package condition

import (
	"encoding/json"
	"os"
	"testing"
	"time"
)

// loadFixture reads the synthetic FollowMyHealth-shaped Condition fixtures and wraps each as an
// InputResource keyed by its FHIR id (so tests can assert per-case). All values are synthetic.
func loadFixture(t *testing.T) []InputResource {
	t.Helper()
	data, err := os.ReadFile("testdata/fmh_conditions.json")
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
			SourceResourceType: "Condition",
			SourceResourceID:   meta.ID,
			SourceID:           "synthetic-source",
			Raw:                r,
		})
	}
	return inputs
}

func TestClassify(t *testing.T) {
	results := Classify(loadFixture(t), time.Now().UTC(), nil, nil)

	byID := make(map[string]ClassifiedCondition, len(results))
	for _, r := range results {
		byID[r.SourceResourceID] = r
	}

	// entered-in-error must be omitted entirely.
	if _, present := byID["entered-in-error"]; present {
		t.Errorf("entered-in-error condition should be omitted from output")
	}
	if len(results) != 12 {
		t.Errorf("expected 12 classified conditions (13 fixtures minus entered-in-error), got %d", len(results))
	}

	type want struct {
		tier, category, state string
		selfReported          bool
	}
	cases := map[string]want{
		"clinician-active":       {TierClinician, CategoryProblem, StateActive, false},
		"clinician-resolved":     {TierClinician, CategoryProblem, StateResolved, false},
		"remission":              {TierClinician, CategoryProblem, StateRemission, false},
		"abated-nostatus":        {TierClinician, CategoryProblem, StateResolved, false},
		"active-abated-conflict": {TierClinician, CategoryProblem, StateActive, false},
		"self-reported":          {TierSelfReported, CategoryProblem, StateActive, true},
		"profile":                {TierProfile, CategorySDOH, StateActive, false},
		"ambiguous":              {TierClinician, CategoryProblem, StateActive, false},
		"unknown-status":         {TierClinician, CategoryProblem, StateUnknown, false},
		"refuted":                {TierClinician, CategoryProblem, StateRuledOut, false},
		// Conformant-source gate: a declared Condition.category is honored, never re-synthesized —
		// the SNOMED-coded sdoh item stays Profile (naive synthesis would promote it to a problem).
		"conformant-sdoh":                {TierProfile, CategorySDOH, StateActive, false},
		"conformant-encounter-diagnosis": {TierClinician, CategoryProblem, StateActive, false},
	}

	for id, w := range cases {
		got, ok := byID[id]
		if !ok {
			t.Errorf("%s: missing from output", id)
			continue
		}
		if got.Tier != w.tier {
			t.Errorf("%s: tier = %q, want %q", id, got.Tier, w.tier)
		}
		if got.Category != w.category {
			t.Errorf("%s: category = %q, want %q", id, got.Category, w.category)
		}
		if got.State != w.state {
			t.Errorf("%s: state = %q, want %q", id, got.State, w.state)
		}
		if got.SelfReported != w.selfReported {
			t.Errorf("%s: selfReported = %v, want %v", id, got.SelfReported, w.selfReported)
		}
	}
}

func TestClassify_DisplayFields(t *testing.T) {
	results := Classify(loadFixture(t), time.Now().UTC(), nil, nil)
	byID := make(map[string]ClassifiedCondition, len(results))
	for _, r := range results {
		byID[r.SourceResourceID] = r
	}

	// Title prefers code.text, else a coding display.
	if got := byID["clinician-active"].Title; got != "Synthetic headache" {
		t.Errorf("title = %q, want %q", got, "Synthetic headache")
	}
	if got := byID["remission"].Title; got != "Synthetic neoplasm" {
		t.Errorf("title (coding display fallback) = %q, want %q", got, "Synthetic neoplasm")
	}

	// Only standard-terminology codings are surfaced; the vendor-internal translation code is dropped.
	if codings := byID["self-reported"].StandardCodings; len(codings) != 0 {
		t.Errorf("self-reported should expose no standard codings, got %v", codings)
	}
	if codings := byID["clinician-active"].StandardCodings; len(codings) != 1 || codings[0].Code != "R51" {
		t.Errorf("clinician-active standard codings = %v, want one ICD-10 R51", codings)
	}

	// Abatement date is surfaced for resolved/remission.
	if got := byID["clinician-resolved"].Abated; got != "2015-09-01" {
		t.Errorf("abated = %q, want %q", got, "2015-09-01")
	}
}
