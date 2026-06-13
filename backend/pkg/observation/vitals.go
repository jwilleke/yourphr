// Package observation turns raw FHIR Observation resources into legible, patient-facing view-models.
//
// The first recognizer here is for VITAL SIGNS. Real-world exports (notably FollowMyHealth/Veradigm
// EHI) store vitals that are structurally US Core-conformant — correct US Core Vital Signs LOINC
// codes, blood pressure properly split into systolic/diastolic components, UCUM units present — but
// leave `code.coding[].display` EMPTY, so a patient panel would render bare LOINC codes. The
// recognizer fills the human label the source omitted by an EXACT LOINC lookup (a definitional
// membership test, not inference — the "no guessing" principle holds: the code already states what
// the measurement is) and, as a free side effect, validates the unit against the US Core expectation.
//
// RecognizeVitals is a pure, stateless derivation over the raw JSON — no database, no HTTP — and it
// only emits Observations whose LOINC is a recognized vital sign (so step counts, labs, etc. are
// skipped). The stored record is never mutated; this is a read-time view-model. It is source-agnostic
// (any EHR's vitals flow through the same table) and only ADDS display fields, so unlike the Condition
// classifier it needs no vendor-detection gate. See
// docs/your-phr-dashboard/classification-and-display-architecture.md.
package observation

import (
	"encoding/json"
	"fmt"
)

// Canonical vital-sign kinds (stable keys for the frontend; independent of any source's wording).
const (
	KindHeartRate        = "heart-rate"
	KindBodyHeight       = "body-height"
	KindBodyWeight       = "body-weight"
	KindBMI              = "bmi"
	KindRespiratoryRate  = "respiratory-rate"
	KindBodyTemperature  = "body-temperature"
	KindOxygenSaturation = "oxygen-saturation"
	KindBloodPressure    = "blood-pressure"
)

// vitalProfile is the definitional identity a US Core Vital Signs LOINC code carries: the canonical
// name to display and the UCUM unit(s) US Core expects. Panels (blood pressure) carry no own value —
// their measurements live in components.
type vitalProfile struct {
	kind    string
	name    string
	units   []string // acceptable UCUM codes; empty for panels
	isPanel bool
}

// vitalsByLOINC maps the US Core Vital Signs LOINC codes to their identity. Seeded with the codes
// observed in real exports plus the US Core core set; extend as data demands (no speculative entries).
var vitalsByLOINC = map[string]vitalProfile{
	"8867-4":  {KindHeartRate, "Heart Rate", []string{"/min"}, false},
	"8302-2":  {KindBodyHeight, "Body Height", []string{"cm", "[in_i]"}, false},
	"29463-7": {KindBodyWeight, "Body Weight", []string{"kg", "g", "[lb_av]"}, false},
	"39156-5": {KindBMI, "Body Mass Index", []string{"kg/m2"}, false},
	"9279-1":  {KindRespiratoryRate, "Respiratory Rate", []string{"/min"}, false},
	"8310-5":  {KindBodyTemperature, "Body Temperature", []string{"Cel", "[degF]"}, false},
	"2708-6":  {KindOxygenSaturation, "Oxygen Saturation", []string{"%"}, false},
	"59408-5": {KindOxygenSaturation, "Oxygen Saturation", []string{"%"}, false},
	"85354-9": {KindBloodPressure, "Blood Pressure", nil, true},
}

// bpComponent is the identity of a blood-pressure component LOINC code.
type bpComponent struct {
	kind string
	name string
}

var bpComponentsByLOINC = map[string]bpComponent{
	"8480-6": {"systolic", "Systolic"},
	"8462-4": {"diastolic", "Diastolic"},
}

const bpUnit = "mm[Hg]"

// InputResource is one stored Observation row: authoritative type/id/source from the DB row plus the
// full FHIR JSON body.
type InputResource struct {
	SourceResourceType string
	SourceResourceID   string
	SourceID           string
	Raw                json.RawMessage
}

// Component is one measurement within a panel (e.g. systolic / diastolic of a blood pressure).
type Component struct {
	Kind        string   `json:"kind"`
	DisplayName string   `json:"displayName"`
	Value       *float64 `json:"value,omitempty"`
	Unit        string   `json:"unit,omitempty"`
}

// RecognizedVital is one Observation recognized as a US Core vital sign, with the human label filled
// from its LOINC code and a conformance verdict on its unit(s). The raw record is never mutated.
type RecognizedVital struct {
	SourceResourceType string      `json:"sourceResourceType"`
	SourceResourceID   string      `json:"sourceResourceId"`
	SourceID           string      `json:"sourceId"`
	Kind               string      `json:"kind"`        // canonical vital key
	DisplayName        string      `json:"displayName"` // filled from the code (source left it blank)
	LOINC              string      `json:"loinc"`
	Value              *float64    `json:"value,omitempty"`
	Unit               string      `json:"unit,omitempty"`
	Components         []Component `json:"components,omitempty"`
	Effective          string      `json:"effective,omitempty"`
	Conformant         bool        `json:"conformant"`       // unit(s) matched the US Core expectation
	Issues             []string    `json:"issues,omitempty"` // why it is not conformant (never fabricated data)
}

// RecognizeVitals returns one RecognizedVital per input Observation whose LOINC is a recognized vital
// sign, in input order. Observations that are not vital signs (step counts, labs, …) are skipped.
func RecognizeVitals(resources []InputResource) []RecognizedVital {
	out := make([]RecognizedVital, 0, len(resources))
	for _, res := range resources {
		var raw rawObservation
		if err := json.Unmarshal(res.Raw, &raw); err != nil {
			continue // unparseable record — skip rather than emit garbage
		}

		code := loincCode(raw.Code)
		prof, ok := vitalsByLOINC[code]
		if !ok {
			continue // not a recognized vital sign — leave it for other recognizers
		}

		rv := RecognizedVital{
			SourceResourceType: res.SourceResourceType,
			SourceResourceID:   res.SourceResourceID,
			SourceID:           res.SourceID,
			Kind:               prof.kind,
			DisplayName:        prof.name, // the legibility fill: the label the source omitted
			LOINC:              code,
			Effective:          raw.effective(),
		}

		if prof.isPanel {
			rv.Components, rv.Conformant, rv.Issues = recognizePanel(prof.kind, raw.Component)
		} else {
			rv.Value, rv.Unit, rv.Conformant, rv.Issues = recognizeScalar(prof, raw.ValueQuantity)
		}
		out = append(out, rv)
	}
	return out
}

// recognizeScalar pulls the single value+unit and validates the unit against the US Core expectation.
// Missing value / missing unit / unexpected unit are reported as issues — never silently fixed.
func recognizeScalar(prof vitalProfile, q *fhirQuantity) (value *float64, unit string, conformant bool, issues []string) {
	if q == nil || q.Value == nil {
		return nil, "", false, []string{"no value recorded"}
	}
	value = q.Value
	unit = unitCode(q)
	if unit == "" {
		return value, "", false, []string{"missing unit"}
	}
	if !unitAllowed(unit, prof.units) {
		return value, unit, false, []string{fmt.Sprintf("unexpected unit %q (US Core expects %v)", unit, prof.units)}
	}
	return value, unit, true, nil
}

// recognizePanel resolves the components of a blood-pressure panel. Conformant only when both
// systolic and diastolic are present with the expected mmHg unit.
func recognizePanel(kind string, comps []fhirComponent) (out []Component, conformant bool, issues []string) {
	seen := map[string]bool{}
	for _, c := range comps {
		bp, ok := bpComponentsByLOINC[loincCode(c.Code)]
		if !ok {
			continue
		}
		comp := Component{Kind: bp.kind, DisplayName: bp.name}
		if c.ValueQuantity != nil {
			comp.Value = c.ValueQuantity.Value
			comp.Unit = unitCode(c.ValueQuantity)
		}
		if comp.Value == nil {
			issues = append(issues, fmt.Sprintf("%s component has no value", bp.kind))
		} else if comp.Unit != bpUnit {
			issues = append(issues, fmt.Sprintf("%s unit %q (expected %q)", bp.kind, comp.Unit, bpUnit))
		}
		seen[bp.kind] = true
		out = append(out, comp)
	}
	if kind == KindBloodPressure {
		if !seen["systolic"] {
			issues = append(issues, "missing systolic component")
		}
		if !seen["diastolic"] {
			issues = append(issues, "missing diastolic component")
		}
	}
	return out, len(issues) == 0, issues
}

func unitAllowed(unit string, allowed []string) bool {
	for _, a := range allowed {
		if unit == a {
			return true
		}
	}
	return false
}
