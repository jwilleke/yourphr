/**
 * The agent-token gate, over the WIRE (yourphr#695).
 *
 *   npm run agent-tokens
 *
 * AgentTokensManager's unit tests prove what it refuses when called directly. This harness proves
 * the thing a manager cannot: that an agent presenting a token at the HTTP edge reaches exactly the
 * reads it was given and nothing else — including that it cannot reach the routes that would let it
 * mint, renew or revoke itself a longer life.
 *
 * A harness rather than a vitest file because the gate can only be tested by making real requests,
 * and `check:boundary` refuses `fetch` under src/ — deliberately, since Node's fetch is undici and
 * ignores the guarded DNS lookup that is the SSRF control. scripts/ is the exempt place for
 * loopback drivers, and that exemption is why this lives here.
 *
 * The teeth are the DEFAULT DENY cases. A default nobody has tried to walk past is not known to
 * hold, so each one below is an attempt to walk past it.
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

/** A real instance with agent tokens switched on the way an operator would switch them on. */
async function boot(): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'yourphr-agent-tokens-'));
  const stores = await openStores(dir, {
    YOURPHR_AUTH_AGENT_TOKEN_ENABLED: 'true',
    YOURPHR_AUTH_SIGNUP_ENABLED: 'true',
    YOURPHR_DEVICES_ENABLED: 'true',
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
  // The sign-in envelope carries the token as `data` itself, not `data.token`.
  return ((await res.json()) as { data?: string }).data ?? '';
}

async function mint(base: string, session: string, scopes: string[]): Promise<string> {
  const res = await fetch(`${base}/api/secure/account/agent-tokens`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${session}` },
    body: JSON.stringify({ name: 'Claude Desktop', scopes }),
  });
  return ((await res.json()) as { data?: { token?: string } }).data?.token ?? '';
}

async function main(): Promise<void> {
  const h = await boot();
  const asAgent = (token: string, path: string, method = 'GET'): Promise<Response> =>
    fetch(h.base + path, { method, headers: { authorization: `Bearer ${token}` } });

  try {
    const session = await signIn(h.base);
    check('a patient can mint a token for an agent', session !== '');
    const agent = await mint(h.base, session, ['Medications']);
    check('the mint returns a cleartext token, once', agent.startsWith('yphr_at_'), agent.slice(0, 12));

    check('the agent reads a category it WAS given',
      (await asAgent(agent, '/api/secure/medications/reconciled')).status === 200);

    const wrong = await asAgent(agent, '/api/secure/conditions/reconciled');
    check('TOOTH: refused a category it was NOT given', wrong.status === 403,
      ((await wrong.json()) as { error: string }).error);

    // The deliberate half of default-deny. yourphr#614: an unaudited disclosure did not happen, so
    // an agent may not reach a surface that has no category to log.
    for (const path of ['/api/secure/sources', '/api/secure/account/access-log', '/api/secure/jobs']) {
      check(`TOOTH: refused the unlisted read ${path} — the log could not record it`,
        (await asAgent(agent, path)).status === 403);
    }

    // The routes that would let a token extend its own life. Two independent locks: this edge gate,
    // and AgentTokensManager.requireHuman behind it — removing either leaves the other standing.
    check('TOOTH: cannot list its owner\'s tokens',
      (await asAgent(agent, '/api/secure/account/agent-tokens')).status === 403);
    check('TOOTH: cannot mint another token',
      (await asAgent(agent, '/api/secure/account/agent-tokens', 'POST')).status === 403);
    check('TOOTH: cannot renew itself',
      (await asAgent(agent, '/api/secure/account/agent-tokens/tok_x/renew', 'POST')).status === 403);
    check('TOOTH: cannot revoke anything',
      (await asAgent(agent, '/api/secure/account/agent-tokens/tok_x/revoke', 'POST')).status === 403);

    // What makes the first cut read-only STRUCTURALLY: a write route added next year is refused by
    // inheritance, not by somebody remembering to guard it.
    for (const method of ['POST', 'PUT', 'DELETE']) {
      check(`TOOTH: every ${method} is refused — no write has a category to be scoped by`,
        (await asAgent(agent, '/api/secure/medications/reconciled', method)).status === 403);
    }

    // An agent credential must not be usable by a browser page.
    const viaCookie = await fetch(`${h.base}/api/secure/medications/reconciled`, {
      headers: { cookie: `yourphr_session=${agent}` },
    });
    check('TOOTH: never accepted from a COOKIE, only a Bearer header', viaCookie.status === 401);

    // yourphr#657 assumed this already worked: "Claude Desktop read your medications", not "you did".
    const log = (await (await fetch(`${h.base}/api/secure/account/access-log`, {
      headers: { authorization: `Bearer ${session}` },
    })).json()) as { data: { actor_username: string; category: string }[] };
    check('the agent\'s read is logged under the AGENT\'s name',
      log.data.some((e) => e.actor_username === 'Claude Desktop' && e.category === 'Medications'));
    check('and is NOT attributed to the patient, who was not at the keyboard',
      !log.data.some((e) => e.actor_username === 'jim' && e.category === 'Medications'));

    // Revocation is the property the whole design rests on — an opaque token can be withdrawn
    // before it expires, which is why this is not a JWT.
    const listed = (await (await fetch(`${h.base}/api/secure/account/agent-tokens`, {
      headers: { authorization: `Bearer ${session}` },
    })).json()) as { data: { tokens: { id: string; name: string }[] } };
    await fetch(`${h.base}/api/secure/account/agent-tokens/${listed.data.tokens[0]?.id}/revoke`, {
      method: 'POST', headers: { authorization: `Bearer ${session}` },
    });
    check('a revoked token stops working on the very next request',
      (await asAgent(agent, '/api/secure/medications/reconciled')).status === 401);

    // --- connected devices (yourphr#807, #808): the one WRITE an agent credential can ever make ---
    const json = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${session}` }, body: JSON.stringify(body) });
    const wrongPw = await fetch(`${h.base}/api/secure/account/devices`, json({ label: "Jim's iPhone", password: 'not-it' }));
    check('TOOTH: granting a device needs the patient to confirm it is them', wrongPw.status === 401);
    const granted = (await (await fetch(`${h.base}/api/secure/account/devices`, json({ label: "Jim's iPhone", password: PASSWORD }))).json()) as { data?: { setup_code?: string; grant?: { id: string } } };
    const setupCode = granted.data?.setup_code ?? '';
    check('a granted device gets a one-time setup code', setupCode.startsWith('yphr_setup_'));
    const claim = await fetch(`${h.base}/api/device/claim`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: setupCode }) });
    const keys = ((await claim.json()) as { data?: { access_token?: string; refresh_token?: string } }).data ?? {};
    check('the device claims its keys with the code, no session', claim.status === 200 && !!keys.access_token && !!keys.refresh_token);
    const again = await fetch(`${h.base}/api/device/claim`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: setupCode }) });
    check('TOOTH: a setup code works once', again.status === 401);

    const deviceKey = keys.access_token ?? '';
    check('the device key passes the gate for its one write (no route yet: 404, not 403)',
      (await asAgent(deviceKey, '/api/secure/health/samples', 'POST')).status === 404);
    check('and for its sync-state read', (await asAgent(deviceKey, '/api/secure/health/sync-state')).status === 404);
    check('TOOTH: a device key reads nothing of the record',
      (await asAgent(deviceKey, '/api/secure/medications/reconciled')).status === 403);
    check('TOOTH: a device key cannot manage devices', (await asAgent(deviceKey, '/api/secure/account/devices')).status === 403);
    const reader = await mint(h.base, session, ['Medications']);
    const readerWrite = await asAgent(reader, '/api/secure/health/samples', 'POST');
    check('TOOTH: an ordinary agent token can never write', readerWrite.status === 403,
      ((await readerWrite.json()) as { error: string }).error);
    const events = JSON.stringify(await (await fetch(`${h.base}/api/secure/account/access-log`, { headers: { authorization: `Bearer ${session}` } })).json());
    check('the device\'s write is in the access log under its own name', events.includes('Health samples (add)') && events.includes("Jim's iPhone"));

    const refreshed = await fetch(`${h.base}/api/device/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: keys.refresh_token }) });
    check('the device refreshes its keys', refreshed.status === 200);
    const reused = await fetch(`${h.base}/api/device/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: keys.refresh_token }) });
    check('TOOTH: a spent refresh token is refused, and ends the grant', reused.status === 401);
    const listedDevices = (await (await fetch(`${h.base}/api/secure/account/devices`, { headers: { authorization: `Bearer ${session}` } })).json()) as { data?: { grants?: { status: string }[] } };
    check('the patient sees it revoked', listedDevices.data?.grants?.[0]?.status === 'revoked');
  } finally {
    await h.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
}

main().catch((err) => { console.error(`agent-token harness failed: ${(err as Error).stack ?? (err as Error).message}`); process.exit(1); });
