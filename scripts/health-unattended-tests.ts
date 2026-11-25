/**
 * Proof for yourphr#991, over the WIRE: a connected device uploads while the patient is signed
 * out, under the server's database key, and nothing about that is weaker than a signed-in upload.
 *
 *   npm run health-unattended
 *
 * - Signed out: after a restart, with no session anywhere, the device's key alone uploads, and
 *   the patient sees the readings when they next sign in. No patient key is involved.
 * - Revoked: a revoked device's upload is refused and stores nothing; so is one after the
 *   patient's sign-out-everywhere.
 * - Cross-patient: a device writes only into the account that granted it, whatever the upload
 *   names, and cannot read.
 * - Restore: a backup carries the readings and their daily Observations, a restore brings them
 *   back, and the device's re-sent queue does not double anything.
 * - No unlocked copies: a per-run marker carried by the upload never appears in clear in any file
 *   under the data folder (databases, WAL and journal files, side files, backups), running or
 *   stopped, nor in any log line. Checked to fail when phd-samples.db is opened without the key.
 *
 * A harness rather than a vitest file because `check:boundary` refuses `fetch` under src/.
 * Synthetic values only; the password is generated per run.
 */
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStores, type Stores } from '../src/app.js';
import { ApiContext } from '../src/framework/ApiContext.js';
import { createYourPhrServer } from '../src/server.js';

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  results.push({ name, ok, detail });
  out(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

// Everything the instance logs is captured, so the marker can be looked for in it; the harness's
// own report goes through `out`, which bypasses the capture.
const realLog = console.log.bind(console);
const out = (line: string): void => { realLog(line); };
const logged: string[] = [];
for (const method of ['log', 'info', 'warn', 'error'] as const) {
  console[method] = (...args: unknown[]) => { logged.push(args.map(String).join(' ')); };
}

const PASSWORD = randomBytes(18).toString('base64url');
const ENV = {
  YOURPHR_DATABASE_ENCRYPTION_KEY: 'unit-key',
  YOURPHR_BACKUP_ENCRYPTION_KEY: 'unit-backup-key',
  YOURPHR_AUTH_SIGNUP_ENABLED: 'true',
  YOURPHR_DEVICES_ENABLED: 'true',
  YOURPHR_HEALTH_ENABLED: 'true',
  YOURPHR_HEALTH_DEVICE_INTAKE_ENABLED: 'true',
};

interface Instance { base: string; stores: Stores; close: () => Promise<void> }

async function start(dir: string, options: { startup?: boolean } = {}): Promise<Instance> {
  const stores = await openStores(dir, ENV, options);
  const server = createYourPhrServer({ engine: stores.engine, auth: {} }) as Server;
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  let closed = false;
  return {
    base: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    stores,
    close: async () => {
      if (closed) return;
      closed = true;
      await new Promise<void>((done) => server.close(() => done()));
      await stores.close();
    },
  };
}

async function withDir(label: string, fn: (dir: string, started: Instance[]) => Promise<void>): Promise<void> {
  out(`\n-- ${label}`);
  const dir = mkdtempSync(join(tmpdir(), 'yourphr-health-unattended-'));
  const started: Instance[] = [];
  try {
    await fn(dir, started);
  } catch (err) {
    check(`${label}: ran to the end`, false, (err as Error).message);
  } finally {
    for (const inst of started) await inst.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function call(base: string, token: string, path: string, method = 'GET', body?: unknown): Promise<Response> {
  return fetch(base + path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function signIn(base: string, username: string): Promise<string> {
  const body = { username, password: PASSWORD };
  await call(base, '', '/api/auth/signup', 'POST', body);
  return (((await (await call(base, '', '/api/auth/signin', 'POST', body)).json()) as { data?: string }).data) ?? '';
}

/** The patient connects a device; the phone claims it. Returns the phone's access token and the grant's id. */
async function connect(base: string, session: string, label: string): Promise<{ key: string; grant: string }> {
  const granted = await call(base, session, '/api/secure/account/devices', 'POST', { label, password: PASSWORD });
  const code = ((await granted.json()) as { data?: { setup_code?: string } }).data?.setup_code ?? '';
  const claim = await call(base, '', '/api/device/claim', 'POST', { code });
  const key = ((await claim.json()) as { data?: { access_token?: string } }).data?.access_token ?? '';
  const list = (await (await call(base, session, '/api/secure/account/devices')).json()) as { data?: { grants?: { id: string; label: string }[] } };
  const grant = list.data?.grants?.find((g) => g.label === label)?.id ?? '';
  if (!key || !grant) throw new Error(`connecting "${label}" failed`);
  return { key, grant };
}

const step = (uuid: string, value: number, start: string, source = 'Phone') => ({
  uuid, type: 'HKQuantityTypeIdentifierStepCount', start, end: start, value, unit: 'count', source_name: source,
});

async function totals(s: Stores, username: string): Promise<string> {
  const who = ApiContext.system('test', username, s.engine);
  const samples = (await s.engine.managers.health.list(who, {})).total;
  const observations = (await s.records.list(who, 'Observation')).length;
  return `samples=${samples} observations=${observations}`;
}

/** Every file under a folder, recursively, with its bytes. */
function filesUnder(dir: string): { path: string; bytes: Buffer }[] {
  const found: { path: string; bytes: Buffer }[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...filesUnder(path));
    else found.push({ path, bytes: readFileSync(path) });
  }
  return found;
}

async function signedOut(): Promise<void> {
  await withDir('signed out: after a restart, with no session, the device key alone uploads', async (dir, started) => {
    const first = await start(dir);
    started.push(first);
    const session = await signIn(first.base, 'jim');
    const { key } = await connect(first.base, session, 'Jim phone');
    await first.close(); // the patient's session and everything in memory are gone

    const later = await start(dir);
    started.push(later);
    const res = await call(later.base, key, '/api/secure/health/samples', 'POST', {
      samples: [step('n1', 900, '2026-08-24T02:00:00-04:00'), step('n2', 100, '2026-08-24T03:00:00-04:00')],
      anchors: { step_count: 'night-1' },
    });
    check('the device uploads with nobody signed in', res.status === 200, String(res.status));
    check('readings and the daily Observation are stored', (await totals(later.stores, 'jim')) === 'samples=2 observations=1', await totals(later.stores, 'jim'));
    const again = await signIn(later.base, 'jim');
    const mine = (await (await call(later.base, again, '/api/secure/health/samples')).json()) as { data?: { total?: number } };
    check('the patient sees them on next sign-in', mine.data?.total === 2, String(mine.data?.total));
  });
}

async function revoked(): Promise<void> {
  await withDir('revoked: a revoked device stores nothing', async (dir, started) => {
    const inst = await start(dir);
    started.push(inst);
    const session = await signIn(inst.base, 'jim');
    const { key, grant } = await connect(inst.base, session, 'Old phone');
    const rev = await call(inst.base, session, `/api/secure/account/devices/${encodeURIComponent(grant)}/revoke`, 'POST');
    check('the patient revokes the device', rev.status === 200, String(rev.status));
    const res = await call(inst.base, key, '/api/secure/health/samples', 'POST', { samples: [step('r1', 10, '2026-08-24T12:00:00Z')] });
    check("TOOTH: the revoked device's upload is 401", res.status === 401, String(res.status));
    check('nothing stored', (await totals(inst.stores, 'jim')) === 'samples=0 observations=0', await totals(inst.stores, 'jim'));
  });
  await withDir('revoked: sign-out-everywhere ends the device too (the contract)', async (dir, started) => {
    const inst = await start(dir);
    started.push(inst);
    const session = await signIn(inst.base, 'jim');
    const { key } = await connect(inst.base, session, 'Phone');
    await call(inst.base, session, '/api/secure/account/sign-out-everywhere', 'POST', {});
    const res = await call(inst.base, key, '/api/secure/health/samples', 'POST', { samples: [step('o1', 10, '2026-08-24T12:00:00Z')] });
    check("TOOTH: the device's upload after sign-out-everywhere is 401", res.status === 401, String(res.status));
    check('nothing stored', (await totals(inst.stores, 'jim')) === 'samples=0 observations=0', await totals(inst.stores, 'jim'));
  });
}

async function crossPatient(): Promise<void> {
  await withDir("cross-patient: a device writes only into its own patient's record", async (dir, started) => {
    const inst = await start(dir);
    started.push(inst);
    const jim = await signIn(inst.base, 'jim');
    const molly = await signIn(inst.base, 'molly');
    const { key } = await connect(inst.base, jim, 'Jim phone');
    // An upload that tries to name another account, in every place a body could.
    const res = await call(inst.base, key, '/api/secure/health/samples', 'POST', {
      username: 'molly', user_id: 'molly', patient: 'molly',
      device: { device_id: 'molly-phone', name: 'Molly phone' },
      samples: [{ ...step('x1', 500, '2026-08-24T12:00:00Z'), user_id: 'molly', subject: 'Patient/molly' }],
    });
    check('the upload is accepted', res.status === 200, String(res.status));
    check("it lands in jim's record", (await totals(inst.stores, 'jim')) === 'samples=1 observations=1', await totals(inst.stores, 'jim'));
    check("TOOTH: nothing lands in molly's", (await totals(inst.stores, 'molly')) === 'samples=0 observations=0', await totals(inst.stores, 'molly'));
    const hers = (await (await call(inst.base, molly, '/api/secure/health/samples')).json()) as { data?: { total?: number } };
    check("molly's own read sees none of it", hers.data?.total === 0, String(hers.data?.total));
    const read = await call(inst.base, key, '/api/secure/health/samples');
    check('TOOTH: the device cannot read', read.status === 403, String(read.status));
  });
}

async function restore(): Promise<void> {
  await withDir('restore: readings and daily Observations come back; the re-sent queue does not double', async (dir, started) => {
    const first = await start(dir);
    started.push(first);
    const session = await signIn(first.base, 'jim');
    const { key } = await connect(first.base, session, 'Jim phone');
    const day = [step('b1', 300, '2026-08-24T09:00:00-04:00'), step('b2', 200, '2026-08-24T10:00:00-04:00')];
    const later = step('b3', 999, '2026-08-25T09:00:00-04:00');
    await call(first.base, key, '/api/secure/health/samples', 'POST', { samples: day });
    const operator = ApiContext.system('test', 'operator', first.stores.engine);
    const taken = await first.stores.engine.managers.backups.backupNow(operator);
    await call(first.base, key, '/api/secure/health/samples', 'POST', { samples: [later] }); // a reading the restore takes away again
    check('before the restore: three readings, two days', (await totals(first.stores, 'jim')) === 'samples=3 observations=2', await totals(first.stores, 'jim'));
    await first.stores.engine.managers.backups.stageRestore(operator, taken.name);
    await first.close();

    const restored = await start(dir, { startup: true });
    started.push(restored);
    check("after the restore: the backup's two readings and their day", (await totals(restored.stores, 'jim')) === 'samples=2 observations=1', await totals(restored.stores, 'jim'));
    const res = await call(restored.base, key, '/api/secure/health/samples', 'POST', { samples: [...day, later] });
    check('the device carries on after the restore', res.status === 200, String(res.status));
    check('its re-sent queue is stored once', (await totals(restored.stores, 'jim')) === 'samples=3 observations=2', await totals(restored.stores, 'jim'));
  });
}

async function noUnlockedCopies(): Promise<void> {
  await withDir('no unlocked copies: the marker is in no file and no log line', async (dir, started) => {
    const marker = `MARKER${randomBytes(6).toString('hex')}`;
    const inst = await start(dir);
    started.push(inst);
    const session = await signIn(inst.base, 'jim');
    const { key } = await connect(inst.base, session, 'Jim phone');
    const res = await call(inst.base, key, '/api/secure/health/samples', 'POST', {
      device: { device_id: `${marker}-device`, name: `${marker} watch` },
      samples: [
        step('u1', 4321, '2026-08-24T12:00:00Z', `${marker} source`),
        { uuid: 'u2', type: 'HKCategoryTypeIdentifierSleepAnalysis', start: '2026-08-24T01:00:00Z', end: '2026-08-24T02:00:00Z', value_text: 'HKCategoryValueSleepAnalysisAsleepREM', source_name: `${marker} source`, metadata: { note: marker } },
      ],
      anchors: { step_count: `${marker}-anchor` },
    });
    check('the upload is stored', res.status === 200, String(res.status));
    // It reads back, so a clean scan means locked, not missing.
    const back = JSON.stringify(await (await call(inst.base, session, '/api/secure/health/samples')).json());
    check('the marker reads back through the API', back.includes(marker));
    await inst.stores.engine.managers.backups.backupNow(ApiContext.system('test', 'operator', inst.stores.engine));

    const scan = (when: string) => {
      const files = filesUnder(dir);
      check(`${when}: phd-samples.db and a backup are among the files scanned`, files.some((f) => f.path.endsWith('phd-samples.db')) && files.some((f) => /backups/.test(f.path)));
      const needles = [Buffer.from(marker, 'utf8'), Buffer.from(marker, 'utf16le')];
      const leaks = files.filter((f) => needles.some((n) => f.bytes.includes(n))).map((f) => f.path.slice(dir.length));
      check(`TOOTH: ${when}: no file holds the marker in clear`, leaks.length === 0, leaks.join(', '));
    };
    scan('running, WAL files present');
    await inst.close();
    scan('after shutdown');
    const inLog = logged.filter((line) => line.includes(marker));
    check('TOOTH: no log line holds the marker', inLog.length === 0, inLog.slice(0, 2).join(' | '));
  });
}

async function main(): Promise<void> {
  await signedOut();
  await revoked();
  await crossPatient();
  await restore();
  await noUnlockedCopies();
  const failed = results.filter((r) => !r.ok);
  out(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
}

main().catch((err) => { out(`health-unattended harness failed: ${(err as Error).stack ?? (err as Error).message}`); process.exit(1); });
