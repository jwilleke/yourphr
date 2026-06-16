package handler

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/fastenhealth/fasten-onprem/backend/pkg"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/config"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/database"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/models"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/relay"
	"github.com/fastenhealth/fasten-sources/clients/smart"
	sourcePkg "github.com/fastenhealth/fasten-sources/pkg"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/sirupsen/logrus"
)

// Provider catalog (#304): admin-configured connectable sources — the self-hosted replacement for the
// upstream Fasten/Lighthouse catalog (EPIC #2). An admin curates providers (FHIR base, scopes,
// client_id, optional client_secret) once; patients connect by picking one, without ever seeing or
// sending credentials. See docs/provider-catalog/README.md.

// providerCatalogRequest is the admin create/update payload. ClientSecret is write-only (json in, never
// out): omitting it on update preserves the stored secret.
type providerCatalogRequest struct {
	Display            string `json:"display"`
	ApiEndpointBaseUrl string `json:"api_endpoint_base_url"`
	Scopes             string `json:"scopes"`
	ClientId           string `json:"client_id"`
	ClientSecret       string `json:"client_secret"`
	PlatformType       string `json:"platform_type"`
	BrandLogoUrl       string `json:"brand_logo_url"`
	Enabled            bool   `json:"enabled"`
}

// requireAdmin returns the current user only when it has the admin role; otherwise it writes a 403/500
// and returns false. The catalog is instance configuration — only an admin curates it.
func requireAdmin(c *gin.Context) bool {
	logger := c.MustGet(pkg.ContextKeyTypeLogger).(*logrus.Entry)
	databaseRepo := c.MustGet(pkg.ContextKeyTypeDatabase).(database.DatabaseRepository)
	currentUser, err := databaseRepo.GetCurrentUser(c)
	if err != nil {
		logger.Errorf("could not resolve current user: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not resolve current user"})
		return false
	}
	if currentUser.Role != pkg.UserRoleAdmin {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "error": "admin role required to manage the provider catalog"})
		return false
	}
	return true
}

// CreateProviderCatalogEntry (admin) registers a connectable provider.
func CreateProviderCatalogEntry(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	logger := c.MustGet(pkg.ContextKeyTypeLogger).(*logrus.Entry)
	databaseRepo := c.MustGet(pkg.ContextKeyTypeDatabase).(database.DatabaseRepository)

	var req providerCatalogRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": fmt.Sprintf("invalid request: %s", err)})
		return
	}
	if strings.TrimSpace(req.Display) == "" || strings.TrimSpace(req.ApiEndpointBaseUrl) == "" || strings.TrimSpace(req.ClientId) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "display, api_endpoint_base_url, and client_id are required"})
		return
	}
	// SSRF guard: the backend will fetch this URL during connect. Reject non-public targets up front.
	if err := validatePublicHTTPSURL(req.ApiEndpointBaseUrl); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": fmt.Sprintf("invalid api_endpoint_base_url: %s", err)})
		return
	}

	entry := models.ProviderCatalogEntry{
		Display:            strings.TrimSpace(req.Display),
		ApiEndpointBaseUrl: strings.TrimSpace(req.ApiEndpointBaseUrl),
		Scopes:             strings.TrimSpace(req.Scopes),
		ClientId:           strings.TrimSpace(req.ClientId),
		ClientSecret:       req.ClientSecret,
		PlatformType:       platformTypeOrDefault(req.PlatformType),
		BrandLogoUrl:       strings.TrimSpace(req.BrandLogoUrl),
		Enabled:            req.Enabled,
	}
	if err := databaseRepo.CreateProviderCatalogEntry(c, &entry); err != nil {
		logger.Errorf("error creating provider catalog entry: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	entry.HasClientSecret = entry.ClientSecret != ""
	c.JSON(http.StatusOK, gin.H{"success": true, "data": entry})
}

// ListProviderCatalogEntries (admin) lists all entries — client_id visible, secret redacted to a bool.
func ListProviderCatalogEntries(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	logger := c.MustGet(pkg.ContextKeyTypeLogger).(*logrus.Entry)
	databaseRepo := c.MustGet(pkg.ContextKeyTypeDatabase).(database.DatabaseRepository)

	entries, err := databaseRepo.ListProviderCatalogEntries(c, false)
	if err != nil {
		logger.Errorf("error listing provider catalog: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": entries})
}

// GetProviderCatalogEntry (admin) returns one entry (secret redacted to a bool).
func GetProviderCatalogEntry(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	databaseRepo := c.MustGet(pkg.ContextKeyTypeDatabase).(database.DatabaseRepository)
	entry, err := databaseRepo.GetProviderCatalogEntry(c, c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": entry})
}

// UpdateProviderCatalogEntry (admin) updates an entry. Omitting client_secret preserves the stored one
// (so an edit never silently blanks the confidential secret).
func UpdateProviderCatalogEntry(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	logger := c.MustGet(pkg.ContextKeyTypeLogger).(*logrus.Entry)
	databaseRepo := c.MustGet(pkg.ContextKeyTypeDatabase).(database.DatabaseRepository)

	existing, err := databaseRepo.GetProviderCatalogEntry(c, c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": err.Error()})
		return
	}
	var req providerCatalogRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": fmt.Sprintf("invalid request: %s", err)})
		return
	}
	if strings.TrimSpace(req.ApiEndpointBaseUrl) != "" {
		if err := validatePublicHTTPSURL(req.ApiEndpointBaseUrl); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": fmt.Sprintf("invalid api_endpoint_base_url: %s", err)})
			return
		}
		existing.ApiEndpointBaseUrl = strings.TrimSpace(req.ApiEndpointBaseUrl)
	}
	if strings.TrimSpace(req.Display) != "" {
		existing.Display = strings.TrimSpace(req.Display)
	}
	if strings.TrimSpace(req.ClientId) != "" {
		existing.ClientId = strings.TrimSpace(req.ClientId)
	}
	if strings.TrimSpace(req.PlatformType) != "" {
		existing.PlatformType = platformTypeOrDefault(req.PlatformType)
	}
	existing.Scopes = strings.TrimSpace(req.Scopes)
	existing.BrandLogoUrl = strings.TrimSpace(req.BrandLogoUrl)
	existing.Enabled = req.Enabled
	// Only overwrite the secret when a new one is supplied; empty input preserves the stored secret.
	if req.ClientSecret != "" {
		existing.ClientSecret = req.ClientSecret
	}

	if err := databaseRepo.UpdateProviderCatalogEntry(c, existing); err != nil {
		logger.Errorf("error updating provider catalog entry: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	existing.HasClientSecret = existing.ClientSecret != ""
	c.JSON(http.StatusOK, gin.H{"success": true, "data": existing})
}

// DeleteProviderCatalogEntry (admin) removes an entry. Existing connected sources are unaffected.
func DeleteProviderCatalogEntry(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	databaseRepo := c.MustGet(pkg.ContextKeyTypeDatabase).(database.DatabaseRepository)
	rows, err := databaseRepo.DeleteProviderCatalogEntry(c, c.Param("id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"deleted": rows}})
}

// ListConnectableProviders (any authenticated user) returns the enabled entries as a credential-free
// picker: id + display + logo only. No client_id/secret/base URL leaves the backend here.
func ListConnectableProviders(c *gin.Context) {
	logger := c.MustGet(pkg.ContextKeyTypeLogger).(*logrus.Entry)
	databaseRepo := c.MustGet(pkg.ContextKeyTypeDatabase).(database.DatabaseRepository)

	entries, err := databaseRepo.ListProviderCatalogEntries(c, true)
	if err != nil {
		logger.Errorf("error listing connectable providers: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	out := make([]models.ConnectableProvider, 0, len(entries))
	for i := range entries {
		out = append(out, entries[i].Connectable())
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": out})
}

// catalogConnectRequest is the patient-facing authorize/connect payload — note it carries NO
// client_id/client_secret/api_endpoint_base_url; those are resolved from the catalog server-side.
type catalogConnectRequest struct {
	RedirectUri  string `json:"redirect_uri"`
	State        string `json:"state"`
	CodeVerifier string `json:"code_verifier"`
	Code         string `json:"code"`
	Display      string `json:"display"`
}

// AuthorizeSourceFromCatalog (any authenticated user) builds the SMART authorize URL for a catalog
// entry — the backend fills client_id/scopes/base URL from the catalog, so the browser never sees them.
func AuthorizeSourceFromCatalog(c *gin.Context) {
	logger := c.MustGet(pkg.ContextKeyTypeLogger).(*logrus.Entry)
	databaseRepo := c.MustGet(pkg.ContextKeyTypeDatabase).(database.DatabaseRepository)
	appConfig := c.MustGet(pkg.ContextKeyTypeConfig).(config.Interface)

	entry, err := loadEnabledEntry(c, databaseRepo)
	if err != nil {
		return // loadEnabledEntry already wrote the response
	}
	var req catalogConnectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": fmt.Sprintf("invalid request: %s", err)})
		return
	}
	if strings.TrimSpace(req.RedirectUri) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "redirect_uri is required"})
		return
	}

	cfg := smart.Config{
		FHIRBaseURL: entry.ApiEndpointBaseUrl,
		ClientID:    entry.ClientId,
		Scopes:      strings.Fields(entry.Scopes),
		RedirectURI: req.RedirectUri,
	}
	ep, err := cfg.Discover(c)
	if err != nil {
		logger.Errorln(err)
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "error": fmt.Sprintf("SMART discovery failed: %s", err)})
		return
	}
	verifier, err := smart.GenerateVerifier()
	if err != nil {
		logger.Errorln(err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not generate PKCE verifier"})
		return
	}
	state := uuid.New().String()
	c.JSON(http.StatusOK, gin.H{
		"success":            true,
		"authorize_url":      cfg.AuthCodeURL(ep, state, verifier),
		"state":              state,
		"code_verifier":      verifier,
		"login_wait_seconds": appConfig.GetInt("web.smart_connect.login_wait_seconds"),
	})
}

// ConnectSourceFromCatalog (any authenticated user) completes a connection for a catalog entry. The
// backend fills client_id/client_secret/base URL from the catalog (zero credentials in the request),
// polls the relay for the code, exchanges it, resolves the patient id, stores the source, and starts
// the background sync.
func ConnectSourceFromCatalog(c *gin.Context) {
	logger := c.MustGet(pkg.ContextKeyTypeLogger).(*logrus.Entry)
	databaseRepo := c.MustGet(pkg.ContextKeyTypeDatabase).(database.DatabaseRepository)

	entry, err := loadEnabledEntry(c, databaseRepo)
	if err != nil {
		return
	}
	var req catalogConnectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": fmt.Sprintf("invalid request: %s", err)})
		return
	}
	if strings.TrimSpace(req.CodeVerifier) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "code_verifier is required"})
		return
	}
	if req.Code == "" && req.State == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "one of code or state is required"})
		return
	}

	if req.Code == "" {
		relayClient, err := relay.FromEnv()
		if err != nil {
			logger.Errorln(err)
			c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "error": fmt.Sprintf("relay not configured: %s", err)})
			return
		}
		code, err := relayClient.PollUntil(c, req.State, time.Second, 30*time.Second)
		if err != nil {
			logger.Errorln(err)
			c.JSON(http.StatusBadGateway, gin.H{"success": false, "error": fmt.Sprintf("could not retrieve authorization code from relay: %s", err)})
			return
		}
		req.Code = code
	}

	cfg := smart.Config{
		FHIRBaseURL:  entry.ApiEndpointBaseUrl,
		ClientID:     entry.ClientId,
		ClientSecret: entry.ClientSecret, // confidential client; resolved server-side, never from the browser
		Scopes:       strings.Fields(entry.Scopes),
		RedirectURI:  req.RedirectUri,
	}
	ep, err := cfg.Discover(c)
	if err != nil {
		logger.Errorln(err)
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "error": fmt.Sprintf("SMART discovery failed: %s", err)})
		return
	}
	tok, err := cfg.ExchangeCode(c, ep, req.Code, req.CodeVerifier)
	if err != nil {
		logger.Errorln(err)
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "error": fmt.Sprintf("token exchange failed: %s", err)})
		return
	}
	patientId, _ := tok.Extra("patient").(string)
	if patientId == "" {
		patientId, err = cfg.DiscoverPatientID(c, ep, tok)
		if err != nil {
			logger.Errorln(err)
			c.JSON(http.StatusBadGateway, gin.H{"success": false, "error": fmt.Sprintf("token had no patient id and could not resolve one from the FHIR API: %s", err)})
			return
		}
	}
	if patientId == "" {
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "error": "could not determine patient id"})
		return
	}

	display := strings.TrimSpace(req.Display)
	if display == "" {
		display = entry.Display
	}
	sourceCred := models.SourceCredential{
		PlatformType:       entry.PlatformType,
		EndpointID:         entry.ID, // tie the connected source back to its catalog provider
		Display:            display,
		ApiEndpointBaseUrl: entry.ApiEndpointBaseUrl,
		ClientId:           entry.ClientId,
		ClientSecret:       entry.ClientSecret,
		Scopes:             entry.Scopes,
		Patient:            patientId,
		AccessToken:        tok.AccessToken,
		RefreshToken:       tok.RefreshToken,
		ExpiresAt:          tok.Expiry.Unix(),
	}
	if err := databaseRepo.CreateSource(c, &sourceCred); err != nil {
		err = fmt.Errorf("an error occurred while storing source credential: %w", err)
		logger.Errorln(err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	bgCtx := GetBackgroundContext(c)
	go func() {
		defer func() {
			if r := recover(); r != nil {
				logger.Errorf("recovered from panic during initial sync of source %s: %v", sourceCred.ID, r)
			}
		}()
		if _, err := BackgroundJobSyncResources(bgCtx, logger, databaseRepo, &sourceCred); err != nil {
			logger.Errorf("initial sync failed for source %s: %v", sourceCred.ID, err)
		}
	}()
	c.JSON(http.StatusOK, gin.H{"success": true, "source": sourceCred, "data": gin.H{"status": "import_started"}})
}

// loadEnabledEntry resolves the :id path param to an enabled catalog entry, writing the error response
// itself (and returning a non-nil error) when it is missing or disabled.
func loadEnabledEntry(c *gin.Context, databaseRepo database.DatabaseRepository) (*models.ProviderCatalogEntry, error) {
	entry, err := databaseRepo.GetProviderCatalogEntry(c, c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "provider not found"})
		return nil, err
	}
	if !entry.Enabled {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "error": "provider is not enabled"})
		return nil, fmt.Errorf("provider %s is not enabled", entry.ID)
	}
	return entry, nil
}

func platformTypeOrDefault(pt string) sourcePkg.PlatformType {
	if strings.TrimSpace(pt) == "" {
		return sourcePkg.PlatformTypeEhr
	}
	return sourcePkg.PlatformType(pt)
}
