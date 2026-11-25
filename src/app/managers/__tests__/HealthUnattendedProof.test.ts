/**
 * Proof for yourphr#991: a connected device uploads while the patient is signed out, under the
 * server's database key, and nothing about that is weaker than a signed-in upload.
 *
 * - Signed out: after a restart, with no session anywhere, the device's key alone uploads, and
 *   the patient sees the readings when they next sign in. No patient key is involved.
 * - Revoked: a revoked device's upload is refused and stores nothing.
 * - Cross-patient: a device writes only into the account that granted it, and nothing in the
 *   upload can name another account.
 * - Restore: a backup carries the readings and their daily Observations, a restore brings them
 *   back, and the device can carry on without doubling anything.
 * - No unlocked copies: a marker carried by the upload never appears in clear in any file the
 *   instance writes (databases, their WAL and journal files, side files, backups) or in its log.
 *
 * Driven over HTTP, the way a phone calls. Synthetic values only; the password is generated per run.
 */
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openStores, type Stores } from '../../../app.js';
import { ApiContext } from '../../../framework/ApiContext.js';
import { createYourPhrServer } from '../../../server.js';

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

const dirs: string[] = [];
const open: Instance[] = [];
let logged: string[] = [];

beforeEach(() => {
  logged = [];
  for (const method of ['log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => { logged.push(args.map(String).join(' ')); });
  }
});

afterEach(async () => {
  for (const inst of open.splice(0)) await inst.close();
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'health-unattended-'));
  dirs.push(dir);
  return dir;
}

async function start(dir: string, options: { startup?: boolean } = {}): Promise<Instance> {
  const stores = await openStores(dir, ENV, options);
  const server = createYourPhrServer({ engine: stores.engine, auth: {} }) as Server;
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  let closed = false;
  const inst: Instance = {
    base: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    stores,
    close: async () => {
      if (closed) return;
      closed = true;
      await new Promise<void>((done) => server.close(() => done()));
      await stores.close();
    },
  };
  open.push(inst);
  return inst;
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
  expect(key).not.toBe('');
  expect(grant).not.toBe('');
  return { key, grant };
}

const step = (uuid: string, value: number, start: string, source = 'Phone') => ({
  uuid, type: 'HKQuantityTypeIdentifierStepCount', start, end: start, value, unit: 'count', source_name: source,
});

async function totals(s: Stores, username: string) {
  const who = ApiContext.system('test', username, s.engine);
  return {
    samples: (await s.engine.managers.health.list(who, {})).total,
    observations: (await s.records.list(who, 'Observation')).length,
  };
}

/** Every file under a folder, recursively, with its bytes. */
function filesUnder(dir: string): { path: string; bytes: Buffer }[] {
  const out: { path: string; bytes: Buffer }[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else out.push({ path, bytes: readFileSync(path) });
  }
  return out;
}

describe('signed out', () => {
  it('after a restart, with no session, the device key alone uploads; the patient sees it on next sign-in', async () => {
    const dir = tempDir();
    const first = await start(dir);
    const session = await signIn(first.base, 'jim');
    const { key } = await connect(first.base, session, 'Jim phone');
    await first.close(); // the patient's session and everything in memory are gone

    const later = await start(dir);
    const res = await call(later.base, key, '/api/secure/health/samples', 'POST', {
      samples: [step('n1', 900, '2026-08-24T02:00:00-04:00'), step('n2', 100, '2026-08-24T03:00:00-04:00')],
      anchors: { step_count: 'night-1' },
    });
    expect(res.status).toBe(200);
    expect(await totals(later.stores, 'jim')).toEqual({ samples: 2, observations: 1 });

    const again = await signIn(later.base, 'jim');
    const mine = (await (await call(later.base, again, '/api/secure/health/samples')).json()) as { data?: { total?: number } };
    expect(mine.data?.total).toBe(2);
  });
});

describe('revoked', () => {
  it("a revoked device's upload is 401 and stores nothing", async () => {
    const inst = await start(tempDir());
    const session = await signIn(inst.base, 'jim');
    const { key, grant } = await connect(inst.base, session, 'Old phone');
    expect((await call(inst.base, session, `/api/secure/account/devices/${encodeURIComponent(grant)}/revoke`, 'POST')).status).toBe(200);

    const res = await call(inst.base, key, '/api/secure/health/samples', 'POST', { samples: [step('r1', 10, '2026-08-24T12:00:00Z')] });
    expect(res.status).toBe(401);
    expect(await totals(inst.stores, 'jim')).toEqual({ samples: 0, observations: 0 });
  });

  it("sign-out-everywhere ends the device too (the contract), and its upload stores nothing", async () => {
    const inst = await start(tempDir());
    const session = await signIn(inst.base, 'jim');
    const { key } = await connect(inst.base, session, 'Phone');
    await call(inst.base, session, '/api/secure/account/sign-out-everywhere', 'POST', {});
    const res = await call(inst.base, key, '/api/secure/health/samples', 'POST', { samples: [step('o1', 10, '2026-08-24T12:00:00Z')] });
    expect(res.status).toBe(401);
    expect(await totals(inst.stores, 'jim')).toEqual({ samples: 0, observations: 0 });
  });
});

describe('cross-patient', () => {
  it("a device writes only into its own patient's record, whatever the upload says", async () => {
    const inst = await start(tempDir());
    const jim = await signIn(inst.base, 'jim');
    const molly = await signIn(inst.base, 'molly');
    const { key } = await connect(inst.base, jim, 'Jim phone');

    // An upload that tries to name another account, in every place a body could.
    const res = await call(inst.base, key, '/api/secure/health/samples', 'POST', {
      username: 'molly', user_id: 'molly', patient: 'molly',
      device: { device_id: 'molly-phone', name: 'Molly phone' },
      samples: [{ ...step('x1', 500, '2026-08-24T12:00:00Z'), user_id: 'molly', subject: 'Patient/molly' }],
    });
    expect(res.status).toBe(200);
    expect(await totals(inst.stores, 'jim')).toEqual({ samples: 1, observations: 1 });
    expect(await totals(inst.stores, 'molly')).toEqual({ samples: 0, observations: 0 });

    // Molly's own reads see none of it; the device cannot read anyone's.
    const hers = (await (await call(inst.base, molly, '/api/secure/health/samples')).json()) as { data?: { total?: number } };
    expect(hers.data?.total).toBe(0);
    expect((await call(inst.base, key, '/api/secure/health/samples')).status).toBe(403);
  });
});

describe('restore', () => {
  it('a backup carries readings and daily Observations; after a restore the device carries on without doubling', async () => {
    const dir = tempDir();
    const first = await start(dir);
    const session = await signIn(first.base, 'jim');
    const { key } = await connect(first.base, session, 'Jim phone');
    const day = [step('b1', 300, '2026-08-24T09:00:00-04:00'), step('b2', 200, '2026-08-24T10:00:00-04:00')];
    expect((await call(first.base, key, '/api/secure/health/samples', 'POST', { samples: day })).status).toBe(200);

    const operator = ApiContext.system('test', 'operator', first.stores.engine);
    const taken = await first.stores.engine.managers.backups.backupNow(operator);
    // A later reading the restore must take away again.
    expect((await call(first.base, key, '/api/secure/health/samples', 'POST', { samples: [step('b3', 999, '2026-08-25T09:00:00-04:00')] })).status).toBe(200);
    expect(await totals(first.stores, 'jim')).toEqual({ samples: 3, observations: 2 });

    await first.stores.engine.managers.backups.stageRestore(operator, taken.name);
    await first.close();

    const restored = await start(dir, { startup: true });
    expect(await totals(restored.stores, 'jim')).toEqual({ samples: 2, observations: 1 });
    // The phone sends its queue again: the same uuids are an update, not a second copy.
    const res = await call(restored.base, key, '/api/secure/health/samples', 'POST', { samples: [...day, step('b3', 999, '2026-08-25T09:00:00-04:00')] });
    expect(res.status).toBe(200);
    expect(await totals(restored.stores, 'jim')).toEqual({ samples: 3, observations: 2 });
  });
});

describe('no unlocked copies', () => {
  it('a marker from the upload is in no file the instance writes, and in no log line', async () => {
    const dir = tempDir();
    const marker = `MARKER${randomBytes(6).toString('hex')}`;
    const inst = await start(dir);
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
    expect(res.status).toBe(200);
    // It was stored and reads back, so a clean scan means locked, not missing.
    const back = JSON.stringify(await (await call(inst.base, session, '/api/secure/health/samples')).json());
    expect(back).toContain(marker);

    const operator = ApiContext.system('test', 'operator', inst.stores.engine);
    await inst.stores.engine.managers.backups.backupNow(operator);

    const scan = (when: string) => {
      const files = filesUnder(dir);
      expect(files.some((f) => f.path.endsWith('phd-samples.db'))).toBe(true);
      expect(files.some((f) => /backups/.test(f.path))).toBe(true);
      const needles = [Buffer.from(marker, 'utf8'), Buffer.from(marker, 'utf16le')];
      const leaks = files.filter((f) => needles.some((n) => f.bytes.includes(n))).map((f) => f.path.slice(dir.length));
      expect(leaks, `files holding the marker in clear (${when})`).toEqual([]);
    };
    scan('while running, WAL files present');
    await inst.close();
    scan('after shutdown');
    expect(logged.filter((line) => line.includes(marker))).toEqual([]);
  });
});
