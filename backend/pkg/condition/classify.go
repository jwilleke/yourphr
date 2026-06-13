// Package condition classifies a patient's Condition resources for legible display: it synthesizes
// the standard Condition.category that non-conformant sources (notably FollowMyHealth/Veradigm EHI
// exports) omit, derives a display state from clinicalStatus/abatement/verificationStatus, and
// separates real health problems from social/administrative "Personal Health Conditions".
//
// Classify is a pure, stateless derivation over the raw FHIR JSON — no database, no HTTP — so the
// rules are unit-testable in isolation. The "no guessing" principle is load-bearing: category,
// tier, and state come only from explicit signals in the record; nothing is fabricated, and the
// only resource dropped is one the record itself marks entered-in-error.
//
// Unlike medications, conditions are NOT deduped or merged — one output row per input Condition
// (report facts as the source provided them). See
// docs/your-phr-dashboard/phase-1-condition-classifier-spec.md.
package condition

import (
	"encoding/json"
	"time"

	"github.com/fastenhealth/fasten-onprem/backend/pkg/provenance"
)

// Synthesized FHIR Condition.category values.
const (
	CategoryProblem       = "problem-list-item" // a health problem
	CategorySDOH          = "sdoh"              // social / personal profile
	CategoryHealthConcern = "health-concern"
)

// Display tiers.
const (
	TierClinician    = "clinician"     // coded diagnosis, clinician-attributed
	TierSelfReported = "self-reported" // real condition, patient-asserted
	TierProfile      = "profile"       // personal / social / administrative
)

// State drives where a health problem displays. Derived from clinicalStatus (primary) with
// abatement as a date source + non-conformance safety net, gated first by verificationStatus.
const (
	StateActive    = "Active"    // active / recurrence / relapse
	StateRemission = "Remission" // shown under Current, badged "in remission since <abatement>"
	StateResolved  = "Resolved"  // resolved / inactive (or abated with no status) -> Past Health Problems
	StateUnknown   = "Unknown"   // status absent/unrecognized -> shown, never assumed
	StateRuledOut  = "RuledOut"  // verificationStatus=refuted -> not a current problem
)

// InputResource is one stored Condition row: authoritative type/id/source from the DB row plus the
// full FHIR JSON body.
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

// ClassifiedCondition is one Condition with its synthesized category + tier + state and the display
// fields Phase 1 needs. The raw record is never mutated; this is a read-time view-model.
type ClassifiedCondition struct {
	SourceResourceType string   `json:"sourceResourceType"`
	SourceResourceID   string   `json:"sourceResourceId"`
	SourceID           string   `json:"sourceId"`
	Title              string   `json:"title"`
	Category           string   `json:"category"`
	Tier               string   `json:"tier"`
	State              string   `json:"state"`
	SelfReported       bool     `json:"selfReported"`
	ClinicalStatus     string   `json:"clinicalStatus,omitempty"`
	VerificationStatus string   `json:"verificationStatus,omitempty"`
	Onset              string   `json:"onset,omitempty"`
	Recorded           string   `json:"recorded,omitempty"`
	Abated             string   `json:"abated,omitempty"`
	Note               string   `json:"note,omitempty"`
	StandardCodings    []Coding `json:"standardCodings,omitempty"`

	// Provenance ("who said this") — the named author/self-reported/source, resolved against the
	// other stored resources. nil when no resolver is supplied. SelfReported above is the quick flag;
	// this is the fuller answer.
	Provenance *provenance.Provenance `json:"provenance,omitempty"`
}

// Classify returns one ClassifiedCondition per input (in input order), except resources the record
// marks entered-in-error, which are omitted. `now` is reserved for future date-based rules and kept
// for signature symmetry with medication.Reconcile.
//
// resolver and sourceLabel are optional (pass nil for both to skip provenance — e.g. in pure unit
// tests): when a resolver is supplied, each condition's "who said this" is resolved against the other
// stored resources, and sourceLabel maps a resource's SourceID to a human source name for the floor.
func Classify(resources []InputResource, now time.Time, resolver *provenance.ResourceSet, sourceLabel func(sourceID string) string) []ClassifiedCondition {
	out := make([]ClassifiedCondition, 0, len(resources))
	for _, res := range resources {
		var raw rawCondition
		if err := json.Unmarshal(res.Raw, &raw); err != nil {
			continue // unparseable record — skip rather than emit garbage
		}

		verif := conceptCode(raw.VerificationStatus)
		if verif == "entered-in-error" {
			continue // the record says this was a mistake — honor it, omit entirely (FHIR con-5)
		}

		tier, category, selfReported := classify(&raw)
		state := resolveState(&raw, verif)

		cc := ClassifiedCondition{
			SourceResourceType: res.SourceResourceType,
			SourceResourceID:   res.SourceResourceID,
			SourceID:           res.SourceID,
			Title:              raw.title(),
			Category:           category,
			Tier:               tier,
			State:              state,
			SelfReported:       selfReported,
			ClinicalStatus:     conceptCode(raw.ClinicalStatus),
			VerificationStatus: verif,
			Onset:              raw.onset(),
			Recorded:           raw.RecordedDate,
			Abated:             raw.abated(),
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
				AuthoredTime: raw.RecordedDate, // Condition.recordedDate = USCDI Author Time Stamp
			})
			cc.Provenance = &prov
		}

		out = append(out, cc)
	}
	return out
}

// provRef converts a parsed FHIR reference to a provenance.Reference (zero value when absent).
func provRef(ref *fhirReference) provenance.Reference {
	if ref == nil {
		return provenance.Reference{}
	}
	return provenance.Reference{Reference: ref.Reference, Display: ref.Display}
}

// classify assigns the tier + category. It first HONORS a category the source already declared —
// Layer 1 never re-categorizes a conformant source (that would, e.g., relabel an Epic `sdoh` social
// item as a health problem) — and only synthesizes one when the source omitted it (the FollowMyHealth
// case). Tier (the self-reported vs clinician badge) is always derived from provenance signals.
func classify(raw *rawCondition) (tier, category string, selfReported bool) {
	if existing := existingCategory(raw.Category); existing != "" {
		return tierForCategory(existing, raw)
	}
	return synthesize(raw)
}

// tierForCategory derives the display tier for a category the source already declared. A declared
// social/profile category is authoritative (it lands in Patient Profile); a declared health-problem
// category still distinguishes self-reported from clinician-coded for the badge.
func tierForCategory(category string, raw *rawCondition) (tier, cat string, selfReported bool) {
	switch category {
	case CategorySDOH, CategoryHealthConcern:
		return TierProfile, category, false
	default: // problem-list-item / encounter-diagnosis -> a health problem
		patientAsserted := refIsType(raw.Asserter, "Patient") || (raw.Asserter == nil && refIsType(raw.Recorder, "Patient"))
		if patientAsserted && !hasStandardCode(raw.Code) {
			return TierSelfReported, CategoryProblem, true
		}
		return TierClinician, CategoryProblem, false
	}
}

// synthesize assigns the tier + synthesized category from explicit signals, first-match-wins, with a
// default-to-health-item safety bias: only agreeing signals demote an item to the Patient Profile;
// anything ambiguous stays a health problem (never bury a possible diagnosis). Used only when the
// source did not declare a standard Condition.category.
func synthesize(raw *rawCondition) (tier, category string, selfReported bool) {
	tell := vendorTell(raw.Identifier)
	stdCode := hasStandardCode(raw.Code)
	anyCoding := hasAnyCoding(raw.Code)
	patientAsserted := refIsType(raw.Asserter, "Patient") || (raw.Asserter == nil && refIsType(raw.Recorder, "Patient"))
	clinicianRecorder := refIsType(raw.Asserter, "Practitioner") || refIsType(raw.Recorder, "Practitioner")

	switch {
	case stdCode || tell == "HealthCondition":
		return TierClinician, CategoryProblem, false
	case anyCoding && patientAsserted:
		return TierSelfReported, CategoryProblem, true
	case !anyCoding && tell == "PersonalHealthConsideration" && !clinicianRecorder:
		return TierProfile, CategorySDOH, false
	default:
		return TierClinician, CategoryProblem, false // safety bias
	}
}

// resolveState derives the display state. verificationStatus gates first (refuted -> RuledOut);
// otherwise clinicalStatus is authoritative, with abatement implying Resolved only when no status
// is present (FHIR con-4: an abated condition's status should already be inactive/resolved/remission).
func resolveState(raw *rawCondition, verif string) string {
	if verif == "refuted" {
		return StateRuledOut
	}
	switch conceptCode(raw.ClinicalStatus) {
	case "active", "recurrence", "relapse":
		return StateActive
	case "remission":
		return StateRemission
	case "resolved", "inactive":
		return StateResolved
	default:
		if raw.abated() != "" {
			return StateResolved
		}
		return StateUnknown
	}
}
