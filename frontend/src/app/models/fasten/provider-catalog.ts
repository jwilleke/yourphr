// ConnectableProvider is the credential-free projection of an admin-configured catalog entry that a
// patient picks to connect (#306 / #291). It deliberately carries NO client_id / client_secret —
// those stay backend-only. Mirrors backend models.ConnectableProvider (GET
// /api/secure/provider-catalog/connectable). See docs/provider-catalog/README.md.
export interface ConnectableProvider {
  id: string;
  display: string;
  brand_logo_url?: string;
}

// ProviderCatalogEntry is the admin view of a catalog entry. The client_secret is NEVER returned by
// the backend (json:"-"); `has_client_secret` tells the admin whether one is stored. Mirrors backend
// models.ProviderCatalogEntry (GET /api/secure/provider-catalog). #310.
export interface ProviderCatalogEntry {
  id?: string;
  display: string;
  // "production" (patient-facing /sources) or "sandbox" (admin-only /sandbox testing). #291
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
}
