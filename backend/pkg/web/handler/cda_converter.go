package handler

import (
	"bytes"
	"context"
	"crypto/sha1"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/fastenhealth/fasten-onprem/backend/pkg"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/config"
	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"
)

// C-CDA / CCD import (#254). Manual upload is otherwise FHIR-JSON/NDJSON only. When a raw
// C-CDA XML document is uploaded, we convert it to a FHIR R4 bundle via the external
// fhir-converter sidecar (Metriport) and then feed it through the existing import pipeline
// unchanged. Conversion is opt-in (cda_converter.enabled) and the sidecar is internal-only
// (raw CCD is PHI).

// looksLikeCDA reports whether the uploaded bytes are a C-CDA (HL7 CDA R2) XML document
// rather than a FHIR JSON/NDJSON bundle. We require both an XML root and the ClinicalDocument
// element so a stray FHIR-XML upload doesn't get mis-routed to the converter.
func looksLikeCDA(data []byte) bool {
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 || trimmed[0] != '<' {
		return false
	}
	return bytes.Contains(trimmed, []byte("ClinicalDocument"))
}

// cdaPatientID derives a STABLE patient id from the CDA recordTarget/patientRole/id. The
// fhir-converter uses the patientId we pass as the FHIR Patient.id, so it must be deterministic
// per patient — otherwise re-importing the same person's documents mints a new Patient each time
// and breaks idempotent dedup (#252, confirmed in #254 Phase 0). Falls back to hashing the whole
// document when no record-target id is present (still deterministic per document).
func cdaPatientID(cdaXML []byte) string {
	var doc struct {
		RecordTarget []struct {
			PatientRole struct {
				ID []struct {
					Root      string `xml:"root,attr"`
					Extension string `xml:"extension,attr"`
				} `xml:"id"`
			} `xml:"patientRole"`
		} `xml:"recordTarget"`
	}
	seed := ""
	if err := xml.Unmarshal(cdaXML, &doc); err == nil {
		for _, rt := range doc.RecordTarget {
			for _, id := range rt.PatientRole.ID {
				if id.Root != "" || id.Extension != "" {
					seed = id.Root + "|" + id.Extension
					break
				}
			}
			if seed != "" {
				break
			}
		}
	}
	if seed == "" {
		seed = string(cdaXML)
	}
	sum := sha1.Sum([]byte(seed))
	return fmt.Sprintf("cda-%x", sum[:8]) // 16 hex chars — a valid, stable FHIR id
}

// convertCDAToFHIR posts a raw C-CDA document to the fhir-converter sidecar and returns the
// unwrapped FHIR R4 Bundle JSON. The converter wraps its output as {"fhirResource": <Bundle>}
// (#254 Phase 0). Returns actionable errors when conversion is disabled or the sidecar is
// unreachable, so the caller can surface them without affecting FHIR/NDJSON import.
func convertCDAToFHIR(ctx context.Context, cfg config.Interface, cdaXML []byte, patientID string) ([]byte, error) {
	if !cfg.GetBool("cda_converter.enabled") {
		return nil, fmt.Errorf("C-CDA import is not enabled on this server (set cda_converter.enabled)")
	}
	baseURL := cfg.GetString("cda_converter.url")
	if baseURL == "" {
		return nil, fmt.Errorf("C-CDA conversion service is not configured (set cda_converter.url)")
	}
	timeout := cfg.GetInt("cda_converter.timeout_seconds")
	if timeout <= 0 {
		timeout = 60
	}

	endpoint := fmt.Sprintf("%s/api/convert/cda/ccd.hbs?patientId=%s", strings.TrimRight(baseURL, "/"), url.QueryEscape(patientID))
	reqCtx, cancel := context.WithTimeout(ctx, time.Duration(timeout)*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, endpoint, bytes.NewReader(cdaXML))
	if err != nil {
		return nil, fmt.Errorf("building C-CDA converter request: %w", err)
	}
	req.Header.Set("Content-Type", "text/plain")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("C-CDA conversion service unavailable: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading C-CDA converter response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("C-CDA converter returned HTTP %d: %s", resp.StatusCode, truncateForError(body, 300))
	}

	var envelope struct {
		FhirResource json.RawMessage `json:"fhirResource"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		return nil, fmt.Errorf("parsing C-CDA converter response: %w", err)
	}
	if len(bytes.TrimSpace(envelope.FhirResource)) == 0 {
		return nil, fmt.Errorf("C-CDA converter response missing fhirResource")
	}
	return envelope.FhirResource, nil
}

// maybeConvertCDA inspects the uploaded bundle; if it's a C-CDA document it converts it to a
// FHIR R4 bundle via the sidecar and returns a new temp file holding the converted JSON. FHIR
// JSON/NDJSON uploads are returned unchanged (rewound). The original raw-CDA temp file is removed
// once converted.
func maybeConvertCDA(c *gin.Context, logger *logrus.Entry, bundleFile *os.File) (*os.File, error) {
	data, err := io.ReadAll(bundleFile)
	if err != nil {
		return nil, fmt.Errorf("reading uploaded file: %w", err)
	}
	if !looksLikeCDA(data) {
		if _, err := bundleFile.Seek(0, io.SeekStart); err != nil {
			return nil, err
		}
		return bundleFile, nil
	}

	cfg := c.MustGet(pkg.ContextKeyTypeConfig).(config.Interface)
	patientID := cdaPatientID(data)
	logger.Infof("detected C-CDA upload — converting via sidecar (patientId=%s, %d bytes)", patientID, len(data))

	fhirBytes, err := convertCDAToFHIR(c.Request.Context(), cfg, data, patientID)
	if err != nil {
		return nil, err
	}

	converted, err := os.CreateTemp("", "fasten-cda-converted-*.json")
	if err != nil {
		return nil, fmt.Errorf("creating converted temp file: %w", err)
	}
	if _, err := converted.Write(fhirBytes); err != nil {
		converted.Close()
		return nil, fmt.Errorf("writing converted bundle: %w", err)
	}
	if _, err := converted.Seek(0, io.SeekStart); err != nil {
		converted.Close()
		return nil, err
	}

	// best-effort cleanup of the original raw-CDA temp file
	origName := bundleFile.Name()
	_ = bundleFile.Close()
	_ = os.Remove(origName)
	return converted, nil
}

func truncateForError(b []byte, n int) string {
	if len(b) > n {
		return string(b[:n]) + "…"
	}
	return string(b)
}
