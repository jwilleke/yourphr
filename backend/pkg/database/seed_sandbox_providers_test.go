package database

import (
	"context"
	"testing"

	"github.com/fastenhealth/fasten-onprem/backend/pkg/models"
	mock_database "github.com/fastenhealth/fasten-onprem/backend/pkg/database/mock"
	"github.com/golang/mock/gomock"
	"github.com/sirupsen/logrus"
	"github.com/stretchr/testify/assert"
)

// A sandbox whose client_id env value is set is upserted with its creds, environment=sandbox, enabled.
func TestSeedSandboxProviders_UpsertsConfigured(t *testing.T) {
	mockCtrl := gomock.NewController(t)
	defer mockCtrl.Finish()
	mockDB := mock_database.NewMockDatabaseRepository(mockCtrl)

	env := map[string]string{
		"YOURPHR_SANDBOX_BLUEBUTTON_CLIENT_ID":     "bb-client",
		"YOURPHR_SANDBOX_BLUEBUTTON_CLIENT_SECRET": "bb-secret",
		// Epic client_id intentionally empty -> skipped.
	}
	getenv := func(k string) string { return env[k] }

	mockDB.EXPECT().UpsertProviderCatalogEntryByDisplay(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, e *models.ProviderCatalogEntry) error {
			assert.Equal(t, "Medicare — Blue Button 2.0 (Sandbox)", e.Display)
			assert.Equal(t, models.ProviderEnvironmentSandbox, e.Environment)
			assert.Equal(t, "bb-client", e.ClientId)
			assert.Equal(t, "bb-secret", e.ClientSecret)
			assert.True(t, e.Enabled)
			return nil
		})

	SeedSandboxProviders(context.Background(), mockDB, logrus.WithField("test", "seed"), getenv)
}

// With no env configured, nothing is upserted (no creds = not configured = skipped).
func TestSeedSandboxProviders_SkipsUnconfigured(t *testing.T) {
	mockCtrl := gomock.NewController(t)
	defer mockCtrl.Finish()
	mockDB := mock_database.NewMockDatabaseRepository(mockCtrl)
	// No UpsertProviderCatalogEntryByDisplay expected — gomock fails if called.

	SeedSandboxProviders(context.Background(), mockDB, logrus.WithField("test", "seed"), func(string) string { return "" })
}
