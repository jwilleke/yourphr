package observation

import (
	"encoding/json"
	"os"
	"testing"
)

// loadFixture reads the synthetic vital-signs Observation fixtures and wraps each as an InputResource
// keyed by its FHIR id (so tests can assert per-case). All values are synthetic.
func loadFixture(t *testing.T) []InputResource {
	t.Helper()
	data, err := os.ReadFile("testdata/vitals.json")
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var raws []json.RawMessage
	if err := json.Unmarshal(data, &raws); err != nil {
		t.Fatalf("unmarshal fixture: %v", err)
	}
	inputs := make([]InputResource, 0, len(raws))
	for _, r := range raws {
		var meta struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(r, &meta); err != nil {
			t.Fatalf("unmarshal id: %v", err)
		}
		inputs = append(inputs, InputResource{
			SourceResourceType: "Observation",
			SourceResourceID:   meta.ID,
			SourceID:           "synthetic-source",
			Raw:                r,
		})
	}
	return inputs
}

func byID(t *testing.T) map[string]RecognizedVital {
	t.Helper()
	out := map[string]RecognizedVital{}
	for _, v := range RecognizeVitals(loadFixture(t)) {
		out[v.SourceResourceID] = v
	}
	return out
}

func TestRecognizeVitals_SkipsNonVitals(t *testing.T) {
	got := byID(t)
	// 7 fixtures, but the step-count Observation (LOINC 41950-7) is not a vital → 6 recognized.
	if len(got) != 6 {
		t.Errorf("expected 6 recognized vitals (steps excluded), got %d", len(got))
	}
	if _, present := got["steps-not-a-vital"]; present {
		t.Errorf("step count should not be recognized as a vital sign")
	}
}

func TestRecognizeVitals_FillsDisplayName(t *testing.T) {
	got := byID(t)
	// The legibility job: the fixtures carry empty code.coding[].display; the recognizer fills it.
	cases := map[string]struct{ kind, name string }{
		"heart-rate":     {KindHeartRate, "Heart Rate"},
		"body-weight":    {KindBodyWeight, "Body Weight"},
		"blood-pressure": {KindBloodPressure, "Blood Pressure"},
	}
	for id, want := range cases {
		v, ok := got[id]
		if !ok {
			t.Errorf("%s: missing from output", id)
			continue
		}
		if v.Kind != want.kind {
			t.Errorf("%s: kind = %q, want %q", id, v.Kind, want.kind)
		}
		if v.DisplayName != want.name {
			t.Errorf("%s: displayName = %q, want %q", id, v.DisplayName, want.name)
		}
	}
}

func TestRecognizeVitals_ConformanceVerdicts(t *testing.T) {
	got := byID(t)

	if v := got["heart-rate"]; !v.Conformant || v.Value == nil || *v.Value != 72 || v.Unit != "/min" {
		t.Errorf("heart-rate: want conformant 72 /min, got %+v", v)
	}
	// Wrong unit is reported, never silently corrected; the value passes through unchanged.
	if v := got["weight-wrong-unit"]; v.Conformant || len(v.Issues) == 0 {
		t.Errorf("weight-wrong-unit: want non-conformant with an issue, got %+v", v)
	}
	if v := got["height-missing-unit"]; v.Conformant || len(v.Issues) == 0 {
		t.Errorf("height-missing-unit: want non-conformant (missing unit), got %+v", v)
	}
}

func TestRecognizeVitals_BloodPressureComponents(t *testing.T) {
	got := byID(t)

	bp := got["blood-pressure"]
	if !bp.Conformant {
		t.Errorf("blood-pressure: want conformant, got issues %v", bp.Issues)
	}
	if bp.Value != nil {
		t.Errorf("blood-pressure: panel should carry no top-level value, got %v", *bp.Value)
	}
	if len(bp.Components) != 2 {
		t.Fatalf("blood-pressure: want 2 components, got %d", len(bp.Components))
	}
	want := map[string]float64{"systolic": 120, "diastolic": 80}
	for _, c := range bp.Components {
		if c.Value == nil || *c.Value != want[c.Kind] {
			t.Errorf("blood-pressure: %s = %v, want %v", c.Kind, c.Value, want[c.Kind])
		}
		if c.Unit != "mm[Hg]" {
			t.Errorf("blood-pressure: %s unit = %q, want mm[Hg]", c.Kind, c.Unit)
		}
	}

	// A panel missing a component is flagged, not dropped.
	if v := got["bp-missing-diastolic"]; v.Conformant || len(v.Issues) == 0 {
		t.Errorf("bp-missing-diastolic: want non-conformant with an issue, got %+v", v)
	}
}
