package observation

import "strings"

// Minimal FHIR R4 Observation shapes — only the fields the vitals recognizer needs. JSON
// unmarshalling ignores absent fields. See docs/your-phr-dashboard/classification-and-display-architecture.md
// (Layer 1 / the vitals legibility recognizer).

type fhirCoding struct {
	System  string `json:"system"`
	Code    string `json:"code"`
	Display string `json:"display"`
}

type fhirCodeableConcept struct {
	Text   string       `json:"text"`
	Coding []fhirCoding `json:"coding"`
}

type fhirQuantity struct {
	Value  *float64 `json:"value"`
	Unit   string   `json:"unit"`
	System string   `json:"system"`
	Code   string   `json:"code"`
}

type fhirPeriod struct {
	Start string `json:"start"`
	End   string `json:"end"`
}

type fhirComponent struct {
	Code          *fhirCodeableConcept `json:"code"`
	ValueQuantity *fhirQuantity        `json:"valueQuantity"`
}

type rawObservation struct {
	ResourceType      string                `json:"resourceType"`
	ID                string                `json:"id"`
	Status            string                `json:"status"`
	Category          []fhirCodeableConcept `json:"category"`
	Code              *fhirCodeableConcept  `json:"code"`
	EffectiveDateTime string                `json:"effectiveDateTime"`
	EffectivePeriod   *fhirPeriod           `json:"effectivePeriod"`
	ValueQuantity     *fhirQuantity         `json:"valueQuantity"`
	Component         []fhirComponent       `json:"component"`
}

// isLOINC reports whether a coding system URL is LOINC.
func isLOINC(system string) bool {
	return strings.Contains(strings.ToLower(system), "loinc")
}

// loincCode returns the first LOINC code in a CodeableConcept (the recognizer keys off it), or "".
func loincCode(cc *fhirCodeableConcept) string {
	if cc == nil {
		return ""
	}
	for _, c := range cc.Coding {
		if isLOINC(c.System) && c.Code != "" {
			return c.Code
		}
	}
	return ""
}

// effective returns the observation's effective date string from either effective[x] form.
func (o *rawObservation) effective() string {
	if o.EffectiveDateTime != "" {
		return o.EffectiveDateTime
	}
	if o.EffectivePeriod != nil && o.EffectivePeriod.Start != "" {
		return o.EffectivePeriod.Start
	}
	return ""
}

// unitCode returns the UCUM code from a quantity, falling back to the human unit string when the
// machine code is absent (some sources populate only `unit`).
func unitCode(q *fhirQuantity) string {
	if q == nil {
		return ""
	}
	if q.Code != "" {
		return q.Code
	}
	return q.Unit
}
