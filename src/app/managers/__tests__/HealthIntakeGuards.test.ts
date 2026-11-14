/**
 * HealthManager's intake guards, called directly (yourphr#314). scripts/health-intake-tests.ts
 * drives the same rules over HTTP.
 *
 * - Everything a request carries is checked before anything is written, so a refused request
 *   leaves no raw row, Observation, upload source or sync state behind.
 * - With health off, the manager exists only when phd-samples.db does, answers 404 to everything,
 *   and still deletes an account's samples.
 * - Device uploads need yourphr.health.device-intake.enabled as well, off by default.
 *
 * Synthetic values only.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openStores, type Stores } from '../../../app.js';
import { ApiContext } from '../../../framework/ApiContext.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'health-guards-'));
  dirs.push(dir);
  return dir;
}

const step = (uuid: string, value = 100, start = '2026-08-24T12:00:00Z') => ({
  uuid, type: 'HKQuantityTypeIdentifierStepCount', start, end: start, value, unit: 'count', source_name: 'Phone',
});

const device = (s: Stores) => ApiContext.agent('jim', { id: 'tok', name: 'Phone', scopes: ['Health samples (add)'], grantId: 'grant-1' }, s.engine);

async function footprint(s: Stores, username = 'jim') {
  const who = ApiContext.system('test', username, s.engine);
  const health = s.engine.managers.health;
  return {
    samples: (await health.list(who, {})).total,
    observations: (await s.records.list(who, 'Observation')).length,
    uploadSources: (await s.sources.list(who)).filter((source) => source.display === 'Uploaded by you').length,
    syncStates: (await health.syncState(who)).length,
  };
}

describe('a refused ingest writes nothing', () => {
  it.each([
    ['an anchor over 1024 characters', { anchors: { step_count: 'a'.repeat(1025) } }, /anchor is longer than 1024/],
    ['more than 32 anchors', { anchors: Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`m${i}`, 'a'])) }, /at most 32 anchors/],
    ['an anchor that is not a string', { anchors: { step_count: 42 } }, /anchor for step_count must be a string/],
    ['anchors that are not an object', { anchors: 'step_count' }, /anchors must be an object/],
    ['anchors given as a list', { anchors: [['step_count', 'a']] }, /anchors must be an object/],
    ['an anchor metric over 64 characters', { anchors: { ['m'.repeat(65)]: 'a' } }, /anchor metric is longer than 64/],
    ['a device that is not an object', { device: 'phone' }, /device must be an object/],
    ['a device given as a list', { device: ['phone'] }, /device must be an object/],
    ['a device name over 200 characters', { device: { device_id: 'p', name: 'n'.repeat(201) } }, /device.name is longer than 200/],
    ['a device id over 256 characters', { device: { device_id: 'd'.repeat(257) } }, /device.device_id is longer than 256/],
    ['a device id that is not a string', { device: { device_id: 7 } }, /device.device_id must be a string/],
    ['samples that are not a list', { samples: 'nope' }, /samples must be an array/],
  ])('refuses %s with 400, before writing any sample, Observation, source or sync state', async (_label, bad, message) => {
    const s = await openStores(tempDir(), { YOURPHR_HEALTH_ENABLED: 'true' });
    try {
      const jim = ApiContext.system('test', 'jim', s.engine);
      await expect(s.engine.managers.health.ingest(jim, { samples: [step('s1'), step('s2', 50)], ...bad } as never))
        .rejects.toMatchObject({ status: 400, message: expect.stringMatching(message) });
      expect(await footprint(s)).toEqual({ samples: 0, observations: 0, uploadSources: 0, syncStates: 0 });
    } finally {
      await s.close();
    }
  });

  it('stores the same batch once the input is good, and reads null device and anchors as absent', async () => {
    const s = await openStores(tempDir(), { YOURPHR_HEALTH_ENABLED: 'true' });
    try {
      const jim = ApiContext.system('test', 'jim', s.engine);
      const health = s.engine.managers.health;
      await health.ingest(jim, { samples: [step('s0')], device: null as never, anchors: null });
      const out = await health.ingest(jim, {
        samples: [step('s1'), step('s2', 50)],
        anchors: { step_count: 'anchor-1', '  ': 'blank metric is skipped' },
        device: { device_id: '  dev-1  ', name: 'Band' },
      });
      expect(out).toMatchObject({ received: 2, stored: 2, rejected: 0 });
      expect(await footprint(s)).toEqual({ samples: 3, observations: 1, uploadSources: 1, syncStates: 1 });
      expect(await health.syncState(jim)).toMatchObject([{ device_id: 'dev-1', metric_type: 'step_count', anchor: 'anchor-1', device_name: 'Band' }]);
    } finally {
      await s.close();
    }
  });
});

describe('health off, with a samples file left from when it was on', () => {
  async function seeded(): Promise<string> {
    const dir = tempDir();
    const on = await openStores(dir, { YOURPHR_HEALTH_ENABLED: 'true' });
    try {
      for (const who of ['jim', 'molly']) {
        await on.engine.managers.health.ingest(ApiContext.system('test', who, on.engine), {
          samples: [step(`${who}-1`), step(`${who}-2`, 70)], anchors: { step_count: 'a' },
        });
      }
    } finally {
      await on.close();
    }
    return dir;
  }

  it('registers the manager disabled, answering 404 to every read and write', async () => {
    const off = await openStores(await seeded(), {});
    try {
      const health = off.engine.managers.health;
      expect(off.engine.has('health')).toBe(true);
      expect(health.enabled).toBe(false);
      expect(health.deviceIntake).toBe(false);
      const jim = ApiContext.system('test', 'jim', off.engine);
      for (const attempt of [
        () => health.ingest(jim, { samples: [step('late')] }),
        () => health.list(jim, {}),
        () => health.observation(jim, 'x'),
        () => health.bundle(jim, {}),
        () => health.metrics(jim),
        () => health.series(jim, { metricTypes: ['step_count'] }),
        () => health.syncState(jim),
      ]) {
        await expect(attempt()).rejects.toMatchObject({ status: 404 });
      }
    } finally {
      await off.close();
    }
  });

  it('deletes the account\'s samples and sync state, and nobody else\'s, and can do it twice', async () => {
    const dir = await seeded();
    const off = await openStores(dir, {});
    try {
      await off.engine.managers.health.removeForUser(ApiContext.system('test', 'jim', off.engine));
      await off.engine.managers.health.removeForUser(ApiContext.system('test', 'jim', off.engine));
    } finally {
      await off.close();
    }
    const after = await openStores(dir, { YOURPHR_HEALTH_ENABLED: 'true' });
    try {
      expect(await footprint(after, 'jim')).toMatchObject({ samples: 0, syncStates: 0 });
      expect(await footprint(after, 'molly')).toMatchObject({ samples: 2, syncStates: 1 });
    } finally {
      await after.close();
    }
  });

  it('refuses an anonymous deletion', async () => {
    const off = await openStores(await seeded(), {});
    try {
      await expect(off.engine.managers.health.removeForUser(ApiContext.anonymous(off.engine))).rejects.toMatchObject({ status: 401 });
    } finally {
      await off.close();
    }
  });

  it('with no samples file, registers nothing and creates no file', async () => {
    const s = await openStores(tempDir(), {});
    try {
      expect(s.engine.has('health')).toBe(false);
      expect(existsSync(s.engine.managers.configuration.getString('yourphr.phd-samples.location'))).toBe(false);
    } finally {
      await s.close();
    }
  });
});

describe('device intake (yourphr.health.device-intake.enabled)', () => {
  it('is off by default: a device credential is refused with 403 before anything is written', async () => {
    const s = await openStores(tempDir(), { YOURPHR_HEALTH_ENABLED: 'true' });
    try {
      expect(s.engine.managers.health.deviceIntake).toBe(false);
      await expect(s.engine.managers.health.ingest(device(s), { samples: [step('d1')] }))
        .rejects.toMatchObject({ status: 403, message: expect.stringMatching(/device intake is not enabled/) });
      expect(await footprint(s)).toEqual({ samples: 0, observations: 0, uploadSources: 0, syncStates: 0 });
    } finally {
      await s.close();
    }
  });

  it('on, a credential without a device grant is still refused', async () => {
    const s = await openStores(tempDir(), { YOURPHR_HEALTH_ENABLED: 'true', YOURPHR_HEALTH_DEVICE_INTAKE_ENABLED: 'true' });
    try {
      expect(s.engine.managers.health.deviceIntake).toBe(true);
      const agent = ApiContext.agent('jim', { id: 'tok', name: 'Agent', scopes: ['Medications'] }, s.engine);
      await expect(s.engine.managers.health.ingest(agent, { samples: [step('a1')] })).rejects.toMatchObject({ status: 403 });
    } finally {
      await s.close();
    }
  });

  it('has no effect while health itself is off', async () => {
    const dir = tempDir();
    await (await openStores(dir, { YOURPHR_HEALTH_ENABLED: 'true' })).close();
    const s = await openStores(dir, { YOURPHR_HEALTH_DEVICE_INTAKE_ENABLED: 'true' });
    try {
      expect(s.engine.managers.health.enabled).toBe(false);
      expect(s.engine.managers.health.deviceIntake).toBe(false);
    } finally {
      await s.close();
    }
  });
});
