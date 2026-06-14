// Payloads for POST /secure/source/authorize — the backend performs SMART on FHIR discovery and
// builds the PKCE authorize URL. The browser opens authorize_url and never handles tokens.
// EPIC #20, issue #52.
export interface SmartAuthorizeRequest {
  api_endpoint_base_url: string;
  client_id: string;
  scopes: string;
  redirect_uri: string;
}

export interface SmartAuthorizeResponse {
  authorize_url: string;
  state: string;
  code_verifier: string;
  // How long (seconds) the client should keep polling for the auth code while the user logs in at
  // the provider. Operator-tunable backend config (web.smart_connect.login_wait_seconds) so it can
  // change without a frontend rebuild; optional — the client falls back to its own default if absent.
  login_wait_seconds?: number;
}
