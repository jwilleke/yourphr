/**
 * The SMART OAuth store-and-poll relay, from the app's side (yourphr#700 / the product's #408).
 *
 * The relay itself (relay/main.go) is a public bouncer for the authorization `code`: the provider
 * redirects the patient's browser to `<public relay>/callback?code&state`, the relay holds
 * `{state -> code}` for ~60 seconds, and THIS class polls `GET /pending?state=` — gated by a shared
 * secret — to bring the code home for the token exchange. The relay never sees tokens; this
 * instance never needs to be publicly reachable.
 *
 * Configuration, resolved at call time so Admin -> Configuration edits take effect immediately:
 *
 *   yourphr.relay.public-url  what providers redirect the browser to; `<it>/callback` is the
 *                             OAuth redirect_uri registered with each FHIR vendor
 *   yourphr.relay.url         where THIS instance polls /pending (defaults to the public URL)
 *   yourphr.relay.secret      the shared secret gating /pending (YOURPHR_RELAY_SECRET)
 *
 * With neither URL set, the project's dev/demo relay is used — the same default the Go stack had,
 * and an honest `source: 'default'` in the admin card so nobody mistakes it for their own.
 *
 * Which door the poll goes through depends on who chose the address (yourphr#749):
 *
 *   - An operator-set relay (either URL configured) is polled through InternalServiceHttp, bound to
 *     that one origin. It may be internal: a relay beside the app on a home LAN, a split-DNS name
 *     that resolves to 192.168.x, or a cluster-internal service. The admin typed that address, as
 *     they typed the C-CDA converter's; nothing a provider or a request supplies can change it, no
 *     redirect is followed, and nothing else is widened.
 *   - The project's default relay goes through the guarded client like every other outbound call.
 *
 * v3.0–3.5 polled every relay through the SSRF guard, which refused any operator whose relay
 * resolved to a private address — including one polling its own public name behind split DNS.
 */
import { ApiError } from '../../framework/ApiContext.js';
import { InternalServiceHttp, OutboundHttp } from '../../http/index.js';
import type { Engine } from '../../framework/Engine.js';

/** The project dev/demo relay — the default when the operator configures nothing. */
export const DEFAULT_PUBLIC_RELAY = 'https://relay.nerdsbythehour.com';

export const PUBLIC_URL_KEY = 'yourphr.relay.public-url';
export const POLL_URL_KEY = 'yourphr.relay.url';
export const SECRET_KEY = 'yourphr.relay.secret';

/** How long one connect attempt polls before the frontend is told to retry (Go's #406 contract). */
export const RELAY_POLL_SECONDS = 55;
/** How long the frontend should keep retrying poll timeouts while the patient signs in. */
export const LOGIN_WAIT_SECONDS = 240;
const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 10_000;
/** /pending answers `{"code":"…"}` — anything near this size is not a relay talking. */
const POLL_MAX_BYTES = 64 * 1024;
/**
 * The admin dashboard's reachability probe (yourphr#870). Short on purpose: the dashboard waits on
 * it, and a relay that has not answered /healthz in three seconds is not one a connect can rely on.
 */
export const HEALTH_TIMEOUT_MS = 3_000;
/** /healthz answers `ok`. */
const HEALTH_MAX_BYTES = 4 * 1024;

/** One resolved value plus where it came from — the admin card's whole point (the product's #402). */
export interface ResolvedValue {
  value: string;
  source: 'configured' | 'inherited' | 'default' | 'unset';
  config_key?: string;
  env_var?: string;
}

export interface RelayResolved {
  callback_url: string;
  /** Whether the shared secret is set. Retained under its original name from the product's #399. */
  configured: boolean;
  /** True when a relay-poll connect can actually complete. */
  ready: boolean;
  public_url: ResolvedValue;
  poll_url: ResolvedValue;
  /** value is ALWAYS '' — the secret is never echoed. */
  secret: ResolvedValue;
}

/** One /healthz probe of the relay this instance polls. `url` is the poll base already shown on the admin card. */
export interface RelayHealth {
  ok: boolean;
  url: string;
  status?: number;
  error?: string;
}

export class RelayProvider {
  constructor(
    private readonly engine: Engine,
    private readonly http: OutboundHttp,
    private readonly options: { sleep?: (ms: number) => Promise<void>; now?: () => number } = {}
  ) {}

  private key(name: string): string {
    return this.engine.managers.configuration.getString(name).trim();
  }

  /** The effective relay settings with provenance — served on the admin relay card. */
  resolved(): RelayResolved {
    const configuredPublic = this.key(PUBLIC_URL_KEY);
    const configuredPoll = this.key(POLL_URL_KEY);
    const secretSet = this.key(SECRET_KEY) !== '';

    const public_url: ResolvedValue = configuredPublic !== ''
      ? { value: configuredPublic, source: 'configured', config_key: PUBLIC_URL_KEY, env_var: 'YOURPHR_RELAY_PUBLIC_URL' }
      : configuredPoll !== ''
        ? { value: configuredPoll, source: 'inherited', config_key: PUBLIC_URL_KEY, env_var: 'YOURPHR_RELAY_PUBLIC_URL' }
        : { value: DEFAULT_PUBLIC_RELAY, source: 'default' };
    const poll_url: ResolvedValue = configuredPoll !== ''
      ? { value: configuredPoll, source: 'configured', config_key: POLL_URL_KEY, env_var: 'YOURPHR_RELAY_URL' }
      : { value: public_url.value, source: public_url.source === 'default' ? 'default' : 'inherited', ...(public_url.source === 'default' ? {} : { config_key: POLL_URL_KEY, env_var: 'YOURPHR_RELAY_URL' }) };

    return {
      callback_url: `${public_url.value.replace(/\/+$/, '')}/callback`,
      configured: secretSet,
      ready: secretSet,
      public_url,
      poll_url,
      secret: { value: '', source: secretSet ? 'configured' : 'unset', config_key: SECRET_KEY, env_var: 'YOURPHR_RELAY_SECRET' },
    };
  }

  /** The OAuth redirect_uri this instance uses — what CatalogManager derives when a request omits one. */
  callbackUrl(): string {
    return this.resolved().callback_url;
  }

  /**
   * Whether a relay-poll connect can actually complete (the shared secret is set). authorize must
   * not derive the relay callback when this is false: the provider would send the code to a relay
   * this instance cannot poll, stranding the patient at "you may close this window" forever.
   */
  ready(): boolean {
    return this.key(SECRET_KEY) !== '';
  }

  /**
   * Poll `/pending?state=` until the code arrives or the window closes. Error codes are the
   * product's #406 contract, which the frontend keys its retry loop off: only `relay_poll_timeout`
   * is retryable — misconfiguration must not spin for minutes.
   */
  async fetchCode(state: string, pollSeconds = RELAY_POLL_SECONDS): Promise<string> {
    const secret = this.key(SECRET_KEY);
    if (secret === '') {
      throw new ApiError(501, 'no relay shared secret is configured (YOURPHR_RELAY_SECRET / yourphr.relay.secret), so live provider connect cannot complete', { error_code: 'relay_not_configured' });
    }
    const pollUrl = this.resolved().poll_url;
    const base = pollUrl.value.replace(/\/+$/, '');
    const path = `/pending?state=${encodeURIComponent(state)}`;
    const headers = { 'X-Yourphr-Token': secret };
    const get = this.pollGetter(base, pollUrl.source !== 'default', POLL_TIMEOUT_MS, POLL_MAX_BYTES);
    const now = this.options.now ?? Date.now;
    const sleep = this.options.sleep ?? ((ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)));
    const deadline = now() + pollSeconds * 1000;

    for (;;) {
      let response;
      try {
        response = await get(path, headers);
      } catch (err) {
        throw new ApiError(502, `could not reach the relay at ${base}: ${(err as Error).message}`, { error_code: 'relay_poll_failed' });
      }
      if (response.status === 200) {
        const code = String((JSON.parse(response.body.toString()) as { code?: unknown }).code ?? '');
        if (code === '') throw new ApiError(502, 'the relay answered 200 with no code', { error_code: 'relay_poll_failed' });
        return code;
      }
      if (response.status === 401 || response.status === 403) {
        throw new ApiError(502, 'the relay rejected the shared secret — set the same YOURPHR_RELAY_SECRET on the app and on the relay', { error_code: 'relay_unauthorized' });
      }
      if (response.status !== 404) {
        throw new ApiError(502, `the relay answered ${response.status} to /pending`, { error_code: 'relay_poll_failed' });
      }
      // 404: not there yet (or expired). Keep polling until the window closes.
      if (now() + POLL_INTERVAL_MS > deadline) {
        throw new ApiError(504, 'timed out waiting for the authorization code — the patient may still be signing in', { error_code: 'relay_poll_timeout' });
      }
      await sleep(POLL_INTERVAL_MS);
    }
  }

  /**
   * Whether the relay this instance polls answers `GET /healthz` (yourphr#870) — the admin
   * dashboard's "configured but unreachable" warning. Goes through the same door as the poll, so it
   * reaches exactly what a connect would reach: an operator-set relay (a cluster-internal service
   * included) at its configured origin only, the project default through the SSRF guard. Never
   * throws; never sends the shared secret (/healthz does not need it).
   */
  async checkHealth(timeoutMs = HEALTH_TIMEOUT_MS): Promise<RelayHealth> {
    const pollUrl = this.resolved().poll_url;
    const base = pollUrl.value.replace(/\/+$/, '');
    let status: number;
    try {
      const get = this.pollGetter(base, pollUrl.source !== 'default', timeoutMs, HEALTH_MAX_BYTES);
      status = (await get('/healthz', {})).status;
    } catch (err) {
      return { ok: false, url: base, error: (err as Error).message };
    }
    if (status !== 200) return { ok: false, url: base, status, error: `the relay answered ${status} to /healthz` };
    return { ok: true, url: base, status };
  }

  /**
   * The door for one request. An operator-set relay is trusted at its configured origin only; the
   * project default gets the guarded client. See the header for why.
   */
  private pollGetter(base: string, operatorSet: boolean, timeoutMs: number, maxBytes: number): (path: string, headers: Record<string, string>) => Promise<{ status: number; body: Buffer }> {
    if (!operatorSet) {
      return (path, headers) => this.http.get(`${base}${path}`, { headers, timeoutMs, maxBytes });
    }
    let service: InternalServiceHttp;
    try {
      service = new InternalServiceHttp(base, { timeoutMs, maxBytes });
    } catch (err) {
      throw new ApiError(502, `the configured relay address is not usable: ${(err as Error).message}`, { error_code: 'relay_poll_failed' });
    }
    return (path, headers) => service.get(path, headers);
  }
}
