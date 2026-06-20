package immunization

import (
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/fastenhealth/fasten-onprem/backend/pkg/provenance"
)

func loadFixture(t *testing.T) []InputResource {
	t.Helper()
	data, err := os.ReadFile("testdata/immunizations.json")
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
			SourceResourceType: "Immunization",
			SourceResourceID:   meta.ID,
			SourceID:           "synthetic",
			Raw:                r,
		})
	}
	return inputs
}

func byID(list []ClassifiedImmunization, id string) (ClassifiedImmunization, bool) {
	for _, c := range list {
		if c.SourceResourceID == id {
			return c, true
		}
	}
	return ClassifiedImmunization{}, false
}

func TestClassify(t *testing.T) {
	got := Classify(loadFixture(t), time.Now().UTC(), nil, nil)

	if len(got) != 4 {
		t.Fatalf("expected 4 (entered-in-error dropped), got %d", len(got))
	}
	if _, ok := byID(got, "mistake"); ok {
		t.Error("entered-in-error should be omitted")
	}

	// Provider-recorded, completed, with lot + manufacturer + CVX coding.
	p, _ := byID(got, "provider-completed")
	if p.State != StateCompleted || p.Source != SourceProviderRecorded {
		t.Errorf("provider-completed: state=%q source=%q, want Completed/Recorded by provider", p.State, p.Source)
	}
	if p.Title != "Influenza, seasonal" || p.LotNumber != "AAJN11K" || p.Manufacturer != "Acme Vaccines" {
		t.Errorf("provider-completed display fields = %+v", p)
	}
	if len(p.StandardCodings) != 1 || p.StandardCodings[0].Code != "140" {
		t.Errorf("provider-completed codings = %+v, want one CVX", p.StandardCodings)
	}

	// Reported (secondary) source carries its reportOrigin detail — not asserted as provider-recorded.
	r, _ := byID(got, "reported-secondary")
	if r.Source != SourceReported || r.ReportOrigin != "Patient recall" {
		t.Errorf("reported-secondary: source=%q reportOrigin=%q, want Reported/Patient recall", r.Source, r.ReportOrigin)
	}

	// not-done surfaces the statusReason.
	n, _ := byID(got, "not-done")
	if n.State != StateNotDone || n.StatusReason != "Patient declined" {
		t.Errorf("not-done: state=%q statusReason=%q", n.State, n.StatusReason)
	}

	// Absent primarySource -> Unknown (never assumed provider-recorded).
	u, _ := byID(got, "no-primarysource")
	if u.Source != SourceUnknown {
		t.Errorf("no-primarysource: source=%q, want Unknown", u.Source)
	}
}

// End-to-end: performer.actor resolves to a named clinician through the shared resolver.
func TestClassify_Provenance(t *testing.T) {
	resolver := provenance.NewResourceSet([]provenance.Resource{
		{SourceResourceType: "Practitioner", SourceResourceID: "dr-1", SourceID: "synthetic",
			Raw: json.RawMessage(`{"resourceType":"Practitioner","id":"dr-1","name":[{"text":"Dr. Jane Synthetic"}]}`)},
	})
	got := Classify(loadFixture(t), time.Now().UTC(), resolver, func(string) string { return "Epic" })

	p, _ := byID(got, "provider-completed")
	if p.Provenance == nil || p.Provenance.Kind != provenance.KindPractitioner || p.Provenance.Display != "Dr. Jane Synthetic" {
		t.Errorf("provider-completed provenance = %+v, want practitioner / Dr. Jane Synthetic", p.Provenance)
	}

	// No performer -> source floor (never fabricated).
	n, _ := byID(got, "no-primarysource")
	if n.Provenance == nil || n.Provenance.Kind != provenance.KindSource || n.Provenance.Display != "Source: Epic" {
		t.Errorf("no-primarysource provenance = %+v, want source floor", n.Provenance)
	}
}
