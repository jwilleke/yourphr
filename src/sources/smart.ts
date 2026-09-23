/**
 * SMART on FHIR: discovery, authorization-code + PKCE, token exchange and refresh (yourphr#539).
 *
 * Mirrors what the Go backend does in `backend/pkg/sources/clients/smart`, with one deliberate
 * addition — see validateDiscoveredEndpoint below.
 *
 * Every outbound request goes through the OutboundHttp capability, so the SSRF guard covers
 * discovery, the token endpoint and everything after. That is not incidental: the endpoints used
 * here are read out of a document the PROVIDER controls, so they are attacker-influenceable in
 * exactly the way a hardcoded URL is not.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { OutboundHttp, validateUrl, type GuardedResponse } from '../http/index.js';

export interface SmartConfig {
  /** The FHIR service root, e.g. https://fhir.example.org/r4 */
  fhirBaseUrl: string;
  clientId: string;
  /** Set only for a confidential client. Empty means public/PKCE-only. */
  clientSecret?: string;
  redirectUri: string;
  scopes: string[];
  /** Tests only — drives loopback servers. Disables the SSRF guard. */
  allowInternal?: boolean;
}

export interface Endpoints {
  authorization: string;
  token: string;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  /** Absolute expiry, computed from expires_in at the moment of the response. */
  expiresAt?: Date;
  scope?: string;
  /** SMART launch context: the patient this token is scoped to, when the server supplies it. */
  patient?: string;
  raw: Record<string, unknown>;
}

/**
 * Refuses a discovered endpoint that would leak credentials.
 *
 * The Go side checks only that the endpoints are non-empty, and relies on the SSRF guard to stop an
 * INTERNAL address. That leaves a gap the guard cannot close: a provider whose smart-configuration
 * names a token endpoint at some other PUBLIC host would receive the authorization code — and, for
 * a confidential client, the client secret. The guard has no opinion about public hosts, correctly.
 *
 * So two rules on top:
 *
 *   - No downgrade. If the FHIR base is https, the endpoints must be too. Posting a client secret
 *     over cleartext is not something a discovery document should be able to ask for.
 *   - Must survive the same URL validation as any other target, so an endpoint of
 *     http://169.254.169.254/token is refused with a clear message rather than at dial time.
 *
 * Deliberately NOT requiring the same origin as the FHIR base: SMART explicitly allows a separate
 * authorization server, and real providers use one (fhir.example.com against auth.example.com).
 * A rule that breaks every real provider would just be turned off.
 */
export function validateDiscoveredEndpoint(
  name: string,
  raw: string,
  baseIsHttps: boolean,
  allowInternal = false
): URL {
  const checked = validateUrl(raw, allowInternal);
  if (!checked.ok) {
    throw new Error(`smart-configuration ${name} rejected: ${checked.reason}`);
  }
  if (baseIsHttps && checked.url.protocol !== 'https:' && !allowInternal) {
    throw new Error(
      `smart-configuration ${name} is ${checked.url.protocol}// while the FHIR base is https — refusing to downgrade`
    );
  }
  return checked.url;
}

/** A high-entropy PKCE code_verifier (RFC 7636): 32 random bytes, base64url, unpadded. */
export function generateVerifier(): string {
  return randomBytes(32).toString('base64url');
}

export function s256Challenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Compares two `state` values without leaking their contents through timing.
 *
 * The callback handler must call this. `state` is the only thing standing between a patient and a
 * cross-site request forgery that attaches an attacker's provider account to their record, and a
 * plain `===` on a secret is the kind of detail that is easy to skip and hard to notice.
 */
export function statesMatch(expected: string, received: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  if (a.length !== b.length || a.length === 0) {
    return false;
  }
  return timingSafeEqual(a, b);
}

export class SmartClient {
  private readonly config: SmartConfig;
  private readonly http: OutboundHttp;

  constructor(config: SmartConfig) {
    this.config = config;
    this.http = new OutboundHttp({ allowInternal: config.allowInternal });
  }

  /** GET {base}/.well-known/smart-configuration */
  async discover(): Promise<Endpoints> {
    const base = this.config.fhirBaseUrl.replace(/\/+$/, '');
    const checkedBase = validateUrl(base, this.config.allowInternal ?? false);
    if (!checkedBase.ok) {
      throw new Error(`FHIR base URL rejected: ${checkedBase.reason}`);
    }

    const response = await this.http.get(`${base}/.well-known/smart-configuration`);
    if (response.status !== 200) {
      throw new Error(`smart-configuration HTTP ${response.status}: ${preview(response)}`);
    }

    let document: Record<string, unknown>;
    try {
      document = JSON.parse(response.body.toString('utf8')) as Record<string, unknown>;
    } catch (err) {
      throw new Error(`decoding smart-configuration: ${(err as Error).message}`);
    }

    const authorization = document['authorization_endpoint'];
    const token = document['token_endpoint'];
    if (typeof authorization !== 'string' || typeof token !== 'string' || !authorization || !token) {
      throw new Error('smart-configuration missing authorization_endpoint or token_endpoint');
    }

    const baseIsHttps = checkedBase.url.protocol === 'https:';
    const allowInternal = this.config.allowInternal ?? false;
    return {
      authorization: validateDiscoveredEndpoint('authorization_endpoint', authorization, baseIsHttps, allowInternal).href,
      token: validateDiscoveredEndpoint('token_endpoint', token, baseIsHttps, allowInternal).href,
    };
  }

  /** The standalone-launch authorization URL, with PKCE S256. `aud` is required by SMART. */
  authorizeUrl(endpoints: Endpoints, state: string, verifier: string): string {
    const url = new URL(endpoints.authorization);
    const params = url.searchParams;
    params.set('response_type', 'code');
    params.set('client_id', this.config.clientId);
    params.set('redirect_uri', this.config.redirectUri);
    params.set('scope', this.config.scopes.join(' '));
    params.set('state', state);
    params.set('aud', this.config.fhirBaseUrl.replace(/\/+$/, ''));
    params.set('code_challenge', s256Challenge(verifier));
    params.set('code_challenge_method', 'S256');
    return url.href;
  }

  /** Exchange an authorization code, with its PKCE verifier, for a token. */
  async exchangeCode(endpoints: Endpoints, code: string, verifier: string): Promise<TokenResponse> {
    return this.postToken(endpoints, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.redirectUri,
      code_verifier: verifier,
    });
  }

  async refresh(endpoints: Endpoints, refreshToken: string): Promise<TokenResponse> {
    return this.postToken(endpoints, { grant_type: 'refresh_token', refresh_token: refreshToken });
  }

  private async postToken(endpoints: Endpoints, form: Record<string, string>): Promise<TokenResponse> {
    const headers: Record<string, string> = {};
    const body: Record<string, string> = { ...form, client_id: this.config.clientId };

    if (this.config.clientSecret) {
      // Confidential client: client_secret_basic, which keeps the secret out of the form body and
      // therefore out of anything that logs request bodies.
      const credentials = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64');
      headers['authorization'] = `Basic ${credentials}`;
    }

    const response = await this.http.get(endpoints.token, { method: 'POST', form: body, headers });
    if (response.status !== 200) {
      // The provider's own reason reaches the caller: "invalid_grant" and "expired token" need
      // different actions from the person holding the account.
      throw new Error(`token endpoint HTTP ${response.status}: ${preview(response)}`);
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(response.body.toString('utf8')) as Record<string, unknown>;
    } catch (err) {
      throw new Error(`decoding the token response: ${(err as Error).message}`);
    }

    const accessToken = payload['access_token'];
    if (typeof accessToken !== 'string' || !accessToken) {
      throw new Error('token response carried no access_token');
    }

    const expiresIn = payload['expires_in'];
    return {
      accessToken,
      refreshToken: typeof payload['refresh_token'] === 'string' ? payload['refresh_token'] : undefined,
      tokenType: typeof payload['token_type'] === 'string' ? payload['token_type'] : 'Bearer',
      expiresAt: typeof expiresIn === 'number' ? new Date(Date.now() + expiresIn * 1000) : undefined,
      scope: typeof payload['scope'] === 'string' ? payload['scope'] : undefined,
      patient: typeof payload['patient'] === 'string' ? payload['patient'] : undefined,
      raw: payload,
    };
  }
}

/** A short, bounded excerpt for an error message — never the whole body. */
function preview(response: GuardedResponse): string {
  return response.body.toString('utf8').slice(0, 512);
}
