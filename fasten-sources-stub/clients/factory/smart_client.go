package factory

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/fastenhealth/fasten-sources/clients/models"
	"github.com/fastenhealth/fasten-sources/clients/smart"
	"github.com/sirupsen/logrus"
	"golang.org/x/oauth2"
)

// smartClient is the generic SMART on FHIR R4 source client (EPIC #20, issue #49). It drives
// the reusable clients/smart core using the self-describing SourceCredential, and embeds the
// file-import client to reuse bundle parsing / patient-id extraction for the interface methods
// it does not override.
type smartClient struct {
	*fileImportClient
	cfg smart.Config
}

func newSmartClient(ctx context.Context, logger *logrus.Entry, cred models.SourceCredential) *smartClient {
	return &smartClient{
		fileImportClient: &fileImportClient{ctx: ctx, logger: logger, cred: cred},
		cfg: smart.Config{
			FHIRBaseURL: cred.GetApiEndpointBaseUrl(),
			ClientID:    cred.GetClientId(),
			Scopes:      cred.GetScopes(),
		},
	}
}

// SyncAll performs a full sync: discover endpoints, ensure a valid access token, fetch
// Patient/$everything (paginated), and upsert every resource. Any refreshed token is written
// back to the SourceCredential so the caller (BackgroundJobSyncResourcesWrapper) persists it.
func (c *smartClient) SyncAll(db models.DatabaseRepository) (models.UpsertSummary, error) {
	summary := models.UpsertSummary{}
	if c.cfg.FHIRBaseURL == "" {
		return summary, fmt.Errorf("source has no FHIR base URL (api_endpoint_base_url); reconnect the source")
	}
	if c.cred.GetPatientId() == "" {
		return summary, fmt.Errorf("source has no patient id; reconnect the source")
	}

	ep, err := c.cfg.Discover(c.ctx)
	if err != nil {
		return summary, fmt.Errorf("SMART discovery failed: %w", err)
	}
	if err := c.ensureValidToken(ep); err != nil {
		return summary, err
	}

	tok := &oauth2.Token{
		AccessToken:  c.cred.GetAccessToken(),
		RefreshToken: c.cred.GetRefreshToken(),
		Expiry:       time.Unix(c.cred.GetExpiresAt(), 0),
	}
	pages, refreshed, err := c.cfg.FetchEverything(c.ctx, ep, tok, c.cred.GetPatientId())
	if err != nil {
		return summary, fmt.Errorf("Patient/$everything failed: %w", err)
	}
	if refreshed != nil {
		c.cred.SetTokens(refreshed.AccessToken, refreshed.RefreshToken, refreshed.Expiry.Unix())
	}

	for _, page := range pages {
		resources, perr := extractResources(page)
		if perr != nil {
			if c.logger != nil {
				c.logger.Warnf("skipping unparseable $everything page: %v", perr)
			}
			continue
		}
		for _, raw := range resources {
			var header struct {
				ResourceType string `json:"resourceType"`
				ID           string `json:"id"`
			}
			if err := json.Unmarshal(raw, &header); err != nil || header.ResourceType == "" || header.ID == "" {
				continue
			}
			rawResource := models.RawResourceFhir{
				SourceResourceType:  header.ResourceType,
				SourceResourceID:    header.ID,
				ResourceRaw:         raw,
				ReferencedResources: extractFHIRReferences(raw),
			}
			if _, err := db.UpsertRawResource(c.ctx, c.cred, rawResource); err != nil {
				if c.logger != nil {
					c.logger.Warnf("error upserting %s/%s: %v", header.ResourceType, header.ID, err)
				}
				continue
			}
			summary.TotalResources++
			summary.UpdatedResources = append(summary.UpdatedResources, fmt.Sprintf("%s/%s", header.ResourceType, header.ID))
		}
	}
	return summary, nil
}

// ensureValidToken refreshes the access token if it is missing or within the skew window of expiry.
// RefreshAccessToken ensures the SMART source's access token is valid, refreshing it in place when
// it is missing or within the skew window of expiry. It reuses the exact discovery + ensureValidToken
// path that SyncAll uses, so there is a single source of truth for SMART token refresh. Returns
// whether a refresh actually occurred; the caller persists the (mutated) credential. Used by the
// scheduled token-refresh worker (#51).
func RefreshAccessToken(ctx context.Context, logger *logrus.Entry, cred models.SourceCredential) (bool, error) {
	const skewSeconds = 60
	// Network-free guards: nothing to do for non-OAuth sources or still-valid tokens.
	if cred.GetAccessToken() == "" {
		return false, nil
	}
	if cred.GetExpiresAt() > time.Now().Add(skewSeconds*time.Second).Unix() {
		return false, nil
	}
	c := newSmartClient(ctx, logger, cred)
	if c.cfg.FHIRBaseURL == "" {
		return false, fmt.Errorf("source has no FHIR base URL (api_endpoint_base_url); reconnect the source")
	}
	ep, err := c.cfg.Discover(ctx)
	if err != nil {
		return false, fmt.Errorf("SMART discovery failed: %w", err)
	}
	before := cred.GetExpiresAt()
	if err := c.ensureValidToken(ep); err != nil {
		return false, err
	}
	return cred.GetExpiresAt() != before, nil
}

func (c *smartClient) ensureValidToken(ep smart.Endpoints) error {
	const skewSeconds = 60
	if c.cred.GetAccessToken() != "" && c.cred.GetExpiresAt() > time.Now().Add(skewSeconds*time.Second).Unix() {
		return nil // still valid
	}

	if c.cred.IsDynamicClient() {
		// Dynamic-client (e.g. Epic JWT) refresh lives on the concrete credential.
		if dc, ok := c.cred.(interface{ RefreshDynamicClientAccessToken() error }); ok {
			return dc.RefreshDynamicClientAccessToken()
		}
		return fmt.Errorf("source uses dynamic client registration but token refresh is unavailable")
	}

	if c.cred.GetRefreshToken() == "" {
		return fmt.Errorf("access token expired and no refresh token is available; reconnect the source")
	}
	tok, err := c.cfg.Refresh(c.ctx, ep, c.cred.GetRefreshToken())
	if err != nil {
		return fmt.Errorf("refreshing access token failed: %w", err)
	}
	c.cred.SetTokens(tok.AccessToken, tok.RefreshToken, tok.Expiry.Unix())
	return nil
}
