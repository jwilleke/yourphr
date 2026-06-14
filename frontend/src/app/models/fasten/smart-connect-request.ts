// Payload for POST /secure/source/connect — completes a SMART on FHIR connection in the
// backend, which performs the token exchange (the browser never handles tokens).
// EPIC #20, issue #52. Fields match the backend handler.SmartConnectRequest.
export interface SmartConnectRequest {
  api_endpoint_base_url: string;
  client_id: string;
  client_secret?: string; // only for CONFIDENTIAL clients (e.g. CMS Blue Button 2.0); empty for public/PKCE (Epic). (#286)
  scopes: string;
  redirect_uri?: string;
  code?: string;
  state?: string;
  code_verifier: string;
  display?: string;
}
