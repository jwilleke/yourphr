/**
 * Who may read the stored samples (yourphr#1020).
 *
 * A high-frequency `points` chart reads phd-samples.db directly instead of the rolled
 * Observations in the records store. That read must make the same decision the records reads do:
 * the account is always ctx.username, never one the request names; nobody signed out reads
 * anything; and an agent token reads health only when its scopes include Health. The HTTP agent
 * gate already refuses an unscoped token; these tests pin the same answer inside the manager, so
 * a caller that reaches it another way gets it too.
 *
 * Synthetic values only.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openStores, type Stores } from '../../../app.js';
import { ApiContext } from '../../../framework/ApiContext.js';

const HEART = 'HKQuantityTypeIdentifierHeartRate';
const WINDOW = { startAfter: '2026-08-24T00:00:00Z', startBefore: '2026-08-25T00:00:00Z' };

const heart = (uuid: string, value: number, start: string) => ({
  uuid, type: HEART, start, end: start, value, unit: 'count/min', source_name: 'Watch',
});

async function withTwoPeople(fn: (s: Stores) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'health-read-access-'));
  const s = await openStores(dir, { YOURPHR_DATABASE_ENCRYPTION_KEY: 'unit-key', YOURPHR_HEALTH_ENABLED: 'true' });
  try {
    const health = s.engine.managers.health;
    await health.ingest(ApiContext.system('test', 'jim', s.engine), {
      samples: [heart('j1', 60, '2026-08-24T10:00:00Z'), heart('j2', 80, '2026-08-24T11:00:00Z')],
    });
    await health.ingest(ApiContext.system('test', 'ann', s.engine), {
      samples: [heart('a1', 120, '2026-08-24T10:30:00Z')],
    });
    await fn(s);
  } finally {
    await s.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

const person = (s: Stores, username: string) => ApiContext.from({ username, role: 'user' }, s.engine);
const agent = (s: Stores, scopes: string[], grantId?: string) =>
  ApiContext.agent('jim', { id: 'tok', name: 'Assistant', scopes, ...(grantId ? { grantId } : {}) }, s.engine);

describe('high-frequency series read from the samples store', () => {
  it('gives the owner their own points', async () => {
    await withTwoPeople(async (s) => {
      const out = await s.engine.managers.health.series(person(s, 'jim'), { metricTypes: ['heart_rate'], ...WINDOW });
      expect(out.points?.map((p) => p.v)).toEqual([60, 80]);
    });
  });

  it('gives another person only their own points, never the owner\'s', async () => {
    await withTwoPeople(async (s) => {
      const health = s.engine.managers.health;
      const ann = person(s, 'ann');
      expect((await health.series(ann, { metricTypes: ['heart_rate'], ...WINDOW })).points?.map((p) => p.v)).toEqual([120]);
      expect((await health.list(ann, {})).samples.map((x) => x.external_uuid)).toEqual(['a1']);
      // A person with no samples sees an empty chart, not someone else's.
      const out = await health.series(person(s, 'bob'), { metricTypes: ['heart_rate'], ...WINDOW });
      expect(out.points ?? []).toEqual([]);
    });
  });

  it('refuses a signed-out caller with 401', async () => {
    await withTwoPeople(async (s) => {
      await expect(s.engine.managers.health.series(ApiContext.anonymous(s.engine), { metricTypes: ['heart_rate'], ...WINDOW }))
        .rejects.toMatchObject({ status: 401 });
    });
  });

  it('lets an agent token scoped to Health read its owner\'s points', async () => {
    await withTwoPeople(async (s) => {
      const out = await s.engine.managers.health.series(agent(s, ['Health']), { metricTypes: ['heart_rate'], ...WINDOW });
      expect(out.points?.map((p) => p.v)).toEqual([60, 80]);
    });
  });

  it.each([
    ['an agent token without the Health scope', ['Medications', 'Records (FHIR)'], undefined],
    ['an agent token with no scopes at all', [], undefined],
    ['a connected device\'s key, which may only add samples', ['Health samples (add)', 'Health samples (sync state)'], 'grant-1'],
  ])('refuses %s with 403 on every samples-store read', async (_label, scopes, grantId) => {
    await withTwoPeople(async (s) => {
      const health = s.engine.managers.health;
      const ctx = agent(s, scopes, grantId);
      for (const read of [
        () => health.series(ctx, { metricTypes: ['heart_rate'], ...WINDOW }),
        () => health.list(ctx, {}),
        () => health.bundle(ctx, {}),
        () => health.metrics(ctx),
        () => health.observation(ctx, 'anything'),
      ]) {
        await expect(read()).rejects.toMatchObject({ status: 403, message: 'this token was not given access to Health' });
      }
    });
  });

  it('still lets a connected device read its sync state, which is its own scope', async () => {
    await withTwoPeople(async (s) => {
      const device = agent(s, ['Health samples (add)', 'Health samples (sync state)'], 'grant-1');
      await expect(s.engine.managers.health.syncState(device)).resolves.toEqual(expect.any(Array));
    });
  });
});
