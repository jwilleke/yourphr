package models

import sourcesPkg "github.com/fastenhealth/fasten-sources/pkg"

// ProviderCatalogEntry is an admin-configured connectable source. It is the self-hosted replacement
// for the upstream Fasten/Lighthouse provider catalog (EPIC #20 / #288): an admin registers a provider app
// once (FHIR base, scopes, client_id, optional client_secret), and patients connect by picking it —
// without ever seeing or handling credentials. See docs/provider-catalog/README.md (#304 / #291).
type ProviderCatalogEntry struct {
	ModelBase

	// Display is the patient-facing button label, e.g. "Connect Medicare / Blue Button". Unique.
	Display string `json:"display" gorm:"uniqueIndex"`

	ApiEndpointBaseUrl string                  `json:"api_endpoint_base_url"`
	Scopes             string                  `json:"scopes"`
	PlatformType       sourcesPkg.PlatformType `json:"platform_type"`
	BrandLogoUrl       string                  `json:"brand_logo_url"`
	Enabled            bool                    `json:"enabled"`

	// ClientId is shown in admin/CRUD responses but redacted from the patient-facing connectable list.
	ClientId string `json:"client_id"`

	// ClientSecret is confidential-client secret material (#286): json:"-" so it is NEVER serialized to
	// the browser; GORM still persists it (column client_secret), encrypted at rest with the DB. Whether
	// one is set is surfaced via HasClientSecret instead.
	ClientSecret string `json:"-"`

	// HasClientSecret is a computed, non-persisted flag so the admin UI can show "confidential" without
	// the secret value ever leaving the backend. Populated on read; never stored.
	HasClientSecret bool `json:"has_client_secret" gorm:"-"`
}

// Connectable is the patient-facing projection: enough to render a picker, with no credentials.
type ConnectableProvider struct {
	ID           string `json:"id"`
	Display      string `json:"display"`
	BrandLogoUrl string `json:"brand_logo_url"`
}

// Connectable returns the credential-free projection of an entry for the patient picker.
func (p *ProviderCatalogEntry) Connectable() ConnectableProvider {
	return ConnectableProvider{
		ID:           p.ID.String(),
		Display:      p.Display,
		BrandLogoUrl: p.BrandLogoUrl,
	}
}

// DefaultProviderCatalogEntries are the known-good, NON-SECRET provider templates shipped as a
// head start: the FHIR base + the exact scopes we've verified, with EMPTY client_id/client_secret
// and Enabled=false. An admin adds their own bring-your-own client_id (and a client_secret for
// confidential providers) and flips Enabled — no real credential is ever committed (CLAUDE.md hard
// rule). Seeded idempotently by Display; deleting one does not bring it back.
func DefaultProviderCatalogEntries() []ProviderCatalogEntry {
	return []ProviderCatalogEntry{
		{
			// CMS Blue Button 2.0 sandbox — confidential client (the admin must add a client_secret).
			// Scopes are the exact set the sandbox accepts: NO offline_access / wildcard / fhirUser.
			Display:            "Medicare — Blue Button 2.0 (Sandbox)",
			ApiEndpointBaseUrl: "https://sandbox.bluebutton.cms.gov/v2/fhir",
			Scopes:             "openid profile launch/patient patient/Patient.read patient/Coverage.read patient/ExplanationOfBenefit.read",
			PlatformType:       sourcesPkg.PlatformTypeEhr,
			Enabled:            false,
		},
		{
			// Epic public SMART sandbox — public/PKCE client (no client_secret needed).
			Display:            "Epic (Sandbox)",
			ApiEndpointBaseUrl: "https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4",
			Scopes:             "launch/patient patient/*.read openid fhirUser offline_access",
			PlatformType:       sourcesPkg.PlatformTypeEhr,
			Enabled:            false,
		},
	}
}
