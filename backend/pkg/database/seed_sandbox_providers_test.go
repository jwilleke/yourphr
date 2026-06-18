package database

import (
	"context"
	"testing"

	mock_database "github.com/fastenhealth/fasten-onprem/backend/pkg/database/mock"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/models"
	"github.com/golang/mock/gomock"
	"github.com/sirupsen/logrus"
	"github.com/stretchr/testify/assert"
)

// captureUpserts records every entry the seeder upserts, keyed by Display.
func captureUpserts(mockDB *mock_database.MockDatabaseRepository) map[string]models.ProviderCatalogEntry {
	got := map[string]models.ProviderCatalogEntry{}
	mockDB.EXPECT().UpsertProviderCatalogEntryByDisplay(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, e *models.ProviderCatalogEntry) error {
			got[e.Display] = *e
			return nil
		}).AnyTimes()
	return got
}

// A sandbox with its client_id env set is upserted with creds, environment=sandbox, enabled. The open
// SMART Health IT sandbox (literal client_id) is always seeded; unconfigured env-based ones are skipped.
func TestSeedSandboxProviders_UpsertsConfigured(t *testing.T) {
	mockCtrl := gomock.NewController(t)
	defer mockCtrl.Finish()
	mockDB := mock_database.NewMockDatabaseRepository(mockCtrl)
	got := captureUpserts(mockDB)

	env := map[string]string{
		"YOURPHR_SANDBOX_BLUEBUTTON_CLIENT_ID":     "bb-client",
		"YOURPHR_SANDBOX_BLUEBUTTON_CLIENT_SECRET": "bb-secret",
		// Epic / Oracle / athenahealth client_ids intentionally empty -> skipped.
	}
	SeedSandboxProviders(context.Background(), mockDB, logrus.WithField("test", "seed"), func(k string) string { return env[k] })

	// Blue Button (env) is configured…
	bb, ok := got["Medicare — Blue Button 2.0 (Sandbox)"]
	assert.True(t, ok, "Blue Button should be seeded")
	assert.Equal(t, models.ProviderEnvironmentSandbox, bb.Environment)
	assert.Equal(t, "bb-client", bb.ClientId)
	assert.Equal(t, "bb-secret", bb.ClientSecret)
	assert.True(t, bb.Enabled)

	// …SMART Health IT (open, literal client_id) is always seeded…
	shi, ok := got["SMART Health IT (Sandbox)"]
	assert.True(t, ok, "open SMART Health IT should always be seeded")
	assert.Equal(t, "my-client-id", shi.ClientId)

	// …and the unconfigured env-based ones are not.
	_, hasEpic := got["Epic (Sandbox)"]
	_, hasOracle := got["Oracle Health / Cerner (Sandbox)"]
	_, hasAthena := got["athenahealth (Sandbox)"]
	assert.False(t, hasEpic)
	assert.False(t, hasOracle)
	assert.False(t, hasAthena)
}

// With no env configured, only the open literal-client_id sandbox (SMART Health IT) is seeded.
func TestSeedSandboxProviders_OnlyOpenSandboxWhenNoEnv(t *testing.T) {
	mockCtrl := gomock.NewController(t)
	defer mockCtrl.Finish()
	mockDB := mock_database.NewMockDatabaseRepository(mockCtrl)
	got := captureUpserts(mockDB)

	SeedSandboxProviders(context.Background(), mockDB, logrus.WithField("test", "seed"), func(string) string { return "" })

	assert.Len(t, got, 1, "only the open SMART Health IT sandbox should seed with no env")
	_, ok := got["SMART Health IT (Sandbox)"]
	assert.True(t, ok)
}

// Confidential athenahealth: when its client_id + secret env are set, both are seeded.
func TestSeedSandboxProviders_AthenaConfidential(t *testing.T) {
	mockCtrl := gomock.NewController(t)
	defer mockCtrl.Finish()
	mockDB := mock_database.NewMockDatabaseRepository(mockCtrl)
	got := captureUpserts(mockDB)

	env := map[string]string{
		"YOURPHR_SANDBOX_ATHENA_CLIENT_ID":     "athena-client",
		"YOURPHR_SANDBOX_ATHENA_CLIENT_SECRET": "athena-secret",
	}
	SeedSandboxProviders(context.Background(), mockDB, logrus.WithField("test", "seed"), func(k string) string { return env[k] })

	a, ok := got["athenahealth (Sandbox)"]
	assert.True(t, ok)
	assert.Equal(t, "athena-client", a.ClientId)
	assert.Equal(t, "athena-secret", a.ClientSecret)
}
