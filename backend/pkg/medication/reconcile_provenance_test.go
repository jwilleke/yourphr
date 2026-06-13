package medication

import (
	"encoding/json"
	"testing"

	"github.com/fastenhealth/fasten-onprem/backend/pkg/provenance"
	"github.com/stretchr/testify/require"
)

func medRes(typ, id, sourceID, body string) InputResource {
	return InputResource{SourceResourceType: typ, SourceResourceID: id, SourceID: sourceID, Raw: json.RawMessage(body)}
}

// With a resolver, each reconciled row carries resolved provenance: a prescriber resolves to a named
// practitioner; a patient information source is self-reported; nothing resolvable falls to the floor.
func TestReconcile_Provenance(t *testing.T) {
	resolver := provenance.NewResourceSet([]provenance.Resource{
		{SourceResourceType: "Practitioner", SourceResourceID: "dr-1", Raw: json.RawMessage(`{"resourceType":"Practitioner","id":"dr-1","name":[{"text":"Dr. Jane Synthetic"}]}`)},
	})
	label := func(sourceID string) string {
		if sourceID == "src-1" {
			return "FollowMyHealth"
		}
		return ""
	}

	prescribed := `{"resourceType":"MedicationRequest","status":"active","authoredOn":"2026-01-01",
		"medicationCodeableConcept":{"coding":[{"system":"http://www.nlm.nih.gov/research/umls/rxnorm","code":"1","display":"Drug A"}]},
		"requester":{"reference":"Practitioner/dr-1"}}`
	selfReported := `{"resourceType":"MedicationStatement","status":"active","effectiveDateTime":"2026-01-01",
		"medicationCodeableConcept":{"coding":[{"system":"http://www.nlm.nih.gov/research/umls/rxnorm","code":"2","display":"Drug B"}]},
		"informationSource":{"reference":"Patient/pat-1"}}`
	floor := `{"resourceType":"MedicationStatement","status":"active","effectiveDateTime":"2026-01-01",
		"medicationCodeableConcept":{"coding":[{"system":"http://www.nlm.nih.gov/research/umls/rxnorm","code":"3","display":"Drug C"}]}}`

	meds := Reconcile([]InputResource{
		medRes("MedicationRequest", "a", "src-1", prescribed),
		medRes("MedicationStatement", "b", "src-1", selfReported),
		medRes("MedicationStatement", "c", "src-1", floor),
	}, now, resolver, label)

	want := map[string]struct{ kind, display string }{
		"rxnorm:1": {provenance.KindPractitioner, "Dr. Jane Synthetic"},
		"rxnorm:2": {provenance.KindSelfReported, "Self-reported"},
		"rxnorm:3": {provenance.KindSource, "Source: FollowMyHealth"},
	}
	for key, w := range want {
		m := find(meds, key)
		require.NotNil(t, m, "row %s missing", key)
		require.NotNil(t, m.Provenance, "row %s has no provenance", key)
		require.Equal(t, w.kind, m.Provenance.Kind, "row %s kind", key)
		require.Equal(t, w.display, m.Provenance.Display, "row %s display", key)
	}
}

// Without a resolver, provenance is left nil (pure reconciliation).
func TestReconcile_NoResolver_NoProvenance(t *testing.T) {
	body := `{"resourceType":"MedicationRequest","status":"active","medicationCodeableConcept":{"text":"Drug"}}`
	meds := Reconcile([]InputResource{res("MedicationRequest", "x", body)}, now, nil, nil)
	require.Len(t, meds, 1)
	require.Nil(t, meds[0].Provenance)
}
