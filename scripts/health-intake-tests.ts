/**
 * Wearable sample intake over the WIRE (yourphr#314).
 *
 *   npm run health-intake
 *
 * HealthManager's unit tests (src/app/managers/__tests__/HealthIntakeGuards.test.ts) prove what the
 * manager refuses when called directly. This harness proves what only real requests can:
 *
 * - a refused upload writes nothing: bad `anchors` or `device` is a 400 with no raw row, no
 *   Observation, no "Uploaded by you" source and no sync state behind it;
 * - DELETE /api/secure/account/me removes the account's samples from phd-samples.db even while
 *   yourphr.health.enabled is off, and leaves other accounts' samples alone;
 * - yourphr.health.device-intake.enabled is its own switch, off by default: a device key's upload
 *   is 403 and is not logged as an upload, while a signed-in session still uploads.
 *
 * A harness rather than a vitest file for the reason scripts/agent-token-tests.ts gives:
 * `check:boundary` refuses `fetch` under src/. Synthetic values only.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { openStores, type Stores } from '../src/app.js';
import { ApiContext } from '../src/framework/ApiContext.js';
import { createYourPhrServer } from '../src/server.js';

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const PASSWORD = 'a-long-enough-password';
type Env = Record<string, string>;
interface Harness { base: string; stores: Stores; close: () => Promise<void> }

async function boot(dir: string, env: Env): Promise<Harness> {
  const stores = await openStores(dir, { YOURPHR_AUTH_SIGNUP_ENABLED: 'true', YOURPHR_AUTH_AGENT_TOKEN_ENABLED: 'true', ...env });
  const server = createYourPhrServer({ engine: stores.engine, auth: {} }) as Server;
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    base, stores,
    close: async () => {
      await new Promise<void>((done) => server.close(() => done()));
      await stores.close();
    },
  };
}

async function signIn(base: string, username = 'jim'): Promise<string> {
  const body = JSON.stringify({ username, password: PASSWORD });
  await fetch(`${base}/api/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  const res = await fetch(`${base}/api/auth/signin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  return ((await res.json()) as { data?: string }).data ?? '';
}

function call(base: string, token: string, path: string, method = 'GET', body?: unknown): Promise<Response> {
  return fetch(base + path, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function deviceKey(base: string, session: string): Promise<string> {
  const granted = await call(base, session, '/api/secure/account/devices', 'POST', { label: 'Test phone', password: PASSWORD });
  const code = ((await granted.json()) as { data?: { setup_code?: string } }).data?.setup_code ?? '';
  const claim = await fetch(`${base}/api/device/claim`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
  return ((await claim.json()) as { data?: { access_token?: string } }).data?.access_token ?? '';
}

async function mintAgent(base: string, session: string): Promise<string> {
  const res = await call(base, session, '/api/secure/account/agent-tokens', 'POST', { name: 'Agent', scopes: ['Medications'] });
  return ((await res.json()) as { data?: { token?: string } }).data?.token ?? '';
}

const step = (uuid: string, value = 100, start = '2026-08-24T12:00:00Z') => ({
  uuid, type: 'HKQuantityTypeIdentifierStepCount', start, end: start, value, unit: 'count', source_name: 'Phone',
});

async function footprint(s: Stores, username = 'jim'): Promise<string> {
  const who = ApiContext.system('test', username, s.engine);
  const health = s.engine.managers.health;
  const samples = (await health.list(who, {})).total;
  const observations = (await s.records.list(who, 'Observation')).length;
  const uploadSources = (await s.sources.list(who)).filter((source) => source.display === 'Uploaded by you').length;
  const syncStates = (await health.syncState(who)).length;
  return `samples=${samples} observations=${observations} uploadSources=${uploadSources} syncStates=${syncStates}`;
}
const NOTHING = 'samples=0 observations=0 uploadSources=0 syncStates=0';

async function refusedWritesNothing(): Promise<void> {
  console.log('\n-- a refused upload writes nothing (anchors used to be checked after the write)');
  const bad: [string, Record<string, unknown>][] = [
    ['an anchor over 1024 characters', { anchors: { step_count: 'a'.repeat(1025) } }],
    ['more than 32 anchors', { anchors: Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`m${i}`, 'a'])) }],
    ['an anchor that is not a string', { anchors: { step_count: 42 } }],
    ['anchors that are not an object', { anchors: ['step_count', 'a'] }],
    ['an anchor metric over 64 characters', { anchors: { ['m'.repeat(65)]: 'a' } }],
    ['a device that is not an object', { device: 'phone' }],
    ['a device name over 200 characters', { device: { device_id: 'p', name: 'n'.repeat(201) } }],
    ['a device id that is not a string', { device: { device_id: 7 } }],
  ];
  const dir = mkdtempSync(join(tmpdir(), 'yourphr-health-intake-'));
  const h = await boot(dir, { YOURPHR_HEALTH_ENABLED: 'true' });
  try {
    const session = await signIn(h.base);
    for (const [label, extra] of bad) {
      const res = await call(h.base, session, '/api/secure/health/samples', 'POST', { samples: [step('s1'), step('s2', 50)], ...extra });
      check(`TOOTH: ${label} is a 400`, res.status === 400, String(res.status));
      const left = await footprint(h.stores);
      check(`  ...and leaves nothing behind`, left === NOTHING, left);
    }
    const ok = await call(h.base, session, '/api/secure/health/samples', 'POST', { samples: [step('s1'), step('s2', 50)], anchors: { step_count: 'anchor-1' }, device: null });
    check('the same batch with good input is stored', ok.status === 200, String(ok.status));
    const stored = await footprint(h.stores);
    check('  ...as two samples, one daily Observation, one upload source and one sync state', stored === 'samples=2 observations=1 uploadSources=1 syncStates=1', stored);
  } finally {
    await h.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

async function deletionReachesSamples(): Promise<void> {
  console.log('\n-- account deletion reaches phd-samples.db whatever the health flag (it used to be skipped while off)');
  const dir = mkdtempSync(join(tmpdir(), 'yourphr-health-delete-'));
  try {
    const on = await boot(dir, { YOURPHR_HEALTH_ENABLED: 'true' });
    const samplesFile = on.stores.engine.managers.configuration.getString('yourphr.phd-samples.location');
    try {
      for (const who of ['jim', 'molly']) {
        const session = await signIn(on.base, who);
        await call(on.base, session, '/api/secure/health/samples', 'POST', { samples: [step(`${who}-1`), step(`${who}-2`, 70)], anchors: { step_count: 'a' } });
      }
      check('two accounts uploaded with health on', (await footprint(on.stores, 'jim')).startsWith('samples=2') && (await footprint(on.stores, 'molly')).startsWith('samples=2'));
    } finally {
      await on.close();
    }

    const off = await boot(dir, {});
    try {
      const health = off.stores.engine.has('health') ? off.stores.engine.managers.health : undefined;
      check('health off with a samples file: the manager exists only to delete', health?.enabled === false);
      const session = await signIn(off.base, 'jim');
      check('TOOTH: with health off the sample routes are absent (404)', (await call(off.base, session, '/api/secure/health/samples')).status === 404
        && (await call(off.base, session, '/api/secure/health/samples', 'POST', { samples: [step('late')] })).status === 404);
      const deleted = await call(off.base, session, '/api/secure/account/me', 'DELETE');
      check('jim deletes his account with health off', deleted.status === 200, String(deleted.status));
    } finally {
      await off.close();
    }

    const after = await boot(dir, { YOURPHR_HEALTH_ENABLED: 'true' });
    try {
      const jim = await footprint(after.stores, 'jim');
      check('TOOTH: jim\'s samples and sync state are gone from phd-samples.db', jim.startsWith('samples=0') && jim.endsWith('syncStates=0'), jim);
      const molly = await footprint(after.stores, 'molly');
      check('molly\'s are untouched', molly.startsWith('samples=2') && molly.endsWith('syncStates=1'), molly);
    } finally {
      await after.close();
    }

    const fresh = mkdtempSync(join(tmpdir(), 'yourphr-health-none-'));
    const none = await boot(fresh, {});
    try {
      check('health off and no samples file: no manager', !none.stores.engine.has('health'));
      const session = await signIn(none.base, 'jim');
      check('account deletion still works', (await call(none.base, session, '/api/secure/account/me', 'DELETE')).status === 200);
      check('and no samples file was created', !existsSync(none.stores.engine.managers.configuration.getString('yourphr.phd-samples.location')));
    } finally {
      await none.close();
      rmSync(fresh, { recursive: true, force: true });
    }
    check('(the first instance did create its samples file)', existsSync(samplesFile));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function deviceIntakeSwitch(): Promise<void> {
  console.log('\n-- device uploads are their own switch, off by default');
  for (const intake of [false, true]) {
    const dir = mkdtempSync(join(tmpdir(), 'yourphr-health-device-'));
    const env: Env = { YOURPHR_HEALTH_ENABLED: 'true', YOURPHR_DEVICES_ENABLED: 'true', ...(intake ? { YOURPHR_HEALTH_DEVICE_INTAKE_ENABLED: 'true' } : {}) };
    const h = await boot(dir, env);
    const label = intake ? 'intake ON' : 'intake OFF (default)';
    try {
      const session = await signIn(h.base);
      const key = await deviceKey(h.base, session);
      const res = await call(h.base, key, '/api/secure/health/samples', 'POST', { samples: [step('d1')] });
      const log = JSON.stringify(await (await call(h.base, session, '/api/secure/account/access-log')).json());
      if (intake) {
        check(`${label}: a device key uploads`, res.status === 200, String(res.status));
        check(`${label}: the upload is logged under the device`, log.includes('Health samples (add)'));
        check(`${label}: into the grant's own source, not the session's`, (await footprint(h.stores)) === 'samples=1 observations=1 uploadSources=0 syncStates=0', await footprint(h.stores));
      } else {
        check(`TOOTH: ${label}: a device key's upload is 403`, res.status === 403, String(res.status));
        check(`TOOTH: ${label}: and is not logged as an upload`, !log.includes('Health samples (add)'));
        check(`${label}: nothing stored`, (await footprint(h.stores)) === NOTHING, await footprint(h.stores));
        const mine = await call(h.base, session, '/api/secure/health/samples', 'POST', { samples: [step('s1')] });
        check(`${label}: a signed-in session still uploads`, mine.status === 200, String(mine.status));
      }
      const agent = await mintAgent(h.base, session);
      check(`TOOTH: ${label}: an ordinary agent token never uploads`, (await call(h.base, agent, '/api/secure/health/samples', 'POST', { samples: [step('a1')] })).status === 403);
    } finally {
      await h.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

async function main(): Promise<void> {
  await refusedWritesNothing();
  await deletionReachesSamples();
  await deviceIntakeSwitch();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
}

main().catch((err) => { console.error(`health-intake harness failed: ${(err as Error).stack ?? (err as Error).message}`); process.exit(1); });
