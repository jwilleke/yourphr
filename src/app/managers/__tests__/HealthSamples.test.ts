/**
 * Wearable sample ingest (yourphr#314), adapted from ep-ipc/yourphr @ d73bd992.
 * A signed-in session may submit samples. A device credential may not.
 */
import { existsSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openStores, type Stores } from '../../../app.js';
import { ApiContext } from '../../../framework/ApiContext.js';

const steps = (uuid: string, value: number, start: string, sourceName = 'Phone') => ({
  uuid,
  type: 'HKQuantityTypeIdentifierStepCount',
  start,
  end: start,
  value,
  unit: 'count',
  source_name: sourceName,
});

async function withHealth(fn: (s: Stores, ctxOf: (u: string) => ApiContext) => Promise<void>, env: Record<string, string> = { YOURPHR_HEALTH_ENABLED: 'true' }): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'health-samples-'));
  const stores = await openStores(dir, env);
  try {
    await fn(stores, (u) => ApiContext.system('test', u, stores.engine));
  } finally {
    await stores.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('health samples stay off until enabled (yourphr#314)', () => {
  it('does not create phd-samples.db when the flag is off', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'health-off-'));
    const stores = await openStores(dir, {});
    try {
      expect(stores.engine.has('health')).toBe(false);
      expect(existsSync(join(dir, 'phd-samples.db'))).toBe(false);
    } finally {
      await stores.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('session ingest (yourphr#314)', () => {
  afterEach(() => { /* stores closed per test */ });

  it('rolls one local day of steps, converts pounds, and keeps the offset', async () => {
    await withHealth(async (s, ctxOf) => {
      const jim = ctxOf('jim');
      const health = s.engine.managers.health;
      const out = await health.ingest(jim, {
        device: { device_id: 'upload', name: 'File' },
        samples: [
          steps('s1', 100, '2026-08-24T22:00:00-04:00'),
          steps('s2', 40, '2026-08-24T23:30:00-04:00'),
          {
            uuid: 'w1',
            type: 'HKQuantityTypeIdentifierBodyMass',
            start: '2026-08-24T08:00:00-04:00',
            end: '2026-08-24T08:00:00-04:00',
            value: 10,
            unit: 'lb',
          },
        ],
        anchors: { step_count: 'anchor-1' },
      });
      expect(out.rejected).toBe(0);
      expect(out.stored).toBe(3);
      const again = await health.ingest(jim, {
        device: { device_id: 'upload' },
        samples: [steps('s1', 100, '2026-08-24T22:00:00-04:00')],
      });
      expect(again.stored).toBe(0);
      expect(again.duplicates).toBe(1);

      const listed = await health.list(jim, { metricTypes: ['step_count'] });
      expect(listed.total).toBe(2);
      expect(listed.samples.every((sample) => sample.local_day === '2026-08-24' && sample.tz_offset === '-04:00')).toBe(true);
      const weight = await health.list(jim, { metricTypes: ['body_mass'] });
      expect(weight.samples[0]?.unit).toBe('kg');
      expect(weight.samples[0]?.original_unit).toBe('lb');

      const daily = (await s.records.list(jim, 'Observation')).find((row) => row['source_resource_id'] === 'pghd-stepcount-2026-08-24');
      const raw = daily?.['resource_raw'] as { valueQuantity?: { value?: number; code?: string }; meta?: { tag?: { code: string }[] } };
      expect(raw.valueQuantity).toMatchObject({ value: 140, code: '{steps}' });
      expect(raw.meta?.tag).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'pghd' })]));
      const where = await s.records.provenance(jim, 'Observation', 'pghd-stepcount-2026-08-24');
      expect(where?.sourceDisplay).toBe('Uploaded by you');
      expect((await health.syncState(jim, 'upload'))[0]?.anchor).toBe('anchor-1');
    });
  });

  it('does not add steps from two sources, and does not average two heart-rate sources into one day', async () => {
    await withHealth(async (s, ctxOf) => {
      const jim = ctxOf('jim');
      const health = s.engine.managers.health;
      await health.ingest(jim, {
        samples: [
          steps('p1', 1000, '2026-08-24T15:00:00Z', 'Phone'),
          { ...steps('w1', 8000, '2026-08-24T15:00:00Z', 'Watch'), source_name: 'Watch' },
          {
            uuid: 'hr-phone', type: 'HKQuantityTypeIdentifierHeartRate', start: '2026-08-24T15:00:00Z', end: '2026-08-24T15:00:00Z',
            value: 60, unit: 'count/min', source_name: 'Phone',
          },
          {
            uuid: 'hr-watch', type: 'HKQuantityTypeIdentifierHeartRate', start: '2026-08-24T16:00:00Z', end: '2026-08-24T16:00:00Z',
            value: 100, unit: 'count/min', source_name: 'Watch',
          },
        ],
      });
      const stepsObs = (await s.records.list(jim, 'Observation')).find((row) => row['source_resource_id'] === 'pghd-stepcount-2026-08-24');
      const stepsRaw = stepsObs?.['resource_raw'] as { valueQuantity?: { value?: number }; note?: { text?: string }[] };
      expect(stepsRaw.valueQuantity?.value).toBe(8000);
      expect(stepsRaw.note?.[0]?.text).toContain('Phone');
      const hr = (await s.records.list(jim, 'Observation')).find((row) => row['source_resource_id'] === 'pghd-heartrate-2026-08-24');
      const hrRaw = hr?.['resource_raw'] as { valueQuantity?: { value?: number }; note?: { text?: string }[] };
      expect(hrRaw.valueQuantity?.value).toBe(100);
      expect(hrRaw.note?.[0]?.text).toContain('Phone');
      expect((await health.list(jim, { metricTypes: ['step_count'] })).total).toBe(2);
    });
  });

  it('pairs blood pressure across batches and replaces that reading when it is sent again', async () => {
    await withHealth(async (s, ctxOf) => {
      const jim = ctxOf('jim');
      const health = s.engine.managers.health;
      const half = (uuid: string, type: string, value: number) => ({
        uuid, type, start: '2026-08-24T08:00:00Z', end: '2026-08-24T08:00:00Z', value, unit: 'mmHg', correlation_uuid: 'corr-x',
      });
      await health.ingest(jim, { samples: [half('sys', 'HKQuantityTypeIdentifierBloodPressureSystolic', 120)] });
      await health.ingest(jim, { samples: [half('dia', 'HKQuantityTypeIdentifierBloodPressureDiastolic', 80)] });
      const listed = await health.list(jim, { metricTypes: ['blood_pressure'] });
      expect(listed.total).toBe(1);
      expect(listed.samples[0]?.components).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: '8480-6', value: 120 }),
        expect.objectContaining({ code: '8462-4', value: 80 }),
      ]));
      await health.ingest(jim, { samples: [half('sys', 'HKQuantityTypeIdentifierBloodPressureSystolic', 130)] });
      const updated = await health.list(jim, { metricTypes: ['blood_pressure'] });
      expect(updated.total).toBe(1);
      expect(updated.samples[0]?.components).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: '8480-6', value: 130 }),
      ]));
    });
  });

  it('a deleted step retracts that day, and another account cannot see the row', async () => {
    await withHealth(async (s, ctxOf) => {
      const jim = ctxOf('jim');
      const pat = ctxOf('pat');
      const health = s.engine.managers.health;
      await health.ingest(jim, { samples: [steps('s1', 10, '2026-08-24T12:00:00Z')] });
      await health.ingest(pat, { samples: [steps('p1', 3, '2026-08-24T12:00:00Z')] });
      expect((await health.list(jim, {})).total).toBe(1);
      expect((await health.list(pat, {})).samples[0]?.external_uuid).toBe('p1');
      await health.ingest(jim, {
        samples: [{ ...steps('s1', 10, '2026-08-24T12:00:00Z'), metadata: { deleted: true } }],
      });
      expect((await health.list(jim, { metricTypes: ['step_count'] })).total).toBe(0);
      const retracted = (await s.records.list(jim, 'Observation')).find((row) => row['source_resource_id'] === 'pghd-stepcount-2026-08-24');
      expect((retracted?.['resource_raw'] as { status?: string }).status).toBe('entered-in-error');
      expect((await health.list(pat, {})).total).toBe(1);
      await health.removeForUser(jim);
      expect((await health.list(jim, {})).total).toBe(0);
      expect((await health.list(pat, {})).total).toBe(1);
    });
  });

  it('refuses a device credential and a timestamp without an offset', async () => {
    await withHealth(async (s, ctxOf) => {
      const jim = ctxOf('jim');
      const device = ApiContext.agent('jim', { id: 'tok', name: 'Phone', scopes: ['Health samples (add)'], grantId: 'grant-1' }, s.engine);
      await expect(s.engine.managers.health.ingest(device, { samples: [steps('s1', 1, '2026-08-24T12:00:00Z')] })).rejects.toMatchObject({ status: 403 });
      const bad = await s.engine.managers.health.ingest(jim, { samples: [steps('s1', 1, '2026-08-24T12:00:00')] });
      expect(bad.rejected).toBe(1);
      expect(bad.stored).toBe(0);
      expect(bad.errors?.[0]?.reason).toMatch(/explicit offset/);
    });
  });
});
