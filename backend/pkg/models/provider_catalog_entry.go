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
