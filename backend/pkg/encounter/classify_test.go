package encounter

import (
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/fastenhealth/fasten-onprem/backend/pkg/provenance"
)

func loadFixture(t *testing.T) []InputResource {
	t.Helper()
	data, err := os.ReadFile("testdata/encounters.json")
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
		inputs = append(inputs, InputResource{SourceResourceType: "Encounter", SourceResourceID: meta.ID, SourceID: "synthetic", Raw: r})
	}
	return inputs
}

func byID(list []ClassifiedEncounter, id string) (ClassifiedEncounter, bool) {
	for _, c := range list {
		if c.SourceResourceID == id {
			return c, true
		}
	}
	return ClassifiedEncounter{}, false
}

// loadEpicHOV loads real Epic FHIR sandbox Encounters (synthetic patient Camila Lopez), captured
// verbatim from the Epic sandbox export. Epic ships class as a LOCAL code {code:"4", display:"HOV"}
// while the human label lives in type[0].text ("Outpatient"). This golden guards that we surface the
// legible label and never the raw local code "HOV" (#262 conformance).
//
// Provenance: Epic on FHIR R4 sandbox (fhir.epic.com), patient Camila Lopez (synthetic), exported
// 2026-06-18; resources copied verbatim. No real PHI.
func loadEpicHOV(t *testing.T) []InputResource {
	t.Helper()
	data, err := os.ReadFile("testdata/epic_camila_encounters.json")
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
		inputs = append(inputs, InputResource{SourceResourceType: "Encounter", SourceResourceID: meta.ID, SourceID: "epic-sandbox", Raw: r})
	}
	return inputs
}

// TestClassify_EpicHOV_Golden — vendor golden (conformance): a non-US-Core local class code must not
// leak into the patient-facing label; the legible "Outpatient" (from type[].text) must win.
func TestClassify_EpicHOV_Golden(t *testing.T) {
	got := Classify(loadEpicHOV(t), time.Now().UTC(), nil, nil)
	if len(got) != 2 {
		t.Fatalf("expected 2 Epic HOV encounters, got %d", len(got))
	}
	for _, c := range got {
		if c.Title != "Outpatient" {
			t.Errorf("%s: Title = %q, want \"Outpatient\" (from type[0].text)", c.SourceResourceID, c.Title)
		}
		if c.Category != "Outpatient" {
			t.Errorf("%s: Category = %q, want \"Outpatient\" — must NOT surface the raw Epic-local class display \"HOV\"", c.SourceResourceID, c.Category)
		}
		if c.State != StateInProgress {
			t.Errorf("%s: State = %q, want %q", c.SourceResourceID, c.State, StateInProgress)
		}
	}
}

func TestClassify(t *testing.T) {
	got := Classify(loadFixture(t), time.Now().UTC(), nil, nil)
	if len(got) != 4 {
		t.Fatalf("expected 4 (entered-in-error dropped), got %d", len(got))
	}

	o, _ := byID(got, "office-finished")
	if o.State != StateFinished || o.Category != "Office visit" {
		t.Errorf("office-finished: state=%q category=%q, want Finished/Office visit", o.State, o.Category)
	}
	if o.Title != "Annual wellness visit" || o.PeriodStart != "2023-03-10T09:00:00Z" || len(o.Reasons) != 1 {
		t.Errorf("office-finished display = %+v", o)
	}

	i, _ := byID(got, "inpatient")
	if i.State != StateInProgress || i.Category != "Inpatient" || i.DischargeDisposition != "Home" {
		t.Errorf("inpatient: state=%q category=%q discharge=%q", i.State, i.Category, i.DischargeDisposition)
	}

	tele, _ := byID(got, "telehealth-planned")
	if tele.State != StatePlanned || tele.Category != "Telehealth" {
		t.Errorf("telehealth-planned: state=%q category=%q, want Planned/Telehealth", tele.State, tele.Category)
	}

	n, _ := byID(got, "no-class")
	if n.Category != "" {
		t.Errorf("no-class: category=%q, want empty", n.Category)
	}
}

func TestClassify_Provenance(t *testing.T) {
	resolver := provenance.NewResourceSet([]provenance.Resource{
		{SourceResourceType: "Practitioner", SourceResourceID: "dr-1", SourceID: "synthetic",
			Raw: json.RawMessage(`{"resourceType":"Practitioner","id":"dr-1","name":[{"text":"Dr. Jane Synthetic"}]}`)},
	})
	got := Classify(loadFixture(t), time.Now().UTC(), resolver, func(string) string { return "Epic" })

	o, _ := byID(got, "office-finished")
	if o.Provenance == nil || o.Provenance.Kind != provenance.KindPractitioner || o.Provenance.Display != "Dr. Jane Synthetic" {
		t.Errorf("office-finished provenance = %+v, want practitioner / Dr. Jane Synthetic", o.Provenance)
	}

	n, _ := byID(got, "no-class")
	if n.Provenance == nil || n.Provenance.Kind != provenance.KindSource {
		t.Errorf("no-class provenance = %+v, want source floor", n.Provenance)
	}
}
