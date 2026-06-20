package provenance

import (
	"encoding/json"
	"testing"
)

func TestExtractRequest(t *testing.T) {
	// Condition: asserter (Patient) + recordedDate.
	req := ExtractRequest(json.RawMessage(`{"resourceType":"Condition","asserter":{"reference":"Patient/p1"},"recordedDate":"2019-03-14"}`), "Condition", "c1", "FollowMyHealth")
	if len(req.Authors) != 1 || req.Authors[0].Reference != "Patient/p1" {
		t.Errorf("condition authors = %+v, want one Patient ref", req.Authors)
	}
	if req.AuthoredTime != "2019-03-14" {
		t.Errorf("condition authoredTime = %q, want recordedDate", req.AuthoredTime)
	}

	// DocumentReference: author[] + date.
	req = ExtractRequest(json.RawMessage(`{"resourceType":"DocumentReference","author":[{"reference":"Practitioner/dr1","display":"Dr. X"}],"date":"2021-01-01"}`), "DocumentReference", "d1", "FollowMyHealth")
	if len(req.Authors) != 1 || req.Authors[0].Display != "Dr. X" {
		t.Errorf("docref authors = %+v, want one Practitioner with display", req.Authors)
	}
	if req.AuthoredTime != "2021-01-01" {
		t.Errorf("docref authoredTime = %q, want date", req.AuthoredTime)
	}

	// Encounter reference + issued time; no author fields.
	req = ExtractRequest(json.RawMessage(`{"resourceType":"Observation","encounter":{"reference":"Encounter/e1"},"issued":"2020-05-05T10:00:00Z"}`), "Observation", "o1", "FollowMyHealth")
	if len(req.Authors) != 0 {
		t.Errorf("observation authors = %+v, want none", req.Authors)
	}
	if req.Encounter.Reference != "Encounter/e1" {
		t.Errorf("observation encounter = %q", req.Encounter.Reference)
	}
	if req.AuthoredTime != "2020-05-05T10:00:00Z" {
		t.Errorf("observation authoredTime = %q, want issued", req.AuthoredTime)
	}

	// Empty/absent: no authors, no time — never fabricated.
	req = ExtractRequest(json.RawMessage(`{"resourceType":"Device"}`), "Device", "dev1", "FollowMyHealth")
	if len(req.Authors) != 0 || req.AuthoredTime != "" || req.Encounter.Reference != "" {
		t.Errorf("device should yield empty request, got %+v", req)
	}
}

// performer is the "who" for performed/administered records, in two FHIR shapes.
func TestExtractRequest_Performer(t *testing.T) {
	// Procedure: BackboneElement performer[].actor.
	req := ExtractRequest(json.RawMessage(`{"resourceType":"Procedure","performer":[{"actor":{"reference":"Practitioner/dr-1"}}],"performedDateTime":"2022-02-02"}`), "Procedure", "proc1", "FollowMyHealth")
	if len(req.Authors) != 1 || req.Authors[0].Reference != "Practitioner/dr-1" {
		t.Errorf("procedure authors = %+v, want one Practitioner from performer.actor", req.Authors)
	}

	// DiagnosticReport: plain reference array performer[].
	req = ExtractRequest(json.RawMessage(`{"resourceType":"DiagnosticReport","performer":[{"reference":"Organization/org-1","display":"Lab Co"}],"issued":"2022-03-03T00:00:00Z"}`), "DiagnosticReport", "dr1", "FollowMyHealth")
	if len(req.Authors) != 1 || req.Authors[0].Reference != "Organization/org-1" || req.Authors[0].Display != "Lab Co" {
		t.Errorf("diagnosticreport authors = %+v, want one Organization from performer[]", req.Authors)
	}
	if req.AuthoredTime != "2022-03-03T00:00:00Z" {
		t.Errorf("diagnosticreport authoredTime = %q, want issued", req.AuthoredTime)
	}

	// Immunization: performer[].actor alongside a function code (which we ignore).
	req = ExtractRequest(json.RawMessage(`{"resourceType":"Immunization","performer":[{"function":{"text":"AP"},"actor":{"reference":"Practitioner/dr-1","display":"Dr X"}}]}`), "Immunization", "imm1", "FollowMyHealth")
	if len(req.Authors) != 1 || req.Authors[0].Reference != "Practitioner/dr-1" {
		t.Errorf("immunization authors = %+v, want one Practitioner from performer.actor", req.Authors)
	}
}

// End-to-end: a Procedure's performer.actor resolves to the named clinician through the ladder.
func TestExtractRequest_PerformerEndToEnd(t *testing.T) {
	s := NewResourceSet(testResources())
	req := ExtractRequest(json.RawMessage(`{"resourceType":"Procedure","performer":[{"actor":{"reference":"Practitioner/dr-1"}}]}`), "Procedure", "proc1", "FollowMyHealth")
	p := s.ResolveProvenance(req)
	if p.Kind != KindPractitioner || p.Display != "Dr. Jane Synthetic" {
		t.Errorf("procedure performer provenance = %+v, want practitioner / Dr. Jane Synthetic", p)
	}
}

// End-to-end: ExtractRequest feeds ResolveProvenance and resolves a named author + time.
func TestExtractRequest_EndToEnd(t *testing.T) {
	s := NewResourceSet(testResources())
	req := ExtractRequest(json.RawMessage(`{"resourceType":"Condition","recorder":{"reference":"Practitioner/dr-1"},"recordedDate":"2019-03-14"}`), "Condition", "c1", "FollowMyHealth")
	p := s.ResolveProvenance(req)
	if p.Kind != KindPractitioner || p.Display != "Dr. Jane Synthetic" || p.Recorded != "2019-03-14" {
		t.Errorf("end-to-end provenance = %+v, want practitioner / Dr. Jane Synthetic / 2019-03-14", p)
	}
}
