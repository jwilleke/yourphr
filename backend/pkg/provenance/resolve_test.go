package provenance

import (
	"encoding/json"
	"testing"
)

// testResources is a small synthetic resource set covering the reference + provenance cases. All
// values are synthetic.
func testResources() []Resource {
	res := func(typ, id string, body string) Resource {
		return Resource{SourceResourceType: typ, SourceResourceID: id, SourceID: "synthetic", Raw: json.RawMessage(body)}
	}
	return []Resource{
		res("Patient", "pat-1", `{"resourceType":"Patient","id":"pat-1"}`),
		res("Practitioner", "dr-1", `{"resourceType":"Practitioner","id":"dr-1","name":[{"text":"Dr. Jane Synthetic"}]}`),
		res("Practitioner", "dr-2", `{"resourceType":"Practitioner","id":"dr-2","name":[{"family":"Doe","given":["John"],"prefix":["Dr."]}]}`),
		res("Organization", "org-1", `{"resourceType":"Organization","id":"org-1","name":"Synthetic Clinic"}`),
		// Encounter stored under its bare id; FMH references it as "Encounter/pat-1_enc-1".
		res("Encounter", "enc-1", `{"resourceType":"Encounter","id":"enc-1","serviceProvider":{"reference":"Organization/org-1"}}`),
		res("Provenance", "prov-1", `{"resourceType":"Provenance","id":"prov-1","target":[{"reference":"Condition/cond-prov"}],"agent":[{"who":{"display":"Audit System"}}]}`),
	}
}

func TestResolve_Reference(t *testing.T) {
	s := NewResourceSet(testResources())

	cases := []struct {
		ref       string
		wantType  string
		wantFound bool
	}{
		{"Practitioner/dr-1", "Practitioner", true},
		{"Encounter/pat-1_enc-1", "Encounter", true},                              // FMH underscore trap: strip patient prefix
		{"https://fhir.example.test/api/Practitioner/dr-1", "Practitioner", true}, // absolute URL
		{"Organization/org-1", "Organization", true},
		{"Patient/missing", "", false},
		{"", "", false},
		{"garbage", "", false},
	}
	for _, c := range cases {
		got, ok := s.Resolve(c.ref)
		if ok != c.wantFound {
			t.Errorf("Resolve(%q) found=%v, want %v", c.ref, ok, c.wantFound)
			continue
		}
		if ok && got.SourceResourceType != c.wantType {
			t.Errorf("Resolve(%q) type=%q, want %q", c.ref, got.SourceResourceType, c.wantType)
		}
	}
}

func TestResolve_EncounterTrapMatchesBareId(t *testing.T) {
	s := NewResourceSet(testResources())
	got, ok := s.Resolve("Encounter/pat-1_enc-1")
	if !ok || got.SourceResourceID != "enc-1" {
		t.Errorf("underscore reference should resolve to bare Encounter id enc-1, got %q (ok=%v)", got.SourceResourceID, ok)
	}
}
