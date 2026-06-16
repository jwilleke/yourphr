package patientlink

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/fastenhealth/fasten-onprem/backend/pkg/provenance"
)

func patientSet(t *testing.T) *Resolver {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "patient.json"))
	if err != nil {
		t.Fatalf("read patient.json: %v", err)
	}
	return NewResolver([]provenance.Resource{
		{SourceResourceType: "Patient", SourceResourceID: "-10000010254618", SourceID: "src-1", Raw: raw},
	})
}

// Both the EOB `patient` reference and the Coverage `beneficiary` reference resolve to the same
// imported Patient, carrying its human name.
func TestResolve_PatientAndBeneficiary(t *testing.T) {
	r := patientSet(t)
	for _, ref := range []string{"Patient/-10000010254618", "https://example.org/fhir/Patient/-10000010254618"} {
		card, ok := r.Resolve(ref)
		if !ok {
			t.Fatalf("ref %q did not resolve", ref)
		}
		if card.Ref != "Patient/-10000010254618" || !card.Confirmed {
			t.Errorf("ref %q -> %+v", ref, card)
		}
		if card.Name != "Chi716 Greenfelder433" {
			t.Errorf("name = %q", card.Name)
		}
	}
}

// No-guessing: an empty reference, a reference to a non-imported patient, and a non-Patient reference
// all fail to resolve — the resource is never attached to a patient by inference.
func TestResolve_NoGuessing(t *testing.T) {
	r := patientSet(t)
	for _, ref := range []string{"", "  ", "Patient/somebody-else", "Coverage/-10000010254618"} {
		if card, ok := r.Resolve(ref); ok {
			t.Errorf("ref %q unexpectedly resolved to %+v", ref, card)
		}
	}
}

// Associate buckets claims and coverage under the patient they reference, and reports anything with no
// resolvable reference as unresolved (never silently attached).
func TestAssociate(t *testing.T) {
	r := patientSet(t)
	claims := []Item{
		{ID: "eob-1", PatientRef: "Patient/-10000010254618"},
		{ID: "eob-2", PatientRef: "Patient/-10000010254618"},
		{ID: "eob-orphan", PatientRef: ""},
	}
	coverages := []Item{
		{ID: "cov-a", PatientRef: "Patient/-10000010254618"},
		{ID: "cov-stranger", PatientRef: "Patient/not-imported"},
	}
	got := r.Associate(claims, coverages)

	if len(got.Patients) != 1 {
		t.Fatalf("expected 1 patient group, got %d", len(got.Patients))
	}
	g := got.Patients[0]
	if g.Patient.Ref != "Patient/-10000010254618" {
		t.Errorf("group patient = %+v", g.Patient)
	}
	if len(g.ClaimIDs) != 2 || g.ClaimIDs[0] != "eob-1" || g.ClaimIDs[1] != "eob-2" {
		t.Errorf("ClaimIDs = %v", g.ClaimIDs)
	}
	if len(g.CoverageIDs) != 1 || g.CoverageIDs[0] != "cov-a" {
		t.Errorf("CoverageIDs = %v", g.CoverageIDs)
	}
	if len(got.UnresolvedClaims) != 1 || got.UnresolvedClaims[0] != "eob-orphan" {
		t.Errorf("UnresolvedClaims = %v", got.UnresolvedClaims)
	}
	if len(got.UnresolvedCoverage) != 1 || got.UnresolvedCoverage[0] != "cov-stranger" {
		t.Errorf("UnresolvedCoverage = %v", got.UnresolvedCoverage)
	}
}

// A Patient record with name.text uses it verbatim; one with no name yields "" (no synthesis).
func TestPatientName(t *testing.T) {
	cases := []struct{ raw, want string }{
		{`{"name":[{"text":"Jane Q. Public"}]}`, "Jane Q. Public"},
		{`{"name":[{"given":["Chi716"],"family":"Greenfelder433"}]}`, "Chi716 Greenfelder433"},
		{`{"name":[{"family":"Solo"}]}`, "Solo"},
		{`{}`, ""},
		{`{"name":[]}`, ""},
	}
	for _, tc := range cases {
		if got := patientName(json.RawMessage(tc.raw)); got != tc.want {
			t.Errorf("patientName(%s) = %q, want %q", tc.raw, got, tc.want)
		}
	}
}
