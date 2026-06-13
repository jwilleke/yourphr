package condition

import "strings"

// Minimal FHIR R4 Condition shapes — only the fields the classifier needs. JSON unmarshalling
// ignores absent fields. See docs/your-phr-dashboard/phase-1-condition-classifier-spec.md.

type fhirCoding struct {
	System  string `json:"system"`
	Code    string `json:"code"`
	Display string `json:"display"`
}

type fhirCodeableConcept struct {
	Text   string       `json:"text"`
	Coding []fhirCoding `json:"coding"`
}

type fhirReference struct {
	Reference string `json:"reference"`
	Display   string `json:"display"`
}

type fhirIdentifier struct {
	System string `json:"system"`
	Value  string `json:"value"`
}

type fhirAnnotation struct {
	Text string `json:"text"`
}

type fhirPeriod struct {
	Start string `json:"start"`
	End   string `json:"end"`
}

type rawCondition struct {
	ResourceType       string                `json:"resourceType"`
	ID                 string                `json:"id"`
	Identifier         []fhirIdentifier      `json:"identifier"`
	Category           []fhirCodeableConcept `json:"category"`
	ClinicalStatus     *fhirCodeableConcept  `json:"clinicalStatus"`
	VerificationStatus *fhirCodeableConcept  `json:"verificationStatus"`
	Code               *fhirCodeableConcept  `json:"code"`
	Recorder           *fhirReference        `json:"recorder"`
	Asserter           *fhirReference        `json:"asserter"`
	Encounter          *fhirReference        `json:"encounter"`
	OnsetDateTime      string                `json:"onsetDateTime"`
	OnsetPeriod        *fhirPeriod           `json:"onsetPeriod"`
	RecordedDate       string                `json:"recordedDate"`
	AbatementDateTime  string                `json:"abatementDateTime"`
	AbatementPeriod    *fhirPeriod           `json:"abatementPeriod"`
	AbatementString    string                `json:"abatementString"`
	Note               []fhirAnnotation      `json:"note"`
}

// conceptCode returns the first non-empty coding code of a CodeableConcept, lowercased
// (used for clinicalStatus / verificationStatus, whose codes are a small controlled set).
func conceptCode(cc *fhirCodeableConcept) string {
	if cc == nil {
		return ""
	}
	for _, c := range cc.Coding {
		if c.Code != "" {
			return strings.ToLower(c.Code)
		}
	}
	return ""
}

// existingCategory returns the normalized category a source already declared on Condition.category,
// or "" when none is recognized (e.g. FollowMyHealth, which omits category entirely). Matching by
// code keeps it system-agnostic across the standard condition-category and US Core SDOH/health-concern
// code systems. Honoring this is how Layer 1 never re-categorizes a conformant source.
func existingCategory(cats []fhirCodeableConcept) string {
	for _, cc := range cats {
		for _, c := range cc.Coding {
			switch strings.ToLower(c.Code) {
			case "problem-list-item", "encounter-diagnosis":
				return CategoryProblem
			case "sdoh":
				return CategorySDOH
			case "health-concern":
				return CategoryHealthConcern
			}
		}
	}
	return ""
}

// isStandardSystem reports whether a coding system is a recognized clinical terminology
// (ICD-9/10, SNOMED, LOINC) — i.e. a real diagnosis code, not a vendor-internal one.
func isStandardSystem(system string) bool {
	s := strings.ToLower(system)
	return strings.Contains(s, "icd") || strings.Contains(s, "snomed") || strings.Contains(s, "loinc")
}

func hasStandardCode(cc *fhirCodeableConcept) bool {
	if cc == nil {
		return false
	}
	for _, c := range cc.Coding {
		if isStandardSystem(c.System) {
			return true
		}
	}
	return false
}

func hasAnyCoding(cc *fhirCodeableConcept) bool {
	return cc != nil && len(cc.Coding) > 0
}

// standardCodings returns the codings from recognized terminologies (for the detail card /
// clinicians); vendor-internal codes (e.g. FollowMyHealth's id/translation) are dropped.
func standardCodings(cc *fhirCodeableConcept) []Coding {
	if cc == nil {
		return nil
	}
	var out []Coding
	for _, c := range cc.Coding {
		if isStandardSystem(c.System) {
			out = append(out, Coding{System: c.System, Code: c.Code, Display: c.Display})
		}
	}
	return out
}

// vendorTell extracts the FollowMyHealth interface object-type from an identifier value of the
// form "<n>:<guid>:<Type>,<id>" — either "HealthCondition" or "PersonalHealthConsideration".
// Returns "" when no FollowMyHealth tell is present (e.g. conformant sources).
func vendorTell(ids []fhirIdentifier) string {
	for _, id := range ids {
		colon := strings.LastIndex(id.Value, ":")
		if colon == -1 {
			continue
		}
		rest := id.Value[colon+1:]
		comma := strings.Index(rest, ",")
		if comma == -1 {
			continue
		}
		switch rest[:comma] {
		case "HealthCondition":
			return "HealthCondition"
		case "PersonalHealthConsideration":
			return "PersonalHealthConsideration"
		}
	}
	return ""
}

// refIsType reports whether a reference points at the given resource type (e.g. "Patient",
// "Practitioner"). Handles both relative ("Patient/123") and absolute URL references.
func refIsType(ref *fhirReference, typ string) bool {
	if ref == nil {
		return false
	}
	return strings.Contains(ref.Reference, typ+"/")
}

func (r *rawCondition) title() string {
	if r.Code != nil {
		if r.Code.Text != "" {
			return r.Code.Text
		}
		for _, c := range r.Code.Coding {
			if c.Display != "" {
				return c.Display
			}
		}
	}
	return "Unknown condition"
}

func (r *rawCondition) onset() string {
	if r.OnsetDateTime != "" {
		return r.OnsetDateTime
	}
	if r.OnsetPeriod != nil && r.OnsetPeriod.Start != "" {
		return r.OnsetPeriod.Start
	}
	return ""
}

// abated returns the abatement date (resolution or remission date), from any abatement[x] form.
func (r *rawCondition) abated() string {
	if r.AbatementDateTime != "" {
		return r.AbatementDateTime
	}
	if r.AbatementPeriod != nil {
		if r.AbatementPeriod.End != "" {
			return r.AbatementPeriod.End
		}
		if r.AbatementPeriod.Start != "" {
			return r.AbatementPeriod.Start
		}
	}
	return r.AbatementString
}

func (r *rawCondition) noteText() string {
	var parts []string
	for _, n := range r.Note {
		if n.Text != "" {
			parts = append(parts, n.Text)
		}
	}
	return strings.Join(parts, "\n")
}
