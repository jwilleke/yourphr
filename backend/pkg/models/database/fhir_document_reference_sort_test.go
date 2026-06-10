package database

import (
	"os"
	"testing"

	"github.com/stretchr/testify/require"
)

// #198 follow-up: the DocumentReference sort_title previously resolved type.text before
// type.coding[0].display, so FollowMyHealth docs (generic type.text like "HIPAA", real name in
// type.coding[0].display / description / attachment.title) sorted/labelled identically. The
// extractor now mirrors the frontend DocumentReferenceModel.title order. These tests pin both the
// non-US-Core shape and the standard shape.

func TestFhirDocumentReference_FollowMyHealth_SortTitle(t *testing.T) {
	t.Parallel()
	bytes, err := os.ReadFile("../../../../frontend/src/lib/fixtures/r4/resources/documentReference/example-followmyhealth.json")
	require.NoError(t, err)

	model := FhirDocumentReference{}
	err = model.PopulateAndExtractSearchParameters(bytes)
	require.NoError(t, err)

	// No description/category — the title must come from the meaningful type.coding[0].display,
	// never the generic type.text ("HIPAA").
	require.NotNil(t, model.SortTitle, "FMH document should derive a sort_title")
	require.Equal(t, "Release of Information Authorization, Example Hospital", *model.SortTitle)
	require.NotEqual(t, "HIPAA", *model.SortTitle)

	require.NotNil(t, model.SortDate, "FMH document should derive sort_date from `date`")
}

func TestFhirDocumentReference_Standard_SortTitle(t *testing.T) {
	t.Parallel()
	bytes, err := os.ReadFile("../../../../frontend/src/lib/fixtures/r4/resources/documentReference/example1.json")
	require.NoError(t, err)

	model := FhirDocumentReference{}
	err = model.PopulateAndExtractSearchParameters(bytes)
	require.NoError(t, err)

	// description leads, so a standard doc with a description titles from it (matching the card).
	require.NotNil(t, model.SortTitle, "standard document should derive a sort_title")
	require.Equal(t, "Physical", *model.SortTitle)

	require.NotNil(t, model.SortDate, "standard document should derive sort_date from `date`")
}
