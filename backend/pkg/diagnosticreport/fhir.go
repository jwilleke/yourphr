package diagnosticreport

import "strings"

// Minimal FHIR R4 DiagnosticReport shapes — only the fields the classifier needs. Self-contained,
// mirroring the other Layer-1 packages.

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

type rawDiagnosticReport struct {
	ResourceType       string                `json:"resourceType"`
	ID                 string                `json:"id"`
	Status             string                `json:"status"`
	Category           []fhirCodeableConcept `json:"category"`
	Code               *fhirCodeableConcept  `json:"code"`
	EffectiveTime      string                `json:"effectiveDateTime"`
	EffectivePeriod    *fhirPeriod           `json:"effectivePeriod"`
	Issued             string                `json:"issued"`
	Performer          []fhirReference       `json:"performer"`
	ResultsInterpreter []fhirReference       `json:"resultsInterpreter"`
	Encounter          *fhirReference        `json:"encounter"`
	Result             []fhirReference       `json:"result"`
	Conclusion         string                `json:"conclusion"`
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

func isStandardSystem(system string) bool {
	s := strings.ToLower(system)
	return strings.Contains(s, "loinc") || strings.Contains(s, "snomed") || strings.Contains(s, "cpt")
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

func (r *rawDiagnosticReport) title() string {
	if t := conceptText(r.Code); t != "" {
		return t
	}
	return "Unknown report"
}

func (r *rawDiagnosticReport) effective() string {
	if r.EffectiveTime != "" {
		return r.EffectiveTime
	}
	if r.EffectivePeriod != nil && r.EffectivePeriod.Start != "" {
		return r.EffectivePeriod.Start
	}
	return ""
}

// serviceCategory maps the HL7 v2-0074 diagnostic service section code to a legible category, falling
// back to the category's own text/display. Returns "" when the record states no category (no guessing).
func (r *rawDiagnosticReport) serviceCategory() string {
	for i := range r.Category {
		for _, c := range r.Category[i].Coding {
			if label := legibleServiceCode(c.Code); label != "" {
				return label
			}
		}
		if t := conceptText(&r.Category[i]); t != "" {
			return t
		}
	}
	return ""
}

func legibleServiceCode(code string) string {
	switch strings.ToUpper(code) {
	case "LAB", "CH", "HM", "MB", "MCB", "BLB", "SR", "TX", "VR":
		return "Laboratory"
	case "RAD", "IMG", "CT", "MR", "MRI", "US", "XR", "NMR", "NMS", "RX", "EC", "OUS":
		return "Imaging"
	case "PAT", "CP", "CY", "CG", "SP":
		return "Pathology"
	case "CUS", "OTH":
		return ""
	default:
		return ""
	}
}
