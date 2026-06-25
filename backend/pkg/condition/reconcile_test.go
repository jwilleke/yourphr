package condition

import (
	"encoding/json"
	"os"
	"testing"
	"time"
)

// loadEpicConditions loads real Epic FHIR sandbox Conditions (synthetic patient Camila Lopez), captured
// verbatim from the Epic sandbox export. Epic returns the same problem as multiple Condition resources
// (per-visit encounter-diagnoses + a problem-list-item), which is the duplication Reconcile collapses.
// No real PHI.
func loadEpicConditions(t *testing.T) []InputResource {
	t.Helper()
	data, err := os.ReadFile("testdata/epic_camila_conditions.json")
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
		_ = json.Unmarshal(r, &meta)
		inputs = append(inputs, InputResource{SourceResourceType: "Condition", SourceResourceID: meta.ID, SourceID: "epic-sandbox", Raw: r})
	}
	return inputs
}

func condTitles(cs []ClassifiedCondition) []string {
	out := make([]string, len(cs))
	for i, c := range cs {
		out[i] = c.Title
	}
	return out
}

// TestReconcile_EpicCamila_Dedup — vendor golden (#262). Epic returns the same problem as multiple
// Condition resources (3x "Ischemic chest pain" visit-diagnoses; "Polycystic ovaries" as both a
// problem-list-item and an encounter-diagnosis). Classify stays faithful (7, the locked 1:1 contract);
// Reconcile collapses by standard code to one entry per clinical concept (4).
func TestReconcile_EpicCamila_Dedup(t *testing.T) {
	in := loadEpicConditions(t)

	if raw := Classify(in, time.Now().UTC(), nil, nil); len(raw) != 7 {
		t.Fatalf("Classify must stay faithful 1:1 — expected 7, got %d: %v", len(raw), condTitles(raw))
	}

	got := Reconcile(in, time.Now().UTC(), nil, nil)
	if len(got) != 4 {
		t.Fatalf("expected 4 distinct conditions after reconcile, got %d: %v", len(got), condTitles(got))
	}

	counts := map[string]int{}
	for _, c := range got {
		counts[c.Title]++
	}
	for _, want := range []string{
		"Ischemic chest pain",
		"Stomach ache",
		"Polycystic ovaries",
		"Pain aggravated by activities of daily living",
	} {
		if counts[want] != 1 {
			t.Errorf("expected exactly one %q after reconcile, got %d (all: %v)", want, counts[want], condTitles(got))
		}
	}
}
