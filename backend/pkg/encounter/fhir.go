package encounter

import "strings"

// Minimal FHIR R4 Encounter shapes — only the fields the classifier needs. Self-contained, mirroring
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

type fhirParticipant struct {
	Individual *fhirReference `json:"individual"`
}

type fhirHospitalization struct {
	DischargeDisposition *fhirCodeableConcept `json:"dischargeDisposition"`
}

type rawEncounter struct {
	ResourceType    string                `json:"resourceType"`
	ID              string                `json:"id"`
	Status          string                `json:"status"`
	Class           *fhirCoding           `json:"class"`
	Type            []fhirCodeableConcept `json:"type"`
	ServiceType     *fhirCodeableConcept  `json:"serviceType"`
	Participant     []fhirParticipant     `json:"participant"`
	Period          *fhirPeriod           `json:"period"`
	ReasonCode      []fhirCodeableConcept `json:"reasonCode"`
	Hospitalization *fhirHospitalization  `json:"hospitalization"`
	ServiceProvider *fhirReference        `json:"serviceProvider"`
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

func (r *rawEncounter) title() string {
	for i := range r.Type {
		if t := conceptText(&r.Type[i]); t != "" {
			return t
		}
	}
	if t := conceptText(r.ServiceType); t != "" {
		return t
	}
	if r.Class != nil && r.Class.Display != "" {
		return r.Class.Display
	}
	return "Encounter"
}

// category maps the v3-ActCode encounter class to a legible category, falling back to the class's own
// display. Returns "" when the record states no class (no guessing).
func (r *rawEncounter) category() string {
	if r.Class == nil {
		return ""
	}
	if label := legibleClass(r.Class.Code); label != "" {
		return label
	}
	return r.Class.Display
}

func legibleClass(code string) string {
	switch strings.ToUpper(code) {
	case "AMB":
		return "Office visit"
	case "IMP", "ACUTE", "NONAC":
		return "Inpatient"
	case "EMER":
		return "Emergency"
	case "VR":
		return "Telehealth"
	case "HH":
		return "Home health"
	case "OBSENC":
		return "Observation"
	case "SS":
		return "Short stay"
	case "PRENC":
		return "Pre-admission"
	case "FLD":
		return "Field"
	default:
		return ""
	}
}

func (r *rawEncounter) reasons() []string {
	var out []string
	for i := range r.ReasonCode {
		if label := conceptText(&r.ReasonCode[i]); label != "" {
			out = append(out, label)
		}
	}
	return out
}

func (r *rawEncounter) dischargeDisposition() string {
	if r.Hospitalization == nil {
		return ""
	}
	return conceptText(r.Hospitalization.DischargeDisposition)
}
