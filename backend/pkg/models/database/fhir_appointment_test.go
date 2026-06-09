package database

import (
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// Non-US-Core (#171): a FollowMyHealth Appointment has no appointmentType/serviceType/description and
// no start — only participants + created. It should still get a sensible sort_title (from the
// practitioner participant) and sort_date (from created), so it doesn't render blank/undated.
func TestFhirAppointment_FollowMyHealth_SortTitleAndDate(t *testing.T) {
	t.Parallel()
	bytes, err := os.ReadFile("../../../../frontend/src/lib/fixtures/r4/resources/appointment/example-followmyhealth.json")
	require.NoError(t, err)

	model := FhirAppointment{}
	err = model.PopulateAndExtractSearchParameters(bytes)
	require.NoError(t, err)

	require.NotNil(t, model.SortTitle, "FMH appointment should have a derived sort_title, not blank")
	require.Equal(t, "Appointment with Dr. Jane Smith", *model.SortTitle)

	require.NotNil(t, model.SortDate, "FMH appointment should fall back to created for sort_date")
	require.Equal(t, time.Date(2025, time.August, 22, 0, 0, 0, 0, time.UTC), *model.SortDate)
}

// Standard FHIR appointment: sort_title from appointmentType, sort_date from start.
func TestFhirAppointment_Standard_SortTitleAndDate(t *testing.T) {
	t.Parallel()
	bytes, err := os.ReadFile("../../../../frontend/src/lib/fixtures/r4/resources/appointment/example1.json")
	require.NoError(t, err)

	model := FhirAppointment{}
	err = model.PopulateAndExtractSearchParameters(bytes)
	require.NoError(t, err)

	require.NotNil(t, model.SortTitle, "standard appointment should derive a sort_title")
	require.NotEmpty(t, *model.SortTitle)
	require.NotNil(t, model.SortDate, "standard appointment should derive a sort_date from start")
}
