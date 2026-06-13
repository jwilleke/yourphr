package condition

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/fastenhealth/fasten-onprem/backend/pkg/provenance"
)

// When a resolver is supplied, each classified condition carries its resolved "who said this".
func TestClassify_Provenance(t *testing.T) {
	inputs := []InputResource{
		{SourceResourceType: "Condition", SourceResourceID: "c-practitioner", SourceID: "src-1",
			Raw: json.RawMessage(`{"resourceType":"Condition","id":"c-practitioner","code":{"coding":[{"system":"http://snomed.info/sct","code":"1","display":"X"}]},"asserter":{"reference":"Practitioner/dr-1"},"clinicalStatus":{"coding":[{"code":"active"}]}}`)},
		{SourceResourceType: "Condition", SourceResourceID: "c-self", SourceID: "src-1",
			Raw: json.RawMessage(`{"resourceType":"Condition","id":"c-self","code":{"coding":[{"system":"x","code":"1","display":"X"}]},"asserter":{"reference":"Patient/pat-1"},"clinicalStatus":{"coding":[{"code":"active"}]}}`)},
		{SourceResourceType: "Condition", SourceResourceID: "c-floor", SourceID: "src-1",
			Raw: json.RawMessage(`{"resourceType":"Condition","id":"c-floor","code":{"coding":[{"system":"http://snomed.info/sct","code":"1","display":"X"}]},"clinicalStatus":{"coding":[{"code":"active"}]}}`)},
	}

	resolver := provenance.NewResourceSet([]provenance.Resource{
		{SourceResourceType: "Practitioner", SourceResourceID: "dr-1", Raw: json.RawMessage(`{"resourceType":"Practitioner","id":"dr-1","name":[{"text":"Dr. Jane Synthetic"}]}`)},
	})
	label := func(sourceID string) string {
		if sourceID == "src-1" {
			return "FollowMyHealth"
		}
		return ""
	}

	results := Classify(inputs, time.Now().UTC(), resolver, label)
	byID := map[string]ClassifiedCondition{}
	for _, r := range results {
		byID[r.SourceResourceID] = r
	}

	cases := map[string]struct{ kind, display string }{
		"c-practitioner": {provenance.KindPractitioner, "Dr. Jane Synthetic"},
		"c-self":         {provenance.KindSelfReported, "Self-reported"},
		"c-floor":        {provenance.KindSource, "Source: FollowMyHealth"},
	}
	for id, want := range cases {
		got := byID[id]
		if got.Provenance == nil {
			t.Errorf("%s: provenance not resolved", id)
			continue
		}
		if got.Provenance.Kind != want.kind || got.Provenance.Display != want.display {
			t.Errorf("%s: provenance = %+v, want {Kind:%s Display:%q}", id, *got.Provenance, want.kind, want.display)
		}
	}
}

// With no resolver, the provenance field is left nil (pure-classification mode).
func TestClassify_NoResolver_NoProvenance(t *testing.T) {
	for _, r := range Classify(loadFixture(t), time.Now().UTC(), nil, nil) {
		if r.Provenance != nil {
			t.Errorf("%s: expected nil provenance without a resolver, got %+v", r.SourceResourceID, *r.Provenance)
		}
	}
}
