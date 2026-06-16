package coverage

import "strings"

// Minimal FHIR R4 Coverage shapes — only the fields the classifier needs. JSON unmarshalling ignores
// absent fields (e.g. a null `period`). Shaped against real CMS Blue Button 2.0 (CARIN-BB / C4BB)
// coverages; see docs/test-sandboxes.md and the #295 issue.

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

type fhirPeriod struct {
	Start string `json:"start"`
	End   string `json:"end"`
}

type fhirPayor struct {
	Display    string          `json:"display"`
	Identifier *fhirIdentifier `json:"identifier"`
}

// fhirCoverageClass is one Coverage.class entry: a typed bucket ("group", "plan", "subplan", …) with
// a free-text value ("Medicare", "Part A", …).
type fhirCoverageClass struct {
	Type  *fhirCodeableConcept `json:"type"`
	Value string               `json:"value"`
	Name  string               `json:"name"`
}

type rawCoverage struct {
	ResourceType string               `json:"resourceType"`
	ID           string               `json:"id"`
	Status       string               `json:"status"`
	Type         *fhirCodeableConcept `json:"type"`
	SubscriberID string               `json:"subscriberId"`
	Beneficiary  *fhirReference       `json:"beneficiary"`
	Relationship *fhirCodeableConcept `json:"relationship"`
	Period       *fhirPeriod          `json:"period"`
	Payor        []fhirPayor          `json:"payor"`
	Class        []fhirCoverageClass  `json:"class"`
}

// classValue returns the trimmed value of the Coverage.class entry whose type coding code matches
// classCode (e.g. "plan" -> "Part A", "group" -> "Medicare"). "" if absent — never guessed.
func (c *rawCoverage) classValue(classCode string) string {
	for _, cls := range c.Class {
		if cls.Type == nil {
			continue
		}
		for _, coding := range cls.Type.Coding {
			if strings.EqualFold(coding.Code, classCode) {
				return strings.TrimSpace(cls.Value)
			}
		}
	}
	return ""
}

// payorName returns the first payor's display or identifier value. "" if none.
func (c *rawCoverage) payorName() string {
	for _, p := range c.Payor {
		if v := strings.TrimSpace(p.Display); v != "" {
			return v
		}
		if p.Identifier != nil {
			if v := strings.TrimSpace(p.Identifier.Value); v != "" {
				return v
			}
		}
	}
	return ""
}

// beneficiaryRef returns the Patient reference this coverage is for (the link used by #296). "" if absent.
func (c *rawCoverage) beneficiaryRef() string {
	if c.Beneficiary == nil {
		return ""
	}
	return strings.TrimSpace(c.Beneficiary.Reference)
}
