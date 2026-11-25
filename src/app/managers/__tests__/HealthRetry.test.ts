/**
 * Failure and retry without losing or doubling readings (yourphr#991).
 *
 * - A store failure (SQLite busy, locked, full, I/O) answers 503 with Retry-After, never a 500.
 * - One upload's raw rows land together or not at all.
 * - The device's sync anchors are written last, so a failed upload never moves them.
 * - Sending the same upload again stores each reading once and rebuilds the day it belongs to.
 * - A bug that is not a store failure stays a 500: a device is never told to retry it.
 *
 * The Retry-After header and the operator's log line are checked over the wire in
 * scripts/health-intake-tests.ts (`check:boundary` refuses fetch under src/).
 *
 * Synthetic values only.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openStores, type Stores } from '../../../app.js';
import { ApiContext } from '../../../framework/ApiContext.js';
import { HEALTH_STORE_RETRY_AFTER_SECONDS, isStoreUnavailable } from '../HealthManager.js';

const KEY = { YOURPHR_DATABASE_ENCRYPTION_KEY: 'unit-key', YOURPHR_HEALTH_ENABLED: 'true' };
const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'health-retry-'));
  dirs.push(dir);
  return dir;
}

function sqliteError(code: string): Error {
  return Object.assign(new Error(`synthetic ${code}`), { name: 'SqliteError', code });
}

const step = (uuid: string, value: number, start = '2026-08-24T12:00:00Z') => ({
  uuid, type: 'HKQuantityTypeIdentifierStepCount', start, end: start, value, unit: 'count', source_name: 'Phone',
});
const upload = { samples: [step('r1', 100), step('r2', 50, '2026-08-24T13:00:00Z')], anchors: { step_count: 'anchor-2' }, device: { device_id: 'phone-1', name: 'Phone' } };

async function footprint(s: Stores) {
  const who = ApiContext.system('test', 'jim', s.engine);
  const health = s.engine.managers.health;
  const observations = (await s.records.list(who, 'Observation')) as unknown as Record<string, unknown>[];
  return {
    samples: (await health.list(who, {})).total,
    observations: observations.length,
    syncStates: (await health.syncState(who)).map((row) => row.anchor),
  };
}

// The provider is the manager's private; the tests reach it only to make it fail.
const providerOf = (s: Stores) => (s.engine.managers.health as unknown as { provider: { insertSamples: (...a: unknown[]) => Promise<number> } }).provider;

describe('isStoreUnavailable', () => {
  it('names SQLite storage failures and nothing else', () => {
    for (const code of ['SQLITE_BUSY', 'SQLITE_BUSY_SNAPSHOT', 'SQLITE_LOCKED', 'SQLITE_FULL', 'SQLITE_IOERR_WRITE', 'SQLITE_CANTOPEN', 'SQLITE_NOTADB', 'SQLITE_READONLY']) {
      expect(isStoreUnavailable(sqliteError(code))).toBe(true);
    }
    for (const err of [sqliteError('SQLITE_CONSTRAINT_UNIQUE'), sqliteError('SQLITE_ERROR'), new TypeError('x is undefined'), null, 'text']) {
      expect(isStoreUnavailable(err)).toBe(false);
    }
  });
});

describe('a store failure during an upload', () => {
  it('raw rows: 503 with a wait, nothing written, anchors untouched; the same upload then lands once', async () => {
    const s = await openStores(tempDir(), KEY);
    try {
      const jim = ApiContext.system('test', 'jim', s.engine);
      const provider = providerOf(s);
      const real = provider.insertSamples.bind(provider);
      provider.insertSamples = vi.fn().mockRejectedValueOnce(sqliteError('SQLITE_BUSY')).mockImplementation(real);
      await expect(s.engine.managers.health.ingest(jim, upload)).rejects.toMatchObject({
        status: 503, extra: { retry_after_seconds: HEALTH_STORE_RETRY_AFTER_SECONDS },
      });
      expect(await footprint(s)).toEqual({ samples: 0, observations: 0, syncStates: [] });

      const out = await s.engine.managers.health.ingest(jim, upload);
      expect(out).toMatchObject({ received: 2, stored: 2, duplicates: 0 });
      expect(await footprint(s)).toEqual({ samples: 2, observations: 1, syncStates: ['anchor-2'] });
    } finally {
      await s.close();
    }
  });

  it('daily Observation: 503, raw rows kept but anchors not moved; the retry rebuilds the day without doubling it', async () => {
    const s = await openStores(tempDir(), KEY);
    try {
      const jim = ApiContext.system('test', 'jim', s.engine);
      const records = s.engine.managers.records;
      const real = records.saveDeviceRecord.bind(records);
      vi.spyOn(records, 'saveDeviceRecord').mockRejectedValueOnce(sqliteError('SQLITE_FULL')).mockImplementation(real);
      await expect(s.engine.managers.health.ingest(jim, upload)).rejects.toMatchObject({ status: 503 });
      expect(await footprint(s)).toEqual({ samples: 2, observations: 0, syncStates: [] });

      const out = await s.engine.managers.health.ingest(jim, upload);
      expect(out).toMatchObject({ received: 2, stored: 0, duplicates: 2 });
      expect(await footprint(s)).toEqual({ samples: 2, observations: 1, syncStates: ['anchor-2'] });
      const day = (await records.list(jim, 'Observation'))[0] as unknown as { valueQuantity?: { value?: number } };
      expect(JSON.stringify(day)).toContain('150'); // 100 + 50, once
    } finally {
      await s.close();
    }
  });

  it('a raw-row batch larger than one chunk is all-or-nothing', async () => {
    const s = await openStores(tempDir(), KEY);
    try {
      const jim = ApiContext.system('test', 'jim', s.engine);
      // 1200 readings, the last one breaking the insert after the earlier chunks went in.
      const many = Array.from({ length: 1200 }, (_, i) => step(`m${i}`, 1, new Date(Date.UTC(2026, 7, 24, 0, 0, i)).toISOString()));
      const provider = providerOf(s) as unknown as { db: { prepare: (sql: string) => { run: (...a: unknown[]) => unknown } } };
      const realPrepare = provider.db.prepare.bind(provider.db);
      let calls = 0;
      vi.spyOn(provider.db, 'prepare').mockImplementation((sql: string) => {
        const stmt = realPrepare(sql);
        if (!sql.startsWith('INSERT INTO phd_samples')) return stmt;
        const run = stmt.run.bind(stmt);
        return Object.assign(stmt, { run: (...a: unknown[]) => { if (++calls === 1200) throw sqliteError('SQLITE_IOERR_WRITE'); return run(...a); } });
      });
      await expect(s.engine.managers.health.ingest(jim, { samples: many })).rejects.toMatchObject({ status: 503 });
      vi.restoreAllMocks();
      expect((await footprint(s)).samples).toBe(0);
    } finally {
      await s.close();
    }
  });

  it('a bug that is not a store failure stays a 500-class error, not a retry', async () => {
    const s = await openStores(tempDir(), KEY);
    try {
      const jim = ApiContext.system('test', 'jim', s.engine);
      const provider = providerOf(s);
      provider.insertSamples = vi.fn().mockRejectedValue(new TypeError('synthetic bug'));
      await expect(s.engine.managers.health.ingest(jim, upload)).rejects.toBeInstanceOf(TypeError);
    } finally {
      await s.close();
    }
  });
});
