// Companion-app access tokens (#settings / connected devices). Returned by
// GET /api/secure/access/token. Distinct from the browser session JWT, which is
// the HttpOnly cookie after Phase 2b (#118).
export interface AccessToken {
  token_id: string
  name: string
  issued_at: string
  expires_at: string
  status?: string
}

export interface CreateAccessTokenRequest {
  name?: string
  expiration?: number
}

export interface ServerDiscovery {
  server_base_urls: string[]
  sync_endpoint: string
}
