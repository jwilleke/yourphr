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
}
