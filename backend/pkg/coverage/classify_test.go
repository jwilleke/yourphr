package coverage

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func loadCoverage(t *testing.T, name string) InputResource {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatalf("read %s: %v", name, err)
	}
	var meta struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(raw, &meta)
	return InputResource{SourceResourceType: "Coverage", SourceResourceID: meta.ID, SourceID: "src-1", Raw: raw}
}

func allParts(t *testing.T) []InputResource {
	return []InputResource{
		loadCoverage(t, "coverage-part-a.json"),
		loadCoverage(t, "coverage-part-b.json"),
		loadCoverage(t, "coverage-part-c.json"),
		loadCoverage(t, "coverage-part-d.json"),
	}
}

// The four real Medicare parts classify into plain language with the correct payor/beneficiary and the
// three distinct period shapes (ongoing / none / bounded).
func TestClassify_MedicareParts(t *testing.T) {
	got := Classify(allParts(t), time.Time{})
	if len(got) != 4 {
		t.Fatalf("expected 4 classified, got %d", len(got))
	}
	byPlan := map[string]ClassifiedCoverage{}
	for _, c := range got {
		byPlan[c.Plan] = c
	}

	cases := []struct {
		plan, label, meaning, periodLabel string
		hasPeriod                         bool
	}{
		{PartA, "Medicare Part A — Hospital", "Hospital", "since 1999-09-08", true},
		{PartB, "Medicare Part B — Medical", "Medical", "since 1999-09-08", true},
		{PartC, "Medicare Part C — Medicare Advantage", "Medicare Advantage", "", false}, // period: null
		{PartD, "Medicare Part D — Prescription drugs", "Prescription drugs", "2025-01-01 to 2025-03-03", true},
	}
	for _, tc := range cases {
		c, ok := byPlan[tc.plan]
		if !ok {
			t.Fatalf("missing %s", tc.plan)
		}
		if c.Label != tc.label {
			t.Errorf("%s Label = %q, want %q", tc.plan, c.Label, tc.label)
		}
		if c.PlanMeaning != tc.meaning {
			t.Errorf("%s PlanMeaning = %q, want %q", tc.plan, c.PlanMeaning, tc.meaning)
		}
		if !c.Active {
			t.Errorf("%s should be active", tc.plan)
		}
		if c.Group != "Medicare" {
			t.Errorf("%s Group = %q, want Medicare", tc.plan, c.Group)
		}
		if c.Payor != "Centers for Medicare and Medicaid Services" {
			t.Errorf("%s Payor = %q", tc.plan, c.Payor)
		}
		if c.BeneficiaryRef != "Patient/-10000010254618" {
			t.Errorf("%s BeneficiaryRef = %q", tc.plan, c.BeneficiaryRef)
		}
		if c.PeriodLabel != tc.periodLabel {
			t.Errorf("%s PeriodLabel = %q, want %q", tc.plan, c.PeriodLabel, tc.periodLabel)
		}
		if tc.hasPeriod && c.Period == nil {
			t.Errorf("%s expected a period", tc.plan)
		}
		if !tc.hasPeriod && c.Period != nil {
			t.Errorf("%s expected NO period (no-guessing), got %+v", tc.plan, c.Period)
		}
	}
}

// No-guessing on periods: a start-only period stays open-ended (no invented end); a null period
// yields nothing (status carries the meaning).
func TestClassify_PeriodNoGuessing(t *testing.T) {
	a := Classify([]InputResource{loadCoverage(t, "coverage-part-a.json")}, time.Time{})[0]
	if a.Period == nil || a.Period.Start != "1999-09-08" || a.Period.End != "" {
		t.Fatalf("Part A period: want start-only 1999-09-08 with no end, got %+v", a.Period)
	}
	c := Classify([]InputResource{loadCoverage(t, "coverage-part-c.json")}, time.Time{})[0]
	if c.Period != nil || c.PeriodLabel != "" {
		t.Fatalf("Part C: null period must yield nil/empty, got %+v / %q", c.Period, c.PeriodLabel)
	}
}

// The patient's coverages roll up into one active-parts summary, in order, de-duplicated.
func TestSummarize(t *testing.T) {
	s := Summarize(Classify(allParts(t), time.Time{}))
	if len(s.ActiveParts) != 4 {
		t.Fatalf("ActiveParts = %v", s.ActiveParts)
	}
	if s.Label != "Active Medicare: Part A, Part B, Part C, Part D" {
		t.Errorf("Summary label = %q", s.Label)
	}
}

// An unknown plan gets no fabricated meaning; an unparseable record is skipped, not emitted.
func TestClassify_UnknownPlanAndSkip(t *testing.T) {
	in := []InputResource{
		{SourceResourceType: "Coverage", SourceResourceID: "x", Raw: json.RawMessage(`{"resourceType":"Coverage","status":"active","class":[{"type":{"coding":[{"code":"plan"}]},"value":"Part Z"}]}`)},
		{SourceResourceType: "Coverage", SourceResourceID: "bad", Raw: json.RawMessage(`{not json`)},
	}
	got := Classify(in, time.Time{})
	if len(got) != 1 {
		t.Fatalf("expected 1 (bad one skipped), got %d", len(got))
	}
	if got[0].Plan != "Part Z" || got[0].PlanMeaning != "" {
		t.Errorf("unknown plan must have no meaning, got plan=%q meaning=%q", got[0].Plan, got[0].PlanMeaning)
	}
	if got[0].Label != "Part Z" {
		t.Errorf("Label = %q, want 'Part Z'", got[0].Label)
	}
}
