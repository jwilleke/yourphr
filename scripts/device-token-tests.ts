/**
 * Companion device tokens over the WIRE — the write an agent token cannot make.
 *
 *   npm run device-tokens
 *
 * DeviceTokensManager's unit tests prove mint/hash/revoke. This harness proves the HTTP edge:
 * a device token authenticates as the owner and may POST HealthKit samples; an agent token
 * presenting the same route is refused by the default-deny write gate. POST /api/auth/companion-session
 * trades that device token for the HttpOnly session cookie the WebView uses, and the token itself
 * stays out of the JSON body.
 *
 * scripts/ is the exempt place for loopback drivers (`check:boundary` refuses fetch under src/).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { openStores, type Stores } from '../src/app.js';
import { createYourPhrServer } from '../src/server.js';

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const PASSWORD = 'a-long-enough-password';

interface Harness {
  base: string;
  stores: Stores;
  server: Server;
  close: () => Promise<void>;
}

async function boot(): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'yourphr-device-tokens-'));
  const stores = await openStores(dir, {
    YOURPHR_AUTH_AGENT_TOKEN_ENABLED: 'true',
    YOURPHR_AUTH_SIGNUP_ENABLED: 'true',
  });
  const server = createYourPhrServer({ engine: stores.engine, auth: {} }) as Server;
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    base, stores, server,
    close: async () => {
      await new Promise<void>((done) => server.close(() => done()));
      await stores.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function signIn(base: string): Promise<string> {
  await fetch(`${base}/api/auth/signup`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'jim', password: PASSWORD }),
  });
  const res = await fetch(`${base}/api/auth/signin`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'jim', password: PASSWORD }),
  });
  return ((await res.json()) as { data?: string }).data ?? '';
}

async function mintDevice(base: string, session: string): Promise<string> {
  const res = await fetch(`${base}/api/secure/access/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${session}` },
    body: JSON.stringify({ name: 'iPhone', expiration: 0 }),
  });
  return ((await res.json()) as { data?: string }).data ?? '';
}

async function mintAgent(base: string, session: string): Promise<string> {
  const res = await fetch(`${base}/api/secure/account/agent-tokens`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${session}` },
    body: JSON.stringify({ name: 'Claude Desktop', scopes: ['Health'] }),
  });
  return ((await res.json()) as { data?: { token?: string } }).data?.token ?? '';
}

const emptyIngest = {
  device: { device_id: 'iphone-1', name: 'iPhone' },
  samples: [] as unknown[],
  anchors: {},
};

async function main(): Promise<void> {
  const h = await boot();
  const asBearer = (token: string, path: string, method = 'GET', body?: unknown): Promise<Response> =>
    fetch(h.base + path, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  try {
    const session = await signIn(h.base);
    check('a patient can mint a companion token', session !== '');
    const device = await mintDevice(h.base, session);
    check('the mint returns a cleartext token, once', device.startsWith('yphr_dt_'), device.slice(0, 12));

    const listed = await asBearer(session, '/api/secure/access/token');
    const listBody = (await listed.json()) as { data?: { token_id: string; name: string; status: string }[] };
    check('GET lists the token in the Go envelope',
      listed.status === 200 && listBody.data?.[0]?.name === 'iPhone' && listBody.data?.[0]?.status === 'active');

    const discovery = await asBearer(session, '/api/secure/sync/discovery');
    const disc = (await discovery.json()) as { data?: { server_base_urls?: string[]; sync_endpoint?: string } };
    check('discovery names at least one base URL and the FHIR sync endpoint',
      discovery.status === 200
      && (disc.data?.server_base_urls?.length ?? 0) > 0
      && disc.data?.sync_endpoint === 'api/secure/resource/fhir');

    const me = await asBearer(device, '/api/secure/account/me');
    check('the companion reads /account/me as the owner (the iPhone probe)',
      me.status === 200 && ((await me.json()) as { data?: { username?: string } }).data?.username === 'jim');

    const ingest = await asBearer(device, '/api/secure/health/samples', 'POST', emptyIngest);
    const ingestBody = (await ingest.json()) as { data?: { received?: number } };
    check('the companion MAY POST health samples',
      ingest.status === 200 && ingestBody.data?.received === 0, `status=${ingest.status}`);

    const agent = await mintAgent(h.base, session);
    check('an agent token can be minted for the contrast', agent.startsWith('yphr_at_'));
    const agentWrite = await asBearer(agent, '/api/secure/health/samples', 'POST', emptyIngest);
    check('TOOTH: an agent token CANNOT POST the same write — default deny',
      agentWrite.status === 403, `status=${agentWrite.status}`);

    const agentMint = await asBearer(agent, '/api/secure/access/token', 'POST', { name: 'stolen' });
    check('TOOTH: an agent cannot mint a companion token', agentMint.status === 403);

    const viaCookie = await fetch(`${h.base}/api/secure/account/me`, {
      headers: { cookie: `yourphr_session=${device}` },
    });
    check('TOOTH: a companion token is never accepted from a COOKIE', viaCookie.status === 401);

    const deviceList = await asBearer(device, '/api/secure/access/token');
    check('TOOTH: the device token itself cannot list device tokens', deviceList.status === 403, `status=${deviceList.status}`);

    const exchanged = await fetch(`${h.base}/api/auth/companion-session`, {
      method: 'POST',
      headers: { authorization: `Bearer ${device}` },
    });
    const exchangeBody = await exchanged.text();
    const setCookie = exchanged.headers.getSetCookie?.().join('; ') || exchanged.headers.get('set-cookie') || '';
    const sessionToken = setCookie.match(/yourphr_session=([^;]+)/)?.[1] ?? '';
    check('exchange sets an HttpOnly session cookie',
      exchanged.status === 200 && /HttpOnly/i.test(setCookie) && sessionToken !== '', `status=${exchanged.status}`);
    check('exchange body is success only — the session JWT is not in the JSON',
      exchangeBody.includes('"success":true') && !exchangeBody.includes(sessionToken) && !/"data"\s*:/.test(exchangeBody));

    const asHuman = await fetch(`${h.base}/api/secure/access/token`, {
      headers: { cookie: `yourphr_session=${sessionToken}` },
    });
    const humanList = (await asHuman.json()) as { data?: { name?: string }[] };
    check('the exchanged cookie is a human session and can list device tokens',
      asHuman.status === 200 && humanList.data?.[0]?.name === 'iPhone', `status=${asHuman.status}`);

    const noBearer = await fetch(`${h.base}/api/auth/companion-session`, { method: 'POST' });
    check('exchange without a bearer device token is refused', noBearer.status === 401);

    const deviceAsCookie = await fetch(`${h.base}/api/auth/companion-session`, {
      method: 'POST',
      headers: { cookie: `yourphr_session=${device}` },
    });
    check('TOOTH: a device token presented as a cookie cannot mint a session', deviceAsCookie.status === 401);

    const agentExchange = await fetch(`${h.base}/api/auth/companion-session`, {
      method: 'POST',
      headers: { authorization: `Bearer ${agent}` },
    });
    check('TOOTH: an agent token cannot mint a session', agentExchange.status === 401, `status=${agentExchange.status}`);

    const sessionExchange = await fetch(`${h.base}/api/auth/companion-session`, {
      method: 'POST',
      headers: { authorization: `Bearer ${session}` },
    });
    check('a browser session token cannot be exchanged again', sessionExchange.status === 401);

    const tokenId = listBody.data?.[0]?.token_id ?? '';
    await asBearer(session, '/api/secure/access/token', 'DELETE', { token_id: tokenId });
    check('a revoked companion token stops working on the next request',
      (await asBearer(device, '/api/secure/account/me')).status === 401);
    const revokedExchange = await fetch(`${h.base}/api/auth/companion-session`, {
      method: 'POST',
      headers: { authorization: `Bearer ${device}` },
    });
    check('a revoked device token cannot mint a session', revokedExchange.status === 401);
  } finally {
    await h.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error(`device-token harness failed: ${(err as Error).stack ?? (err as Error).message}`);
  process.exit(1);
});
