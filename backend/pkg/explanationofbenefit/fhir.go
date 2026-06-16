package explanationofbenefit

import "strings"

// Minimal FHIR R4 ExplanationOfBenefit shapes — only the fields the classifier needs. Shaped against
// real CMS Blue Button 2.0 (CARIN-BB / C4BB) claims; see docs/test-sandboxes.md and the #294 issue.

const (
	systemEOBType   = "bluebutton.cms.gov/resources/codesystem/eob-type"
	systemClaimType = "terminology.hl7.org/CodeSystem/claim-type"
	systemC4BBAdj   = "hl7.org/fhir/us/carin-bb/CodeSystem/C4BBAdjudication"
)

type fhirCoding struct {
	System  string `json:"system"`
	Code    string `json:"code"`
	Display string `json:"display"`
}

type fhirCodeableConcept struct {
	Text   string       `json:"text"`
	Coding []fhirCoding `json:"coding"`
}

type fhirIdentifier struct {
	System string `json:"system"`
	Value  string `json:"value"`
}

// fhirReference covers both literal references and identifier-only references (Blue Button names the
// provider/insurer by identifier, not a Reference).
type fhirReference struct {
	Reference  string          `json:"reference"`
	Display    string          `json:"display"`
	Identifier *fhirIdentifier `json:"identifier"`
}

type fhirPeriod struct {
	Start string `json:"start"`
	End   string `json:"end"`
}

type fhirMoney struct {
	Value    float64 `json:"value"`
	Currency string  `json:"currency"`
}

type rawDiagnosis struct {
	Sequence                 int                   `json:"sequence"`
	DiagnosisCodeableConcept *fhirCodeableConcept  `json:"diagnosisCodeableConcept"`
	Type                     []fhirCodeableConcept `json:"type"`
}

type rawTotal struct {
	Category *fhirCodeableConcept `json:"category"`
	Amount   *fhirMoney           `json:"amount"`
}

type rawPayment struct {
	Amount *fhirMoney `json:"amount"`
}

type rawEOB struct {
	ResourceType   string               `json:"resourceType"`
	ID             string               `json:"id"`
	Status         string               `json:"status"`
	Type           *fhirCodeableConcept `json:"type"`
	Use            string               `json:"use"`
	Patient        *fhirReference       `json:"patient"`
	BillablePeriod *fhirPeriod          `json:"billablePeriod"`
	Created        string               `json:"created"`
	Insurer        *fhirReference       `json:"insurer"`
	Provider       *fhirReference       `json:"provider"`
	Outcome        string               `json:"outcome"`
	Disposition    string               `json:"disposition"`
	Diagnosis      []rawDiagnosis       `json:"diagnosis"`
	Total          []rawTotal           `json:"total"`
	Payment        *rawPayment          `json:"payment"`
}

// codeForSystem returns the first code from a CodeableConcept whose coding system ends with the given
// suffix (systems are matched by suffix so http/https and trailing-path variants both hit). "" if none.
func codeForSystem(cc *fhirCodeableConcept, systemSuffix string) string {
	if cc == nil {
		return ""
	}
	for _, c := range cc.Coding {
		if strings.HasSuffix(c.System, systemSuffix) {
			return strings.TrimSpace(c.Code)
		}
	}
	return ""
}

// firstDisplay returns the first non-empty coding display of a CodeableConcept (else its text). "" if none.
func firstDisplay(cc *fhirCodeableConcept) string {
	if cc == nil {
		return ""
	}
	for _, c := range cc.Coding {
		if d := strings.TrimSpace(c.Display); d != "" {
			return d
		}
	}
	return strings.TrimSpace(cc.Text)
}

// name returns a human label for an identifier-or-literal reference: display, else identifier value,
// else the reference string. "" if absent.
func (r *fhirReference) name() string {
	if r == nil {
		return ""
	}
	if d := strings.TrimSpace(r.Display); d != "" {
		return d
	}
	if r.Identifier != nil {
		if v := strings.TrimSpace(r.Identifier.Value); v != "" {
			return v
		}
	}
	return strings.TrimSpace(r.Reference)
}
