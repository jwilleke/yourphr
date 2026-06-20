// Package diagnosticreport classifies a patient's DiagnosticReport resources for legible display: it
// maps the status to a legible state, synthesizes a legible service category (Laboratory / Imaging /
// Pathology) from the stated category code, and resolves "who reported it".
//
// Classify is a pure, stateless derivation over the raw FHIR JSON — no database, no HTTP. The "no
// guessing" principle holds: state and category come only from explicit signals (absent category ->
// empty, never inferred from the code); entered-in-error is dropped. One row per input.
package diagnosticreport

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/fastenhealth/fasten-onprem/backend/pkg/provenance"
)

// State is the legible report status, mapped from FHIR DiagnosticReport.status (entered-in-error dropped).
const (
	StateFinal       = "Final"       // final / amended / corrected / appended
	StatePreliminary = "Preliminary" // registered / partial / preliminary
	StateCancelled   = "Cancelled"
	StateUnknown     = "Unknown"
)

// InputResource is one stored DiagnosticReport row.
type InputResource struct {
	SourceResourceType string
	SourceResourceID   string
	SourceID           string
	Raw                json.RawMessage
}

// Coding is a fidelity passthrough of an original FHIR coding.
type Coding struct {
	System  string `json:"system,omitempty"`
	Code    string `json:"code,omitempty"`
	Display string `json:"display,omitempty"`
}

// ClassifiedDiagnosticReport is one DiagnosticReport with its synthesized state + category and legible
// display fields. The raw record is never mutated; this is a read-time view-model.
type ClassifiedDiagnosticReport struct {
	SourceResourceType string `json:"sourceResourceType"`
	SourceResourceID   string `json:"sourceResourceId"`
	SourceID           string `json:"sourceId"`
	Title              string `json:"title"`
	State              string `json:"state"`
	Category           string `json:"category,omitempty"` // legible service category

	Status          string   `json:"status,omitempty"` // raw FHIR status
	Effective       string   `json:"effective,omitempty"`
	Issued          string   `json:"issued,omitempty"`
	Conclusion      string   `json:"conclusion,omitempty"`
	ResultCount     int      `json:"resultCount,omitempty"` // number of linked result Observations
	StandardCodings []Coding `json:"standardCodings,omitempty"`

	// Provenance ("who reported this") — resolved via the shared resolver (performer /
	// resultsInterpreter); nil when no resolver is supplied.
	Provenance *provenance.Provenance `json:"provenance,omitempty"`
}

// Classify returns one ClassifiedDiagnosticReport per input (in input order), except entered-in-error.
//
// resolver and sourceLabel are optional (pass nil for both to skip provenance in pure unit tests).
func Classify(resources []InputResource, now time.Time, resolver *provenance.ResourceSet, sourceLabel func(sourceID string) string) []ClassifiedDiagnosticReport {
	out := make([]ClassifiedDiagnosticReport, 0, len(resources))
	for _, res := range resources {
		var raw rawDiagnosticReport
		if err := json.Unmarshal(res.Raw, &raw); err != nil {
			continue
		}
		if strings.ToLower(raw.Status) == "entered-in-error" {
			continue
		}

		cd := ClassifiedDiagnosticReport{
			SourceResourceType: res.SourceResourceType,
			SourceResourceID:   res.SourceResourceID,
			SourceID:           res.SourceID,
			Title:              raw.title(),
			State:              stateLabel(raw.Status),
			Category:           raw.serviceCategory(),
			Status:             raw.Status,
			Effective:          raw.effective(),
			Issued:             raw.Issued,
			Conclusion:         raw.Conclusion,
			ResultCount:        len(raw.Result),
			StandardCodings:    standardCodings(raw.Code),
		}

		if resolver != nil {
			label := ""
			if sourceLabel != nil {
				label = sourceLabel(res.SourceID)
			}
			var authors []provenance.Reference
			for _, p := range raw.Performer {
				if p.Reference != "" {
					authors = append(authors, provenance.Reference{Reference: p.Reference, Display: p.Display})
				}
			}
			for _, ri := range raw.ResultsInterpreter {
				if ri.Reference != "" {
					authors = append(authors, provenance.Reference{Reference: ri.Reference, Display: ri.Display})
				}
			}
			prov := resolver.ResolveProvenance(provenance.Request{
				Authors:      authors,
				Encounter:    provRef(raw.Encounter),
				TargetType:   res.SourceResourceType,
				TargetID:     res.SourceResourceID,
				SourceLabel:  label,
				AuthoredTime: raw.Issued, // DiagnosticReport.issued = when released
			})
			cd.Provenance = &prov
		}

		out = append(out, cd)
	}
	return out
}

func stateLabel(status string) string {
	switch strings.ToLower(status) {
	case "final", "amended", "corrected", "appended":
		return StateFinal
	case "registered", "partial", "preliminary":
		return StatePreliminary
	case "cancelled":
		return StateCancelled
	default:
		return StateUnknown
	}
}

func provRef(ref *fhirReference) provenance.Reference {
	if ref == nil {
		return provenance.Reference{}
	}
	return provenance.Reference{Reference: ref.Reference, Display: ref.Display}
}
