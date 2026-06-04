// Replacement for github.com/fastenhealth/fasten-sources/clients/factory.
// GetSourceClient returns a file-import client for manual sources and the generic SMART on
// FHIR R4 client (clients/smart) for live EHR sources — no commercial Fasten Lighthouse
// dependency (see fastenhealth/fasten-onprem#629 and EPIC #20).
package factory

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"github.com/fastenhealth/fasten-sources/clients/models"
	"github.com/fastenhealth/fasten-sources/pkg"
	"github.com/sirupsen/logrus"
)

// GetSourceClient returns a source client. For manual/fasten platform types it returns a
// file-import client; for live EHR sources it returns the generic SMART-R4 client.
func GetSourceClient(
	env pkg.FastenLighthouseEnvType,
	ctx context.Context,
	logger *logrus.Entry,
	cred models.SourceCredential,
) (models.SourceClient, error) {
	platformType := cred.GetPlatformType()
	if platformType == pkg.PlatformTypeManual || platformType == pkg.PlatformTypeFasten || platformType == "" {
		return &fileImportClient{ctx: ctx, logger: logger, cred: cred}, nil
	}
	// EHR / live SMART on FHIR providers: drive the generic SMART-R4 client (EPIC #20, #49).
	return newSmartClient(ctx, logger, cred), nil
}

// fileImportClient implements SourceClient for manual FHIR file import (JSON Bundle / NDJSON).
type fileImportClient struct {
	ctx    context.Context
	logger *logrus.Entry
	cred   models.SourceCredential
}

func (c *fileImportClient) GetLogger() *logrus.Entry { return c.logger }

func (c *fileImportClient) GetSourceCredential() models.SourceCredential { return c.cred }

func (c *fileImportClient) SyncAll(db models.DatabaseRepository) (models.UpsertSummary, error) {
	return models.UpsertSummary{}, fmt.Errorf("SyncAll not implemented — use SyncAllBundle for file import")
}

func (c *fileImportClient) SyncAllByResourceName(db models.DatabaseRepository, resourceNames []string) (models.UpsertSummary, error) {
	return models.UpsertSummary{}, fmt.Errorf("SyncAllByResourceName not available in open-source build")
}

func (c *fileImportClient) GetRequest(resourceSubpath string, decodeTarget interface{}) (interface{}, error) {
	return nil, fmt.Errorf("GetRequest not available in open-source build")
}

// ExtractPatientId reads the bundle to find the Patient resource ID and detect the FHIR version.
// Seeks back to the beginning of the reader after reading, so SyncAllBundle can read the same data.
func (c *fileImportClient) ExtractPatientId(bundleFile io.Reader) (string, pkg.FhirVersionType, error) {
	data, err := io.ReadAll(bundleFile)
	if err != nil {
		return "", pkg.FhirVersion401, err
	}
	// Seek back to the start so the caller can pass the same reader to SyncAllBundle.
	if seeker, ok := bundleFile.(io.Seeker); ok {
		seeker.Seek(0, 0)
	}
	patientId := extractPatientIdFromBytes(data)
	return patientId, pkg.FhirVersion401, nil
}

// SyncAllBundle reads a FHIR Bundle (JSON or NDJSON) and upserts each resource via db.
func (c *fileImportClient) SyncAllBundle(db models.DatabaseRepository, bundleFile io.Reader, fhirVersion pkg.FhirVersionType) (models.UpsertSummary, error) {
	data, err := io.ReadAll(bundleFile)
	if err != nil {
		return models.UpsertSummary{}, fmt.Errorf("reading bundle: %w", err)
	}

	resources, err := extractResources(data)
	if err != nil {
		return models.UpsertSummary{}, fmt.Errorf("parsing bundle: %w", err)
	}

	summary := models.UpsertSummary{}
	for _, raw := range resources {
		var header struct {
			ResourceType string `json:"resourceType"`
			ID           string `json:"id"`
		}
		if err := json.Unmarshal(raw, &header); err != nil || header.ResourceType == "" || header.ID == "" {
			continue
		}
		rawResource := models.RawResourceFhir{
			SourceResourceType:  header.ResourceType,
			SourceResourceID:    header.ID,
			ResourceRaw:         raw,
			ReferencedResources: extractFHIRReferences(raw),
		}
		_, err := db.UpsertRawResource(c.ctx, c.cred, rawResource)
		if err != nil {
			if c.logger != nil {
				c.logger.Warnf("error upserting %s/%s: %v", header.ResourceType, header.ID, err)
			}
			continue
		}
		ref := fmt.Sprintf("%s/%s", header.ResourceType, header.ID)
		summary.TotalResources++
		summary.UpdatedResources = append(summary.UpdatedResources, ref)
	}
	return summary, nil
}

// extractResources handles both NDJSON (one JSON object per line) and JSON Bundle formats.
func extractResources(data []byte) ([]json.RawMessage, error) {
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 {
		return nil, nil
	}

	// Try JSON Bundle (single valid JSON object/array) first.
	// json.Valid returns false for multi-line NDJSON (multiple root objects).
	if json.Valid(trimmed) {
		var bundle struct {
			ResourceType string            `json:"resourceType"`
			Contained    []json.RawMessage `json:"contained"`
			Entry        []struct {
				FullURL  string          `json:"fullUrl"`
				Resource json.RawMessage `json:"resource"`
			} `json:"entry"`
		}
		if err := json.Unmarshal(trimmed, &bundle); err == nil && bundle.ResourceType == "List" {
			// FHIR List with contained resources (used by CreateRelatedResources handler)
			return bundle.Contained, nil
		}
		if err := json.Unmarshal(trimmed, &bundle); err == nil && bundle.ResourceType == "Bundle" {
			// Build fullUrl → "ResourceType/id" lookup for resolving urn:uuid: references.
			urlToRef := make(map[string]string, len(bundle.Entry))
			for _, e := range bundle.Entry {
				if e.FullURL == "" || len(e.Resource) == 0 {
					continue
				}
				var hdr struct {
					ResourceType string `json:"resourceType"`
					ID           string `json:"id"`
				}
				if json.Unmarshal(e.Resource, &hdr) == nil && hdr.ResourceType != "" && hdr.ID != "" {
					urlToRef[e.FullURL] = hdr.ResourceType + "/" + hdr.ID
				}
			}
			return bundleResources(bundle.Entry, urlToRef), nil
		}
		// Single resource (not a Bundle)
		return []json.RawMessage{trimmed}, nil
	}

	// NDJSON: one JSON resource per line
	var out []json.RawMessage
	scanner := bufio.NewScanner(bytes.NewReader(trimmed))
	scanner.Buffer(make([]byte, 10*1024*1024), 10*1024*1024)
	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		if len(line) == 0 {
			continue
		}
		cp := make(json.RawMessage, len(line))
		copy(cp, line)
		out = append(out, cp)
	}
	return out, scanner.Err()
}

// bundleResources extracts resources from bundle entries, rewriting urn:uuid: references.
func bundleResources(entries []struct {
	FullURL  string          `json:"fullUrl"`
	Resource json.RawMessage `json:"resource"`
}, urlToRef map[string]string) []json.RawMessage {
	var out []json.RawMessage
	for _, e := range entries {
		if len(e.Resource) == 0 {
			continue
		}
		// Rewrite urn:uuid: references in the raw resource JSON.
		raw := e.Resource
		if len(urlToRef) > 0 {
			str := string(raw)
			for urn, ref := range urlToRef {
				// Handle both compact ("reference":"urn:...") and spaced ("reference": "urn:...") JSON
				str = strings.ReplaceAll(str, `"reference":"`+urn+`"`, `"reference":"`+ref+`"`)
				str = strings.ReplaceAll(str, `"reference": "`+urn+`"`, `"reference": "`+ref+`"`)
			}
			raw = json.RawMessage(str)
		}
		out = append(out, raw)
	}
	return out
}

// extractFHIRReferences walks the JSON and collects all {"reference":"..."} values.
// These are FHIR resource references used to build the resource association graph.
func extractFHIRReferences(raw json.RawMessage) []string {
	var refs []string
	var walk func(v interface{})
	walk = func(v interface{}) {
		switch node := v.(type) {
		case map[string]interface{}:
			if ref, ok := node["reference"].(string); ok && ref != "" {
				refs = append(refs, ref)
			}
			for _, child := range node {
				walk(child)
			}
		case []interface{}:
			for _, item := range node {
				walk(item)
			}
		}
	}
	var parsed interface{}
	if err := json.Unmarshal(raw, &parsed); err == nil {
		walk(parsed)
	}
	return refs
}

func extractPatientIdFromBytes(data []byte) string {
	resources, _ := extractResources(data)
	for _, raw := range resources {
		var r struct {
			ResourceType string `json:"resourceType"`
			ID           string `json:"id"`
		}
		if json.Unmarshal(raw, &r) == nil && r.ResourceType == "Patient" {
			return r.ID
		}
	}
	return ""
}
