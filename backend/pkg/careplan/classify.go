// Package careplan classifies a patient's CarePlan resources for legible display: it maps the status
// to a legible state (Active / Draft / Revoked / …), passes through the intent + category, and resolves
// "who authored it".
//
// Classify is a pure, stateless derivation over the raw FHIR JSON — no database, no HTTP. The "no
// guessing" principle holds: state comes only from the explicit status; entered-in-error is dropped.
// One row per input.
package careplan

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/fastenhealth/fasten-onprem/backend/pkg/provenance"
)

// State is the legible status, mapped from FHIR CarePlan.status (entered-in-error dropped).
const (
	StateActive    = "Active"
	StateDraft     = "Draft"
	StateOnHold    = "OnHold"
	StateRevoked   = "Revoked"
	StateCompleted = "Completed"
	StateUnknown   = "Unknown"
)

// InputResource is one stored CarePlan row.
type InputResource struct {
	SourceResourceType string
	SourceResourceID   string
	SourceID           string
	Raw                json.RawMessage
}

// ClassifiedCarePlan is one CarePlan with its synthesized state + legible display fields. The raw
// record is never mutated; this is a read-time view-model.
type ClassifiedCarePlan struct {
	SourceResourceType string `json:"sourceResourceType"`
	SourceResourceID   string `json:"sourceResourceId"`
	SourceID           string `json:"sourceId"`
	Title              string `json:"title"`
	State              string `json:"state"`
	SelfReported       bool   `json:"selfReported"`

	Status         string `json:"status,omitempty"` // raw FHIR status
	Intent         string `json:"intent,omitempty"`
	Category       string `json:"category,omitempty"`
	Description    string `json:"description,omitempty"`
	PeriodStart    string `json:"periodStart,omitempty"`
	PeriodEnd      string `json:"periodEnd,omitempty"`
	GoalCount      int    `json:"goalCount,omitempty"`
	AddressesCount int    `json:"addressesCount,omitempty"`

	// Provenance ("who authored this") via the shared resolver (author / contributor).
	Provenance *provenance.Provenance `json:"provenance,omitempty"`
}

// Classify returns one ClassifiedCarePlan per input (in input order), except entered-in-error.
//
// resolver and sourceLabel are optional (pass nil for both to skip provenance in pure unit tests).
func Classify(resources []InputResource, now time.Time, resolver *provenance.ResourceSet, sourceLabel func(sourceID string) string) []ClassifiedCarePlan {
	out := make([]ClassifiedCarePlan, 0, len(resources))
	for _, res := range resources {
		var raw rawCarePlan
		if err := json.Unmarshal(res.Raw, &raw); err != nil {
			continue
		}
		if strings.ToLower(raw.Status) == "entered-in-error" {
			continue
		}

		cp := ClassifiedCarePlan{
			SourceResourceType: res.SourceResourceType,
			SourceResourceID:   res.SourceResourceID,
			SourceID:           res.SourceID,
			Title:              raw.title(),
			State:              stateLabel(raw.Status),
			SelfReported:       refIsType(raw.Author, "Patient") || refIsType(raw.Author, "RelatedPerson"),
			Status:             raw.Status,
			Intent:             raw.Intent,
			Category:           raw.category(),
			Description:        raw.Description,
			GoalCount:          len(raw.Goal),
			AddressesCount:     len(raw.Addresses),
		}
		if raw.Period != nil {
			cp.PeriodStart, cp.PeriodEnd = raw.Period.Start, raw.Period.End
		}

		if resolver != nil {
			label := ""
			if sourceLabel != nil {
				label = sourceLabel(res.SourceID)
			}
			authors := []provenance.Reference{provRef(raw.Author)}
			for _, ctr := range raw.Contributor {
				if ctr.Reference != "" {
					authors = append(authors, provenance.Reference{Reference: ctr.Reference, Display: ctr.Display})
				}
			}
			prov := resolver.ResolveProvenance(provenance.Request{
				Authors:     authors,
				Encounter:   provRef(raw.Encounter),
				TargetType:  res.SourceResourceType,
				TargetID:    res.SourceResourceID,
				SourceLabel: label,
				// CarePlan has no author-time stamp; leave Recorded empty.
			})
			cp.Provenance = &prov
		}

		out = append(out, cp)
	}
	return out
}

func stateLabel(status string) string {
	switch strings.ToLower(status) {
	case "active":
		return StateActive
	case "draft":
		return StateDraft
	case "on-hold":
		return StateOnHold
	case "revoked":
		return StateRevoked
	case "completed":
		return StateCompleted
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
