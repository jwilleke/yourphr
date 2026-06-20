package immunization

import "strings"

// Minimal FHIR R4 Immunization shapes — only the fields the classifier needs. Absent fields unmarshal
// to zero values and are never fabricated. Self-contained, mirroring pkg/condition and pkg/allergyintolerance.

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

type fhirPerformer struct {
	Function *fhirCodeableConcept `json:"function"`
	Actor    *fhirReference       `json:"actor"`
}

type rawImmunization struct {
	ResourceType   string               `json:"resourceType"`
	ID             string               `json:"id"`
	Status         string               `json:"status"` // completed | entered-in-error | not-done
	StatusReason   *fhirCodeableConcept `json:"statusReason"`
	VaccineCode    *fhirCodeableConcept `json:"vaccineCode"`
	OccurrenceTime string               `json:"occurrenceDateTime"`
	OccurrenceStr  string               `json:"occurrenceString"`
	Recorded       string               `json:"recorded"`
	PrimarySource  *bool                `json:"primarySource"`
	ReportOrigin   *fhirCodeableConcept `json:"reportOrigin"`
	Manufacturer   *fhirReference       `json:"manufacturer"`
	LotNumber      string               `json:"lotNumber"`
	ExpirationDate string               `json:"expirationDate"`
	Performer      []fhirPerformer      `json:"performer"`
	Encounter      *fhirReference       `json:"encounter"`
	Note           []fhirAnnotation     `json:"note"`
}

// conceptCode returns the first non-empty coding code of a CodeableConcept, lowercased.
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

// isStandardSystem reports whether a coding system is a recognized vaccine terminology (CVX, NDC,
// SNOMED), i.e. a real code, not a vendor-internal one.
func isStandardSystem(system string) bool {
	s := strings.ToLower(system)
	return strings.Contains(s, "cvx") || strings.Contains(s, "ndc") || strings.Contains(s, "snomed")
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

func (r *rawImmunization) title() string {
	if t := conceptText(r.VaccineCode); t != "" {
		return t
	}
	return "Unknown vaccine"
}

func (r *rawImmunization) occurrence() string {
	if r.OccurrenceTime != "" {
		return r.OccurrenceTime
	}
	return r.OccurrenceStr
}

func (r *rawImmunization) manufacturerName() string {
	if r.Manufacturer == nil {
		return ""
	}
	return r.Manufacturer.Display
}

func (r *rawImmunization) noteText() string {
	var parts []string
	for _, n := range r.Note {
		if n.Text != "" {
			parts = append(parts, n.Text)
		}
	}
	return strings.Join(parts, "\n")
}
