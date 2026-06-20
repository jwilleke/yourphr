package careplan

import (
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/fastenhealth/fasten-onprem/backend/pkg/provenance"
)

func loadFixture(t *testing.T) []InputResource {
	t.Helper()
	data, err := os.ReadFile("testdata/careplans.json")
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
		inputs = append(inputs, InputResource{SourceResourceType: "CarePlan", SourceResourceID: meta.ID, SourceID: "synthetic", Raw: r})
	}
	return inputs
}

func byID(list []ClassifiedCarePlan, id string) (ClassifiedCarePlan, bool) {
	for _, c := range list {
		if c.SourceResourceID == id {
			return c, true
		}
	}
	return ClassifiedCarePlan{}, false
}

func TestClassify(t *testing.T) {
	got := Classify(loadFixture(t), time.Now().UTC(), nil, nil)
	if len(got) != 4 {
		t.Fatalf("expected 4 (entered-in-error dropped), got %d", len(got))
	}

	a, _ := byID(got, "active-plan")
	if a.State != StateActive || a.Intent != "plan" {
		t.Errorf("active-plan: state=%q intent=%q, want Active/plan", a.State, a.Intent)
	}
	if a.Title != "Diabetes management" || a.GoalCount != 2 || a.AddressesCount != 1 || a.PeriodStart != "2023-01-01" {
		t.Errorf("active-plan display = %+v", a)
	}
	if a.SelfReported {
		t.Error("active-plan should not be self-reported (Practitioner author)")
	}

	r, _ := byID(got, "revoked")
	if r.State != StateRevoked {
		t.Errorf("revoked: state=%q, want Revoked", r.State)
	}

	s, _ := byID(got, "self-authored")
	if !s.SelfReported {
		t.Error("self-authored should be self-reported (Patient author)")
	}

	n, _ := byID(got, "no-status")
	if n.State != StateUnknown {
		t.Errorf("no-status: state=%q, want Unknown", n.State)
	}
}

func TestClassify_Provenance(t *testing.T) {
	resolver := provenance.NewResourceSet([]provenance.Resource{
		{SourceResourceType: "Practitioner", SourceResourceID: "dr-1", SourceID: "synthetic",
			Raw: json.RawMessage(`{"resourceType":"Practitioner","id":"dr-1","name":[{"text":"Dr. Jane Synthetic"}]}`)},
	})
	got := Classify(loadFixture(t), time.Now().UTC(), resolver, func(string) string { return "Epic" })

	a, _ := byID(got, "active-plan")
	if a.Provenance == nil || a.Provenance.Kind != provenance.KindPractitioner || a.Provenance.Display != "Dr. Jane Synthetic" {
		t.Errorf("active-plan provenance = %+v, want practitioner / Dr. Jane Synthetic", a.Provenance)
	}

	s, _ := byID(got, "self-authored")
	if s.Provenance == nil || s.Provenance.Kind != provenance.KindSelfReported {
		t.Errorf("self-authored provenance = %+v, want self-reported", s.Provenance)
	}
}
