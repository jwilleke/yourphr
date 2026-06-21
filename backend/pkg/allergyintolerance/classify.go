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
	NoKnown            bool   `json:"noKnown,omitempty"` // a "no known allergy" negation, not an allergy — exclude from counts (#290)

	ClinicalStatus     string   `json:"clinicalStatus,omitempty"`
	VerificationStatus string   `json:"verificationStatus,omitempty"`
	Type               string   `json:"type,omitempty"`       // allergy | intolerance
	Categories         []string `json:"categories,omitempty"` // food | medication | environment | biologic
	Criticality        string   `json:"criticality,omitempty"`

	Reactions       []Reaction `json:"reactions,omitempty"`
	Onset           string     `json:"onset,omitempty"`
	Recorded        string     `json:"recorded,omitempty"`
	Start           string     `json:"start,omitempty"`        // earliest stated date (onset, else recorded); deduped: earliest across merged records
	End             string     `json:"end,omitempty"`          // latest stated date (lastOccurrence, else recorded); deduped: latest across merged records
	LastActivity    string     `json:"lastActivity,omitempty"` // = End; sort key for the list view
	Occurrences     int        `json:"occurrences,omitempty"`  // number of source records merged into this entry (#290 dedupe)
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
	perRecord := make([]ClassifiedAllergy, 0, len(resources))
	for _, res := range resources {
		var raw rawAllergy
		if err := json.Unmarshal(res.Raw, &raw); err != nil {
			continue // unparseable record — skip rather than emit garbage
		}

		verif := conceptCode(raw.VerificationStatus)
		if verif == "entered-in-error" {
			continue // the record says this was a mistake — honor it, omit entirely
		}

		start := firstNonEmpty(raw.onset(), raw.RecordedDate)
		end := firstNonEmpty(raw.LastOccurrence, raw.RecordedDate)
		ca := ClassifiedAllergy{
			SourceResourceType: res.SourceResourceType,
			SourceResourceID:   res.SourceResourceID,
			SourceID:           res.SourceID,
			Title:              raw.title(),
			State:              resolveState(conceptCode(raw.ClinicalStatus), verif),
			Verification:       verificationLabel(verif),
			SelfReported:       patientAsserted(&raw),
			NoKnown:            raw.noKnown(),
			ClinicalStatus:     conceptCode(raw.ClinicalStatus),
			VerificationStatus: verif,
			Type:               raw.Type,
			Categories:         raw.Category,
			Criticality:        raw.Criticality,
			Reactions:          raw.reactions(),
			Onset:              raw.onset(),
			Recorded:           raw.RecordedDate,
			Start:              start,
			End:                end,
			LastActivity:       end,
			Occurrences:        1,
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

		perRecord = append(perRecord, ca)
	}
	return dedupeAllergies(perRecord)
}

// dedupeAllergies collapses records describing the SAME substance (by standard code, else normalized
// title) into ONE entry — the same allergy (or the same "no known" assertion) recorded across many
// encounters must appear once, not repeated per encounter (#290). Merged: Start = earliest, End /
// LastActivity = latest, Occurrences = count; the representative state/verification/criticality/
// provenance come from the most-recently-recorded member (latest known status); reactions + categories
// are unioned. Group order follows first appearance (stable).
func dedupeAllergies(in []ClassifiedAllergy) []ClassifiedAllergy {
	order := make([]string, 0, len(in))
	groups := make(map[string][]ClassifiedAllergy)
	for _, c := range in {
		k := allergyDedupKey(c)
		if _, ok := groups[k]; !ok {
			order = append(order, k)
		}
		groups[k] = append(groups[k], c)
	}
	out := make([]ClassifiedAllergy, 0, len(order))
	for _, k := range order {
		out = append(out, mergeAllergyGroup(groups[k]))
	}
	return out
}

// allergyDedupKey identifies "the same substance": the first standard coding (system|code), else the
// normalized title. Distinct negations (e.g. "no known food" vs "no known drug") have distinct codes
// and stay separate, as they should.
func allergyDedupKey(c ClassifiedAllergy) string {
	for _, cd := range c.StandardCodings {
		if cd.Code != "" {
			return "code:" + strings.ToLower(cd.System) + "|" + strings.ToLower(cd.Code)
		}
	}
	return "title:" + strings.ToLower(strings.TrimSpace(c.Title))
}

func mergeAllergyGroup(g []ClassifiedAllergy) ClassifiedAllergy {
	rep := g[0]
	for _, c := range g[1:] {
		if allergyRecency(c) > allergyRecency(rep) {
			rep = c // most-recently-recorded member drives the current status fields
		}
	}
	merged := rep
	merged.Occurrences = len(g)
	for _, c := range g {
		merged.Start = earlierDate(merged.Start, c.Start)
		merged.End = laterDate(merged.End, c.End)
		merged.NoKnown = merged.NoKnown || c.NoKnown
		merged.Categories = unionStrings(merged.Categories, c.Categories)
		merged.Reactions = mergeReactions(merged.Reactions, c.Reactions)
	}
	merged.LastActivity = merged.End
	return merged
}

// allergyRecency is the sort key for "most recent record" within a dedupe group.
func allergyRecency(c ClassifiedAllergy) string {
	return firstNonEmpty(c.Recorded, c.End, c.Start)
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
