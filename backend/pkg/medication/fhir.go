package medication

import (
	"fmt"
	"strings"
	"time"
)

// Minimal FHIR R4 shapes — only the fields reconciliation needs, unioned across the four medication
// resource types. JSON unmarshalling ignores absent fields, so one struct serves all types.

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

type fhirQuantity struct {
	Value float64 `json:"value"`
	Unit  string  `json:"unit"`
}

type fhirPeriod struct {
	Start string `json:"start"`
	End   string `json:"end"`
}

type fhirDoseAndRate struct {
	DoseQuantity *fhirQuantity `json:"doseQuantity"`
	DoseRange    *struct {
		Low  *fhirQuantity `json:"low"`
		High *fhirQuantity `json:"high"`
	} `json:"doseRange"`
}

type fhirTimingRepeat struct {
	Frequency  int     `json:"frequency"`
	Period     float64 `json:"period"`
	PeriodUnit string  `json:"periodUnit"`
}

type fhirDosage struct {
	Text   string `json:"text"`
	Timing *struct {
		Repeat *fhirTimingRepeat `json:"repeat"`
	} `json:"timing"`
	AsNeededBoolean         *bool                `json:"asNeededBoolean"`
	AsNeededCodeableConcept *fhirCodeableConcept `json:"asNeededCodeableConcept"`
	DoseAndRate             []fhirDoseAndRate    `json:"doseAndRate"`
}

type fhirContained struct {
	ResourceType string               `json:"resourceType"`
	ID           string               `json:"id"`
	Code         *fhirCodeableConcept `json:"code"`
}

type rawMedicationResource struct {
	ResourceType string `json:"resourceType"`
	ID           string `json:"id"`
	Status       string `json:"status"`

	MedicationCodeableConcept *fhirCodeableConcept `json:"medicationCodeableConcept"`
	MedicationReference       *fhirReference       `json:"medicationReference"`
	Contained                 []fhirContained      `json:"contained"`

	AuthoredOn        string      `json:"authoredOn"`
	WhenHandedOver    string      `json:"whenHandedOver"`
	WhenPrepared      string      `json:"whenPrepared"`
	EffectiveDateTime string      `json:"effectiveDateTime"`
	EffectivePeriod   *fhirPeriod `json:"effectivePeriod"`
	DateAsserted      string      `json:"dateAsserted"`

	DosageInstruction []fhirDosage `json:"dosageInstruction"` // MedicationRequest / MedicationDispense
	Dosage            []fhirDosage `json:"dosage"`            // MedicationStatement

	Requester         *fhirReference `json:"requester"`
	InformationSource *fhirReference `json:"informationSource"`

	ReasonCode []fhirCodeableConcept `json:"reasonCode"`

	// set from the DB row (authoritative), not the JSON
	sourceResourceType string
	sourceResourceID   string
}

func (r *rawMedicationResource) resolvedType() string {
	if r.sourceResourceType != "" {
		return r.sourceResourceType
	}
	return r.ResourceType
}

// medication resolves the display name, the original codings (for passthrough), and the RxNorm code
// if present. Resolution order mirrors the sort_title generator: medicationCodeableConcept →
// medicationReference.display → a contained Medication referenced by "#id".
func (r *rawMedicationResource) medication() (name string, codings []fhirCoding, rxCode string) {
	cc := r.MedicationCodeableConcept
	if cc == nil && r.MedicationReference != nil {
		if ref := r.MedicationReference.Reference; strings.HasPrefix(ref, "#") {
			id := strings.TrimPrefix(ref, "#")
			for i := range r.Contained {
				if r.Contained[i].ID == id && r.Contained[i].Code != nil {
					cc = r.Contained[i].Code
					break
				}
			}
		}
	}

	if cc != nil {
		codings = cc.Coding
		for _, c := range cc.Coding {
			if c.System == rxNormSystem && c.Code != "" {
				rxCode = c.Code
			}
		}
		if cc.Text != "" {
			name = cc.Text
		} else {
			for _, c := range cc.Coding {
				if c.Display != "" {
					name = c.Display
					break
				}
			}
			if name == "" {
				for _, c := range cc.Coding {
					if c.Code != "" {
						name = c.Code
						break
					}
				}
			}
		}
	}
	if name == "" && r.MedicationReference != nil && r.MedicationReference.Display != "" {
		name = r.MedicationReference.Display
	}
	return name, codings, rxCode
}

// classifyState maps the explicit status (and an explicit past end date) to a state. excluded is
// true for entered-in-error. MedicationDispense carries no medication-state signal (its status
// describes the dispense act), so it returns ("", false).
func (r *rawMedicationResource) classifyState(now time.Time) (state string, excluded bool) {
	status := strings.ToLower(strings.TrimSpace(r.Status))
	if status == "entered-in-error" {
		return "", true
	}

	// An explicit past effectivePeriod.end means the record states the med ended.
	if r.EffectivePeriod != nil {
		if end := parseFHIRDate(r.EffectivePeriod.End); end != nil && end.Before(now) {
			return StatePast, false
		}
	}

	switch r.resolvedType() {
	case "MedicationRequest", "MedicationStatement":
		switch status {
		case "active":
			return StateActive, false
		case "on-hold":
			return StateSuspended, false
		case "stopped", "cancelled", "completed", "not-taken":
			return StatePast, false
		default: // draft, intended, unknown, "" → no fabricated state
			return StateUnknown, false
		}
	default: // MedicationDispense and anything else: no state signal
		return "", false
	}
}

// relevantDate is the date used for sorting/last-activity, per resource type.
func (r *rawMedicationResource) relevantDate() *time.Time {
	switch r.resolvedType() {
	case "MedicationRequest":
		return parseFHIRDate(r.AuthoredOn)
	case "MedicationDispense":
		if d := parseFHIRDate(r.WhenHandedOver); d != nil {
			return d
		}
		return parseFHIRDate(r.WhenPrepared)
	case "MedicationStatement":
		if d := parseFHIRDate(r.EffectiveDateTime); d != nil {
			return d
		}
		if r.EffectivePeriod != nil {
			if d := parseFHIRDate(r.EffectivePeriod.Start); d != nil {
				return d
			}
		}
		return parseFHIRDate(r.DateAsserted)
	}
	return nil
}

func (r *rawMedicationResource) dosages() []fhirDosage {
	if len(r.DosageInstruction) > 0 {
		return r.DosageInstruction
	}
	return r.Dosage
}

func (r *rawMedicationResource) doseFrequencySig() (dose, frequency, sig string) {
	dosages := r.dosages()
	if len(dosages) == 0 {
		return "", "", ""
	}
	d := dosages[0]
	sig = d.Text

	for _, dr := range d.DoseAndRate {
		if dr.DoseQuantity != nil {
			dose = formatQuantity(dr.DoseQuantity)
		} else if dr.DoseRange != nil {
			lo := formatQuantity(dr.DoseRange.Low)
			hi := formatQuantity(dr.DoseRange.High)
			if lo != "" || hi != "" {
				dose = strings.TrimSpace(lo + "-" + hi)
			}
		}
		if dose != "" {
			break
		}
	}

	switch {
	case d.AsNeededBoolean != nil && *d.AsNeededBoolean:
		frequency = "As needed (PRN)"
	case d.AsNeededCodeableConcept != nil:
		frequency = "As needed (PRN)"
	case d.Timing != nil && d.Timing.Repeat != nil:
		frequency = formatFrequency(d.Timing.Repeat)
	}
	return dose, frequency, sig
}

func formatFrequency(rep *fhirTimingRepeat) string {
	if rep == nil || rep.Frequency == 0 || rep.PeriodUnit == "" {
		return ""
	}
	unit := periodUnitWord[rep.PeriodUnit]
	if unit == "" {
		unit = rep.PeriodUnit
	}
	times := "1×"
	if rep.Frequency > 1 {
		times = fmt.Sprintf("%d×", rep.Frequency)
	}
	if rep.Period <= 1 {
		return times + "/" + unit
	}
	period := strings.TrimSuffix(fmt.Sprintf("%g", rep.Period), ".0")
	return fmt.Sprintf("%s per %s %ss", times, period, unit)
}

func (r *rawMedicationResource) purpose() string {
	for _, rc := range r.ReasonCode {
		if rc.Text != "" {
			return rc.Text
		}
		for _, c := range rc.Coding {
			if c.Display != "" {
				return c.Display
			}
		}
	}
	return ""
}

func (r *rawMedicationResource) prescriber() string {
	if r.Requester != nil {
		return r.Requester.Display
	}
	return ""
}
