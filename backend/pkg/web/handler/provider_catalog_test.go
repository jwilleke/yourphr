package handler_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/fastenhealth/fasten-onprem/backend/pkg"
	mock_database "github.com/fastenhealth/fasten-onprem/backend/pkg/database/mock"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/models"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/web/handler"
	"github.com/gin-gonic/gin"
	"github.com/golang/mock/gomock"
	"github.com/google/uuid"
	"github.com/sirupsen/logrus"
	"github.com/stretchr/testify/assert"
)

func catalogContext(t *testing.T, mockDB *mock_database.MockDatabaseRepository, method, target string, body interface{}) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set(pkg.ContextKeyTypeLogger, logrus.WithField("test", "provider_catalog"))
	c.Set(pkg.ContextKeyTypeDatabase, mockDB)
	jsonData, _ := json.Marshal(body)
	c.Request, _ = http.NewRequest(method, target, bytes.NewBuffer(jsonData))
	c.Request.Header.Set("Content-Type", "application/json")
	return c, w
}

func adminUser() *models.User { return &models.User{Role: pkg.UserRoleAdmin} }
func plainUser() *models.User { return &models.User{Role: pkg.UserRoleUser} }

// A non-admin is refused (403) and no write reaches the DB.
func TestProviderCatalog_AdminGate(t *testing.T) {
	gin.SetMode(gin.TestMode)
	mockCtrl := gomock.NewController(t)
	defer mockCtrl.Finish()
	mockDB := mock_database.NewMockDatabaseRepository(mockCtrl)

	mockDB.EXPECT().GetCurrentUser(gomock.Any()).Return(plainUser(), nil)
	// CreateProviderCatalogEntry must NOT be called — gomock fails the test if it is.

	c, w := catalogContext(t, mockDB, http.MethodPost, "/provider-catalog", gin.H{
		"display": "Connect Medicare", "api_endpoint_base_url": "https://sandbox.bluebutton.cms.gov/v2/fhir", "client_id": "abc",
	})
	handler.CreateProviderCatalogEntry(c)
	assert.Equal(t, http.StatusForbidden, w.Code)
}

// An admin create succeeds; the response reports has_client_secret but NEVER serializes the secret.
func TestProviderCatalog_CreateRedactsSecret(t *testing.T) {
	gin.SetMode(gin.TestMode)
	mockCtrl := gomock.NewController(t)
	defer mockCtrl.Finish()
	mockDB := mock_database.NewMockDatabaseRepository(mockCtrl)

	mockDB.EXPECT().GetCurrentUser(gomock.Any()).Return(adminUser(), nil)
	mockDB.EXPECT().CreateProviderCatalogEntry(gomock.Any(), gomock.Any()).Return(nil)

	c, w := catalogContext(t, mockDB, http.MethodPost, "/provider-catalog", gin.H{
		"display":               "Connect Medicare / Blue Button",
		"api_endpoint_base_url": "https://sandbox.bluebutton.cms.gov/v2/fhir",
		"client_id":             "my-client-id",
		"client_secret":         "SUPER-SECRET-VALUE",
		"enabled":               true,
	})
	handler.CreateProviderCatalogEntry(c)

	assert.Equal(t, http.StatusOK, w.Code)
	bodyStr := w.Body.String()
	assert.NotContains(t, bodyStr, "SUPER-SECRET-VALUE", "client_secret must never appear in the response")
	assert.Contains(t, bodyStr, "\"has_client_secret\":true")
}

// Required-field validation rejects a missing client_id (no DB write).
func TestProviderCatalog_CreateRequiresFields(t *testing.T) {
	gin.SetMode(gin.TestMode)
	mockCtrl := gomock.NewController(t)
	defer mockCtrl.Finish()
	mockDB := mock_database.NewMockDatabaseRepository(mockCtrl)

	mockDB.EXPECT().GetCurrentUser(gomock.Any()).Return(adminUser(), nil)

	c, w := catalogContext(t, mockDB, http.MethodPost, "/provider-catalog", gin.H{
		"display": "X", "api_endpoint_base_url": "https://fhir.example.com/r4", // no client_id
	})
	handler.CreateProviderCatalogEntry(c)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

// The patient connectable list exposes only id/display/logo — no credentials, only enabled entries.
func TestProviderCatalog_ConnectableIsCredentialFree(t *testing.T) {
	gin.SetMode(gin.TestMode)
	mockCtrl := gomock.NewController(t)
	defer mockCtrl.Finish()
	mockDB := mock_database.NewMockDatabaseRepository(mockCtrl)

	entry := models.ProviderCatalogEntry{
		ModelBase:    models.ModelBase{ID: uuid.New()},
		Display:      "Connect Medicare / Blue Button",
		Environment:  models.ProviderEnvironmentProduction,
		ClientId:     "leaky-client-id",
		ClientSecret: "leaky-secret",
		BrandLogoUrl: "https://logo",
		Enabled:      true,
	}
	// A sandbox (admin-only) entry must NOT appear in the patient-facing list.
	sandbox := models.ProviderCatalogEntry{
		ModelBase:   models.ModelBase{ID: uuid.New()},
		Display:     "Epic (Sandbox)",
		Environment: models.ProviderEnvironmentSandbox,
		ClientId:    "sandbox-client-id",
		Enabled:     true,
	}
	// enabledOnly must be true for the patient-facing list.
	mockDB.EXPECT().ListProviderCatalogEntries(gomock.Any(), true).Return([]models.ProviderCatalogEntry{entry, sandbox}, nil)

	c, w := catalogContext(t, mockDB, http.MethodGet, "/provider-catalog/connectable", nil)
	handler.ListConnectableProviders(c)

	assert.Equal(t, http.StatusOK, w.Code)
	body := w.Body.String()
	assert.Contains(t, body, "Connect Medicare / Blue Button")
	assert.NotContains(t, body, "leaky-client-id")
	assert.NotContains(t, body, "leaky-secret")
	assert.NotContains(t, body, "Epic (Sandbox)", "sandbox providers must never appear in the patient list")
}

// The admin sandbox list returns only sandbox entries, credential-free, and refuses non-admins.
func TestProviderCatalog_SandboxListAdminOnlyAndFiltered(t *testing.T) {
	gin.SetMode(gin.TestMode)

	// Non-admin is refused (403); no DB read happens.
	t.Run("non-admin refused", func(t *testing.T) {
		mockCtrl := gomock.NewController(t)
		defer mockCtrl.Finish()
		mockDB := mock_database.NewMockDatabaseRepository(mockCtrl)
		mockDB.EXPECT().GetCurrentUser(gomock.Any()).Return(plainUser(), nil)

		c, w := catalogContext(t, mockDB, http.MethodGet, "/provider-catalog/sandbox", nil)
		handler.ListSandboxProviders(c)
		assert.Equal(t, http.StatusForbidden, w.Code)
	})

	t.Run("admin gets sandbox only", func(t *testing.T) {
		mockCtrl := gomock.NewController(t)
		defer mockCtrl.Finish()
		mockDB := mock_database.NewMockDatabaseRepository(mockCtrl)
		mockDB.EXPECT().GetCurrentUser(gomock.Any()).Return(adminUser(), nil)

		prod := models.ProviderCatalogEntry{
			ModelBase: models.ModelBase{ID: uuid.New()}, Display: "Medicare Production",
			Environment: models.ProviderEnvironmentProduction, Enabled: true,
		}
		sandbox := models.ProviderCatalogEntry{
			ModelBase: models.ModelBase{ID: uuid.New()}, Display: "Epic (Sandbox)",
			Environment: models.ProviderEnvironmentSandbox, ClientId: "sandbox-cid", ClientSecret: "sandbox-secret", Enabled: true,
		}
		mockDB.EXPECT().ListProviderCatalogEntries(gomock.Any(), true).Return([]models.ProviderCatalogEntry{prod, sandbox}, nil)

		c, w := catalogContext(t, mockDB, http.MethodGet, "/provider-catalog/sandbox", nil)
		handler.ListSandboxProviders(c)

		assert.Equal(t, http.StatusOK, w.Code)
		body := w.Body.String()
		assert.Contains(t, body, "Epic (Sandbox)")
		assert.NotContains(t, body, "Medicare Production", "production entries must not appear in the sandbox list")
		assert.NotContains(t, body, "sandbox-cid")
		assert.NotContains(t, body, "sandbox-secret")
	})
}

// Updating with an empty client_secret preserves the stored secret (never silently blanks it).
func TestProviderCatalog_UpdatePreservesSecret(t *testing.T) {
	gin.SetMode(gin.TestMode)
	mockCtrl := gomock.NewController(t)
	defer mockCtrl.Finish()
	mockDB := mock_database.NewMockDatabaseRepository(mockCtrl)

	id := uuid.New()
	stored := &models.ProviderCatalogEntry{
		ModelBase: models.ModelBase{ID: id}, Display: "Old", ApiEndpointBaseUrl: "https://fhir.example.com/r4",
		ClientId: "cid", ClientSecret: "KEEP-ME", Enabled: true,
	}
	mockDB.EXPECT().GetCurrentUser(gomock.Any()).Return(adminUser(), nil)
	mockDB.EXPECT().GetProviderCatalogEntry(gomock.Any(), id.String()).Return(stored, nil)
	// Capture what gets persisted and assert the secret survived.
	mockDB.EXPECT().UpdateProviderCatalogEntry(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ interface{}, e *models.ProviderCatalogEntry) error {
			assert.Equal(t, "KEEP-ME", e.ClientSecret, "omitted client_secret must preserve the stored one")
			assert.Equal(t, "New", e.Display)
			return nil
		})

	c, w := catalogContext(t, mockDB, http.MethodPut, "/provider-catalog/"+id.String(), gin.H{
		"display": "New", "client_id": "cid", "enabled": true, // no client_secret
	})
	c.Params = gin.Params{{Key: "id", Value: id.String()}}
	handler.UpdateProviderCatalogEntry(c)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.NotContains(t, w.Body.String(), "KEEP-ME")
}

// The static /connectable route and the /:id param route coexist without a router panic (gin v1.12).
func TestProviderCatalog_RoutesRegisterWithoutPanic(t *testing.T) {
	gin.SetMode(gin.TestMode)
	assert.NotPanics(t, func() {
		r := gin.New()
		g := r.Group("/api/secure")
		g.POST("/provider-catalog", handler.CreateProviderCatalogEntry)
		g.GET("/provider-catalog", handler.ListProviderCatalogEntries)
		g.GET("/provider-catalog/connectable", handler.ListConnectableProviders)
		g.GET("/provider-catalog/sandbox", handler.ListSandboxProviders)
		g.GET("/provider-catalog/:id", handler.GetProviderCatalogEntry)
		g.PUT("/provider-catalog/:id", handler.UpdateProviderCatalogEntry)
		g.DELETE("/provider-catalog/:id", handler.DeleteProviderCatalogEntry)
		g.POST("/provider-catalog/:id/authorize", handler.AuthorizeSourceFromCatalog)
		g.POST("/provider-catalog/:id/connect", handler.ConnectSourceFromCatalog)
	})
}

// Guard: the model never serializes the secret even when set.
func TestProviderCatalogEntry_NeverSerializesSecret(t *testing.T) {
	e := models.ProviderCatalogEntry{Display: "X", ClientSecret: "nope", HasClientSecret: true}
	b, err := json.Marshal(e)
	assert.NoError(t, err)
	assert.False(t, strings.Contains(string(b), "nope"))
	assert.Contains(t, string(b), "has_client_secret")
}
