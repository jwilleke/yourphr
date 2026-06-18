package models

import sourcesPkg "github.com/fastenhealth/fasten-sources/pkg"

// Provider environments. Production entries are patient-facing (shown on /sources); sandbox entries are
// admin-only test providers (shown on /sandbox) and never reach patients.
const (
	ProviderEnvironmentProduction = "production"
	ProviderEnvironmentSandbox    = "sandbox"
)

// ProviderCatalogEntry is an admin-configured connectable source — the self-hosted replacement for the
// upstream Fasten/Lighthouse provider catalog (EPIC #20 / #288). An admin registers a provider once
// (FHIR base, scopes, client_id, optional client_secret); users connect by picking it, without ever
// seeing or handling credentials. `Environment` separates production (patient-facing) from sandbox
// (admin testing). See docs/provider-catalog/README.md (#304 / #291).
type ProviderCatalogEntry struct {
	ModelBase

	// Display is the user-facing button label, e.g. "Connect Medicare / Blue Button". Unique.
	Display string `json:"display" gorm:"uniqueIndex"`

	// Environment: "production" (patient-facing /sources) or "sandbox" (admin-only /sandbox).
	Environment string `json:"environment" gorm:"index;default:production"`

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

// ConnectableProvider is the user-facing projection: enough to render a picker, with no credentials.
type ConnectableProvider struct {
	ID           string `json:"id"`
	Display      string `json:"display"`
	BrandLogoUrl string `json:"brand_logo_url"`
}

// Connectable returns the credential-free projection of an entry for the picker.
func (p *ProviderCatalogEntry) Connectable() ConnectableProvider {
	return ConnectableProvider{
		ID:           p.ID.String(),
		Display:      p.Display,
		BrandLogoUrl: p.BrandLogoUrl,
	}
}

// SandboxProviderSeed is a known test sandbox: its public config plus the ENV VAR NAMES that supply its
// credentials. The actual client_id/secret come from env (a k8s Secret), never hardcoded or typed in
// the UI — so the /sandbox buttons connect with zero typing and the secret never reaches the browser.
type SandboxProviderSeed struct {
	Display            string
	ApiEndpointBaseUrl string
	Scopes             string
	ClientIDEnv        string // env var holding the client_id ("" when ClientIDLiteral is used)
	ClientSecretEnv    string // env var holding the client_secret ("" for public/PKCE providers)
	// ClientIDLiteral is a fixed, non-secret client_id for OPEN sandboxes that accept any value (e.g.
	// SMART Health IT). When set, the provider is always seeded without needing an env var.
	ClientIDLiteral string
}

// SandboxProviderSeeds lists the test sandboxes whose credentials are supplied via env. Only those with
// a non-empty client_id env value are seeded at startup (see the sandbox seeding in the web package).
func SandboxProviderSeeds() []SandboxProviderSeed {
	return []SandboxProviderSeed{
		{
			Display:            "Medicare — Blue Button 2.0 (Sandbox)",
			ApiEndpointBaseUrl: "https://sandbox.bluebutton.cms.gov/v2/fhir",
			Scopes:             "openid profile launch/patient patient/Patient.read patient/Coverage.read patient/ExplanationOfBenefit.read",
			ClientIDEnv:        "YOURPHR_SANDBOX_BLUEBUTTON_CLIENT_ID",
			ClientSecretEnv:    "YOURPHR_SANDBOX_BLUEBUTTON_CLIENT_SECRET",
		},
		{
			Display:            "Epic (Sandbox)",
			ApiEndpointBaseUrl: "https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4",
			Scopes:             "launch/patient patient/*.read openid fhirUser offline_access",
			ClientIDEnv:        "YOURPHR_SANDBOX_EPIC_CLIENT_ID",
			ClientSecretEnv:    "", // public/PKCE
		},
		{
			Display:            "Oracle Health / Cerner (Sandbox)",
			ApiEndpointBaseUrl: "https://fhir-myrecord.sandboxcerner.com/r4/ec2458f2-1e24-41c8-b71b-0e701af7583d",
			Scopes:             "launch/patient openid fhirUser offline_access patient/*.read",
			ClientIDEnv:        "YOURPHR_SANDBOX_ORACLE_CLIENT_ID",
			ClientSecretEnv:    "", // public/PKCE
		},
		{
			Display:            "athenahealth (Sandbox)",
			ApiEndpointBaseUrl: "https://api.preview.platform.athenahealth.com/fhir/r4",
			Scopes:             "launch/patient patient/*.read openid fhirUser offline_access",
			ClientIDEnv:        "YOURPHR_SANDBOX_ATHENA_CLIENT_ID",
			ClientSecretEnv:    "YOURPHR_SANDBOX_ATHENA_CLIENT_SECRET", // confidential
		},
		{
			// Open public launcher — accepts any client_id, no registration/secret. Always seeded.
			// The /sim/<base64> segment is required ({"launch_type":"patient-standalone"}).
			Display:            "SMART Health IT (Sandbox)",
			ApiEndpointBaseUrl: "https://launch.smarthealthit.org/v/r4/sim/eyJsYXVuY2hfdHlwZSI6InBhdGllbnQtc3RhbmRhbG9uZSJ9/fhir",
			Scopes:             "launch/patient patient/*.read openid fhirUser offline_access",
			ClientIDLiteral:    "my-client-id",
		},
	}
}

// DefaultProviderCatalogEntries are the no-credential sandbox templates seeded by an early migration.
// Kept for that migration's historical behavior; the live credentials now come from the env-based
// sandbox seeding (SandboxProviderSeeds), which upserts these by Display and fills the creds. Marked
// sandbox so they never appear to patients.
func DefaultProviderCatalogEntries() []ProviderCatalogEntry {
	out := []ProviderCatalogEntry{}
	for _, s := range SandboxProviderSeeds() {
		out = append(out, ProviderCatalogEntry{
			Display:            s.Display,
			Environment:        ProviderEnvironmentSandbox,
			ApiEndpointBaseUrl: s.ApiEndpointBaseUrl,
			Scopes:             s.Scopes,
			PlatformType:       sourcesPkg.PlatformTypeEhr,
			Enabled:            false,
		})
	}
	return out
}
