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
			FHIRBaseURL:  cred.GetApiEndpointBaseUrl(),
			ClientID:     cred.GetClientId(),
			ClientSecret: cred.GetClientSecret(), // confidential client when set; "" = public/PKCE (#286)
			Scopes:       cred.GetScopes(),
			// Surface the fetch strategy + per-resource results in the sync logs so empty/partial
			// imports are diagnosable instead of silent (#341 / #337).
			Logf: func(format string, args ...any) {
				if logger != nil {
					logger.Infof(format, args...)
				}
			},
		},
	}
}

// SyncAll performs a full sync: discover endpoints, ensure a valid access token, fetch the patient's
// data (Patient/$everything when the server supports it, else a per-resource compartment search), and
// upsert every resource. Any refreshed token is written back to the SourceCredential so the caller
// (BackgroundJobSyncResourcesWrapper) persists it.
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
	// FetchPatientData picks the strategy from the server's CapabilityStatement: Patient/$everything
	// when supported, else a per-resource search across the patient compartment (e.g. CMS Blue Button
	// 2.0, which has no $everything) — see clients/smart capability_fetch.go (#250). Pages are upserted
	// INCREMENTALLY as they arrive (the onPage callback), so a later hang/timeout/error keeps everything
	// already stored instead of discarding a whole buffered fetch (#341).
	// binaryRefs accumulates the Binary attachment URLs seen on DocumentReference/DiagnosticReport
	// resources during the metadata fetch, deduped, for the second (document-bytes) pass below. #342.
	binaryRefs := map[string]struct{}{}
	onPage := func(page []byte) error {
		resources, perr := extractResources(page)
		if perr != nil {
			if c.logger != nil {
				c.logger.Warnf("skipping unparseable fetch page: %v", perr)
			}
			return nil // one bad page must not abort the whole sync
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

			// Collect Binary attachment URLs for the second pass (#342). Providers like Cerner store
			// only a URL to a Binary, never inline bytes — so the document is unopenable until fetched.
			if header.ResourceType == "DocumentReference" || header.ResourceType == "DiagnosticReport" {
				for _, u := range extractAttachmentURLs(header.ResourceType, raw) {
					binaryRefs[u] = struct{}{}
				}
			}
		}
		return nil
	}

	refreshed, fetchErr := c.cfg.FetchPatientData(c.ctx, ep, tok, c.cred.GetPatientId(), onPage)
	if refreshed != nil { // persist a renewed token even if the fetch later errored
		c.cred.SetTokens(refreshed.AccessToken, refreshed.RefreshToken, refreshed.Expiry.Unix())
	}

	// Second pass: follow DocumentReference/DiagnosticReport attachment URLs to fetch the actual
	// document bytes (Binary resources). Runs AFTER the metadata import and is best-effort, so a slow
	// or failing document fetch never costs the records already stored (#341 philosophy). #342.
	c.fetchBinaries(db, ep, binaryRefs, &summary)

	if fetchErr != nil {
		// Whatever was fetched before the error is already stored (incremental upsert) — keep it and
		// surface the error so the partial sync is visible.
		return summary, fmt.Errorf("fetching patient data failed after importing %d resource(s): %w", summary.TotalResources, fetchErr)
	}
	return summary, nil
}

// fetchBinaries runs the #342 second pass: fetch each collected Binary attachment URL and upsert it.
// Upserts are serial (called back from FetchBinaries on a single goroutine); only the network fetches
// run in parallel. Any refreshed token is persisted. Best-effort: per-document failures are logged
// inside FetchBinaries and skipped, never aborting the sync.
func (c *smartClient) fetchBinaries(db models.DatabaseRepository, ep smart.Endpoints, binaryRefs map[string]struct{}, summary *models.UpsertSummary) {
	if len(binaryRefs) == 0 {
		return
	}
	urls := make([]string, 0, len(binaryRefs))
	for u := range binaryRefs {
		urls = append(urls, u)
	}
	if c.logger != nil {
		c.logger.Infof("fetching %d document attachment(s) as Binary resources (#342)", len(urls))
	}

	tok := &oauth2.Token{
		AccessToken:  c.cred.GetAccessToken(),
		RefreshToken: c.cred.GetRefreshToken(),
		Expiry:       time.Unix(c.cred.GetExpiresAt(), 0),
	}
	onBinary := func(page []byte) error {
		var header struct {
			ResourceType string `json:"resourceType"`
			ID           string `json:"id"`
		}
		if err := json.Unmarshal(page, &header); err != nil || header.ResourceType != "Binary" || header.ID == "" {
			if c.logger != nil {
				c.logger.Warnf("skipping fetched attachment: not a Binary resource with an id")
			}
			return nil
		}
		rawResource := models.RawResourceFhir{
			SourceResourceType:  header.ResourceType,
			SourceResourceID:    header.ID,
			ResourceRaw:         page,
			ReferencedResources: extractFHIRReferences(page),
		}
		if _, err := db.UpsertRawResource(c.ctx, c.cred, rawResource); err != nil {
			if c.logger != nil {
				c.logger.Warnf("error upserting Binary/%s: %v", header.ID, err)
			}
			return nil
		}
		summary.TotalResources++
		summary.UpdatedResources = append(summary.UpdatedResources, fmt.Sprintf("Binary/%s", header.ID))
		return nil
	}

	refreshed, err := c.cfg.FetchBinaries(c.ctx, ep, tok, urls, onBinary)
	if refreshed != nil {
		c.cred.SetTokens(refreshed.AccessToken, refreshed.RefreshToken, refreshed.Expiry.Unix())
	}
	if err != nil && c.logger != nil {
		c.logger.Warnf("document (Binary) fetch pass ended with: %v", err)
	}
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
