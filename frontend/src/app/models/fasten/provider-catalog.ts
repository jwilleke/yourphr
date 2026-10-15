// ConnectableProvider is the credential-free projection of an admin-configured catalog entry that a
// patient picks to connect (#306 / #291). It deliberately carries NO client_id / client_secret —
// those stay backend-only. Mirrors backend models.ConnectableProvider (GET
// /api/secure/provider-catalog/connectable). See docs/architecture/provider-catalog.md.
export interface ConnectableProvider {
  id: string;
  display: string;
  brand_logo_url?: string;
  /** PP/ToS opt-in required before connect (default true for all medical sources). */
  requires_user_consent?: boolean;
  /** Resolved pre-connect profile: none | generic | medicare. */
  pre_connect_profile?: string;
  /** CMS Blue Button-class (attribution + forced Medicare label on production). */
  medicare_class?: boolean;
  /** @deprecated use requires_user_consent */
  requires_legal_consent?: boolean;
}

// ProviderCatalogEntry is the admin view of a catalog entry. The client_secret is NEVER returned by
// the backend (json:"-"); `has_client_secret` tells the admin whether one is stored. Mirrors backend
// models.ProviderCatalogEntry (GET /api/secure/provider-catalog). #310.
export interface ProviderCatalogEntry {
  id?: string;
  display: string;
  // "production" (what real accounts connect on /sources) or "sandbox" (what test accounts connect there, #919). #291
  environment?: string;
  api_endpoint_base_url: string;
  scopes: string;
  client_id: string;
  has_client_secret?: boolean;
  platform_type?: string;
  brand_logo_url?: string;
  enabled: boolean;
  // Optional: pins the authorize endpoint when the server's discovery can't advertise the one our app
  // must use (e.g. Cerner's patient-persona authorize is undiscoverable). Usually empty. #338
  authorize_url_override?: string;
  /** required (default) | skip */
  consent_policy?: string;
  /** auto (default) | generic | medicare | none */
  pre_connect_profile?: string;
}

// ProviderCatalogEntryRequest is the admin create/update payload. client_secret is write-only: send it
// to set/replace; omit (empty) on update to keep the stored secret.
export interface ProviderCatalogEntryRequest {
  display: string;
  environment?: string;
  api_endpoint_base_url: string;
  scopes: string;
  client_id: string;
  client_secret?: string;
  platform_type?: string;
  brand_logo_url?: string;
  enabled: boolean;
  authorize_url_override?: string;
  consent_policy?: string;
  pre_connect_profile?: string;
}
