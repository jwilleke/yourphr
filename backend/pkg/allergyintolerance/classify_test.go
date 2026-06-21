package allergyintolerance

import (
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/fastenhealth/fasten-onprem/backend/pkg/provenance"
)

// loadFixture reads the synthetic AllergyIntolerance fixtures, keyed by FHIR id. All synthetic.
func loadFixture(t *testing.T) []InputResource {
	t.Helper()
	data, err := os.ReadFile("testdata/allergies.json")
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
			SourceResourceType: "AllergyIntolerance",
			SourceResourceID:   meta.ID,
			SourceID:           "synthetic",
			Raw:                r,
		})
	}
	return inputs
}

func byID(list []ClassifiedAllergy, id string) (ClassifiedAllergy, bool) {
	for _, c := range list {
		if c.SourceResourceID == id {
			return c, true
		}
	}
	return ClassifiedAllergy{}, false
}

func TestClassify(t *testing.T) {
	got := Classify(loadFixture(t), time.Now().UTC(), nil, nil)

	// entered-in-error is dropped; the other 4 remain.
	if len(got) != 4 {
		t.Fatalf("expected 4 classified (entered-in-error dropped), got %d", len(got))
	}
	if _, ok := byID(got, "mistake"); ok {
		t.Error("entered-in-error record should have been omitted")
	}

	// Confirmed + active, clinician-recorded, with reactions.
	c, _ := byID(got, "confirmed-active")
	if c.Verification != VerifConfirmed || c.State != StateActive {
		t.Errorf("confirmed-active: verification=%q state=%q, want Confirmed/Active", c.Verification, c.State)
	}
	if c.SelfReported {
		t.Error("confirmed-active should not be self-reported (clinician recorder)")
	}
	if c.Title != "Penicillin" || c.Criticality != "high" {
		t.Errorf("confirmed-active: title=%q criticality=%q", c.Title, c.Criticality)
	}
	if len(c.Reactions) != 2 || c.Reactions[0].Severity != "severe" || c.Reactions[0].Manifestations[0] != "Anaphylaxis" {
		t.Errorf("confirmed-active reactions = %+v", c.Reactions)
	}
	if len(c.StandardCodings) != 1 || c.StandardCodings[0].Code != "7980" {
		t.Errorf("confirmed-active standardCodings = %+v, want one RxNorm", c.StandardCodings)
	}

	// Unconfirmed + patient asserter -> self-reported.
	s, _ := byID(got, "self-reported-unconfirmed")
	if s.Verification != VerifUnconfirmed || !s.SelfReported {
		t.Errorf("self-reported-unconfirmed: verification=%q selfReported=%v, want Unconfirmed/true", s.Verification, s.SelfReported)
	}

	// Refuted -> RuledOut state regardless of clinicalStatus.
	r, _ := byID(got, "refuted")
	if r.Verification != VerifRefuted || r.State != StateRuledOut {
		t.Errorf("refuted: verification=%q state=%q, want Refuted/RuledOut", r.Verification, r.State)
	}

	// No status -> Unknown verification + Unknown state (never assumed).
	n, _ := byID(got, "no-status")
	if n.Verification != VerifUnknown || n.State != StateUnknown {
		t.Errorf("no-status: verification=%q state=%q, want Unknown/Unknown", n.Verification, n.State)
	}
}

// End-to-end: a clinician recorder resolves to a named provenance through the shared resolver.
func TestClassify_Provenance(t *testing.T) {
	resolver := provenance.NewResourceSet([]provenance.Resource{
		{SourceResourceType: "Practitioner", SourceResourceID: "dr-1", SourceID: "synthetic",
			Raw: json.RawMessage(`{"resourceType":"Practitioner","id":"dr-1","name":[{"text":"Dr. Jane Synthetic"}]}`)},
	})
	got := Classify(loadFixture(t), time.Now().UTC(), resolver, func(string) string { return "Epic" })

	c, _ := byID(got, "confirmed-active")
	if c.Provenance == nil || c.Provenance.Kind != provenance.KindPractitioner || c.Provenance.Display != "Dr. Jane Synthetic" {
		t.Errorf("confirmed-active provenance = %+v, want practitioner / Dr. Jane Synthetic", c.Provenance)
	}
	if c.Provenance.Recorded != "2018-04-02" {
		t.Errorf("provenance recorded = %q, want recordedDate 2018-04-02", c.Provenance.Recorded)
	}

	// Patient asserter -> Self-reported.
	s, _ := byID(got, "self-reported-unconfirmed")
	if s.Provenance == nil || s.Provenance.Kind != provenance.KindSelfReported {
		t.Errorf("self-reported provenance = %+v, want self-reported", s.Provenance)
	}

	// No author -> falls to the source floor (never fabricated).
	n, _ := byID(got, "no-status")
	if n.Provenance == nil || n.Provenance.Kind != provenance.KindSource || n.Provenance.Display != "Source: Epic" {
		t.Errorf("no-status provenance = %+v, want source floor 'Source: Epic'", n.Provenance)
	}
}

// TestClassify_NoKnown verifies "no known allergy" negation assertions are flagged (and so can be
// excluded from counts/lists) — keyed off the SNOMED negation code or a "No Known ..." title (#290).
func TestClassify_NoKnown(t *testing.T) {
	in := []InputResource{
		{SourceResourceType: "AllergyIntolerance", SourceResourceID: "nka-coded", SourceID: "s",
			Raw: json.RawMessage(`{"resourceType":"AllergyIntolerance","id":"nka-coded","code":{"coding":[{"system":"http://snomed.info/sct","code":"716186003","display":"No known allergy"}]}}`)},
		{SourceResourceType: "AllergyIntolerance", SourceResourceID: "nka-text", SourceID: "s",
			Raw: json.RawMessage(`{"resourceType":"AllergyIntolerance","id":"nka-text","code":{"text":"No Known Drug Allergies"}}`)},
		{SourceResourceType: "AllergyIntolerance", SourceResourceID: "real", SourceID: "s",
			Raw: json.RawMessage(`{"resourceType":"AllergyIntolerance","id":"real","code":{"text":"Penicillin"},"clinicalStatus":{"coding":[{"code":"active"}]}}`)},
	}
	got := Classify(in, time.Now().UTC(), nil, nil)
	if len(got) != 3 {
		t.Fatalf("expected 3 classified, got %d", len(got))
	}
	if c, _ := byID(got, "nka-coded"); !c.NoKnown {
		t.Errorf("SNOMED 716186003 should be flagged NoKnown")
	}
	if c, _ := byID(got, "nka-text"); !c.NoKnown {
		t.Errorf("'No Known Drug Allergies' title should be flagged NoKnown")
	}
	if c, _ := byID(got, "real"); c.NoKnown {
		t.Errorf("Penicillin must NOT be flagged NoKnown")
	}
	real := 0
	for _, c := range got {
		if !c.NoKnown {
			real++
		}
	}
	if real != 1 {
		t.Errorf("expected 1 real allergy (negations excluded), got %d", real)
	}
}
