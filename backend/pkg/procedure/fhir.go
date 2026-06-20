package procedure

import "strings"

// Minimal FHIR R4 Procedure shapes — only the fields the classifier needs. Absent fields unmarshal to
// zero values and are never fabricated. Self-contained, mirroring the other Layer-1 packages.

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

type fhirPerformer struct {
	Function *fhirCodeableConcept `json:"function"`
	Actor    *fhirReference       `json:"actor"`
}

type rawProcedure struct {
	ResourceType    string                `json:"resourceType"`
	ID              string                `json:"id"`
	Status          string                `json:"status"`
	StatusReason    *fhirCodeableConcept  `json:"statusReason"`
	Category        *fhirCodeableConcept  `json:"category"`
	Code            *fhirCodeableConcept  `json:"code"`
	Recorder        *fhirReference        `json:"recorder"`
	Asserter        *fhirReference        `json:"asserter"`
	Performer       []fhirPerformer       `json:"performer"`
	Encounter       *fhirReference        `json:"encounter"`
	PerformedTime   string                `json:"performedDateTime"`
	PerformedPeriod *fhirPeriod           `json:"performedPeriod"`
	PerformedString string                `json:"performedString"`
	BodySite        []fhirCodeableConcept `json:"bodySite"`
	Outcome         *fhirCodeableConcept  `json:"outcome"`
	ReasonCode      []fhirCodeableConcept `json:"reasonCode"`
	Note            []fhirAnnotation      `json:"note"`
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

// isStandardSystem reports whether a coding system is a recognized procedure terminology (CPT, SNOMED,
// ICD, LOINC, HCPCS), i.e. a real code, not a vendor-internal one.
func isStandardSystem(system string) bool {
	s := strings.ToLower(system)
	return strings.Contains(s, "cpt") || strings.Contains(s, "snomed") || strings.Contains(s, "icd") ||
		strings.Contains(s, "loinc") || strings.Contains(s, "hcpcs")
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

func refIsType(ref *fhirReference, typ string) bool {
	if ref == nil {
		return false
	}
	return strings.Contains(ref.Reference, typ+"/")
}

func (r *rawProcedure) title() string {
	if t := conceptText(r.Code); t != "" {
		return t
	}
	return "Unknown procedure"
}

func (r *rawProcedure) performed() string {
	if r.PerformedTime != "" {
		return r.PerformedTime
	}
	if r.PerformedPeriod != nil && r.PerformedPeriod.Start != "" {
		return r.PerformedPeriod.Start
	}
	return r.PerformedString
}

// bodySites returns the stated body-site labels (feeds the body-map view, #352).
func (r *rawProcedure) bodySites() []string {
	var out []string
	for i := range r.BodySite {
		if label := conceptText(&r.BodySite[i]); label != "" {
			out = append(out, label)
		}
	}
	return out
}

func (r *rawProcedure) reasons() []string {
	var out []string
	for i := range r.ReasonCode {
		if label := conceptText(&r.ReasonCode[i]); label != "" {
			out = append(out, label)
		}
	}
	return out
}

func (r *rawProcedure) noteText() string {
	var parts []string
	for _, n := range r.Note {
		if n.Text != "" {
			parts = append(parts, n.Text)
		}
	}
	return strings.Join(parts, "\n")
}
