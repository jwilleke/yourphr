// Package procedure classifies a patient's Procedure resources for legible display: it maps the FHIR
// status to a legible state (Completed / NotDone / Stopped / …), surfaces body sites + reason + outcome,
// and resolves "who performed it".
//
// Classify is a pure, stateless derivation over the raw FHIR JSON — no database, no HTTP. The "no
// guessing" principle holds: state, body site, and provenance come only from explicit signals; an
// absent/unrecognized status is "Unknown" and an entered-in-error record is dropped. One output row
// per input, mirroring the other Layer-1 packages.
package procedure

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/fastenhealth/fasten-onprem/backend/pkg/provenance"
)

// State is the legible status, mapped from FHIR Procedure.status (entered-in-error is dropped).
const (
	StateCompleted   = "Completed"
	StateNotDone     = "NotDone"
	StateStopped     = "Stopped" // FHIR "stopped" — aborted/abandoned
	StateInProgress  = "InProgress"
	StateOnHold      = "OnHold"
	StatePreparation = "Preparation"
	StateUnknown     = "Unknown" // status absent/unrecognized — never assumed
)

// InputResource is one stored Procedure row.
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

// ClassifiedProcedure is one Procedure with its synthesized state + legible display fields. The raw
// record is never mutated; this is a read-time view-model.
type ClassifiedProcedure struct {
	SourceResourceType string `json:"sourceResourceType"`
	SourceResourceID   string `json:"sourceResourceId"`
	SourceID           string `json:"sourceId"`
	Title              string `json:"title"`
	State              string `json:"state"`
	SelfReported       bool   `json:"selfReported"`

	Status          string   `json:"status,omitempty"` // raw FHIR status
	StatusReason    string   `json:"statusReason,omitempty"`
	Category        string   `json:"category,omitempty"`
	Performed       string   `json:"performed,omitempty"`
	BodySites       []string `json:"bodySites,omitempty"`
	Reasons         []string `json:"reasons,omitempty"`
	Outcome         string   `json:"outcome,omitempty"`
	Note            string   `json:"note,omitempty"`
	StandardCodings []Coding `json:"standardCodings,omitempty"`

	// Provenance ("who performed this") — resolved via the shared resolver (asserter/recorder/
	// performer.actor); nil when no resolver is supplied.
	Provenance *provenance.Provenance `json:"provenance,omitempty"`
}

// Classify returns one ClassifiedProcedure per input (in input order), except records marked
// entered-in-error. `now` is reserved for future date-based rules.
//
// resolver and sourceLabel are optional (pass nil for both to skip provenance in pure unit tests).
func Classify(resources []InputResource, now time.Time, resolver *provenance.ResourceSet, sourceLabel func(sourceID string) string) []ClassifiedProcedure {
	out := make([]ClassifiedProcedure, 0, len(resources))
	for _, res := range resources {
		var raw rawProcedure
		if err := json.Unmarshal(res.Raw, &raw); err != nil {
			continue
		}
		if strings.ToLower(raw.Status) == "entered-in-error" {
			continue // the record says this was a mistake — honor it, omit entirely
		}

		cp := ClassifiedProcedure{
			SourceResourceType: res.SourceResourceType,
			SourceResourceID:   res.SourceResourceID,
			SourceID:           res.SourceID,
			Title:              raw.title(),
			State:              stateLabel(raw.Status),
			SelfReported:       patientAsserted(&raw),
			Status:             raw.Status,
			StatusReason:       conceptText(raw.StatusReason),
			Category:           conceptText(raw.Category),
			Performed:          raw.performed(),
			BodySites:          raw.bodySites(),
			Reasons:            raw.reasons(),
			Outcome:            conceptText(raw.Outcome),
			Note:               raw.noteText(),
			StandardCodings:    standardCodings(raw.Code),
		}

		if resolver != nil {
			label := ""
			if sourceLabel != nil {
				label = sourceLabel(res.SourceID)
			}
			authors := []provenance.Reference{provRef(raw.Asserter), provRef(raw.Recorder)}
			for _, p := range raw.Performer {
				if p.Actor != nil && p.Actor.Reference != "" {
					authors = append(authors, provenance.Reference{Reference: p.Actor.Reference, Display: p.Actor.Display})
				}
			}
			prov := resolver.ResolveProvenance(provenance.Request{
				Authors:     authors,
				Encounter:   provRef(raw.Encounter),
				TargetType:  res.SourceResourceType,
				TargetID:    res.SourceResourceID,
				SourceLabel: label,
				// Procedure has no recordedDate/authoredOn (no USCDI author time stamp); leave it empty
				// rather than conflate the performed-on date with when it was authored.
			})
			cp.Provenance = &prov
		}

		out = append(out, cp)
	}
	return out
}

func stateLabel(status string) string {
	switch strings.ToLower(status) {
	case "completed":
		return StateCompleted
	case "not-done":
		return StateNotDone
	case "stopped":
		return StateStopped
	case "in-progress":
		return StateInProgress
	case "on-hold":
		return StateOnHold
	case "preparation":
		return StatePreparation
	default:
		return StateUnknown
	}
}

// patientAsserted reports whether the patient/related person is the source (asserter, or recorder when
// no asserter).
func patientAsserted(raw *rawProcedure) bool {
	if refIsType(raw.Asserter, "Patient") || refIsType(raw.Asserter, "RelatedPerson") {
		return true
	}
	if raw.Asserter == nil {
		return refIsType(raw.Recorder, "Patient") || refIsType(raw.Recorder, "RelatedPerson")
	}
	return false
}

func provRef(ref *fhirReference) provenance.Reference {
	if ref == nil {
		return provenance.Reference{}
	}
	return provenance.Reference{Reference: ref.Reference, Display: ref.Display}
}
