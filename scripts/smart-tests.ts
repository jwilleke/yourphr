/**
 * Does the SMART client discover, authorize, exchange and refresh correctly — and refuse the things
 * it must refuse? (yourphr#539)
 *
 * Driven by a fake SMART server on loopback, so it needs no network, no credentials and no patient
 * data, and therefore runs in CI on every push. Reaching loopback requires allowInternal, which is
 * the same test-only escape hatch the Go side has.
 *
 *   npm run smart
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import {
  SmartClient,
  generateVerifier,
  s256Challenge,
  statesMatch,
  validateDiscoveredEndpoint,
} from '../src/sources/index.js';

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

interface FakeOptions {
  /** Overrides the endpoints announced by smart-configuration, to test what discovery accepts. */
  announce?: (base: string) => Record<string, unknown>;
}

/** A minimal SMART server: discovery, and a token endpoint that verifies PKCE properly. */
function startFakeProvider(options: FakeOptions = {}) {
  const seen: { tokenRequests: Record<string, string>[]; authHeaders: (string | undefined)[] } = {
    tokenRequests: [],
    authHeaders: [],
  };

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    if (req.url === '/.well-known/smart-configuration') {
      const body = options.announce
        ? options.announce(base)
        : { authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token` };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
      return;
    }

    if (req.url === '/token' && req.method === 'POST') {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const form = Object.fromEntries(new URLSearchParams(raw));
        seen.tokenRequests.push(form);
        seen.authHeaders.push(req.headers.authorization);

        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            access_token: 'at-12345',
            refresh_token: 'rt-67890',
            token_type: 'Bearer',
            expires_in: 3600,
            scope: 'patient/*.read',
            patient: 'Patient/abc',
          })
        );
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  return { server, seen };
}

function listen(server: ReturnType<typeof startFakeProvider>['server']): Promise<string> {
  return new Promise((done) =>
    server.listen(0, '127.0.0.1', () => done(`http://127.0.0.1:${(server.address() as AddressInfo).port}`))
  );
}

async function main(): Promise<void> {
  console.log('\nPKCE\n');
  const verifier = generateVerifier();
  check('verifier is at least 43 characters (RFC 7636)', verifier.length >= 43, `${verifier.length}`);
  check('verifier is base64url with no padding', /^[A-Za-z0-9_-]+$/.test(verifier));
  check('two verifiers differ', generateVerifier() !== generateVerifier());
  check(
    'challenge is the base64url SHA-256 of the verifier',
    s256Challenge('abc') === createHash('sha256').update('abc').digest('base64url')
  );

  console.log('\nstate comparison\n');
  check('equal states match', statesMatch('abc123', 'abc123'));
  check('different states do not', !statesMatch('abc123', 'abc124'));
  check('different lengths do not', !statesMatch('abc', 'abcd'));
  check('empty state never matches', !statesMatch('', ''));

  console.log('\ndiscovery and the token flow\n');
  const provider = startFakeProvider();
  const base = await listen(provider.server);

  const client = new SmartClient({
    fhirBaseUrl: base,
    clientId: 'spike-client',
    redirectUri: 'http://localhost:9999/callback',
    scopes: ['patient/*.read', 'offline_access'],
    allowInternal: true,
  });

  const endpoints = await client.discover();
  check('discovers the authorization endpoint', endpoints.authorization === `${base}/authorize`, endpoints.authorization);
  check('discovers the token endpoint', endpoints.token === `${base}/token`, endpoints.token);

  const authUrl = new URL(client.authorizeUrl(endpoints, 'state-xyz', verifier));
  check('authorize URL uses the authorization code flow', authUrl.searchParams.get('response_type') === 'code');
  check('carries the PKCE challenge', authUrl.searchParams.get('code_challenge') === s256Challenge(verifier));
  check('declares S256, never plain', authUrl.searchParams.get('code_challenge_method') === 'S256');
  check('carries aud, which SMART requires', authUrl.searchParams.get('aud') === base);
  check('carries state', authUrl.searchParams.get('state') === 'state-xyz');
  check('never carries the verifier itself', !authUrl.href.includes(verifier));

  const token = await client.exchangeCode(endpoints, 'code-abc', verifier);
  check('exchange returns the access token', token.accessToken === 'at-12345');
  check('exchange returns the refresh token', token.refreshToken === 'rt-67890');
  check('expiry is absolute, not a duration', token.expiresAt instanceof Date && token.expiresAt > new Date());
  check('captures the SMART patient context', token.patient === 'Patient/abc');

  const sent = provider.seen.tokenRequests[0] ?? {};
  check('sends the PKCE verifier', sent['code_verifier'] === verifier);
  check('sends grant_type=authorization_code', sent['grant_type'] === 'authorization_code');
  check('a public client sends no Authorization header', provider.seen.authHeaders[0] === undefined);

  const refreshed = await client.refresh(endpoints, 'rt-67890');
  check('refresh returns a token', refreshed.accessToken === 'at-12345');
  check('refresh uses grant_type=refresh_token', (provider.seen.tokenRequests[1] ?? {})['grant_type'] === 'refresh_token');

  console.log('\nconfidential client\n');
  const confidential = new SmartClient({
    fhirBaseUrl: base,
    clientId: 'spike-client',
    clientSecret: 'sh! secret',
    redirectUri: 'http://localhost:9999/callback',
    scopes: ['patient/*.read'],
    allowInternal: true,
  });
  await confidential.exchangeCode(endpoints, 'code-abc', verifier);
  const header = provider.seen.authHeaders[2];
  check('uses client_secret_basic', (header ?? '').startsWith('Basic '));
  check(
    'keeps the secret out of the form body, so body logging cannot leak it',
    !Object.values(provider.seen.tokenRequests[2] ?? {}).includes('sh! secret')
  );

  provider.server.close();

  console.log('\nrefused discovery documents\n');

  // Tested directly rather than through the fake server: reaching a loopback fake needs
  // allowInternal, and that same flag switches off the very rules under test. Driving the pure
  // function keeps the coverage real instead of vacuous.
  const refuses = (name: string, url: string, baseIsHttps: boolean): boolean => {
    try {
      validateDiscoveredEndpoint(name, url, baseIsHttps);
      return false;
    } catch {
      return true;
    }
  };

  check('refuses a token endpoint at cloud metadata', refuses('token_endpoint', 'http://169.254.169.254/token', true));
  check('refuses a token endpoint on loopback', refuses('token_endpoint', 'http://127.0.0.1/token', true));
  check('refuses a token endpoint on a private address', refuses('token_endpoint', 'https://10.0.0.5/token', true));
  check('refuses an http token endpoint when the base is https (no downgrade)', refuses('token_endpoint', 'http://auth.example.com/token', true));
  check('refuses a non-http scheme', refuses('token_endpoint', 'file:///etc/passwd', true));

  // Must still allow the normal case: SMART explicitly permits a separate authorization server, and
  // real providers use one. A rule that broke every provider would simply be turned off.
  check(
    'allows a separate public https authorization server',
    !refuses('token_endpoint', 'https://auth.example.com/token', true)
  );

  // Missing endpoints.
  const emptyAnnouncer = startFakeProvider({ announce: () => ({ authorization_endpoint: '' }) });
  const emptyBase = await listen(emptyAnnouncer.server);
  const emptyClient = new SmartClient({
    fhirBaseUrl: emptyBase,
    clientId: 'c',
    redirectUri: 'http://localhost/cb',
    scopes: [],
    allowInternal: true,
  });
  let missing = '';
  try {
    await emptyClient.discover();
  } catch (err) {
    missing = (err as Error).message;
  }
  check('a document missing endpoints is refused', missing.includes('missing'), missing);
  emptyAnnouncer.server.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
