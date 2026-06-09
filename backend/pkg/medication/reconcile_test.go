package medication

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

var now = time.Date(2026, time.June, 9, 0, 0, 0, 0, time.UTC)

func res(t string, id string, body string) InputResource {
	return InputResource{SourceResourceType: t, SourceResourceID: id, Raw: json.RawMessage(body)}
}

func find(meds []ReconciledMedication, key string) *ReconciledMedication {
	for i := range meds {
		if meds[i].Key == key {
			return &meds[i]
		}
	}
	return nil
}

// A MedicationRequest + a MedicationDispense for the same clinical drug collapse into one row.
// Fields follow precedence (Request wins), state comes from the Request, last-activity is the max date.
func TestReconcile_DedupRequestPlusDispense(t *testing.T) {
	req := `{"resourceType":"MedicationRequest","status":"active",
		"medicationCodeableConcept":{"coding":[{"system":"http://www.nlm.nih.gov/research/umls/rxnorm","code":"314076","display":"Lisinopril 40 MG Oral Tablet"}]},
		"authoredOn":"2026-01-01",
		"dosageInstruction":[{"timing":{"repeat":{"frequency":1,"period":1,"periodUnit":"d"}},"doseAndRate":[{"doseQuantity":{"value":40,"unit":"mg"}}]}],
		"reasonCode":[{"text":"Hypertension"}],
		"requester":{"display":"Dr. McKinley"}}`
	disp := `{"resourceType":"MedicationDispense","status":"completed",
		"medicationCodeableConcept":{"coding":[{"system":"http://www.nlm.nih.gov/research/umls/rxnorm","code":"314076","display":"Lisinopril 40 MG Oral Tablet"}]},
		"whenHandedOver":"2026-01-15",
		"dosageInstruction":[{"doseAndRate":[{"doseQuantity":{"value":40,"unit":"mg"}}]}]}`

	meds := Reconcile([]InputResource{res("MedicationRequest", "mr1", req), res("MedicationDispense", "md1", disp)}, now)

	require.Len(t, meds, 1)
	m := meds[0]
	require.Equal(t, "rxnorm:314076", m.Key)
	require.Equal(t, "Lisinopril 40 MG Oral Tablet", m.Title)
	require.Equal(t, "314076", m.RxNormCode)
	require.Equal(t, StateActive, m.State)
	require.False(t, m.StateConflict)
	require.Equal(t, "40 mg", m.Dose)
	require.Equal(t, "1×/day", m.Frequency)
	require.Equal(t, "Hypertension", m.Purpose)
	require.Equal(t, "Dr. McKinley", m.Prescriber)
	require.NotNil(t, m.LastActivity)
	require.Equal(t, time.Date(2026, time.January, 15, 0, 0, 0, 0, time.UTC), *m.LastActivity)
	require.Len(t, m.Contributors, 2)
}

// Different strengths of the same ingredient stay as separate rows (dose-specific de-dup).
func TestReconcile_DoseSpecific_TwoRows(t *testing.T) {
	r40 := `{"resourceType":"MedicationRequest","status":"active","authoredOn":"2026-02-01",
		"medicationCodeableConcept":{"coding":[{"system":"http://www.nlm.nih.gov/research/umls/rxnorm","code":"314076","display":"Lisinopril 40 MG Oral Tablet"}]}}`
	r10 := `{"resourceType":"MedicationRequest","status":"completed","authoredOn":"2025-12-01",
		"medicationCodeableConcept":{"coding":[{"system":"http://www.nlm.nih.gov/research/umls/rxnorm","code":"197361","display":"Lisinopril 10 MG Oral Tablet"}]}}`

	meds := Reconcile([]InputResource{res("MedicationRequest", "a", r40), res("MedicationRequest", "b", r10)}, now)

	require.Len(t, meds, 2)
	require.Equal(t, StateActive, find(meds, "rxnorm:314076").State)
	require.Equal(t, StatePast, find(meds, "rxnorm:197361").State)
}

// Non-US-Core (FollowMyHealth): no RxNorm, only coding[0].display under a local system. De-dup falls
// back to the exact normalized display string; the original coding is preserved.
func TestReconcile_NonUSCore_TextKeyAndPassthrough(t *testing.T) {
	stmt := `{"resourceType":"MedicationStatement","status":"active",
		"medicationCodeableConcept":{"coding":[{"system":"https://fhir.followmyhealth.com/id/translation","code":"7c2e9d40-uuid","display":"Omeprazole 20 MG Oral Tablet Delayed Release"}]},
		"effectivePeriod":{"start":"2025-11-01"},"dateAsserted":"2026-02-20"}`

	meds := Reconcile([]InputResource{res("MedicationStatement", "s1", stmt)}, now)

	require.Len(t, meds, 1)
	m := meds[0]
	require.Equal(t, "text:omeprazole 20 mg oral tablet delayed release", m.Key)
	require.Equal(t, "Omeprazole 20 MG Oral Tablet Delayed Release", m.Title)
	require.Empty(t, m.RxNormCode)
	require.Equal(t, StateActive, m.State)
	require.Equal(t, time.Date(2025, time.November, 1, 0, 0, 0, 0, time.UTC), *m.LastActivity)
	require.Len(t, m.OriginalCodings, 1)
	require.Equal(t, "https://fhir.followmyhealth.com/id/translation", m.OriginalCodings[0].System)
}

func TestReconcile_StateClassification(t *testing.T) {
	cases := []struct {
		status string
		want   string
	}{
		{"active", StateActive},
		{"on-hold", StateSuspended},
		{"completed", StatePast},
		{"stopped", StatePast},
		{"unknown", StateUnknown},
		{"", StateUnknown},
	}
	for _, tc := range cases {
		body := `{"resourceType":"MedicationRequest","status":"` + tc.status + `",
			"medicationCodeableConcept":{"text":"Drug ` + tc.status + `"}}`
		meds := Reconcile([]InputResource{res("MedicationRequest", "x", body)}, now)
		require.Len(t, meds, 1, "status=%q", tc.status)
		require.Equal(t, tc.want, meds[0].State, "status=%q", tc.status)
	}
}

func TestReconcile_EnteredInError_Dropped(t *testing.T) {
	body := `{"resourceType":"MedicationRequest","status":"entered-in-error","medicationCodeableConcept":{"text":"Bogus"}}`
	meds := Reconcile([]InputResource{res("MedicationRequest", "x", body)}, now)
	require.Empty(t, meds, "entered-in-error contributor should be dropped, leaving no row")
}

// An explicit past effectivePeriod.end means the record states the med ended → Past, even if status=active.
func TestReconcile_ExplicitPastEndDate(t *testing.T) {
	body := `{"resourceType":"MedicationStatement","status":"active","medicationCodeableConcept":{"text":"Old Drug"},
		"effectivePeriod":{"start":"2024-01-01","end":"2024-06-01"}}`
	meds := Reconcile([]InputResource{res("MedicationStatement", "x", body)}, now)
	require.Len(t, meds, 1)
	require.Equal(t, StatePast, meds[0].State)
}

// Active request + completed statement for the same drug: conflict flagged; the most-recently-dated
// stated contributor drives the badge.
func TestReconcile_StatusConflict(t *testing.T) {
	req := `{"resourceType":"MedicationRequest","status":"active","authoredOn":"2025-01-01",
		"medicationCodeableConcept":{"coding":[{"system":"http://www.nlm.nih.gov/research/umls/rxnorm","code":"999","display":"Drug X"}]}}`
	stmt := `{"resourceType":"MedicationStatement","status":"completed","effectiveDateTime":"2026-01-01",
		"medicationCodeableConcept":{"coding":[{"system":"http://www.nlm.nih.gov/research/umls/rxnorm","code":"999","display":"Drug X"}]}}`
	meds := Reconcile([]InputResource{res("MedicationRequest", "r", req), res("MedicationStatement", "s", stmt)}, now)
	require.Len(t, meds, 1)
	require.True(t, meds[0].StateConflict)
	require.Equal(t, StatePast, meds[0].State, "most recent (2026 statement, completed) wins the badge")
}

// Dose/Frequency follow precedence: the prescribed MedicationRequest wins over the statement.
func TestReconcile_FieldPrecedence(t *testing.T) {
	stmt := `{"resourceType":"MedicationStatement","status":"active","effectiveDateTime":"2026-01-01",
		"medicationCodeableConcept":{"coding":[{"system":"http://www.nlm.nih.gov/research/umls/rxnorm","code":"555","display":"Drug Y"}]},
		"dosage":[{"doseAndRate":[{"doseQuantity":{"value":5,"unit":"mg"}}]}]}`
	req := `{"resourceType":"MedicationRequest","status":"active","authoredOn":"2026-01-02",
		"medicationCodeableConcept":{"coding":[{"system":"http://www.nlm.nih.gov/research/umls/rxnorm","code":"555","display":"Drug Y"}]},
		"dosageInstruction":[{"doseAndRate":[{"doseQuantity":{"value":10,"unit":"mg"}}]}]}`
	meds := Reconcile([]InputResource{res("MedicationStatement", "s", stmt), res("MedicationRequest", "r", req)}, now)
	require.Len(t, meds, 1)
	require.Equal(t, "10 mg", meds[0].Dose, "MedicationRequest dose should win over MedicationStatement")
}

// Default order is newest-on-top; an undated row sinks to the bottom.
func TestReconcile_SortNewestOnTopUndatedLast(t *testing.T) {
	older := `{"resourceType":"MedicationRequest","status":"active","authoredOn":"2025-01-01","medicationCodeableConcept":{"text":"Older"}}`
	newer := `{"resourceType":"MedicationRequest","status":"active","authoredOn":"2026-05-01","medicationCodeableConcept":{"text":"Newer"}}`
	undated := `{"resourceType":"MedicationRequest","status":"active","medicationCodeableConcept":{"text":"Undated"}}`
	meds := Reconcile([]InputResource{res("MedicationRequest", "a", older), res("MedicationRequest", "b", undated), res("MedicationRequest", "c", newer)}, now)
	require.Len(t, meds, 3)
	require.Equal(t, "Newer", meds[0].Title)
	require.Equal(t, "Older", meds[1].Title)
	require.Equal(t, "Undated", meds[2].Title, "undated row sorts last")
}

// The medication name and RxNorm key resolve through a contained Medication referenced by "#id".
func TestReconcile_ContainedReference(t *testing.T) {
	body := `{"resourceType":"MedicationDispense","status":"completed","whenHandedOver":"2026-03-01",
		"medicationReference":{"reference":"#m1"},
		"contained":[{"resourceType":"Medication","id":"m1","code":{"coding":[{"system":"http://www.nlm.nih.gov/research/umls/rxnorm","code":"213293","display":"Capecitabine 500mg oral tablet (Xeloda)"}]}}]}`
	meds := Reconcile([]InputResource{res("MedicationDispense", "d", body)}, now)
	require.Len(t, meds, 1)
	require.Equal(t, "rxnorm:213293", meds[0].Key)
	require.Equal(t, "Capecitabine 500mg oral tablet (Xeloda)", meds[0].Title)
	// dispense alone carries no state signal
	require.Equal(t, StateUnknown, meds[0].State)
}

// PRN (asNeeded) renders a clear frequency.
func TestReconcile_PRNFrequency(t *testing.T) {
	body := `{"resourceType":"MedicationStatement","status":"active","effectiveDateTime":"2026-01-01",
		"medicationCodeableConcept":{"text":"Valacyclovir"},
		"dosage":[{"asNeededBoolean":true,"doseAndRate":[{"doseQuantity":{"value":1,"unit":"g"}}]}]}`
	meds := Reconcile([]InputResource{res("MedicationStatement", "s", body)}, now)
	require.Len(t, meds, 1)
	require.Equal(t, "As needed (PRN)", meds[0].Frequency)
	require.Equal(t, "1 g", meds[0].Dose)
}
