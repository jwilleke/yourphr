package diagnosticreport

import (
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/fastenhealth/fasten-onprem/backend/pkg/provenance"
)

func loadFixture(t *testing.T) []InputResource {
	t.Helper()
	data, err := os.ReadFile("testdata/diagnosticreports.json")
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
		inputs = append(inputs, InputResource{SourceResourceType: "DiagnosticReport", SourceResourceID: meta.ID, SourceID: "synthetic", Raw: r})
	}
	return inputs
}

func byID(list []ClassifiedDiagnosticReport, id string) (ClassifiedDiagnosticReport, bool) {
	for _, c := range list {
		if c.SourceResourceID == id {
			return c, true
		}
	}
	return ClassifiedDiagnosticReport{}, false
}

func TestClassify(t *testing.T) {
	got := Classify(loadFixture(t), time.Now().UTC(), nil, nil)
	if len(got) != 3 {
		t.Fatalf("expected 3 (entered-in-error dropped), got %d", len(got))
	}

	c, _ := byID(got, "final-lab")
	if c.State != StateFinal || c.Category != "Laboratory" {
		t.Errorf("final-lab: state=%q category=%q, want Final/Laboratory", c.State, c.Category)
	}
	if c.Title != "Complete blood count" || c.ResultCount != 2 || c.Conclusion != "Within normal limits" {
		t.Errorf("final-lab display = %+v", c)
	}
	if len(c.StandardCodings) != 1 || c.StandardCodings[0].Code != "58410-2" {
		t.Errorf("final-lab codings = %+v, want one LOINC", c.StandardCodings)
	}

	i, _ := byID(got, "imaging-prelim")
	if i.State != StatePreliminary || i.Category != "Imaging" {
		t.Errorf("imaging-prelim: state=%q category=%q, want Preliminary/Imaging", i.State, i.Category)
	}

	// No category stated -> empty (never inferred from the code).
	n, _ := byID(got, "no-category")
	if n.Category != "" {
		t.Errorf("no-category: category=%q, want empty", n.Category)
	}
}

func TestClassify_Provenance(t *testing.T) {
	resolver := provenance.NewResourceSet([]provenance.Resource{
		{SourceResourceType: "Organization", SourceResourceID: "org-1", SourceID: "synthetic",
			Raw: json.RawMessage(`{"resourceType":"Organization","id":"org-1","name":"Acme Labs"}`)},
	})
	got := Classify(loadFixture(t), time.Now().UTC(), resolver, func(string) string { return "Epic" })

	c, _ := byID(got, "final-lab")
	if c.Provenance == nil || c.Provenance.Kind != provenance.KindOrganization || c.Provenance.Display != "Acme Labs" {
		t.Errorf("final-lab provenance = %+v, want organization / Acme Labs", c.Provenance)
	}
	if c.Provenance.Recorded != "2022-05-02T08:00:00Z" {
		t.Errorf("final-lab provenance recorded = %q, want issued", c.Provenance.Recorded)
	}
}
