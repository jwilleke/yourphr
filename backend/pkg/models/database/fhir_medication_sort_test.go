package database

import (
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// #176: MedicationDispense and MedicationStatement previously had no resourceSortConfig entry, so
// they rendered blank/undated. These tests cover both a non-US-Core (FollowMyHealth) shape — where
// the medication carries only coding[0].display under a local code system — and the standard shape
// where the medication is a contained reference.

func TestFhirMedicationDispense_FollowMyHealth_SortTitleAndDate(t *testing.T) {
	t.Parallel()
	bytes, err := os.ReadFile("../../../../frontend/src/lib/fixtures/r4/resources/medicationDispense/example-followmyhealth.json")
	require.NoError(t, err)

	model := FhirMedicationDispense{}
	err = model.PopulateAndExtractSearchParameters(bytes)
	require.NoError(t, err)

	require.NotNil(t, model.SortTitle, "FMH dispense should derive sort_title from coding[0].display")
	require.Equal(t, "Lisinopril 40 MG Oral Tablet", *model.SortTitle)

	require.NotNil(t, model.SortDate, "FMH dispense should derive sort_date from whenHandedOver")
	require.Equal(t, time.Date(2026, time.January, 15, 0, 0, 0, 0, time.UTC), *model.SortDate)
}

func TestFhirMedicationDispense_Contained_SortTitle(t *testing.T) {
	t.Parallel()
	bytes, err := os.ReadFile("../../../../frontend/src/lib/fixtures/r4/resources/medicationDispense/example1.json")
	require.NoError(t, err)

	model := FhirMedicationDispense{}
	err = model.PopulateAndExtractSearchParameters(bytes)
	require.NoError(t, err)

	// example1 has no medicationCodeableConcept — the name lives in a contained Medication
	// referenced by "#medexample015"; the sort_title must resolve through it.
	require.NotNil(t, model.SortTitle, "dispense should resolve sort_title from the contained Medication")
	require.Equal(t, "Capecitabine 500mg oral tablet (Xeloda)", *model.SortTitle)
}

func TestFhirMedicationStatement_FollowMyHealth_SortTitleAndDate(t *testing.T) {
	t.Parallel()
	bytes, err := os.ReadFile("../../../../frontend/src/lib/fixtures/r4/resources/medicationStatement/example-followmyhealth.json")
	require.NoError(t, err)

	model := FhirMedicationStatement{}
	err = model.PopulateAndExtractSearchParameters(bytes)
	require.NoError(t, err)

	require.NotNil(t, model.SortTitle, "FMH statement should derive sort_title from coding[0].display")
	require.Equal(t, "Omeprazole 20 MG Oral Tablet Delayed Release", *model.SortTitle)

	require.NotNil(t, model.SortDate, "FMH statement should fall back to effectivePeriod.start for sort_date")
	require.Equal(t, time.Date(2025, time.November, 1, 0, 0, 0, 0, time.UTC), *model.SortDate)
}

func TestFhirMedicationStatement_Standard_SortTitleAndDate(t *testing.T) {
	t.Parallel()
	bytes, err := os.ReadFile("../../../../frontend/src/lib/fixtures/r4/resources/medicationStatement/example1.json")
	require.NoError(t, err)

	model := FhirMedicationStatement{}
	err = model.PopulateAndExtractSearchParameters(bytes)
	require.NoError(t, err)

	// Name lives in a contained Medication referenced by "#med0309".
	require.NotNil(t, model.SortTitle, "statement should resolve sort_title from the contained Medication")
	require.Equal(t, "Tylenol PM", *model.SortTitle)

	require.NotNil(t, model.SortDate, "statement should derive sort_date from effectiveDateTime")
	require.Equal(t, time.Date(2015, time.January, 23, 0, 0, 0, 0, time.UTC), *model.SortDate)
}
