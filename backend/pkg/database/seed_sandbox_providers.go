package database

import (
	"context"
	"strings"

	"github.com/fastenhealth/fasten-onprem/backend/pkg/models"
	sourcesPkg "github.com/fastenhealth/fasten-sources/pkg"
	"github.com/sirupsen/logrus"
)

// SeedSandboxProviders upserts the known test-sandbox providers (Blue Button, Epic, …) into the
// provider catalog as `sandbox` entries, taking their credentials from env (a k8s Secret) — so the
// /sandbox buttons connect with zero typing and the client_secret never reaches the browser (#291).
// A provider whose client_id env value is empty is skipped (not configured). Idempotent — runs at
// every startup and refreshes creds from env. getenv is injectable for tests (pass os.Getenv in prod).
func SeedSandboxProviders(ctx context.Context, repo DatabaseRepository, logger *logrus.Entry, getenv func(string) string) {
	for _, s := range models.SandboxProviderSeeds() {
		clientID := strings.TrimSpace(getenv(s.ClientIDEnv))
		if clientID == "" {
			continue // not configured in this deployment
		}
		secret := ""
		if s.ClientSecretEnv != "" {
			secret = strings.TrimSpace(getenv(s.ClientSecretEnv))
		}
		entry := models.ProviderCatalogEntry{
			Display:            s.Display,
			Environment:        models.ProviderEnvironmentSandbox,
			ApiEndpointBaseUrl: s.ApiEndpointBaseUrl,
			Scopes:             s.Scopes,
			PlatformType:       sourcesPkg.PlatformTypeEhr,
			ClientId:           clientID,
			ClientSecret:       secret,
			Enabled:            true,
		}
		if err := repo.UpsertProviderCatalogEntryByDisplay(ctx, &entry); err != nil {
			if logger != nil {
				logger.Errorf("sandbox seed: could not upsert %q: %v", s.Display, err)
			}
			continue
		}
		if logger != nil {
			logger.Infof("sandbox provider configured from env: %q", s.Display)
		}
	}
}
