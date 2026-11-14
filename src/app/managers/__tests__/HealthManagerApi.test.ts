/**
 * HealthManager beyond the happy path (yourphr#314): conversions, what is refused and why, FHIR intake,
 * the read side (list, observation, bundle, metrics, series) and the flag-off engine. Synthetic values only.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openStores, type Stores } from '../../../app.js';
import { ApiContext } from '../../../framework/ApiContext.js';
import { HEALTH_SAMPLE_MAX_BATCH, HEALTH_SAMPLE_MAX_REPORTED_ERRORS } from '../HealthManager.js';

type Sample = Record<string, unknown>;

const hk = (type: string, uuid: string, value: number | undefined, unit: string, start = '2026-08-24T12:00:00Z', extra: Sample = {}): Sample => ({
  uuid, type, start, end: start, value, unit, source_name: 'Phone', ...extra,
});

const STEPS = 'HKQuantityTypeIdentifierStepCount';
const HEART = 'HKQuantityTypeIdentifierHeartRate';
const MASS = 'HKQuantityTypeIdentifierBodyMass';
const TEMP = 'HKQuantityTypeIdentifierBodyTemperature';
const SPO2 = 'HKQuantityTypeIdentifierOxygenSaturation';
const SLEEP = 'HKCategoryTypeIdentifierSleepAnalysis';

async function withHealth(fn: (s: Stores, jim: ApiContext) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'health-api-'));
  const stores = await openStores(dir, { YOURPHR_HEALTH_ENABLED: 'true' });
  try {
    await fn(stores, ApiContext.system('test', 'jim', stores.engine));
  } finally {
    await stores.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

async function rejection(s: Stores, jim: ApiContext, sample: Sample): Promise<string> {
  const out = await s.engine.managers.health.ingest(jim, { samples: [sample] });
  expect(out.rejected).toBe(1);
  expect(out.stored).toBe(0);
  return out.errors?.[0]?.reason ?? '';
}

describe('the flag off', () => {
  it('registers no health manager, opens no phd-samples.db, and stays off for an explicit false', async () => {
    for (const env of [{}, { YOURPHR_HEALTH_ENABLED: 'false' }]) {
      const dir = mkdtempSync(join(tmpdir(), 'health-off-'));
      const stores = await openStores(dir, env);
      try {
        expect(stores.engine.has('health')).toBe(false);
        expect(existsSync(join(dir, 'phd-samples.db'))).toBe(false);
      } finally {
        await stores.close();
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('creates phd-samples.db once the flag is on', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'health-on-'));
    const stores = await openStores(dir, { YOURPHR_HEALTH_ENABLED: 'true' });
    try {
      expect(stores.engine.has('health')).toBe(true);
      expect(existsSync(join(dir, 'phd-samples.db'))).toBe(true);
    } finally {
      await stores.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('unit conversion on ingest', () => {
  it('stores pounds as kilograms, Fahrenheit as Celsius, and a HealthKit oxygen fraction as a percent, keeping the unit the sender wrote', async () => {
    await withHealth(async (s, jim) => {
      const health = s.engine.managers.health;
      const out = await health.ingest(jim, {
        samples: [
          hk(MASS, 'w', 150, 'lb', '2026-08-24T08:00:00Z'),
          hk(TEMP, 't', 98.6, 'degF', '2026-08-24T09:00:00Z'),
          hk(SPO2, 'o', 0.97, '%', '2026-08-24T10:00:00Z'),
          hk(HEART, 'h', 72, 'count/min', '2026-08-24T11:00:00Z'),
        ],
      });
      expect(out).toMatchObject({ received: 4, accepted: 4, stored: 4, rejected: 0 });
      const byMetric = Object.fromEntries((await health.list(jim, {})).samples.map((x) => [x.metric_type, x]));
      expect(byMetric['body_mass']).toMatchObject({ unit: 'kg', value_num: 68.039 });
      expect(byMetric['body_temperature']).toMatchObject({ unit: 'Cel', value_num: 37 });
      expect(byMetric['oxygen_saturation']).toMatchObject({ unit: '%', value_num: 97 });
      expect(byMetric['heart_rate']).toMatchObject({ unit: '/min', value_num: 72 });
    });
  });
});

describe('what ingest refuses, and says why', () => {
  it('names the reason for each bad sample and stores the good ones beside them', async () => {
    await withHealth(async (s, jim) => {
      const health = s.engine.managers.health;
      const out = await health.ingest(jim, {
        samples: [
          hk(STEPS, 'ok', 5, 'count'),
          hk(STEPS, 'no-offset', 5, 'count', '2026-08-24T12:00:00'),
          { type: STEPS, start: '2026-08-24T12:00:00Z', value: 5, unit: 'count' },
          { uuid: 'no-type', start: '2026-08-24T12:00:00Z', value: 5 },
          'not an object',
          null,
        ],
      });
      expect(out).toMatchObject({ received: 6, stored: 1, rejected: 5 });
      expect(out.errors?.map((e) => e.reason)).toEqual([
        'start must be RFC 3339 with an explicit offset',
        'uuid is required',
        'type is required',
        'uuid is required',
        'uuid is required',
      ]);
      expect(out.errors?.[0]).toMatchObject({ uuid: 'no-offset', type: STEPS });
    });
  });

  it('refuses a known type sent in a unit the catalog does not accept, a missing value, and a value out of range', async () => {
    await withHealth(async (s, jim) => {
      expect(await rejection(s, jim, hk(STEPS, 'u', 5, 'furlongs'))).toBe('step_count expects unit "{steps}", got "furlongs"');
      expect(await rejection(s, jim, hk(STEPS, 'v', undefined, 'count'))).toBe('step_count requires a numeric value');
      expect(await rejection(s, jim, hk(HEART, 'r', 900, 'count/min'))).toMatch(/heart_rate value 900 is outside 1–400/);
      expect(await rejection(s, jim, hk(TEMP, 'f', 212, 'degF'))).toMatch(/body_temperature value 100 is outside 25–45/);
      expect(await rejection(s, jim, hk(MASS, 'm', 150, 'stone'))).toMatch(/body_mass expects unit "kg"/);
    });
  });

  it('refuses an end before the start, an over-long field, and metadata that cannot be saved', async () => {
    await withHealth(async (s, jim) => {
      expect(await rejection(s, jim, hk(STEPS, 'e', 5, 'count', '2026-08-24T12:00:00Z', { end: '2026-08-24T11:00:00Z' }))).toBe('end is before start');
      expect(await rejection(s, jim, hk(STEPS, 'n', 5, 'count', '2026-08-24T12:00:00Z', { source_name: 'x'.repeat(201) }))).toBe('source_name is longer than 200 characters');
      expect(await rejection(s, jim, hk(STEPS, 'l', 5, 'count', '2026-08-24T12:00:00Z', { uuid: 'u'.repeat(201) }))).toBe('uuid is longer than 200 characters');
      const circular: Record<string, unknown> = {};
      circular['self'] = circular;
      expect(await rejection(s, jim, hk(STEPS, 'c', 5, 'count', '2026-08-24T12:00:00Z', { metadata: circular }))).toBe('metadata is not serializable');
      // Over-long metadata is refused too. (Its reason text is not asserted: see the report on this PR.)
      await rejection(s, jim, hk(STEPS, 'b', 5, 'count', '2026-08-24T12:00:00Z', { metadata: { note: 'y'.repeat(2100) } }));
    });
  });

  it('refuses a blood-pressure half with no value, a wrong unit, or that is not a half', async () => {
    await withHealth(async (s, jim) => {
      const sys = 'HKQuantityTypeIdentifierBloodPressureSystolic';
      expect(await rejection(s, jim, hk(sys, 'a', undefined, 'mmHg'))).toBe('blood_pressure requires a numeric value');
      expect(await rejection(s, jim, hk(sys, 'b', 120, 'kPa'))).toBe('blood_pressure expects unit "mm[Hg]", got "kPa"');
      expect(await rejection(s, jim, hk(sys, 'c', 700, 'mmHg'))).toMatch(/outside 1–400/);
      expect(await rejection(s, jim, hk('HKCorrelationTypeIdentifierBloodPressure', 'd', 120, 'mmHg'))).toBe('HKCorrelationTypeIdentifierBloodPressure is not a blood-pressure component');
    });
  });

  it('refuses a sleep sample with no stage, and keeps a stage the catalog does not map', async () => {
    await withHealth(async (s, jim) => {
      expect(await rejection(s, jim, { uuid: 'z', type: SLEEP, start: '2026-08-24T02:00:00Z', end: '2026-08-24T03:00:00Z' })).toBe('sleep_stage does not accept value ""');
      const out = await s.engine.managers.health.ingest(jim, {
        samples: [{ uuid: 'inbed', type: SLEEP, start: '2026-08-24T02:00:00Z', end: '2026-08-24T03:00:00Z', value_text: 'inBed' }],
      });
      expect(out.stored).toBe(1);
      const [kept] = (await s.engine.managers.health.list(jim, {})).samples;
      expect(kept).toMatchObject({ metric_type: 'sleep_stage', value_text: 'inBed' });
      expect(kept?.code).toBeUndefined();
    });
  });

  it('stores a type the catalog has never heard of, with no code, rather than losing it', async () => {
    await withHealth(async (s, jim) => {
      const out = await s.engine.managers.health.ingest(jim, {
        samples: [hk('HKQuantityTypeIdentifierMysteryNew', 'new', 3.5, 'widgets'), { uuid: 'bare', type: 'Whatever', start: '2026-08-24T12:00:00Z' }],
      });
      expect(out).toMatchObject({ stored: 2, rejected: 0 });
      const listed = (await s.engine.managers.health.list(jim, { vendorType: 'HKQuantityTypeIdentifierMysteryNew' })).samples;
      expect(listed[0]).toMatchObject({ vendor_type: 'HKQuantityTypeIdentifierMysteryNew', value_num: 3.5, unit: 'widgets', metric_type: '' });
      expect(listed[0]?.code).toBeUndefined();
    });
  });

  it('caps the rejections it lists at 50 while still counting every one', async () => {
    await withHealth(async (s, jim) => {
      const bad = Array.from({ length: HEALTH_SAMPLE_MAX_REPORTED_ERRORS + 10 }, (_, i) => hk(STEPS, `bad-${i}`, 1, 'furlongs'));
      const out = await s.engine.managers.health.ingest(jim, { samples: bad });
      expect(out.rejected).toBe(HEALTH_SAMPLE_MAX_REPORTED_ERRORS + 10);
      expect(out.errors).toHaveLength(HEALTH_SAMPLE_MAX_REPORTED_ERRORS);
    });
  });

  it('refuses a batch over the limit, and samples that are not a list, before reading either', async () => {
    await withHealth(async (s, jim) => {
      const health = s.engine.managers.health;
      await expect(health.ingest(jim, { samples: new Array(HEALTH_SAMPLE_MAX_BATCH + 1).fill({}) })).rejects.toMatchObject({ status: 400 });
      await expect(health.ingest(jim, { samples: 'nope' })).rejects.toMatchObject({ status: 400, message: 'invalid request: samples must be an array' });
      await expect(health.ingest(jim, { samples: { a: 1 } })).rejects.toMatchObject({ status: 400 });
      expect((await health.list(jim, {})).total).toBe(0);
    });
  });

  it('refuses a device credential on every path that writes, and an unauthenticated caller everywhere', async () => {
    await withHealth(async (s, jim) => {
      const health = s.engine.managers.health;
      const device = ApiContext.agent('jim', { id: 'tok', name: 'Phone', scopes: ['Health samples (add)'], grantId: 'grant-1' }, s.engine);
      await expect(health.ingest(device, { samples: [] })).rejects.toMatchObject({ status: 403 });
      expect((await health.list(jim, {})).total).toBe(0);
      const anon = ApiContext.anonymous(s.engine);
      await expect(health.list(anon, {})).rejects.toMatchObject({ status: 401 });
      await expect(health.ingest(anon, { samples: [] })).rejects.toMatchObject({ status: 401 });
    });
  });

  it('refuses more than 32 anchors, and an anchor over 1024 characters, and skips a blank metric name', async () => {
    await withHealth(async (s, jim) => {
      const health = s.engine.managers.health;
      const many = Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`m${i}`, 'a']));
      await expect(health.ingest(jim, { samples: [], anchors: many })).rejects.toMatchObject({ status: 400, message: 'at most 32 anchors' });
      await expect(health.ingest(jim, { samples: [], anchors: { step_count: 'a'.repeat(1025) } })).rejects.toMatchObject({ status: 400 });
      await health.ingest(jim, { samples: [], anchors: { '  ': 'ignored', step_count: 'kept' }, device: { device_id: 'dev-1', name: 'Band' } });
      expect(await health.syncState(jim)).toMatchObject([{ device_id: 'dev-1', metric_type: 'step_count', anchor: 'kept', device_name: 'Band' }]);
    });
  });

  it('takes an anchor\'s last sample time from the batch, by the catalog name, and leaves it empty for a metric not in the batch', async () => {
    await withHealth(async (s, jim) => {
      const health = s.engine.managers.health;
      await health.ingest(jim, {
        samples: [hk(STEPS, 'a', 1, 'count', '2026-08-24T10:00:00Z'), hk(STEPS, 'b', 1, 'count', '2026-08-24T12:00:00Z'), hk(STEPS, 'c', 1, 'count', '2026-08-24T11:00:00Z')],
        anchors: { step_count: 'x', heart_rate: 'y', unknown_metric: 'z', blood_pressure_systolic: 'w' },
        device: { device_id: 'dev-1' },
      });
      const states = Object.fromEntries((await health.syncState(jim, ' dev-1 ')).map((x) => [x.metric_type, x]));
      expect(states['step_count']?.last_sample_end_time).toBe('2026-08-24T12:00:00Z');
      expect(states['heart_rate']).not.toHaveProperty('last_sample_end_time');
      expect(states['unknown_metric']).not.toHaveProperty('last_sample_end_time');
      expect(await health.syncState(jim, 'other-device')).toEqual([]);
    });
  });

  it('files every upload under one device source named "Uploaded by you", however many batches', async () => {
    await withHealth(async (s, jim) => {
      const health = s.engine.managers.health;
      await health.ingest(jim, { samples: [hk(STEPS, 'a', 1, 'count', '2026-08-24T10:00:00Z')] });
      await health.ingest(jim, { samples: [hk(STEPS, 'b', 1, 'count', '2026-08-25T10:00:00Z')] });
      const sources = (await s.engine.managers.sources.list(jim)).filter((x) => x.display === 'Uploaded by you');
      expect(sources).toHaveLength(1);
      expect((await health.syncState(jim)).length).toBe(0);
    });
  });
});

describe('blood pressure pairing', () => {
  const half = (uuid: string, type: string, value: number, corr: string, start = '2026-08-24T08:00:00Z') => hk(type, uuid, value, 'mmHg', start, { correlation_uuid: corr });
  const SYS = 'HKQuantityTypeIdentifierBloodPressureSystolic';
  const DIA = 'HKQuantityTypeIdentifierBloodPressureDiastolic';

  it('joins both halves in one batch into one reading spanning both times, and writes one Observation for it', async () => {
    await withHealth(async (s, jim) => {
      const health = s.engine.managers.health;
      const out = await health.ingest(jim, {
        samples: [half('sys', SYS, 118, 'corr-1', '2026-08-24T08:00:05Z'), half('dia', DIA, 76, 'corr-1', '2026-08-24T08:00:00Z')],
      });
      expect(out).toMatchObject({ received: 2, accepted: 1, stored: 1 });
      const listed = await health.list(jim, { metricTypes: ['blood_pressure'] });
      expect(listed.total).toBe(1);
      expect(listed.samples[0]).toMatchObject({ external_uuid: 'corr-1', vendor_type: 'HKCorrelationTypeIdentifierBloodPressure', start_time: '2026-08-24T08:00:00Z', end_time: '2026-08-24T08:00:05Z' });
      expect(listed.samples[0]?.components?.map((c) => [c.code, c.value])).toEqual([['8480-6', 118], ['8462-4', 76]]);
      const written = (await s.records.list(jim, 'Observation')).filter((r) => String(r['source_resource_id']).startsWith('pghd-corr-1'));
      expect(written).toHaveLength(1);
    });
  });

  it('keeps two readings with different correlation ids apart, and a half with none as its own row', async () => {
    await withHealth(async (s, jim) => {
      const health = s.engine.managers.health;
      await health.ingest(jim, {
        samples: [
          half('s1', SYS, 120, 'c1'), half('d1', DIA, 80, 'c1'),
          half('s2', SYS, 130, 'c2', '2026-08-24T09:00:00Z'), half('d2', DIA, 85, 'c2', '2026-08-24T09:00:00Z'),
          hk(SYS, 'lone', 140, 'mmHg', '2026-08-24T10:00:00Z'),
        ],
      });
      const listed = (await health.list(jim, { metricTypes: ['blood_pressure'], sort: 'asc' })).samples;
      expect(listed.map((x) => x.external_uuid)).toEqual(['c1', 'c2', 'lone']);
    });
  });

  it('a corrected half replaces the earlier one in the stored reading, and the old half rows stop showing', async () => {
    await withHealth(async (s, jim) => {
      const health = s.engine.managers.health;
      await health.ingest(jim, { samples: [half('s', SYS, 120, 'c1'), half('d', DIA, 80, 'c1')] });
      await health.ingest(jim, { samples: [half('d', DIA, 90, 'c1')] });
      const listed = (await health.list(jim, { metricTypes: ['blood_pressure'] })).samples;
      expect(listed).toHaveLength(1);
      expect(listed[0]?.components?.map((c) => [c.code, c.value]).sort()).toEqual([['8462-4', 90], ['8480-6', 120]]);
    });
  });
});

describe('FHIR intake', () => {
  const heart = (id: string, value: number, extra: Sample = {}): Sample => ({
    resourceType: 'Observation',
    status: 'final',
    identifier: [{ system: 'urn:test', value: id }],
    code: { coding: [{ system: 'http://loinc.org', code: '8867-4' }] },
    effectiveDateTime: '2026-08-24T12:00:00-04:00',
    valueQuantity: { value, unit: 'beats/minute', code: '/min' },
    ...extra,
  });

  it('takes a collection Bundle of Observations, keeps the identifier system and the offset, and rebuilds an Observation on read', async () => {
    await withHealth(async (s, jim) => {
      const health = s.engine.managers.health;
      const out = await health.ingest(jim, {
        resourceType: 'Bundle',
        entry: [{ resource: heart('hr-1', 64, { meta: { source: 'https://example.test/device' }, device: { display: 'Band' } }) }, { resource: undefined }, null],
      });
      expect(out).toMatchObject({ received: 1, stored: 1, rejected: 0 });
      const [item] = (await health.list(jim, {})).samples;
      expect(item).toMatchObject({ identifier_system: 'urn:test', external_uuid: 'hr-1', metric_type: 'heart_rate', value_num: 64, unit: '/min', device_name: 'Band', source_name: 'https://example.test/device' });
      const obs = await health.observation(jim, item!.id);
      expect(obs).toMatchObject({ resourceType: 'Observation', status: 'final', effectiveDateTime: '2026-08-24T16:00:00Z', meta: { source: 'https://example.test/device' } });
      expect(obs.code?.coding?.[0]).toMatchObject({ system: 'http://loinc.org', code: '8867-4', display: 'Heart rate' });
      expect(obs.valueQuantity).toMatchObject({ value: 64, unit: 'beats/minute' });
    });
  });

  it('ignores a Bundle that is not a Bundle, or has no entries, and reads a period', async () => {
    await withHealth(async (s, jim) => {
      const health = s.engine.managers.health;
      expect(await health.ingest(jim, { resourceType: 'Bundle' })).toMatchObject({ received: 0, stored: 0 });
      expect(await health.ingest(jim, { resourceType: 'Bundle', entry: 'x' })).toMatchObject({ received: 0 });
      expect(await health.ingest(jim, { resourceType: 'Patient', entry: [{ resource: heart('x', 1) }] })).toMatchObject({ received: 0 });
      const out = await health.ingest(jim, {
        samples: [heart('p', 70, { effectiveDateTime: undefined, effectivePeriod: { start: '2026-08-24T08:00:00Z', end: '2026-08-24T09:00:00Z' } })],
      });
      expect(out.stored).toBe(1);
      const [item] = (await health.list(jim, {})).samples;
      expect(item).toMatchObject({ start_time: '2026-08-24T08:00:00Z', end_time: '2026-08-24T09:00:00Z' });
      const obs = await health.observation(jim, item!.id);
      expect(obs.effectivePeriod).toEqual({ start: '2026-08-24T08:00:00Z', end: '2026-08-24T09:00:00Z' });
    });
  });

  it('refuses an Observation with no identifier, no time, a value the catalog cannot take, or no components for a panel', async () => {
    await withHealth(async (s, jim) => {
      expect(await rejection(s, jim, heart('', 70, { identifier: undefined }))).toBe('identifier or uuid is required');
      expect(await rejection(s, jim, heart('t', 70, { effectiveDateTime: undefined }))).toBe('start is required');
      expect(await rejection(s, jim, heart('nv', 70, { valueQuantity: undefined }))).toBe('heart_rate requires a numeric value');
      expect(await rejection(s, jim, heart('u', 70, { valueQuantity: { value: 70, unit: 'bananas' } }))).toBe('heart_rate expects unit "/min", got "bananas"');
      expect(await rejection(s, jim, heart('p', 70, { code: { coding: [{ code: '85354-9' }] }, valueQuantity: undefined }))).toBe('blood_pressure requires component values');
    });
  });

  it('keeps a blood-pressure panel with its components, converting a component unit written with a different spelling', async () => {
    await withHealth(async (s, jim) => {
      const health = s.engine.managers.health;
      const out = await health.ingest(jim, {
        samples: [{
          resourceType: 'Observation',
          identifier: [{ value: 'bp-1' }],
          code: { coding: [{ system: 'http://loinc.org', code: '85354-9', display: 'Blood pressure' }] },
          effectiveDateTime: '2026-08-24T08:00:00Z',
          component: [
            { code: { coding: [{ code: '8480-6', display: 'Systolic' }] }, valueQuantity: { value: 125, unit: 'mmHg' } },
            { code: { coding: [{ code: '8462-4' }] }, valueQuantity: { value: 82 } },
            { code: { coding: [{ code: '8462-4' }] } },
            'junk',
          ],
        }],
      });
      expect(out).toMatchObject({ stored: 1, rejected: 0 });
      const [item] = (await health.list(jim, {})).samples;
      expect(item?.components).toEqual([
        { code: '8480-6', display: 'Systolic', value: 125, unit: 'mm[Hg]' },
        { code: '8462-4', value: 82, unit: 'mm[Hg]' },
      ]);
      expect(item?.identifier_system).toBe('urn:uuid');
    });
  });

  it('reads a sleep stage by its LOINC code, retracts an entered-in-error reading, and keeps a code it does not know', async () => {
    await withHealth(async (s, jim) => {
      const health = s.engine.managers.health;
      const stage = (id: string, status: string): Sample => ({
        resourceType: 'Observation', status, identifier: [{ value: id }],
        code: { coding: [{ system: 'http://loinc.org', code: '93828-2' }] },
        effectivePeriod: { start: '2026-08-24T02:00:00Z', end: '2026-08-24T03:00:00Z' },
        valueCodeableConcept: { coding: [{ system: 'http://loinc.org', code: '93831-6' }] },
      });
      await health.ingest(jim, { samples: [stage('st-1', 'final')] });
      const [first] = (await health.list(jim, { metricTypes: ['sleep_stage'] })).samples;
      expect(first).toMatchObject({ metric_type: 'sleep_stage', code: '93831-6', value_text: '93831-6' });
      await health.ingest(jim, { samples: [stage('st-1', 'entered-in-error')] });
      expect((await health.list(jim, { metricTypes: ['sleep_stage'] })).total).toBe(0);

      const out = await health.ingest(jim, {
        samples: [
          {
            resourceType: 'Observation', identifier: [{ value: 'x1' }], code: { coding: [{ system: 'urn:acme', code: 'GLUCOSE', display: 'Glucose' }] },
            effectiveDateTime: '2026-08-24T08:00:00Z', valueQuantity: { value: 5.4, unit: 'mmol/L' },
          },
          {
            resourceType: 'Observation', identifier: [{ value: 'x2' }], code: { coding: [{ system: 'urn:acme', code: 'COLOR' }] },
            effectiveDateTime: '2026-08-24T08:00:00Z', valueCodeableConcept: { coding: [{ code: 'red' }] },
          },
          {
            resourceType: 'Observation', identifier: [{ value: 'x3' }], code: { coding: [{ system: 'urn:acme', code: 'PANEL' }] },
            effectiveDateTime: '2026-08-24T08:00:00Z', component: [{ code: { coding: [{ code: 'A' }] }, valueQuantity: { value: 1, unit: 'u' } }],
          },
          { resourceType: 'Observation', identifier: [{ value: 'x4' }], code: { coding: [{ system: 'urn:acme', code: 'BARE' }] }, effectiveDateTime: '2026-08-24T08:00:00Z', value: 9, unit: ' kg ', value_text: ' text ' },
        ],
      });
      expect(out).toMatchObject({ stored: 4, rejected: 0 });
      const byUuid = Object.fromEntries((await health.list(jim, {})).samples.map((x) => [x.external_uuid, x]));
      expect(byUuid['x1']).toMatchObject({ code: 'GLUCOSE', code_system: 'urn:acme', value_num: 5.4, unit: 'mmol/L', metric_type: '' });
      expect(byUuid['x2']).toMatchObject({ code: 'COLOR', value_text: 'red' });
      expect(byUuid['x3']?.components).toEqual([{ code: 'A', value: 1, unit: 'u' }]);
      expect(byUuid['x4']).toMatchObject({ value_num: 9, unit: 'kg', value_text: 'text' });
    });
  });

  it('refuses a stage value the catalog does not know and keeps the Observation only when the metric takes free text', async () => {
    await withHealth(async (s, jim) => {
      const base: Sample = {
        resourceType: 'Observation', identifier: [{ value: 'st' }], code: { coding: [{ system: 'http://loinc.org', code: '93828-2' }] },
        effectiveDateTime: '2026-08-24T02:00:00Z',
      };
      expect(await rejection(s, jim, base)).toBe('sleep_stage does not accept value ""');
      const out = await s.engine.managers.health.ingest(jim, { samples: [{ ...base, valueCodeableConcept: { coding: [{ code: 'napping' }] } }] });
      expect(out.stored).toBe(1);
      expect((await s.engine.managers.health.list(jim, {})).samples[0]).toMatchObject({ value_text: 'napping' });
    });
  });
});

describe('the read side', () => {
  it('refuses a limit or offset that is not a number, and a time without an offset', async () => {
    await withHealth(async (s, jim) => {
      const health = s.engine.managers.health;
      await expect(health.list(jim, { limit: 'many' })).rejects.toMatchObject({ status: 400, message: 'limit must be an integer' });
      await expect(health.list(jim, { offset: 'x' })).rejects.toMatchObject({ status: 400, message: 'offset must be an integer' });
      await expect(health.list(jim, { startAfter: '2026-08-24T00:00:00' })).rejects.toMatchObject({ status: 400, message: 'start_after must be RFC 3339 with an explicit offset' });
      await expect(health.list(jim, { startBefore: 5 })).rejects.toMatchObject({ status: 400 });
      await expect(health.bundle(jim, { startBefore: 'tomorrow' })).rejects.toMatchObject({ status: 400 });
    });
  });

  it('pages, sorts, filters by window and by code or vendor type, and clamps an absurd limit', async () => {
    await withHealth(async (s, jim) => {
      const health = s.engine.managers.health;
      await health.ingest(jim, {
        samples: [
          hk(STEPS, 'a', 1, 'count', '2026-08-24T10:00:00Z'),
          hk(STEPS, 'b', 2, 'count', '2026-08-25T10:00:00Z'),
          hk(STEPS, 'c', 3, 'count', '2026-08-26T10:00:00Z'),
          hk(HEART, 'h', 60, 'count/min', '2026-08-25T11:00:00Z'),
        ],
      });
      const uuids = async (q: Parameters<typeof health.list>[1]) => (await health.list(jim, q)).samples.map((x) => x.external_uuid);
      expect(await uuids({ codes: ['55423-8'] })).toEqual(['c', 'b', 'a']);
      expect(await uuids({ codes: ['55423-8'], sort: 'ASC' })).toEqual(['a', 'b', 'c']);
      expect(await uuids({ vendorType: HEART })).toEqual(['h']);
      expect(await uuids({ metricTypes: ['step_count'], startAfter: '2026-08-25T00:00:00+00:00', startBefore: '2026-08-26T00:00:00Z', sort: 'asc' })).toEqual(['b']);
      const page = await health.list(jim, { metricTypes: ['step_count'], limit: 1, offset: 1, sort: 'asc' });
      expect(page).toMatchObject({ total: 3, count: 1, offset: 1 });
      expect(page.samples[0]?.external_uuid).toBe('b');
      expect((await health.list(jim, { limit: 99999999 })).count).toBe(4);
      expect((await health.list(jim, { limit: -3, offset: -9 })).offset).toBe(0);
    });
  });

  it('returns one Observation by id, 404 for an id that is not this account\'s, and a Bundle of them', async () => {
    await withHealth(async (s, jim) => {
      const health = s.engine.managers.health;
      await health.ingest(jim, { samples: [hk(STEPS, 'a', 1, 'count', '2026-08-24T10:00:00Z'), hk(STEPS, 'b', 2, 'count', '2026-08-25T10:00:00Z')] });
      const [first] = (await health.list(jim, { sort: 'asc' })).samples;
      const obs = await health.observation(jim, first!.id);
      expect(obs.id).toBe(first!.id);
      expect(obs.subject?.reference).toMatch(/^Patient\//);
      await expect(health.observation(jim, 'no-such-id')).rejects.toMatchObject({ status: 404 });
      const pat = ApiContext.system('test', 'pat', s.engine);
      await expect(health.observation(pat, first!.id)).rejects.toMatchObject({ status: 404 });
      const bundle = await health.bundle(jim, { metricTypes: ['step_count'] });
      expect(bundle).toMatchObject({ resourceType: 'Bundle', type: 'collection' });
      expect(bundle.entry?.map((e) => e.resource?.effectiveDateTime)).toEqual(['2026-08-24T10:00:00Z', '2026-08-25T10:00:00Z']);
      expect((await health.bundle(pat, {})).entry).toEqual([]);
    });
  });

  it('summarises metrics with the time of the last sync across devices', async () => {
    await withHealth(async (s, jim) => {
      const health = s.engine.managers.health;
      expect(await health.metrics(jim)).toEqual({ metrics: [] });
      await health.ingest(jim, { samples: [hk(STEPS, 'a', 1, 'count')], anchors: { step_count: 'a' }, device: { device_id: 'd1' } });
      const out = await health.metrics(jim);
      expect(out.metrics.map((m) => m.metric_type)).toEqual(['step_count']);
      expect(out.last_synced_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });
});

describe('series', () => {
  const day = (n: number): string => new Date(Date.UTC(2026, 5, 1 + n, 12)).toISOString().replace(/\.\d{3}Z$/, 'Z');

  it('refuses a mode it does not know, a query that names nothing, and a max_points that is not a number', async () => {
    await withHealth(async (s, jim) => {
      const health = s.engine.managers.health;
      await expect(health.series(jim, { metricTypes: ['step_count'], mode: 'weekly' })).rejects.toMatchObject({ status: 400, message: 'mode must be points, day, daily-stats, or stages' });
      await expect(health.series(jim, {})).rejects.toMatchObject({ status: 400, message: 'code, metric_type, or vendor_type is required' });
      await expect(health.series(jim, { metricTypes: ['step_count'], maxPoints: 'lots' })).rejects.toMatchObject({ status: 400 });
      await expect(health.series(jim, { metricTypes: ['step_count'], startAfter: 'yesterday' })).rejects.toMatchObject({ status: 400 });
    });
  });

  it('reads raw points for a high-frequency metric from the sample store, and for a type the catalog does not know', async () => {
    await withHealth(async (s, jim) => {
      const health = s.engine.managers.health;
      await health.ingest(jim, {
        samples: [
          hk(HEART, 'h1', 60, 'count/min', '2026-08-24T10:00:00Z'),
          hk(HEART, 'h2', 80, 'count/min', '2026-08-24T11:00:00Z'),
          hk('HKQuantityTypeIdentifierMysteryNew', 'm1', 3, 'widgets', '2026-08-24T10:00:00Z'),
        ],
      });
      const hr = await health.series(jim, { metricTypes: ['heart_rate'], startAfter: '2026-08-24T00:00:00Z', startBefore: '2026-08-25T00:00:00Z' });
      expect(hr).toMatchObject({ total: 2, unit: '/min', stats: { min: 60, max: 80, avg: 70 } });
      expect(hr.points?.map((p) => p.v)).toEqual([60, 80]);
      const unknown = await health.series(jim, { vendorType: 'HKQuantityTypeIdentifierMysteryNew', startAfter: '2026-08-24T00:00:00Z' });
      expect(unknown.points).toEqual([{ t: '2026-08-24T10:00:00Z', v: 3 }]);
    });
  });

  it('defaults to the last 30 days when no window is given', async () => {
    await withHealth(async (s, jim) => {
      const health = s.engine.managers.health;
      const recent = new Date(Date.now() - 2 * 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
      const old = new Date(Date.now() - 90 * 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
      await health.ingest(jim, { samples: [hk(HEART, 'r', 70, 'count/min', recent), hk(HEART, 'o', 99, 'count/min', old)] });
      const out = await health.series(jim, { metricTypes: ['heart_rate'] });
      expect(out.points?.map((p) => p.v)).toEqual([70]);
    });
  });

  it('charts a daily total from the daily Observations, and sums days into weeks when the window is over 45 days', async () => {
    await withHealth(async (s, jim) => {
      const health = s.engine.managers.health;
      await health.ingest(jim, { samples: Array.from({ length: 14 }, (_, i) => hk(STEPS, `s${i}`, 1000 * (i + 1), 'count', day(i))) });
      const daily = await health.series(jim, { metricTypes: ['step_count'], mode: 'day', startAfter: '2026-06-01T00:00:00Z', startBefore: '2026-06-20T00:00:00Z' });
      expect(daily.total).toBe(14);
      expect(daily.daily).toHaveLength(14);
      expect(daily.daily?.[0]).toMatchObject({ date: '2026-06-01', value: 1000, n: 1 });
      expect(daily.downsampled).toBe(false);

      const weekly = await health.series(jim, { metricTypes: ['step_count'], mode: 'day', startAfter: '2026-06-01T00:00:00Z', startBefore: '2026-08-01T00:00:00Z' });
      expect(weekly.downsampled).toBe(true);
      // 2026-06-01 is a Monday: days 1–7 are one week (1000+…+7000), days 8–14 the next.
      expect(weekly.daily).toEqual([
        { date: '2026-06-01', value: 28000, n: 7 },
        { date: '2026-06-08', value: 77000, n: 7 },
      ]);

      const monthly = await health.series(jim, { metricTypes: ['step_count'], mode: 'day', startAfter: '2026-06-01T00:00:00Z', startBefore: '2027-01-01T00:00:00Z' });
      expect(monthly.daily).toEqual([{ date: '2026-06-01', value: 105000, n: 14 }]);
    });
  });

  it('averages the daily means over a long window for daily-stats, with the day\'s minimum and maximum', async () => {
    await withHealth(async (s, jim) => {
      const health = s.engine.managers.health;
      await health.ingest(jim, {
        samples: [
          hk(HEART, 'a', 60, 'count/min', '2026-06-01T08:00:00Z'), hk(HEART, 'b', 100, 'count/min', '2026-06-01T20:00:00Z'),
          hk(HEART, 'c', 70, 'count/min', '2026-06-02T08:00:00Z'),
        ],
      });
      const short = await health.series(jim, { metricTypes: ['heart_rate'], mode: 'daily-stats', startAfter: '2026-06-01T00:00:00Z', startBefore: '2026-06-10T00:00:00Z' });
      expect(short.daily).toEqual([
        { date: '2026-06-01', value: 80, min: 60, max: 100, n: 1 },
        { date: '2026-06-02', value: 70, min: 70, max: 70, n: 1 },
      ]);
      const long = await health.series(jim, { metricTypes: ['heart_rate'], mode: 'daily-stats', startAfter: '2026-06-01T00:00:00Z', startBefore: '2026-09-01T00:00:00Z' });
      expect(long.daily).toEqual([{ date: '2026-06-01', value: 75, n: 2 }]);
    });
  });

  it('charts spot readings as points, blood pressure as one line per component, and sleep as stage hours per night', async () => {
    await withHealth(async (s, jim) => {
      const health = s.engine.managers.health;
      await health.ingest(jim, {
        samples: [
          hk(MASS, 'w1', 150, 'lb', '2026-08-24T08:00:00Z'),
          hk(MASS, 'w2', 152, 'lb', '2026-08-25T08:00:00Z'),
          hk('HKQuantityTypeIdentifierBloodPressureSystolic', 's', 120, 'mmHg', '2026-08-24T09:00:00Z', { correlation_uuid: 'c1' }),
          hk('HKQuantityTypeIdentifierBloodPressureDiastolic', 'd', 80, 'mmHg', '2026-08-24T09:00:00Z', { correlation_uuid: 'c1' }),
          { uuid: 'z1', type: SLEEP, start: '2026-08-24T02:00:00Z', end: '2026-08-24T03:30:00Z', value_text: 'asleepDeep' },
          { uuid: 'z2', type: SLEEP, start: '2026-08-24T04:00:00Z', end: '2026-08-24T05:00:00Z', value_text: 'asleepREM' },
        ],
      });
      const window = { startAfter: '2026-08-24T00:00:00Z', startBefore: '2026-08-26T00:00:00Z' };
      const weight = await health.series(jim, { metricTypes: ['body_mass'], ...window });
      // Compared by time: the order the Observations come back in is the records store's, not the chart's.
      const byTime = [...(weight.points ?? [])].sort((a, b) => a.t.localeCompare(b.t));
      expect(byTime.map((p) => [p.t, Math.round(p.v)])).toEqual([['2026-08-24T00:00:00Z', 68], ['2026-08-25T00:00:00Z', 69]]);

      const pressure = await health.series(jim, { metricTypes: ['blood_pressure'], ...window });
      expect(pressure.points).toBeUndefined();
      expect(pressure.components?.['8480-6']).toEqual([{ t: '2026-08-24T00:00:00Z', v: 120 }]);
      expect(pressure.components?.['8462-4']).toEqual([{ t: '2026-08-24T00:00:00Z', v: 80 }]);

      const sleep = await health.series(jim, { metricTypes: ['sleep_stage'], mode: 'stages', ...window });
      expect(sleep.nights).toHaveLength(1);
      expect(sleep.nights?.[0]?.date).toBe('2026-08-24');
      expect(sleep.nights?.[0]?.stages['93831-6']).toBeCloseTo(1.5, 5);
      expect(sleep.nights?.[0]?.stages['93829-0']).toBeCloseTo(1, 5);
    });
  });

  it('leaves a day out of the chart when its Observation was retracted, or falls outside the window', async () => {
    await withHealth(async (s, jim) => {
      const health = s.engine.managers.health;
      await health.ingest(jim, { samples: [hk(STEPS, 'a', 100, 'count', '2026-08-24T10:00:00Z'), hk(STEPS, 'b', 200, 'count', '2026-08-25T10:00:00Z'), hk(STEPS, 'c', 300, 'count', '2026-08-26T10:00:00Z')] });
      await health.ingest(jim, { samples: [hk(STEPS, 'b', 200, 'count', '2026-08-25T10:00:00Z', { metadata: { deleted: true } })] });
      const out = await health.series(jim, { metricTypes: ['step_count'], mode: 'day', startAfter: '2026-08-24T00:00:00Z', startBefore: '2026-08-26T00:00:00Z' });
      expect(out.daily?.map((d) => [d.date, d.value])).toEqual([['2026-08-24', 100]]);
      expect(out.total).toBe(1);
    });
  });
});
