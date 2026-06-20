// Package allergyintolerance classifies a patient's AllergyIntolerance resources for legible display:
// it synthesizes a patient-legible verification label (Confirmed / Presumed / Unconfirmed / Refuted)
// and a display state from clinicalStatus gated by verificationStatus, and resolves "who said this".
//
// Classify is a pure, stateless derivation over the raw FHIR JSON — no database, no HTTP — so the
// rules are unit-testable in isolation. The "no guessing" principle is load-bearing: verification,
// state, and provenance come only from explicit signals; nothing is fabricated, and the only resource
// dropped is one the record itself marks entered-in-error. Allergies are NOT deduped — one output row
// per input (report facts as the source provided them), mirroring pkg/condition.
package allergyintolerance

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/fastenhealth/fasten-onprem/backend/pkg/provenance"
)

// State drives where an allergy displays. Derived from clinicalStatus, gated first by
// verificationStatus (refuted -> RuledOut).
const (
	StateActive   = "Active"   // clinicalStatus active
	StateInactive = "Inactive" // clinicalStatus inactive
	StateResolved = "Resolved" // clinicalStatus resolved
	StateUnknown  = "Unknown"  // status absent/unrecognized -> shown, never assumed
	StateRuledOut = "RuledOut" // verificationStatus refuted -> determined not to be an allergy
)

// Verification is the patient-legible "how sure are we" label, mapped 1:1 from FHIR
// AllergyIntolerance.verificationStatus (entered-in-error is dropped, not labeled).
const (
	VerifConfirmed   = "Confirmed"
	VerifPresumed    = "Presumed"
	VerifUnconfirmed = "Unconfirmed"
	VerifRefuted     = "Refuted"
	VerifUnknown     = "Unknown" // verificationStatus absent — never assume "Confirmed"
)

// InputResource is one stored AllergyIntolerance row.
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

// Reaction is a legible reaction row: manifestation labels + description + severity, as stated.
type Reaction struct {
	Manifestations []string `json:"manifestations,omitempty"`
	Description    string   `json:"description,omitempty"`
	Severity       string   `json:"severity,omitempty"` // mild | moderate | severe
}

// ClassifiedAllergy is one AllergyIntolerance with its synthesized verification label + display state
// and the legible display fields. The raw record is never mutated; this is a read-time view-model.
type ClassifiedAllergy struct {
	SourceResourceType string `json:"sourceResourceType"`
	SourceResourceID   string `json:"sourceResourceId"`
	SourceID           string `json:"sourceId"`
	Title              string `json:"title"`
	State              string `json:"state"`
	Verification       string `json:"verification"`
	SelfReported       bool   `json:"selfReported"`

	ClinicalStatus     string   `json:"clinicalStatus,omitempty"`
	VerificationStatus string   `json:"verificationStatus,omitempty"`
	Type               string   `json:"type,omitempty"`       // allergy | intolerance
	Categories         []string `json:"categories,omitempty"` // food | medication | environment | biologic
	Criticality        string   `json:"criticality,omitempty"`

	Reactions       []Reaction `json:"reactions,omitempty"`
	Onset           string     `json:"onset,omitempty"`
	Recorded        string     `json:"recorded,omitempty"`
	Note            string     `json:"note,omitempty"`
	StandardCodings []Coding   `json:"standardCodings,omitempty"`

	// Provenance ("who said this") — resolved against the other stored resources; nil when no
	// resolver is supplied. SelfReported is the quick flag; this is the fuller answer.
	Provenance *provenance.Provenance `json:"provenance,omitempty"`
}

// Classify returns one ClassifiedAllergy per input (in input order), except records marked
// entered-in-error, which are omitted. `now` is reserved for future date-based rules (signature
// symmetry with condition.Classify / medication.Reconcile).
//
// resolver and sourceLabel are optional (pass nil for both to skip provenance in pure unit tests).
func Classify(resources []InputResource, now time.Time, resolver *provenance.ResourceSet, sourceLabel func(sourceID string) string) []ClassifiedAllergy {
	out := make([]ClassifiedAllergy, 0, len(resources))
	for _, res := range resources {
		var raw rawAllergy
		if err := json.Unmarshal(res.Raw, &raw); err != nil {
			continue // unparseable record — skip rather than emit garbage
		}

		verif := conceptCode(raw.VerificationStatus)
		if verif == "entered-in-error" {
			continue // the record says this was a mistake — honor it, omit entirely
		}

		ca := ClassifiedAllergy{
			SourceResourceType: res.SourceResourceType,
			SourceResourceID:   res.SourceResourceID,
			SourceID:           res.SourceID,
			Title:              raw.title(),
			State:              resolveState(conceptCode(raw.ClinicalStatus), verif),
			Verification:       verificationLabel(verif),
			SelfReported:       patientAsserted(&raw),
			ClinicalStatus:     conceptCode(raw.ClinicalStatus),
			VerificationStatus: verif,
			Type:               raw.Type,
			Categories:         raw.Category,
			Criticality:        raw.Criticality,
			Reactions:          raw.reactions(),
			Onset:              raw.onset(),
			Recorded:           raw.RecordedDate,
			Note:               raw.noteText(),
			StandardCodings:    standardCodings(raw.Code),
		}

		if resolver != nil {
			label := ""
			if sourceLabel != nil {
				label = sourceLabel(res.SourceID)
			}
			prov := resolver.ResolveProvenance(provenance.Request{
				Authors:      []provenance.Reference{provRef(raw.Asserter), provRef(raw.Recorder)},
				Encounter:    provRef(raw.Encounter),
				TargetType:   res.SourceResourceType,
				TargetID:     res.SourceResourceID,
				SourceLabel:  label,
				AuthoredTime: raw.RecordedDate, // AllergyIntolerance.recordedDate = USCDI Author Time Stamp
			})
			ca.Provenance = &prov
		}

		out = append(out, ca)
	}
	return out
}

// resolveState derives the display state: verificationStatus gates first (refuted -> RuledOut),
// otherwise clinicalStatus is authoritative; an unrecognized/absent status stays Unknown (never assumed).
func resolveState(clinical, verif string) string {
	if verif == "refuted" {
		return StateRuledOut
	}
	switch clinical {
	case "active":
		return StateActive
	case "inactive":
		return StateInactive
	case "resolved":
		return StateResolved
	default:
		return StateUnknown
	}
}

// verificationLabel maps the FHIR verificationStatus code to a patient-legible label. An absent status
// is "Unknown" — we never upgrade silence to "Confirmed". An unrecognized non-empty code passes through
// title-cased (explicit signal, not a guess).
func verificationLabel(verif string) string {
	switch verif {
	case "confirmed":
		return VerifConfirmed
	case "presumed":
		return VerifPresumed
	case "unconfirmed":
		return VerifUnconfirmed
	case "refuted":
		return VerifRefuted
	case "":
		return VerifUnknown
	default:
		return titleFirst(verif)
	}
}

func titleFirst(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

// patientAsserted reports whether the patient (or a related person) is the source: an explicit
// Patient/RelatedPerson asserter, or — absent an asserter — a Patient/RelatedPerson recorder.
func patientAsserted(raw *rawAllergy) bool {
	if refIsType(raw.Asserter, "Patient") || refIsType(raw.Asserter, "RelatedPerson") {
		return true
	}
	if raw.Asserter == nil {
		return refIsType(raw.Recorder, "Patient") || refIsType(raw.Recorder, "RelatedPerson")
	}
	return false
}

// provRef converts a parsed FHIR reference to a provenance.Reference (zero value when absent).
func provRef(ref *fhirReference) provenance.Reference {
	if ref == nil {
		return provenance.Reference{}
	}
	return provenance.Reference{Reference: ref.Reference, Display: ref.Display}
}
