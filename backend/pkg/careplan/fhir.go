package careplan

import "strings"

// Minimal FHIR R4 CarePlan shapes — only the fields the classifier needs. Self-contained, mirroring
// the other Layer-1 packages.

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

type fhirPeriod struct {
	Start string `json:"start"`
	End   string `json:"end"`
}

type rawCarePlan struct {
	ResourceType string                `json:"resourceType"`
	ID           string                `json:"id"`
	Status       string                `json:"status"`
	Intent       string                `json:"intent"`
	Category     []fhirCodeableConcept `json:"category"`
	Title        string                `json:"title"`
	Description  string                `json:"description"`
	Period       *fhirPeriod           `json:"period"`
	Author       *fhirReference        `json:"author"`
	Contributor  []fhirReference       `json:"contributor"`
	Encounter    *fhirReference        `json:"encounter"`
	Addresses    []fhirReference       `json:"addresses"`
	Goal         []fhirReference       `json:"goal"`
}

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

func (r *rawCarePlan) title() string {
	if r.Title != "" {
		return r.Title
	}
	if r.Description != "" {
		return r.Description
	}
	for i := range r.Category {
		if t := conceptText(&r.Category[i]); t != "" {
			return t
		}
	}
	return "Care plan"
}

func (r *rawCarePlan) category() string {
	for i := range r.Category {
		if t := conceptText(&r.Category[i]); t != "" {
			return t
		}
	}
	return ""
}

func refIsType(ref *fhirReference, typ string) bool {
	if ref == nil {
		return false
	}
	return strings.Contains(ref.Reference, typ+"/")
}
