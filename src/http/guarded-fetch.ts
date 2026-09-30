/**
 * The outbound request path for provider data (yourphr#539).
 *
 * Node's built-in `fetch` cannot be used here: it is undici, which ignores `http.Agent` and so
 * ignores the guarded DNS lookup that is the actual SSRF control. It also follows redirects
 * internally, which is precisely the step that must be inspected rather than delegated. So requests
 * go through node:http/node:https with the guarded agents, and redirects are followed by hand.
 *
 * Every hop is a fresh guarded request. That is the whole point: the validated base URL is public
 * and the server answers `302 http://169.254.169.254/…`, which no amount of checking the ORIGINAL
 * url would catch.
 */
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { guardedAgents, validateUrl, REFUSAL } from './ssrf.js';

export interface GuardedFetchOptions {
  /** Refused once exceeded, rather than followed forever. */
  maxRedirects?: number;
  /** Total cap on the response body. A provider is not a reason to exhaust a family box's memory. */
  maxBytes?: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
  /** Test-only escape hatch, exactly as the Go side has. Never set in production. */
  allowInternal?: boolean;
  method?: 'GET' | 'POST';
  /** Sent form-encoded. Used by the OAuth token endpoint, which is why this exists at all. */
  form?: Record<string, string>;
  /** Sent as application/json. Used by RFC 7591 dynamic client registration (yourphr#581). */
  json?: unknown;
}

export interface GuardedResponse {
  status: number;
  headers: NodeJS.Dict<string | string[]>;
  body: Buffer;
  /** Where the response actually came from, after redirects. */
  finalUrl: string;
  /** Every URL in the chain, for the audit trail — a redirect is a disclosure of where you went. */
  chain: string[];
}

const DEFAULTS = { maxRedirects: 5, maxBytes: 8 * 1024 * 1024, timeoutMs: 30_000 };

export async function guardedFetch(target: string, options: GuardedFetchOptions = {}): Promise<GuardedResponse> {
  const maxRedirects = options.maxRedirects ?? DEFAULTS.maxRedirects;
  const maxBytes = options.maxBytes ?? DEFAULTS.maxBytes;
  const timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
  const allowInternal = options.allowInternal ?? false;
  const agents = guardedAgents(allowInternal);

  const chain: string[] = [];
  let current = target;
  let headers: Record<string, string> = { ...options.headers };

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const checked = validateUrl(current, allowInternal);
    if (!checked.ok) {
      throw new Error(checked.reason);
    }
    chain.push(current);

    const url = checked.url;
    const secure = url.protocol === 'https:';
    const send = secure ? httpsRequest : httpRequest;
    const method = options.method ?? 'GET';
    const requestBody = options.form
      ? new URLSearchParams(options.form).toString()
      : options.json !== undefined
        ? JSON.stringify(options.json)
        : undefined;
    const requestContentType = options.form ? 'application/x-www-form-urlencoded' : 'application/json';

    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      const req = send(
        url,
        {
          method,
          agent: secure ? agents.https : agents.http,
          headers: {
            accept: 'application/json',
            ...(requestBody === undefined
              ? {}
              : {
                  'content-type': requestContentType,
                  'content-length': String(Buffer.byteLength(requestBody)),
                }),
            ...headers,
          },
          timeout: timeoutMs,
        },
        resolve
      );
      req.on('timeout', () => req.destroy(new Error(`timed out after ${timeoutMs}ms: ${url.href}`)));
      req.on('error', reject);
      if (requestBody !== undefined) {
        req.write(requestBody);
      }
      req.end();
    });

    const location = response.headers.location;
    // A POST is never replayed to a redirect target. The token endpoint carries a client secret and
    // an authorization code; following a redirect would hand both to wherever the response pointed.
    if (method === 'POST' && response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
      response.resume();
      throw new Error(`refusing to follow a redirect from a POST to ${url.href} — credentials would be replayed`);
    }
    if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && location) {
      response.resume(); // drain, so the socket is released
      // Resolved against the current URL, because a relative Location is legal and common.
      const next = new URL(location, url);
      headers = headersForRedirect(url, next, headers);
      current = next.href;
      continue;
    }

    const body = await readCapped(response, maxBytes, url.href);
    return {
      status: response.statusCode ?? 0,
      headers: response.headers,
      body,
      finalUrl: url.href,
      chain,
    };
  }

  throw new Error(`too many redirects (${maxRedirects}) starting at ${target}`);
}

/** Headers that carry the caller's credentials — never sent on to an origin the caller did not name. */
const CREDENTIAL_HEADERS = new Set(['authorization', 'proxy-authorization', 'cookie']);

/**
 * The headers for the next hop of a redirect (yourphr#811).
 *
 *   - https → http is refused outright: the credential, and the response, would cross the wire in
 *     the clear, and nothing a provider serves needs it.
 *   - A different origin gets the request WITHOUT the credential headers — what the Fetch standard
 *     does for a browser. The sync's Bearer token is for the provider that issued it; a redirect to a
 *     CDN, a presigned storage URL, or anywhere else must not receive it. (A presigned URL refuses a
 *     stray Authorization header anyway, so stripping is also what makes those redirects work.)
 *   - The same origin keeps them.
 */
export function headersForRedirect(from: URL, to: URL, headers: Record<string, string>): Record<string, string> {
  if (from.protocol === 'https:' && to.protocol !== 'https:') {
    throw new Error(`refusing to follow a redirect from ${from.href} to ${to.protocol}// — it would leave HTTPS`);
  }
  if (from.origin === to.origin) return headers;
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !CREDENTIAL_HEADERS.has(name.toLowerCase())));
}

/**
 * Reads a body, refusing rather than truncating past the cap.
 *
 * Truncating would hand the caller a JSON document that parses to something different from what the
 * server sent, which is a worse failure than an error.
 */
function readCapped(response: IncomingMessage, maxBytes: number, href: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    response.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        response.destroy();
        reject(new Error(`response from ${href} exceeded ${maxBytes} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    response.on('end', () => resolve(Buffer.concat(chunks)));
    response.on('error', reject);
  });
}

export { REFUSAL };
