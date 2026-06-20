// Package encounter classifies a patient's Encounter resources for legible display: it maps the status
// to a legible state, synthesizes a legible category from the encounter class (Office visit / Inpatient
// / Emergency / Telehealth / …), and resolves "who" (participants / service provider).
//
// Classify is a pure, stateless derivation over the raw FHIR JSON — no database, no HTTP. The "no
// guessing" principle holds: state and category come only from explicit signals (absent class ->
// empty); entered-in-error is dropped. One row per input.
package encounter

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/fastenhealth/fasten-onprem/backend/pkg/provenance"
)

// State is the legible status, mapped from FHIR Encounter.status (entered-in-error dropped).
const (
	StateFinished   = "Finished"
	StateInProgress = "InProgress" // arrived / triaged / in-progress / onleave
	StatePlanned    = "Planned"
	StateCancelled  = "Cancelled"
	StateUnknown    = "Unknown"
)

// InputResource is one stored Encounter row.
type InputResource struct {
	SourceResourceType string
	SourceResourceID   string
	SourceID           string
	Raw                json.RawMessage
}

// ClassifiedEncounter is one Encounter with its synthesized state + legible category and display
// fields. The raw record is never mutated; this is a read-time view-model.
type ClassifiedEncounter struct {
	SourceResourceType string `json:"sourceResourceType"`
	SourceResourceID   string `json:"sourceResourceId"`
	SourceID           string `json:"sourceId"`
	Title              string `json:"title"`
	State              string `json:"state"`
	Category           string `json:"category,omitempty"` // legible encounter class

	Status               string   `json:"status,omitempty"` // raw FHIR status
	PeriodStart          string   `json:"periodStart,omitempty"`
	PeriodEnd            string   `json:"periodEnd,omitempty"`
	Reasons              []string `json:"reasons,omitempty"`
	DischargeDisposition string   `json:"dischargeDisposition,omitempty"`

	// Provenance ("who" — the participating clinician/service provider) via the shared resolver.
	Provenance *provenance.Provenance `json:"provenance,omitempty"`
}

// Classify returns one ClassifiedEncounter per input (in input order), except entered-in-error.
//
// resolver and sourceLabel are optional (pass nil for both to skip provenance in pure unit tests).
func Classify(resources []InputResource, now time.Time, resolver *provenance.ResourceSet, sourceLabel func(sourceID string) string) []ClassifiedEncounter {
	out := make([]ClassifiedEncounter, 0, len(resources))
	for _, res := range resources {
		var raw rawEncounter
		if err := json.Unmarshal(res.Raw, &raw); err != nil {
			continue
		}
		if strings.ToLower(raw.Status) == "entered-in-error" {
			continue
		}

		ce := ClassifiedEncounter{
			SourceResourceType:   res.SourceResourceType,
			SourceResourceID:     res.SourceResourceID,
			SourceID:             res.SourceID,
			Title:                raw.title(),
			State:                stateLabel(raw.Status),
			Category:             raw.category(),
			Status:               raw.Status,
			Reasons:              raw.reasons(),
			DischargeDisposition: raw.dischargeDisposition(),
		}
		if raw.Period != nil {
			ce.PeriodStart, ce.PeriodEnd = raw.Period.Start, raw.Period.End
		}

		if resolver != nil {
			label := ""
			if sourceLabel != nil {
				label = sourceLabel(res.SourceID)
			}
			var authors []provenance.Reference
			for _, p := range raw.Participant {
				if p.Individual != nil && p.Individual.Reference != "" {
					authors = append(authors, provenance.Reference{Reference: p.Individual.Reference, Display: p.Individual.Display})
				}
			}
			if raw.ServiceProvider != nil && raw.ServiceProvider.Reference != "" {
				authors = append(authors, provenance.Reference{Reference: raw.ServiceProvider.Reference, Display: raw.ServiceProvider.Display})
			}
			prov := resolver.ResolveProvenance(provenance.Request{
				Authors:     authors,
				TargetType:  res.SourceResourceType,
				TargetID:    res.SourceResourceID,
				SourceLabel: label,
				// Encounter has no author-time stamp; leave Recorded empty rather than use period.start.
			})
			ce.Provenance = &prov
		}

		out = append(out, ce)
	}
	return out
}

func stateLabel(status string) string {
	switch strings.ToLower(status) {
	case "finished":
		return StateFinished
	case "arrived", "triaged", "in-progress", "onleave":
		return StateInProgress
	case "planned":
		return StatePlanned
	case "cancelled":
		return StateCancelled
	default:
		return StateUnknown
	}
}
