// The PKCE authorize URL a catalog entry builds (authorizeSourceFromCatalog). The browser opens
// authorize_url and never handles tokens.
export interface SmartAuthorizeResponse {
  authorize_url: string;
  state: string;
  code_verifier: string;
  // The redirect_uri the backend actually used. Round-trip it verbatim to the connect call — the
  // token exchange requires an exact match.
  redirect_uri?: string;
  // How long (seconds) the client should keep retrying connect while the user logs in at
  // the provider. Operator-tunable backend config (web.smart_connect.login_wait_seconds) so it can
  // change without a frontend rebuild; optional — the client falls back to its own default if absent.
  login_wait_seconds?: number;
  // How long (seconds) one backend connect request polls the relay. Used to size UI retry
  // attempts (login_wait / relay_poll). Optional — default 55 matches the backend (#406).
  relay_poll_seconds?: number;
}
