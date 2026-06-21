package allergyintolerance

import "strings"

// Minimal FHIR R4 AllergyIntolerance shapes — only the fields the classifier needs. Absent fields
// unmarshal to zero values and are never fabricated. Mirrors the per-package pattern used by
// pkg/condition (each Layer-1 package is self-contained).

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

type fhirAnnotation struct {
	Text string `json:"text"`
}

type fhirPeriod struct {
	Start string `json:"start"`
	End   string `json:"end"`
}

type fhirReaction struct {
	Manifestation []fhirCodeableConcept `json:"manifestation"`
	Description   string                `json:"description"`
	Severity      string                `json:"severity"`
}

type rawAllergy struct {
	ResourceType       string               `json:"resourceType"`
	ID                 string               `json:"id"`
	ClinicalStatus     *fhirCodeableConcept `json:"clinicalStatus"`
	VerificationStatus *fhirCodeableConcept `json:"verificationStatus"`
	Type               string               `json:"type"`     // allergy | intolerance
	Category           []string             `json:"category"` // food | medication | environment | biologic
	Criticality        string               `json:"criticality"`
	Code               *fhirCodeableConcept `json:"code"`
	Recorder           *fhirReference       `json:"recorder"`
	Asserter           *fhirReference       `json:"asserter"`
	Encounter          *fhirReference       `json:"encounter"` // not in R4 AllergyIntolerance; harmless if absent
	OnsetDateTime      string               `json:"onsetDateTime"`
	OnsetPeriod        *fhirPeriod          `json:"onsetPeriod"`
	OnsetString        string               `json:"onsetString"`
	RecordedDate       string               `json:"recordedDate"`
	Reaction           []fhirReaction       `json:"reaction"`
	Note               []fhirAnnotation     `json:"note"`
}

// conceptCode returns the first non-empty coding code of a CodeableConcept, lowercased (for the
// small controlled-vocabulary fields clinicalStatus / verificationStatus).
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

// isStandardSystem reports whether a coding system is a recognized terminology for an allergy
// substance (SNOMED, RxNorm, UNII) or diagnosis (ICD), i.e. a real code, not a vendor-internal one.
func isStandardSystem(system string) bool {
	s := strings.ToLower(system)
	return strings.Contains(s, "snomed") || strings.Contains(s, "rxnorm") ||
		strings.Contains(s, "unii") || strings.Contains(s, "icd") || strings.Contains(s, "ndfrt")
}

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

// refIsType reports whether a reference points at the given resource type.
func refIsType(ref *fhirReference, typ string) bool {
	if ref == nil {
		return false
	}
	return strings.Contains(ref.Reference, typ+"/")
}

// conceptText returns a human label for a CodeableConcept: its text, else the first coding display.
func conceptText(cc *fhirCodeableConcept) string {
	if cc == nil {
		return ""
	}
	if cc.Text != "" {
		return cc.Text
	}
	for _, c := range cc.Coding {
		if c.Display != "" {
			return c.Display
		}
	}
	return ""
}

func (r *rawAllergy) title() string {
	if t := conceptText(r.Code); t != "" {
		return t
	}
	return "Unknown allergy"
}

// noKnownAllergyCodes are the SNOMED CT "no known allergy" NEGATION assertions — a record stating the
// ABSENCE of an allergy, not an allergy. USCDI / US-Core represent "no known allergies" with these.
var noKnownAllergyCodes = map[string]bool{
	"716186003": true, // No known allergy
	"409137002": true, // No known history of drug allergy
	"429625007": true, // No known food allergy
	"428607008": true, // No known environmental allergy
	"716184000": true, // No known latex allergy
}

// noKnown reports whether this AllergyIntolerance is a "no known allergy" NEGATION assertion rather
// than an actual allergy — keyed off the explicit SNOMED negation codes, with a text fallback for
// exports that carry only a "No Known ..." title (the observed real record listed four such negations
// with no negation code). This is not inference: the record itself states the absence. Negations must
// not be counted or listed as allergies (#290).
func (r *rawAllergy) noKnown() bool {
	if r.Code == nil {
		return false
	}
	for _, c := range r.Code.Coding {
		if noKnownAllergyCodes[strings.TrimSpace(c.Code)] {
			return true
		}
	}
	return strings.Contains(strings.ToLower(conceptText(r.Code)), "no known")
}

func (r *rawAllergy) onset() string {
	if r.OnsetDateTime != "" {
		return r.OnsetDateTime
	}
	if r.OnsetPeriod != nil && r.OnsetPeriod.Start != "" {
		return r.OnsetPeriod.Start
	}
	return r.OnsetString
}

func (r *rawAllergy) noteText() string {
	var parts []string
	for _, n := range r.Note {
		if n.Text != "" {
			parts = append(parts, n.Text)
		}
	}
	return strings.Join(parts, "\n")
}

// reactions flattens reaction[].manifestation into legible reaction rows (manifestation labels +
// description + severity), reporting only what the record states.
func (r *rawAllergy) reactions() []Reaction {
	var out []Reaction
	for _, rx := range r.Reaction {
		var manifestations []string
		for _, m := range rx.Manifestation {
			if label := conceptText(&m); label != "" {
				manifestations = append(manifestations, label)
			}
		}
		if len(manifestations) == 0 && rx.Description == "" && rx.Severity == "" {
			continue
		}
		out = append(out, Reaction{
			Manifestations: manifestations,
			Description:    rx.Description,
			Severity:       strings.ToLower(rx.Severity),
		})
	}
	return out
}
