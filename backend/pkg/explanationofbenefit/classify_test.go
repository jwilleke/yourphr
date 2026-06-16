package explanationofbenefit

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func loadEOB(t *testing.T, name string) InputResource {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatalf("read %s: %v", name, err)
	}
	var meta struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(raw, &meta)
	return InputResource{SourceResourceType: "ExplanationOfBenefit", SourceResourceID: meta.ID, SourceID: "src-1", Raw: raw}
}

// The real CARRIER claim classifies into a plain-language claim with date, provider, insurer,
// diagnoses, costs (as stated), the payment amount, and the patient link.
func TestClassify_CarrierClaim(t *testing.T) {
	got := Classify([]InputResource{loadEOB(t, "eob-carrier.json")}, time.Time{})
	if len(got) != 1 {
		t.Fatalf("expected 1, got %d", len(got))
	}
	e := got[0]

	if e.Category != "Professional / doctor services" {
		t.Errorf("Category = %q", e.Category)
	}
	if e.ClaimType != "CARRIER" {
		t.Errorf("ClaimType = %q", e.ClaimType)
	}
	if e.TypeDisplay == "" || e.TypeDisplay[:13] != "Local carrier" {
		t.Errorf("TypeDisplay = %q", e.TypeDisplay)
	}
	if e.Date != "2015-09-28" || e.DateEnd != "" { // start==end -> no separate end
		t.Errorf("dates = %q / %q, want 2015-09-28 / ''", e.Date, e.DateEnd)
	}
	if e.Provider != "1063654341" {
		t.Errorf("Provider = %q", e.Provider)
	}
	if e.Insurer != "Medicare (CMS)" {
		t.Errorf("Insurer = %q, want 'Medicare (CMS)'", e.Insurer)
	}
	if e.Use != "claim" || e.Outcome != "complete" {
		t.Errorf("use/outcome = %q / %q", e.Use, e.Outcome)
	}
	if e.PatientRef != "Patient/-10000010254618" {
		t.Errorf("PatientRef = %q", e.PatientRef)
	}

	// diagnoses (principal + secondary), preferring ICD-10-CM
	if len(e.Diagnoses) != 2 {
		t.Fatalf("Diagnoses = %+v", e.Diagnoses)
	}
	if e.Diagnoses[0].Code != "R4689" || e.Diagnoses[0].Type != "principal" {
		t.Errorf("dx[0] = %+v", e.Diagnoses[0])
	}
	if e.Diagnoses[1].Code != "E781" || e.Diagnoses[1].Type != "secondary" {
		t.Errorf("dx[1] = %+v", e.Diagnoses[1])
	}

	// cost line uses the C4BBAdjudication display; payment amount surfaced separately
	if len(e.Costs) != 1 || e.Costs[0].Label != "Prior payer paid" || e.Costs[0].Currency != "USD" {
		t.Errorf("Costs = %+v", e.Costs)
	}
	if e.AmountPaid == nil || *e.AmountPaid != 932.69 || e.Currency != "USD" {
		t.Errorf("AmountPaid = %v / %q", e.AmountPaid, e.Currency)
	}
}

// eob-type drives the plain category; claim-type is the fallback; unknown yields "" (no-guessing).
func TestCategoryMapping(t *testing.T) {
	cases := []struct{ eobType, claimType, want string }{
		{"CARRIER", "professional", "Professional / doctor services"},
		{"INPATIENT", "institutional", "Hospital — inpatient"},
		{"OUTPATIENT", "institutional", "Hospital — outpatient"},
		{"PDE", "pharmacy", "Prescription drug (Part D)"},
		{"SNF", "institutional", "Skilled nursing facility"},
		{"HHA", "institutional", "Home health"},
		{"HOSPICE", "institutional", "Hospice"},
		{"DME", "professional", "Medical equipment (DME)"},
		{"", "institutional", "Facility / hospital"}, // fallback to claim-type
		{"", "", ""},                                 // unknown -> no guessing
	}
	for _, tc := range cases {
		raw := fmt.Sprintf(`{"resourceType":"ExplanationOfBenefit","type":{"coding":[`+
			`{"system":"https://bluebutton.cms.gov/resources/codesystem/eob-type","code":%q},`+
			`{"system":"http://terminology.hl7.org/CodeSystem/claim-type","code":%q}]}}`, tc.eobType, tc.claimType)
		got := Classify([]InputResource{{SourceResourceType: "ExplanationOfBenefit", Raw: json.RawMessage(raw)}}, time.Time{})
		if len(got) != 1 {
			t.Fatalf("eob-type %q: expected 1", tc.eobType)
		}
		if got[0].Category != tc.want {
			t.Errorf("eob-type=%q claim-type=%q -> Category %q, want %q", tc.eobType, tc.claimType, got[0].Category, tc.want)
		}
	}
}

// Costs are surfaced per adjudication line exactly as stated — nothing summed or inferred.
func TestCosts_AsStated(t *testing.T) {
	raw := `{"resourceType":"ExplanationOfBenefit","total":[
	  {"category":{"coding":[{"system":"http://hl7.org/fhir/us/carin-bb/CodeSystem/C4BBAdjudication","code":"submitted","display":"Submitted Amount"}]},"amount":{"value":150,"currency":"USD"}},
	  {"category":{"coding":[{"system":"http://hl7.org/fhir/us/carin-bb/CodeSystem/C4BBAdjudication","code":"benefit","display":"Benefit Amount"}]},"amount":{"value":100,"currency":"USD"}}
	],"payment":{"amount":{"value":100,"currency":"USD"}}}`
	got := Classify([]InputResource{{SourceResourceType: "ExplanationOfBenefit", Raw: json.RawMessage(raw)}}, time.Time{})[0]
	if len(got.Costs) != 2 {
		t.Fatalf("Costs = %+v", got.Costs)
	}
	if got.Costs[0].Label != "Submitted Amount" || got.Costs[0].Amount != 150 {
		t.Errorf("Costs[0] = %+v", got.Costs[0])
	}
	if got.Costs[1].Label != "Benefit Amount" || got.Costs[1].Amount != 100 {
		t.Errorf("Costs[1] = %+v", got.Costs[1])
	}
	if got.AmountPaid == nil || *got.AmountPaid != 100 {
		t.Errorf("AmountPaid = %v", got.AmountPaid)
	}
}

// billablePeriod with differing start/end surfaces both; an unparseable record is skipped.
func TestDatesAndSkip(t *testing.T) {
	in := []InputResource{
		{SourceResourceType: "ExplanationOfBenefit", SourceResourceID: "span", Raw: json.RawMessage(`{"resourceType":"ExplanationOfBenefit","billablePeriod":{"start":"2020-01-01","end":"2020-01-05"}}`)},
		{SourceResourceType: "ExplanationOfBenefit", SourceResourceID: "bad", Raw: json.RawMessage(`{not json`)},
	}
	got := Classify(in, time.Time{})
	if len(got) != 1 {
		t.Fatalf("expected 1 (bad skipped), got %d", len(got))
	}
	if got[0].Date != "2020-01-01" || got[0].DateEnd != "2020-01-05" {
		t.Errorf("dates = %q / %q", got[0].Date, got[0].DateEnd)
	}
}
