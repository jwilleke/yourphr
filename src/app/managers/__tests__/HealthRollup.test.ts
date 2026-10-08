/**
 * Daily and spot readings land in the record through saveDeviceRecord (yourphr#314).
 * Raw samples stay in phd-samples.db. Two step sources on one local day are not added together.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStores, type Stores } from '../../../app.js';
import { ApiContext } from '../../../framework/ApiContext.js';

const PASSWORD = 'a-long-enough-password';
const req = { remoteAddr: '127.0.0.1' };

let dir: string;
let s: Stores;
let jim: ApiContext;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'health-rollup-'));
  s = await openStores(dir, { YOURPHR_HEALTH_ENABLED: 'true', YOURPHR_DEVICES_ENABLED: 'true' });
  await s.users.createUser(ApiContext.system('test', 'test', s.engine), 'jim', PASSWORD);
  jim = ApiContext.system('test', 'jim', s.engine);
});

afterEach(async () => {
  await s.close();
  rmSync(dir, { recursive: true, force: true });
});

function steps(uuid: string, value: number, start: string) {
  return {
    uuid,
    type: 'HKQuantityTypeIdentifierStepCount',
    start,
    end: start,
    value,
    unit: 'count',
    source_name: 'Apple Watch',
  };
}

async function observations(): Promise<Record<string, unknown>[]> {
  return s.engine.managers.records.list(jim, 'Observation');
}

describe('rollup through the device record door', () => {
  it('writes one daily step Observation and keeps pounds on the raw row only', async () => {
    const health = s.engine.managers.health;
    await health.ingest(jim, {
      device: { device_id: 'upload' },
      samples: [
        steps('s1', 100, '2026-08-24T22:00:00-04:00'),
        steps('s2', 40, '2026-08-24T23:00:00-04:00'),
        {
          uuid: 'w1',
          type: 'HKQuantityTypeIdentifierBodyMass',
          start: '2026-08-24T08:00:00-04:00',
          end: '2026-08-24T08:00:00-04:00',
          value: 10,
          unit: 'lb',
        },
      ],
    });
    const rows = await observations();
    const daily = rows.find((row) => row['source_resource_id'] === 'pghd-stepcount-2026-08-24');
    const raw = (daily?.['resource_raw'] ?? {}) as { valueQuantity?: { value?: number; code?: string }; subject?: { reference?: string } };
    expect(raw.valueQuantity).toMatchObject({ value: 140, code: '{steps}' });
    expect(raw.subject?.reference).toMatch(/^Patient\//);

    const weight = rows.find((row) => String(row['source_resource_id']).startsWith('pghd-w1'));
    const weightRaw = (weight?.['resource_raw'] ?? {}) as { valueQuantity?: { value?: number; code?: string } };
    expect(weightRaw.valueQuantity?.code).toBe('kg');
    expect(weightRaw.valueQuantity?.value).toBeCloseTo(4.536, 2);

    const stored = await health.list(jim, { metricTypes: ['body_mass'] });
    expect(stored.samples[0]?.unit).toBe('kg');
  });

  it('keeps the larger step total when two devices record the same local day', async () => {
    const phone = `source-${(await s.sources.addDeviceSource(jim, 'Phone')).id}`;
    const watch = `source-${(await s.sources.addDeviceSource(jim, 'Watch')).id}`;
    const tokens = s.engine.managers.agentTokens;
    const phoneGrant = await tokens.createDeviceGrant(jim, { label: 'Phone', sourceId: phone, credentials: { password: PASSWORD }, request: req });
    const watchGrant = await tokens.createDeviceGrant(jim, { label: 'Watch', sourceId: watch, credentials: { password: PASSWORD }, request: req });
    const asDevice = (grantId: string, name: string) => ApiContext.agent('jim', {
      id: grantId, name, scopes: ['Health samples (add)'], grantId,
    }, s.engine);
    const health = s.engine.managers.health;
    await health.ingest(asDevice(phoneGrant.grant.id, 'Phone'), {
      device: { device_id: 'phone' },
      samples: [steps('p1', 1000, '2026-08-24T15:00:00Z')],
    });
    await health.ingest(asDevice(watchGrant.grant.id, 'Watch'), {
      device: { device_id: 'watch' },
      samples: [steps('w1', 8000, '2026-08-24T15:00:00Z')],
    });
    const daily = (await observations()).find((row) => row['source_resource_id'] === 'pghd-stepcount-2026-08-24');
    const raw = (daily?.['resource_raw'] ?? {}) as { valueQuantity?: { value?: number }; note?: { text?: string }[] };
    expect(raw.valueQuantity?.value).toBe(8000);
    expect(raw.note?.[0]?.text).toContain(phone);
    const rawRows = await health.list(jim, { metricTypes: ['step_count'] });
    expect(rawRows.total).toBe(2);
    const chart = await health.series(jim, {
      metricTypes: ['step_count'], mode: 'day', startAfter: '2026-08-01T00:00:00Z', startBefore: '2026-09-01T00:00:00Z',
    });
    expect(chart.daily?.[0]?.value).toBe(8000);
  });

  it('pairs blood-pressure halves that arrive in different batches', async () => {
    const health = s.engine.managers.health;
    const half = (uuid: string, type: string, value: number) => ({
      uuid,
      type,
      start: '2026-08-24T08:00:00Z',
      end: '2026-08-24T08:00:00Z',
      value,
      unit: 'mmHg',
      correlation_uuid: 'corr-x',
    });
    await health.ingest(jim, { device: { device_id: 'cuff' }, samples: [half('sys', 'HKQuantityTypeIdentifierBloodPressureSystolic', 120)] });
    await health.ingest(jim, { device: { device_id: 'cuff' }, samples: [half('dia', 'HKQuantityTypeIdentifierBloodPressureDiastolic', 80)] });
    const listed = await health.list(jim, { metricTypes: ['blood_pressure'] });
    expect(listed.total).toBe(1);
    expect(listed.samples[0]?.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: '8480-6', value: 120 }),
      expect.objectContaining({ code: '8462-4', value: 80 }),
    ]));
  });
});
