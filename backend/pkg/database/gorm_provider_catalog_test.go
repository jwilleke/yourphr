package database

import (
	"context"
	"fmt"
	"os"
	"testing"

	"github.com/fastenhealth/fasten-onprem/backend/pkg/config"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/event_bus"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/models"
	"github.com/sirupsen/logrus"
	"github.com/stretchr/testify/require"
)

// newTestRepo spins up a real (temp, unencrypted) sqlite repo for provider-catalog tests. Note its
// migrations pre-seed the credential-free Blue Button + Epic sandbox templates (#304/#291).
func newTestRepo(t *testing.T) (DatabaseRepository, func()) {
	t.Helper()
	dbFile, err := os.CreateTemp("", fmt.Sprintf("%s.*.db", t.Name()))
	require.NoError(t, err)
	cfg, err := config.Create()
	require.NoError(t, err)
	cfg.SetDefault("database.location", dbFile.Name())
	cfg.SetDefault("database.encryption.enabled", false)
	cfg.SetDefault("log.level", "INFO")
	repo, err := NewRepository(cfg, logrus.WithField("test", t.Name()), event_bus.NewNoopEventBusServer())
	require.NoError(t, err)
	return repo, func() { os.Remove(dbFile.Name()) }
}

// byDisplay finds the single catalog entry with this display (helper; fails if absent).
func byDisplay(t *testing.T, repo DatabaseRepository, display string) models.ProviderCatalogEntry {
	t.Helper()
	entries, err := repo.ListProviderCatalogEntries(context.Background(), false)
	require.NoError(t, err)
	for _, e := range entries {
		if e.Display == display {
			return e
		}
	}
	t.Fatalf("no catalog entry with display %q", display)
	return models.ProviderCatalogEntry{}
}

// UpsertProviderCatalogEntryByDisplay must PROVISION (create / fill empty creds) but NEVER clobber an
// entry an admin has already edited — the env seed runs on every startup (#291).
func TestUpsertProviderCatalogEntryByDisplay_ProvisionThenPreserve(t *testing.T) {
	repo, cleanup := newTestRepo(t)
	defer cleanup()
	ctx := context.Background()

	display := "ZZ Custom Sandbox Provider" // unique — not one of the migration-seeded templates

	seed := func() *models.ProviderCatalogEntry {
		return &models.ProviderCatalogEntry{
			Display: display, Environment: models.ProviderEnvironmentSandbox,
			ApiEndpointBaseUrl: "https://example.com/fhir", Scopes: "openid patient/Patient.read",
			ClientId: "env-client", ClientSecret: "env-secret", Enabled: true,
		}
	}

	// 1. First seed -> creates the entry from env.
	require.NoError(t, repo.UpsertProviderCatalogEntryByDisplay(ctx, seed()))
	created := byDisplay(t, repo, display)
	require.Equal(t, "env-client", created.ClientId)
	require.True(t, created.Enabled)

	// 2. Admin edits it (changes scopes + client_id) via the normal update path.
	admin := created
	admin.Scopes = "admin-edited-scopes"
	admin.ClientId = "admin-client"
	require.NoError(t, repo.UpdateProviderCatalogEntry(ctx, &admin))

	// 3. Next startup re-runs the seed with the env values — it must NOT clobber the admin edit.
	before, err := repo.ListProviderCatalogEntries(ctx, false)
	require.NoError(t, err)
	require.NoError(t, repo.UpsertProviderCatalogEntryByDisplay(ctx, seed()))
	after, err := repo.ListProviderCatalogEntries(ctx, false)
	require.NoError(t, err)

	require.Len(t, after, len(before), "re-seed must not create a duplicate")
	final := byDisplay(t, repo, display)
	require.Equal(t, "admin-client", final.ClientId, "admin client_id must survive re-seed")
	require.Equal(t, "admin-edited-scopes", final.Scopes, "admin scopes must survive re-seed")
}

// When a credential-free entry already exists (the migration seed), the env seed fills its creds.
func TestUpsertProviderCatalogEntryByDisplay_FillsEmptyCreds(t *testing.T) {
	repo, cleanup := newTestRepo(t)
	defer cleanup()
	ctx := context.Background()

	// The migration pre-seeds "Epic (Sandbox)" credential-free + disabled.
	display := "Epic (Sandbox)"
	pre := byDisplay(t, repo, display)
	require.Empty(t, pre.ClientId, "migration seed should start credential-free")
	require.False(t, pre.Enabled)

	// Env seed provides the client_id -> it should fill + enable the existing row (no duplicate).
	before, err := repo.ListProviderCatalogEntries(ctx, false)
	require.NoError(t, err)
	require.NoError(t, repo.UpsertProviderCatalogEntryByDisplay(ctx, &models.ProviderCatalogEntry{
		Display: display, Environment: models.ProviderEnvironmentSandbox,
		ApiEndpointBaseUrl: "https://fhir.epic.com/.../R4", Scopes: "launch/patient", ClientId: "epic-real", Enabled: true,
	}))
	after, err := repo.ListProviderCatalogEntries(ctx, false)
	require.NoError(t, err)

	require.Len(t, after, len(before), "fill must update in place, not duplicate")
	filled := byDisplay(t, repo, display)
	require.Equal(t, "epic-real", filled.ClientId)
	require.True(t, filled.Enabled)
}
