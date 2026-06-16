// Package explanationofbenefit classifies a patient's ExplanationOfBenefit (claims) for legible
// display: it turns the dense CARIN-Blue-Button / Medicare representation into a plain-language claim —
// a category ("Professional / doctor services", "Hospital — inpatient", "Prescription drug (Part D)",
// "Medical equipment (DME)", …), the service date, provider, insurer, the diagnoses, and the costs
// (each adjudication line as the record states it, plus the amount paid).
//
// Classify is a pure, stateless derivation over the raw FHIR JSON — no database, no HTTP. The
// "no guessing" principle is load-bearing: the category comes only from the explicit eob-type /
// claim-type codes (unknown → ""), costs are surfaced exactly as the record's adjudication lines state
// them (nothing summed or inferred), and an unparseable record is skipped rather than emitted as
// garbage. Claims are NOT joined to clinical encounters here — that coordination is a separate,
// patient-confirmed, provenance-recorded step (#294 design / #296), never a silent date/provider match.
//
// See the #294 issue.
package explanationofbenefit

import (
	"encoding/json"
	"strings"
	"time"
)

// InputResource is one stored ExplanationOfBenefit row: authoritative type/id/source from the DB row
// plus the full FHIR JSON body.
type InputResource struct {
	SourceResourceType string
	SourceResourceID   string
	SourceID           string
	Raw                json.RawMessage
}

// Diagnosis is one claim diagnosis rendered for display.
type Diagnosis struct {
	Code    string `json:"code,omitempty"`
	Display string `json:"display,omitempty"`
	Type    string `json:"type,omitempty"` // principal / secondary / … (ex-diagnosistype / C4BB)
}

// Cost is one adjudication line, surfaced exactly as the record states it (label + amount). Never summed.
type Cost struct {
	Label    string  `json:"label"`
	Amount   float64 `json:"amount"`
	Currency string  `json:"currency,omitempty"`
}

// ClassifiedEOB is one claim rendered for display. The raw record is never mutated.
type ClassifiedEOB struct {
	SourceResourceType string `json:"sourceResourceType"`
	SourceResourceID   string `json:"sourceResourceId"`
	SourceID           string `json:"sourceId"`

	Category    string `json:"category,omitempty"`    // plain language, e.g. "Professional / doctor services" ("" if unknown)
	ClaimType   string `json:"claimType,omitempty"`   // raw eob-type, e.g. "CARRIER"
	TypeDisplay string `json:"typeDisplay,omitempty"` // detailed type display (nch_clm_type_cd), if present

	Date     string `json:"date,omitempty"`     // service date (billablePeriod.start, else created)
	DateEnd  string `json:"dateEnd,omitempty"`  // billablePeriod.end when it differs from start
	Provider string `json:"provider,omitempty"` // billing provider name/NPI
	Insurer  string `json:"insurer,omitempty"`  // e.g. "CMS" / "Medicare"

	Status      string `json:"status,omitempty"`
	Outcome     string `json:"outcome,omitempty"`
	Use         string `json:"use,omitempty"`
	Disposition string `json:"disposition,omitempty"`

	Diagnoses []Diagnosis `json:"diagnoses,omitempty"`

	Costs      []Cost   `json:"costs,omitempty"`      // adjudication lines as stated (no totals invented)
	AmountPaid *float64 `json:"amountPaid,omitempty"` // payment.amount.value, when present
	Currency   string   `json:"currency,omitempty"`

	PatientRef string `json:"patientRef,omitempty"` // "Patient/<id>" — the link for #296
}

// Classify returns one ClassifiedEOB per input (in input order). Unparseable records are skipped.
// `now` is reserved for future date-based rules and kept for signature symmetry with the other classifiers.
func Classify(resources []InputResource, now time.Time) []ClassifiedEOB {
	out := make([]ClassifiedEOB, 0, len(resources))
	for _, res := range resources {
		var raw rawEOB
		if err := json.Unmarshal(res.Raw, &raw); err != nil {
			continue
		}

		eobType := codeForSystem(raw.Type, systemEOBType)
		claimType := codeForSystem(raw.Type, systemClaimType)

		ec := ClassifiedEOB{
			SourceResourceType: res.SourceResourceType,
			SourceResourceID:   res.SourceResourceID,
			SourceID:           res.SourceID,
			Category:           categoryFor(eobType, claimType),
			ClaimType:          eobType,
			TypeDisplay:        typeDetailDisplay(raw.Type),
			Provider:           raw.Provider.name(),
			Insurer:            insurerLabel(raw.Insurer),
			Status:             strings.TrimSpace(raw.Status),
			Outcome:            strings.TrimSpace(raw.Outcome),
			Use:                strings.TrimSpace(raw.Use),
			Disposition:        strings.TrimSpace(raw.Disposition),
			Diagnoses:          diagnosesOf(raw.Diagnosis),
			Costs:              costsOf(raw.Total),
			PatientRef:         patientRef(raw.Patient),
		}
		ec.Date, ec.DateEnd = serviceDates(&raw)
		if raw.Payment != nil && raw.Payment.Amount != nil {
			v := raw.Payment.Amount.Value
			ec.AmountPaid = &v
			ec.Currency = raw.Payment.Amount.Currency
		}

		out = append(out, ec)
	}
	return out
}

// categoryFor maps the Blue Button eob-type (primary) or the FHIR claim-type (fallback) to a plain
// patient-facing category. Unknown -> "" (no-guessing; never invent a category).
func categoryFor(eobType, claimType string) string {
	switch strings.ToUpper(eobType) {
	case "CARRIER":
		return "Professional / doctor services"
	case "PDE":
		return "Prescription drug (Part D)"
	case "INPATIENT":
		return "Hospital — inpatient"
	case "OUTPATIENT":
		return "Hospital — outpatient"
	case "SNF":
		return "Skilled nursing facility"
	case "HHA":
		return "Home health"
	case "HOSPICE":
		return "Hospice"
	case "DME":
		return "Medical equipment (DME)"
	}
	switch strings.ToLower(claimType) {
	case "professional":
		return "Professional / doctor services"
	case "institutional":
		return "Facility / hospital"
	case "pharmacy":
		return "Prescription drug"
	case "oral":
		return "Dental"
	case "vision":
		return "Vision"
	}
	return ""
}

// typeDetailDisplay returns the most descriptive type display (the nch_clm_type_cd display when
// present, else the first available), used as a secondary detail under the plain category.
func typeDetailDisplay(cc *fhirCodeableConcept) string {
	if cc == nil {
		return ""
	}
	for _, c := range cc.Coding {
		if strings.HasSuffix(c.System, "nch_clm_type_cd") && strings.TrimSpace(c.Display) != "" {
			return strings.TrimSpace(c.Display)
		}
	}
	return firstDisplay(cc)
}

// insurerLabel renders the insurer name, normalizing the bare CMS identifier to "Medicare (CMS)".
func insurerLabel(ref *fhirReference) string {
	n := ref.name()
	if strings.EqualFold(n, "CMS") {
		return "Medicare (CMS)"
	}
	return n
}

// serviceDates returns the service date from billablePeriod (start, and end when it differs), falling
// back to `created` only when billablePeriod is absent.
func serviceDates(raw *rawEOB) (date, end string) {
	if raw.BillablePeriod != nil {
		start := strings.TrimSpace(raw.BillablePeriod.Start)
		e := strings.TrimSpace(raw.BillablePeriod.End)
		if start != "" {
			if e != "" && e != start {
				return start, e
			}
			return start, ""
		}
		if e != "" {
			return e, ""
		}
	}
	return strings.TrimSpace(raw.Created), ""
}

// diagnosesOf renders the claim diagnoses (code + display + principal/secondary type). Entries with no
// usable code/display are dropped.
func diagnosesOf(in []rawDiagnosis) []Diagnosis {
	var out []Diagnosis
	for _, d := range in {
		code, display := diagnosisCode(d.DiagnosisCodeableConcept)
		if code == "" && display == "" {
			continue
		}
		dx := Diagnosis{Code: code, Display: display}
		for _, t := range d.Type {
			for _, c := range t.Coding {
				if c.Code != "" {
					dx.Type = strings.ToLower(strings.TrimSpace(c.Code))
					break
				}
			}
			if dx.Type != "" {
				break
			}
		}
		out = append(out, dx)
	}
	return out
}

// diagnosisCode prefers an ICD-10-CM coding, else the first coding.
func diagnosisCode(cc *fhirCodeableConcept) (code, display string) {
	if cc == nil {
		return "", ""
	}
	for _, c := range cc.Coding {
		if strings.HasSuffix(c.System, "icd-10-cm") {
			return strings.TrimSpace(c.Code), strings.TrimSpace(c.Display)
		}
	}
	for _, c := range cc.Coding {
		if c.Code != "" || c.Display != "" {
			return strings.TrimSpace(c.Code), strings.TrimSpace(c.Display)
		}
	}
	return "", strings.TrimSpace(cc.Text)
}

// costsOf surfaces each total[] adjudication line exactly as the record states it (label from the most
// human display available, amount as given). Nothing is summed or inferred. Entries with no amount and
// no label are dropped.
func costsOf(totals []rawTotal) []Cost {
	var out []Cost
	for _, t := range totals {
		if t.Amount == nil {
			continue
		}
		label := adjudicationLabel(t.Category)
		if label == "" {
			continue
		}
		out = append(out, Cost{Label: label, Amount: t.Amount.Value, Currency: t.Amount.Currency})
	}
	return out
}

// adjudicationLabel prefers the C4BBAdjudication coding's display (the standardized, human one), else
// any coding display, else the category text.
func adjudicationLabel(cc *fhirCodeableConcept) string {
	if cc == nil {
		return ""
	}
	for _, c := range cc.Coding {
		if strings.HasSuffix(c.System, "C4BBAdjudication") && strings.TrimSpace(c.Display) != "" {
			return strings.TrimSpace(c.Display)
		}
	}
	return firstDisplay(cc)
}

func patientRef(ref *fhirReference) string {
	if ref == nil {
		return ""
	}
	return strings.TrimSpace(ref.Reference)
}
