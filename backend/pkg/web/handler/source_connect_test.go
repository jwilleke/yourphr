package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/fastenhealth/fasten-onprem/backend/pkg"
	mock_config "github.com/fastenhealth/fasten-onprem/backend/pkg/config/mock"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/database"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/event_bus"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/models"
	"github.com/gin-gonic/gin"
	"github.com/golang/mock/gomock"
	"github.com/sirupsen/logrus"
	"github.com/stretchr/testify/require"
)

// fakeSmartProvider stands up a hermetic SMART on FHIR provider: discovery, token endpoint, and
// Patient/$everything. Enough for ConnectSource's full pipeline (discover → exchange → fetch →
// ingest) with no external network, no relay, and no browser.
func fakeSmartProvider(t *testing.T, patientID string) *httptest.Server {
	t.Helper()
	var base string
	mux := http.NewServeMux()

	mux.HandleFunc("/.well-known/smart-configuration", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"authorization_endpoint":           base + "/authorize",
			"token_endpoint":                   base + "/token",
			"code_challenge_methods_supported": []string{"S256"},
			"grant_types_supported":            []string{"authorization_code"},
			"capabilities":                     []string{"launch-standalone", "client-public", "permission-patient"},
		})
	})

	mux.HandleFunc("/token", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		// Includes `patient` (the SMART launch context) — ConnectSource requires it.
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"access_token":  "AT",
			"refresh_token": "RT",
			"token_type":    "Bearer",
			"expires_in":    3600,
			"patient":       patientID,
		})
	})

	mux.HandleFunc("/Patient/"+patientID+"/$everything", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer AT" {
			http.Error(w, "missing bearer", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/fhir+json")
		fmt.Fprintf(w, `{"resourceType":"Bundle","type":"searchset","entry":[
			{"resource":{"resourceType":"Patient","id":%q}},
			{"resource":{"resourceType":"Observation","id":"obs1","status":"final","code":{"text":"Test Observation"},"subject":{"reference":"Patient/%s"}}}
		]}`, patientID, patientID)
	})

	srv := httptest.NewServer(mux)
	base = srv.URL
	return srv
}

// TestConnectSource_HappyPath exercises the SMART connect pipeline end-to-end against a hermetic
// fake provider (EPIC #20 acceptance — the real-OAuth happy path the Playwright spec can't run
// because fasten-sources is stubbed and there's no live provider/relay). The authorization code is
// passed directly, which the handler explicitly supports (the relay is only polled when Code is
// absent), so no relay is needed.
func TestConnectSource_HappyPath(t *testing.T) {
	// allow discovery against the httptest loopback URL (the SSRF guard blocks loopback in prod).
	original := validatePublicHTTPSURL
	validatePublicHTTPSURL = func(string) error { return nil }
	defer func() { validatePublicHTTPSURL = original }()

	provider := fakeSmartProvider(t, "pat1")
	defer provider.Close()

	ctrl := gomock.NewController(t)
	dbFile, err := os.CreateTemp("", "connect.*.db")
	require.NoError(t, err)
	defer os.Remove(dbFile.Name())

	cfg := mock_config.NewMockInterface(ctrl)
	cfg.EXPECT().GetString("database.location").Return(dbFile.Name()).AnyTimes()
	cfg.EXPECT().GetString("database.type").Return("sqlite").AnyTimes()
	cfg.EXPECT().IsSet("database.encryption.key").Return(false).AnyTimes()
	cfg.EXPECT().GetString("log.level").Return("INFO").AnyTimes()
	cfg.EXPECT().GetBool("database.validation_mode").Return(false).AnyTimes()
	cfg.EXPECT().GetBool("database.encryption.enabled").Return(false).AnyTimes()

	logger := logrus.WithField("test", t.Name())
	repo, err := database.NewRepository(cfg, logger, event_bus.NewNoopEventBusServer())
	require.NoError(t, err)
	require.NoError(t, repo.CreateUser(context.Background(), &models.User{Username: "u1", Password: "p"}))

	body, _ := json.Marshal(map[string]string{
		"api_endpoint_base_url": provider.URL,
		"client_id":             "e2e-client",
		"code":                  "the-code", // direct → relay not polled
		"code_verifier":         "the-verifier",
		"scopes":                "launch/patient openid fhirUser offline_access patient/*.read",
		"display":               "Fake EHR",
	})

	w := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(w)
	ctx.Set(pkg.ContextKeyTypeLogger, logger)
	ctx.Set(pkg.ContextKeyTypeDatabase, repo)
	ctx.Set(pkg.ContextKeyTypeConfig, cfg)
	ctx.Set(pkg.ContextKeyTypeEventBusServer, event_bus.NewNoopEventBusServer())
	ctx.Set(pkg.ContextKeyTypeAuthUsername, "u1")
	ctx.Request = httptest.NewRequest("POST", "/api/secure/source/connect", bytes.NewReader(body))
	ctx.Request.Header.Set("Content-Type", "application/json")

	ConnectSource(ctx)
	require.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())

	var resp struct {
		Success bool                    `json:"success"`
		Source  models.SourceCredential `json:"source"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	require.True(t, resp.Success)
	require.Equal(t, "pat1", resp.Source.Patient, "patient id from the token response should be stored")
	require.Equal(t, "AT", resp.Source.AccessToken)

	// the connected source is persisted (a default manual-upload source also exists per user,
	// so find ours by its FHIR base URL rather than assuming it's the only one)
	uctx := context.WithValue(context.Background(), pkg.ContextKeyTypeAuthUsername, "u1")
	sources, err := repo.GetSources(uctx)
	require.NoError(t, err)
	var connected *models.SourceCredential
	for i := range sources {
		if sources[i].ApiEndpointBaseUrl == provider.URL {
			connected = &sources[i]
		}
	}
	require.NotNil(t, connected, "the connected SMART source should be persisted")
	require.Equal(t, "pat1", connected.Patient)

	// and Patient/$everything was fetched + ingested by the now-async background sync (wait for it)
	require.Eventually(t, func() bool {
		obs, err := repo.ListResources(uctx, models.ListResourceQueryOptions{SourceResourceType: "Observation"})
		return err == nil && len(obs) == 1
	}, 5*time.Second, 20*time.Millisecond, "the Observation from $everything should be ingested")
}
