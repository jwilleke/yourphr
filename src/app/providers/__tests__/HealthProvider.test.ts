import { beforeEach, describe, expect, it } from 'vitest';
import { Engine } from '../../../framework/Engine.js';
import { ApiContext } from '../../../framework/ApiContext.js';
import { HealthManager, HEALTH_SAMPLE_MAX_BATCH } from '../../managers/HealthManager.js';
import { SqlitePhdSamplesProvider } from '../SqlitePhdSamplesProvider.js';

let engine: Engine;
let health: HealthManager;
let jim: ApiContext;
let pat: ApiContext;

const device = { device_id: 'iphone-1', name: 'Jim\'s iPhone' };

function quantity(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    uuid: 'hr-1',
    type: 'HKQuantityTypeIdentifierHeartRate',
    start: '2026-08-24T12:00:00Z',
    end: '2026-08-24T12:00:00Z',
    value: 72,
    unit: 'count/min',
    source_name: 'Apple Watch',
    ...over,
  };
}

const inWindow = { startAfter: '2026-08-01T00:00:00Z', startBefore: '2026-09-01T00:00:00Z' };

async function boot(): Promise<void> {
  engine = new Engine();
  health = new HealthManager(engine, new SqlitePhdSamplesProvider(':memory:'));
  engine.register('health', health);
  await engine.initialize();
  jim = ApiContext.from({ username: 'jim', role: 'user' }, engine);
  pat = ApiContext.from({ username: 'pat', role: 'user' }, engine);
}

beforeEach(async () => { await boot(); });

describe('ingest', () => {
  it('stores a valid sample and reports received/accepted/stored', async () => {
    const result = await health.ingest(jim, { device, samples: [quantity()] });
    expect(result).toMatchObject({ received: 1, accepted: 1, stored: 1, duplicates: 0, rejected: 0 });
  });

  it('is idempotent on HealthKit uuid — a retry is a duplicate, not a second row', async () => {
    await health.ingest(jim, { device, samples: [quantity()] });
    const again = await health.ingest(jim, { device, samples: [quantity()] });
    expect(again).toMatchObject({ received: 1, accepted: 1, stored: 0, duplicates: 1, rejected: 0 });
    expect((await health.list(jim, {})).total).toBe(1);
  });

  it('rejects a known type with a bad unit, and stores an unknown type verbatim', async () => {
    const result = await health.ingest(jim, {
      device,
      samples: [
        quantity({ uuid: 'bad', unit: 'furlongs' }),
        quantity({ uuid: 'new', type: 'HKQuantityTypeIdentifierSomethingNew', unit: 'widget' }),
      ],
    });
    expect(result.rejected).toBe(1);
    expect(result.accepted).toBe(1);
    expect(result.errors?.[0]?.reason).toMatch(/expects unit/);
    const listed = await health.list(jim, {});
    expect(listed.samples[0]?.metric_type).toBe('');
    expect(listed.samples[0]?.vendor_type).toBe('HKQuantityTypeIdentifierSomethingNew');
  });

  it('accepts a session upload without a device id and refuses a batch over the cap', async () => {
    const uploaded = await health.ingest(jim, { device: { device_id: '' }, samples: [quantity({ uuid: 'no-device' })] });
    expect(uploaded.stored).toBe(1);
    const tooMany = Array.from({ length: HEALTH_SAMPLE_MAX_BATCH + 1 }, (_, i) => quantity({ uuid: `u-${i}` }));
    await expect(health.ingest(jim, { device, samples: tooMany })).rejects.toThrow(/maximum is/);
  });

  it('records opaque anchors after the samples they describe', async () => {
    await health.ingest(jim, {
      device,
      samples: [quantity()],
      anchors: { heart_rate: 'opaque-anchor' },
    });
    const states = await health.syncState(jim, 'iphone-1');
    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({ device_id: 'iphone-1', metric_type: 'heart_rate', anchor: 'opaque-anchor' });
  });

  it('never stores another account\'s samples under this one', async () => {
    await health.ingest(jim, { device, samples: [quantity()] });
    await health.ingest(pat, { device: { device_id: 'pat-phone' }, samples: [quantity({ uuid: 'pat-hr' })] });
    expect((await health.list(jim, {})).total).toBe(1);
    expect((await health.list(pat, {})).total).toBe(1);
    expect((await health.list(pat, {})).samples[0]?.external_uuid).toBe('pat-hr');
  });

  it('merges a HealthKit blood-pressure correlation into one panel Observation', async () => {
    const result = await health.ingest(jim, {
      device,
      samples: [
        quantity({
          uuid: 'sys-1',
          type: 'HKQuantityTypeIdentifierBloodPressureSystolic',
          value: 128,
          unit: 'mmHg',
          correlation_uuid: 'corr-9',
        }),
        quantity({
          uuid: 'dia-1',
          type: 'HKQuantityTypeIdentifierBloodPressureDiastolic',
          value: 82,
          unit: 'mmHg',
          correlation_uuid: 'corr-9',
        }),
      ],
    });
    expect(result).toMatchObject({ received: 2, accepted: 1, stored: 1, rejected: 0 });
    const listed = await health.list(jim, { metricTypes: ['blood_pressure'] });
    expect(listed.total).toBe(1);
    expect(listed.samples[0]?.code).toBe('85354-9');
    expect(listed.samples[0]?.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: '8480-6', value: 128 }),
      expect.objectContaining({ code: '8462-4', value: 82 }),
    ]));
    const obs = await health.observation(jim, listed.samples[0]!.id);
    expect(obs.component).toHaveLength(2);
    const series = await health.series(jim, { codes: ['85354-9'], mode: 'points', ...inWindow });
    expect(series.components?.['8480-6']?.map((p) => p.v)).toEqual([128]);
    expect(series.components?.['8462-4']?.map((p) => p.v)).toEqual([82]);
  });

  it('accepts a blood-pressure panel Observation with components', async () => {
    const result = await health.ingest(jim, {
      device,
      samples: [{
        resourceType: 'Observation',
        identifier: [{ system: 'urn:uuid', value: 'corr-obs' }],
        status: 'final',
        code: { coding: [{ system: 'http://loinc.org', code: '85354-9' }] },
        effectiveDateTime: '2026-08-24T08:00:00Z',
        component: [
          { code: { coding: [{ system: 'http://loinc.org', code: '8480-6' }] }, valueQuantity: { value: 120, code: 'mm[Hg]' } },
          { code: { coding: [{ system: 'http://loinc.org', code: '8462-4' }] }, valueQuantity: { value: 80, code: 'mm[Hg]' } },
        ],
      }],
    });
    expect(result).toMatchObject({ received: 1, accepted: 1, stored: 1 });
    const listed = await health.list(jim, { codes: ['85354-9'] });
    expect(listed.total).toBe(1);
    expect(listed.samples[0]?.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: '8480-6', value: 120 }),
      expect.objectContaining({ code: '8462-4', value: 80 }),
    ]));
  });

  it('accepts a FHIR Observation and a Bundle of Observations', async () => {
    const observation = {
      resourceType: 'Observation',
      identifier: [{ system: 'urn:uuid', value: 'obs-hr' }],
      status: 'final',
      code: { coding: [{ system: 'http://loinc.org', code: '8867-4' }] },
      effectiveDateTime: '2026-08-24T15:00:00Z',
      valueQuantity: { value: 64, unit: 'beats/minute', system: 'http://unitsofmeasure.org', code: '/min' },
      device: { display: 'Apple Watch' },
      meta: { source: 'Health' },
    };
    const result = await health.ingest(jim, { device, samples: [observation] });
    expect(result).toMatchObject({ received: 1, accepted: 1, stored: 1 });
    const listed = await health.list(jim, { codes: ['8867-4'] });
    expect(listed.samples[0]?.value_num).toBe(64);
    expect(listed.samples[0]?.device_name).toBe('Apple Watch');
    expect(listed.samples[0]?.source_name).toBe('Health');
    const bundleIn = await health.ingest(jim, {
      device,
      resourceType: 'Bundle',
      entry: [{ resource: { ...observation, identifier: [{ value: 'obs-hr-2' }], valueQuantity: { value: 80, code: '/min' } } }],
    });
    expect(bundleIn.stored).toBe(1);
    const bundle = await health.bundle(jim, { codes: ['8867-4'] });
    expect(bundle.resourceType).toBe('Bundle');
    expect(bundle.entry?.length).toBeGreaterThanOrEqual(2);
    expect(bundle.total).toBeUndefined();
  });
});

describe('reads', () => {
  it('summarizes metrics and charts a points series', async () => {
    await health.ingest(jim, {
      device,
      samples: [
        quantity({ uuid: 'a', start: '2026-08-24T10:00:00Z', end: '2026-08-24T10:00:00Z', value: 70 }),
        quantity({ uuid: 'b', start: '2026-08-24T11:00:00Z', end: '2026-08-24T11:00:00Z', value: 80 }),
      ],
      anchors: { heart_rate: 'a1' },
    });
    const catalog = await health.metrics(jim);
    expect(catalog.metrics[0]?.code).toBe('8867-4');
    expect(catalog.metrics[0]?.metric_type).toBe('heart_rate');
    expect(catalog.metrics[0]?.sample_count).toBe(2);
    expect(catalog.last_synced_at).toBeTruthy();

    const series = await health.series(jim, { metricTypes: ['heart_rate'], mode: 'points', ...inWindow });
    expect(series.total).toBe(2);
    expect(series.downsampled).toBe(false);
    expect(series.points?.map((p) => p.v)).toEqual([70, 80]);
    expect(series.stats).toMatchObject({ min: 70, max: 80, avg: 75 });
  });

  it('sums steps by the sample\'s own local day and buckets sleep the same way', async () => {
    await health.ingest(jim, {
      device,
      samples: [
        quantity({ uuid: 's1', type: 'HKQuantityTypeIdentifierStepCount', start: '2026-08-24T01:00:00Z', end: '2026-08-24T01:00:00Z', value: 100, unit: 'count' }),
        quantity({ uuid: 's2', type: 'HKQuantityTypeIdentifierStepCount', start: '2026-08-24T02:00:00Z', end: '2026-08-24T02:00:00Z', value: 50, unit: 'count' }),
        {
          uuid: 'sleep-1',
          type: 'HKCategoryTypeIdentifierSleepAnalysis',
          start: '2026-08-24T04:00:00Z',
          end: '2026-08-24T06:00:00Z',
          value_text: 'asleepDeep',
        },
      ],
    });
    const daily = await health.series(jim, { metricTypes: ['step_count'], mode: 'day', ...inWindow });
    expect(daily.daily).toEqual([{ date: '2026-08-24', value: 150 }]);

    const nights = await health.series(jim, { metricTypes: ['sleep_stage'], mode: 'stages', ...inWindow });
    expect(nights.nights?.[0]?.date).toBe('2026-08-24');
    expect(nights.nights?.[0]?.stages['93831-6']).toBeCloseTo(2, 5);
  });

  it('returns per-day min/max/avg for daily-stats without inventing gap days', async () => {
    await health.ingest(jim, {
      device,
      samples: [
        quantity({ uuid: 'a', start: '2026-08-24T10:00:00Z', end: '2026-08-24T10:00:00Z', value: 70 }),
        quantity({ uuid: 'b', start: '2026-08-24T11:00:00Z', end: '2026-08-24T11:00:00Z', value: 80 }),
        quantity({ uuid: 'c', start: '2026-08-26T09:00:00Z', end: '2026-08-26T09:00:00Z', value: 90 }),
      ],
    });
    const series = await health.series(jim, { metricTypes: ['heart_rate'], mode: 'daily-stats', ...inWindow });
    expect(series.total).toBe(3);
    expect(series.stats).toMatchObject({ min: 70, max: 90, avg: 80 });
    expect(series.daily).toEqual([
      { date: '2026-08-24', value: 75, min: 70, max: 80, n: 2 },
      { date: '2026-08-26', value: 90, min: 90, max: 90, n: 1 },
    ]);
    const steps = await health.series(jim, { metricTypes: ['step_count'], mode: 'day', ...inWindow });
    expect(steps.daily).toEqual([]);
  });

  it('refuses a series without a metric and an unknown mode', async () => {
    await expect(health.series(jim, {})).rejects.toThrow(/code, metric_type, or vendor_type/);
    await expect(health.series(jim, { metricTypes: ['heart_rate'], mode: 'weekly' })).rejects.toThrow(/points, day, daily-stats, or stages/);
  });

  it('an account\'s samples go when the account does', async () => {
    await health.ingest(jim, { device, samples: [quantity()] });
    await health.ingest(pat, { device: { device_id: 'pat-phone' }, samples: [quantity({ uuid: 'pat-hr' })] });
    await health.removeForUser(jim);
    expect((await health.list(jim, {})).total).toBe(0);
    expect((await health.list(pat, {})).total).toBe(1);
  });
});
