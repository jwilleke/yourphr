/**
 * The last gate on yourphr#539: one sandbox connected, end to end, from the TypeScript stack.
 *
 * Everything before this proved the pieces — discovery, PKCE, exchange, refresh — against a fake
 * authorization server on loopback. This runs the same client against a REAL one: the SMART Health
 * IT launcher, the same seeded sandbox the Go stack lists ("SMART Health IT (Sandbox)",
 * client_id `my-client-id`, no registration — see yourphr
 * backend/pkg/models/provider_catalog_entry.go SandboxProviderSeeds).
 *
 * The flow needs a human (or a driven browser) once: the script prints the authorization URL,
 * waits on a loopback callback server, and a browser completes the patient-standalone launch.
 * Everything after the redirect is the code under test — state check, code exchange, an
 * authorized fetch, a resync, a real token refresh, and a fetch on the refreshed token.
 *
 * The SSRF guard stays ON for every outbound request. The callback server is inbound and local;
 * the guard has no opinion about it, correctly.
 *
 * Public synthetic data only — no PHI, nothing writes to phi/.
 *
 *   npm run live:smart            # then open the printed URL and pick a patient
 *   npm run live:smart -- --port 8765
 */
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SmartClient, generateVerifier, statesMatch, type Endpoints, type TokenResponse } from '../src/sources/index.js';
import { OutboundHttp } from '../src/http/index.js';
import { SqliteFhirRepository } from '../src/SqliteFhirRepository.js';
import { SqliteRecordsProvider } from '../src/app/providers/SqliteRecordsProvider.js';
import { syncFrom } from '../src/sources/index.js';

// The same open sandbox the Go stack seeds: launch_type patient-standalone, any client_id accepted.
const BASE = argValue('--base') ?? 'https://launch.smarthealthit.org/v/r4/sim/eyJsYXVuY2hfdHlwZSI6InBhdGllbnQtc3RhbmRhbG9uZSJ9/fhir';
const PORT = Number(argValue('--port') ?? '8765');
const CALLBACK_TIMEOUT_MS = 10 * 60 * 1000;

function argValue(flag: string): string | undefined {
  const at = process.argv.indexOf(flag);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

/** One authorization redirect, delivered to a loopback listener. Resolves with code + state. */
function awaitCallback(port: number): { url: Promise<{ code: string; state: string }>; close: () => void } {
  let resolve!: (value: { code: string; state: string }) => void;
  let reject!: (reason: Error) => void;
  const done = new Promise<{ code: string; state: string }>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
    if (url.pathname !== '/callback') {
      response.writeHead(404).end();
      return;
    }
    const error = url.searchParams.get('error');
    if (error) {
      response.writeHead(200, { 'content-type': 'text/plain' }).end(`authorization refused: ${error}`);
      reject(new Error(`authorization refused: ${error} — ${url.searchParams.get('error_description') ?? ''}`));
      return;
    }
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || !state) {
      // A stray probe or a favicon fetch must not abort a wait that a real redirect would satisfy.
      response.writeHead(400, { 'content-type': 'text/plain' }).end('missing code or state');
      return;
    }
    response
      .writeHead(200, { 'content-type': 'text/plain' })
      .end('Connected. This window can be closed; the script carries on.');
    resolve({ code, state });
  });
  server.listen(port, '127.0.0.1');

  const timer = setTimeout(() => reject(new Error(`no redirect arrived within ${CALLBACK_TIMEOUT_MS / 60000} minutes`)), CALLBACK_TIMEOUT_MS);
  return {
    url: done.finally(() => clearTimeout(timer)),
    close: () => server.close(),
  };
}

async function authorizedGet(http: OutboundHttp, url: string, token: string): Promise<number> {
  const response = await http.get(url, { headers: { authorization: `Bearer ${token}` } });
  return response.status;
}

async function main(): Promise<void> {
  const client = new SmartClient({
    fhirBaseUrl: BASE,
    clientId: 'my-client-id',
    redirectUri: `http://127.0.0.1:${PORT}/callback`,
    scopes: ['launch/patient', 'patient/*.read', 'openid', 'fhirUser', 'offline_access'],
  });

  // Discovery, through the guarded capability, guard ON.
  let endpoints: Endpoints;
  try {
    endpoints = await client.discover();
  } catch (err) {
    throw new Error(`discovery failed: ${(err as Error).message}`);
  }
  check(
    'discovery through the SSRF guard, both endpoints https',
    endpoints.authorization.startsWith('https://') && endpoints.token.startsWith('https://'),
    endpoints.token
  );

  const state = randomBytes(16).toString('base64url');
  const verifier = generateVerifier();
  const listener = awaitCallback(PORT);

  console.log('\nOpen this URL in a browser and complete the patient-standalone launch:\n');
  console.log(`AUTHORIZE_URL: ${client.authorizeUrl(endpoints, state, verifier)}\n`);

  let callback: { code: string; state: string };
  try {
    callback = await listener.url;
  } finally {
    listener.close();
  }

  check('redirect state matches, compared timing-safe', statesMatch(state, callback.state));
  if (!statesMatch(state, callback.state)) {
    throw new Error('state mismatch — refusing the code');
  }

  // The exchange that has only ever met a fake.
  let token: TokenResponse;
  try {
    token = await client.exchangeCode(endpoints, callback.code, verifier);
  } catch (err) {
    throw new Error(`code exchange failed: ${(err as Error).message}`);
  }
  check('authorization code exchanged at the real token endpoint', token.accessToken.length > 0, `token_type ${token.tokenType}`);
  check('token arrives scoped to a patient', typeof token.patient === 'string' && token.patient.length > 0, token.patient ?? 'no patient context');
  check('a refresh token was issued (offline_access honoured)', typeof token.refreshToken === 'string' && token.refreshToken.length > 0);

  const patient = token.patient as string;
  const http = new OutboundHttp({});

  const readStatus = await authorizedGet(http, `${BASE}/Patient/${patient}`, token.accessToken);
  check('authorized read of the launch patient succeeds', readStatus === 200, `HTTP ${readStatus}`);

  // Fetch and store, holding the real token, guard still ON.
  const dir = mkdtempSync(join(tmpdir(), 'spike-live-smart-'));
  const repo = new SqliteFhirRepository({ file: join(dir, 'live.db'), userId: 'live-user' });
  const records = SqliteRecordsProvider.overRepository(repo);
  const writerFor = (sourceId = '') => records.writer(repo.userId ?? '', sourceId);
  try {
    const first = await syncFrom(`${BASE}/Condition?patient=${patient}&_count=50`, {
      writer: writerFor('smarthealthit-authorized'),
      accessToken: token.accessToken,
    });
    check('an authorized sync fetches and stores records', first.received > 0 && first.created > 0, `${first.received} received, ${first.created} created`);

    const observations = await syncFrom(`${BASE}/Observation?patient=${patient}&_count=50`, {
      writer: writerFor('smarthealthit-authorized'),
      accessToken: token.accessToken,
      maxPages: 20,
    });
    check('a second resource type syncs on the same token', observations.received > 0, `${observations.received} Observations received`);

    // A real refresh — gate 2 has only ever been cleared against a fake authorization server.
    let refreshed: TokenResponse;
    try {
      refreshed = await client.refresh(endpoints, token.refreshToken as string);
    } catch (err) {
      throw new Error(`refresh failed: ${(err as Error).message}`);
    }
    check('the refresh grant returns a fresh access token', refreshed.accessToken.length > 0);
    check('the refreshed token is not the old token', refreshed.accessToken !== token.accessToken);

    // Resync on the REFRESHED token: idempotence and the refreshed credential proven in one pass.
    const again = await syncFrom(`${BASE}/Condition?patient=${patient}&_count=50`, {
      writer: writerFor('smarthealthit-authorized'),
      accessToken: refreshed.accessToken,
    });
    const held = await repo.search({ resourceType: 'Condition', count: 500, total: 'accurate' });
    check('a resync on the refreshed token creates nothing new', again.created === 0, `${again.created} created, ${held.total} held`);
    check('no cross-source collisions', again.collisions.length === 0);
  } finally {
    repo.db.close();
    rmSync(dir, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error(`\nlive SMART launch failed: ${(err as Error).message}`);
  console.error('This talks to a third-party sandbox through a browser, so a failure here may not be a defect.');
  process.exit(1);
});
