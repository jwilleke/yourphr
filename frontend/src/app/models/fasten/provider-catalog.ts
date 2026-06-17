// ConnectableProvider is the credential-free projection of an admin-configured catalog entry that a
// patient picks to connect (#306 / #291). It deliberately carries NO client_id / client_secret —
// those stay backend-only. Mirrors backend models.ConnectableProvider (GET
// /api/secure/provider-catalog/connectable). See docs/provider-catalog/README.md.
export interface ConnectableProvider {
  id: string;
  display: string;
  brand_logo_url?: string;
}
