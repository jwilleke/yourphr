package procedure

import (
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/fastenhealth/fasten-onprem/backend/pkg/provenance"
)

func loadFixture(t *testing.T) []InputResource {
	t.Helper()
	data, err := os.ReadFile("testdata/procedures.json")
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
		inputs = append(inputs, InputResource{
			SourceResourceType: "Procedure",
			SourceResourceID:   meta.ID,
			SourceID:           "synthetic",
			Raw:                r,
		})
	}
	return inputs
}

func byID(list []ClassifiedProcedure, id string) (ClassifiedProcedure, bool) {
	for _, c := range list {
		if c.SourceResourceID == id {
			return c, true
		}
	}
	return ClassifiedProcedure{}, false
}

func TestClassify(t *testing.T) {
	got := Classify(loadFixture(t), time.Now().UTC(), nil, nil)

	if len(got) != 4 {
		t.Fatalf("expected 4 (entered-in-error dropped), got %d", len(got))
	}
	if _, ok := byID(got, "mistake"); ok {
		t.Error("entered-in-error should be omitted")
	}

	c, _ := byID(got, "completed-surgical")
	if c.State != StateCompleted || c.SelfReported {
		t.Errorf("completed-surgical: state=%q selfReported=%v, want Completed/false", c.State, c.SelfReported)
	}
	if c.Title != "Appendectomy" || c.Category != "Surgical procedure" || c.Performed != "2021-06-12" {
		t.Errorf("completed-surgical display = %+v", c)
	}
	if len(c.BodySites) != 1 || c.BodySites[0] != "Appendix structure" {
		t.Errorf("completed-surgical bodySites = %+v", c.BodySites)
	}
	if len(c.Reasons) != 1 || c.Reasons[0] != "Acute appendicitis" || c.Outcome != "Successful" {
		t.Errorf("completed-surgical reasons/outcome = %+v / %q", c.Reasons, c.Outcome)
	}
	if len(c.StandardCodings) != 1 || c.StandardCodings[0].Code != "80146002" {
		t.Errorf("completed-surgical codings = %+v, want one SNOMED", c.StandardCodings)
	}

	s, _ := byID(got, "stopped")
	if s.State != StateStopped || s.StatusReason != "Poor bowel prep" {
		t.Errorf("stopped: state=%q statusReason=%q, want Stopped/Poor bowel prep", s.State, s.StatusReason)
	}

	sr, _ := byID(got, "self-reported")
	if !sr.SelfReported {
		t.Error("self-reported should be self-reported (Patient asserter)")
	}

	u, _ := byID(got, "unknown-status")
	if u.State != StateUnknown {
		t.Errorf("unknown-status: state=%q, want Unknown", u.State)
	}
}

// End-to-end: performer.actor resolves to a named clinician; the encounter rung backs it up.
func TestClassify_Provenance(t *testing.T) {
	resolver := provenance.NewResourceSet([]provenance.Resource{
		{SourceResourceType: "Practitioner", SourceResourceID: "dr-1", SourceID: "synthetic",
			Raw: json.RawMessage(`{"resourceType":"Practitioner","id":"dr-1","name":[{"text":"Dr. Jane Synthetic"}]}`)},
	})
	got := Classify(loadFixture(t), time.Now().UTC(), resolver, func(string) string { return "Epic" })

	c, _ := byID(got, "completed-surgical")
	if c.Provenance == nil || c.Provenance.Kind != provenance.KindPractitioner || c.Provenance.Display != "Dr. Jane Synthetic" {
		t.Errorf("completed-surgical provenance = %+v, want practitioner / Dr. Jane Synthetic", c.Provenance)
	}

	sr, _ := byID(got, "self-reported")
	if sr.Provenance == nil || sr.Provenance.Kind != provenance.KindSelfReported {
		t.Errorf("self-reported provenance = %+v, want self-reported", sr.Provenance)
	}

	u, _ := byID(got, "unknown-status")
	if u.Provenance == nil || u.Provenance.Kind != provenance.KindSource {
		t.Errorf("unknown-status provenance = %+v, want source floor", u.Provenance)
	}
}
