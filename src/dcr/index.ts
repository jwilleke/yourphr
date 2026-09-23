/**
 * Dynamic Client Registration, RFC 7591 (yourphr#581; Phase 4 of yourphr#542; supersedes the Go
 * yourphr#355 on the transition path).
 *
 * Why this exists — the lesson of 2026-08-19: Epic issues refresh tokens to PUBLIC standalone
 * clients only through DCR (register a per-installation client, then use the refresh grant as
 * that client). The product went confidential to ship; DCR is the standards path that lets a
 * self-hosted install keep offline access WITHOUT a shared secret.
 *
 * Security posture — the registration endpoint is attacker-influenceable in exactly the way the
 * token endpoint is (it comes out of a document the PROVIDER controls), so it passes the same
 * gauntlet: SSRF-validated, https-only against an https base, no downgrade
 * (validateDiscoveredEndpoint), fetched through the guarded capability.
 *
 * Two response refusals with teeth:
 *   - no client_id -> not a registration, refuse.
 *   - redirect_uris in the response that we DID NOT REQUEST -> refuse outright. A server that
 *     "helpfully" adds a redirect URI has minted a way to steal authorization codes; accepting the
 *     rest of the registration would wire that theft in.
 */
import { OutboundHttp } from '../http/index.js';
import { validateDiscoveredEndpoint } from '../sources/index.js';

export interface DcrRequest {
  registrationEndpoint: string;
  /** The https FHIR base the endpoint was discovered from — drives the no-downgrade rule. */
  baseIsHttps: boolean;
  clientName: string;
  redirectUris: string[];
  /** Epic-style: the access token from the FIRST authorization authorizes the registration. */
  initialAccessToken?: string;
  /** Tests only. */
  allowInternal?: boolean;
}

export interface DynamicClient {
  clientId: string;
  clientSecret: string;
  registrationAccessToken: string;
  registrationClientUri: string;
}

export async function registerDynamicClient(request: DcrRequest): Promise<DynamicClient> {
  // Same gauntlet as the token endpoint — see the module header.
  const endpoint = validateDiscoveredEndpoint(
    'registration_endpoint', request.registrationEndpoint, request.baseIsHttps, request.allowInternal ?? false
  );

  const http = new OutboundHttp({ allowInternal: request.allowInternal });
  const response = await http.get(endpoint.href, {
    method: 'POST',
    json: {
      client_name: request.clientName,
      redirect_uris: request.redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
    headers: request.initialAccessToken ? { authorization: `Bearer ${request.initialAccessToken}` } : {},
  });
  if (response.status !== 201 && response.status !== 200) {
    throw new Error(`registration endpoint HTTP ${response.status}: ${response.body.toString('utf8').slice(0, 256)}`);
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(response.body.toString('utf8')) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`decoding the registration response: ${(err as Error).message}`);
  }

  const clientId = payload['client_id'];
  if (typeof clientId !== 'string' || clientId === '') {
    throw new Error('registration response carried no client_id — not a registration');
  }

  const echoed = payload['redirect_uris'];
  if (Array.isArray(echoed)) {
    const requested = new Set(request.redirectUris);
    const extras = echoed.filter((u) => typeof u !== 'string' || !requested.has(u));
    if (extras.length > 0) {
      throw new Error(
        `registration response added redirect_uris we never requested (${JSON.stringify(extras)}) — a code-steal vector; refusing the registration`
      );
    }
  }

  return {
    clientId,
    clientSecret: typeof payload['client_secret'] === 'string' ? payload['client_secret'] : '',
    registrationAccessToken: typeof payload['registration_access_token'] === 'string' ? payload['registration_access_token'] : '',
    registrationClientUri: typeof payload['registration_client_uri'] === 'string' ? payload['registration_client_uri'] : '',
  };
}
