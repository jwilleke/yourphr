/**
 * phd-samples.db opens with the same SQLCipher key as the other databases (yourphr#314).
 * A missing or wrong key does not fall back to a clear file.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqlitePhdSamplesProvider } from '../SqlitePhdSamplesProvider.js';
import type { HealthSampleQuery, HealthSampleRow, HealthSeriesQuery } from '../BaseHealthProvider.js';

function row(): HealthSampleRow {
  return {
    id: 'row-1', userId: '', externalUuid: 'ext-1', identifierSystem: 'urn:uuid', adapter: 'healthkit',
    vendorType: 'HKQuantityTypeIdentifierStepCount', metricType: 'step_count', codeSystem: 'http://loinc.org',
    code: '55423-8', category: 'activity', subject: '', startTime: '2026-08-24T12:00:00Z', endTime: '2026-08-24T12:00:00Z',
    tzOffset: 'Z', localDay: '2026-08-24', valueNum: 10, unit: '{steps}', originalUnit: 'count', valueText: '',
    valueSystem: '', components: '', correlationUuid: '', sourceName: 'Phone', sourceBundleId: '', deviceName: '',
    sourceId: 'source-1', metadata: '', deleted: false,
  };
}

describe('SqlitePhdSamplesProvider encryption', () => {
  it('reads back under the key it was written with, and refuses the file without that key', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'phd-key-'));
    const file = join(dir, 'phd-samples.db');
    const writer = new SqlitePhdSamplesProvider(file, 'unit-key');
    try {
      expect(await writer.insertSamples('jim', [row()])).toBe(1);
    } finally {
      await writer.close();
    }
    const reader = new SqlitePhdSamplesProvider(file, 'unit-key');
    try {
      expect((await reader.listSamples('jim', { codes: [], metricTypes: [], vendorType: '', limit: 10, offset: 0, sortAscending: true })).total).toBe(1);
    } finally {
      await reader.close();
    }
    expect(() => new SqlitePhdSamplesProvider(file, '')).toThrow();
    expect(() => new SqlitePhdSamplesProvider(file, 'other-key')).toThrow();
    rmSync(dir, { recursive: true, force: true });
  });
});

const everything: HealthSampleQuery = { codes: [], metricTypes: [], vendorType: '', limit: 100, offset: 0, sortAscending: true };

function sample(over: Partial<HealthSampleRow>): HealthSampleRow {
  return { ...row(), ...over };
}

function seriesQuery(over: Partial<HealthSeriesQuery>): HealthSeriesQuery {
  return { codes: [], metricTypes: [], vendorType: '', maxPoints: 100, mode: 'points', ...over };
}

const bp = (id: string, start: string, sys: number, dia: number, over: Partial<HealthSampleRow> = {}) => sample({
  id, externalUuid: id, vendorType: 'HKCorrelationTypeIdentifierBloodPressure', metricType: 'blood_pressure', code: '85354-9',
  category: 'vital-signs', startTime: start, endTime: start, localDay: start.slice(0, 10), valueNum: null, unit: 'mm[Hg]',
  components: JSON.stringify([
    { code: '8480-6', value: sys, unit: 'mm[Hg]' },
    { code: '8462-4', value: dia, unit: 'mm[Hg]' },
  ]),
  ...over,
});

describe('SqlitePhdSamplesProvider storage', () => {
  let dir: string;
  let provider: SqlitePhdSamplesProvider;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'phd-store-'));
    provider = new SqlitePhdSamplesProvider(join(dir, 'phd-samples.db'), 'unit-key');
  });

  afterEach(async () => {
    await provider.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('opens an empty file with no key as a plain database, and writes nothing for an empty batch', async () => {
    const plain = new SqlitePhdSamplesProvider(join(dir, 'plain.db'));
    try {
      expect(await plain.insertSamples('jim', [row()])).toBe(1);
      expect(await plain.insertSamples('jim', [])).toBe(0);
    } finally {
      await plain.close();
    }
  });

  it('writes a sample once, leaves an identical resend alone, and updates one whose value changed', async () => {
    expect(await provider.insertSamples('jim', [sample({ id: 'a', externalUuid: 'e1', valueNum: 10 })])).toBe(1);
    expect(await provider.insertSamples('jim', [sample({ id: 'b', externalUuid: 'e1', valueNum: 10 })])).toBe(0);
    expect(await provider.insertSamples('jim', [sample({ id: 'c', externalUuid: 'e1', valueNum: 25 })])).toBe(1);
    const listed = await provider.listSamples('jim', everything);
    expect(listed.total).toBe(1);
    expect(listed.samples[0]).toMatchObject({ id: 'a', externalUuid: 'e1', valueNum: 25 });
  });

  it('writes a batch larger than one transaction', async () => {
    const rows = Array.from({ length: 600 }, (_, i) => sample({ id: `r${i}`, externalUuid: `e${i}` }));
    expect(await provider.insertSamples('jim', rows)).toBe(600);
    expect((await provider.listSamples('jim', everything)).total).toBe(600);
  });

  it('keeps one account\'s samples invisible to another, by list, read and removal', async () => {
    await provider.insertSamples('jim', [sample({ id: 'jim-1', externalUuid: 'same' })]);
    await provider.insertSamples('pat', [sample({ id: 'pat-1', externalUuid: 'same' })]);
    expect((await provider.listSamples('jim', everything)).samples.map((s) => s.id)).toEqual(['jim-1']);
    expect(await provider.readSample('pat', 'jim-1')).toBeUndefined();
    expect((await provider.readSample('jim', 'jim-1'))?.userId).toBe('jim');
    await provider.removeForOwner('jim');
    expect((await provider.listSamples('jim', everything)).total).toBe(0);
    expect((await provider.listSamples('pat', everything)).total).toBe(1);
  });

  it('filters by code, metric, vendor type and window, pages, and sorts either way', async () => {
    await provider.insertSamples('jim', [
      sample({ id: 'a', externalUuid: 'a', startTime: '2026-08-24T10:00:00Z', valueNum: 1 }),
      sample({ id: 'b', externalUuid: 'b', startTime: '2026-08-25T10:00:00Z', valueNum: 2 }),
      sample({ id: 'c', externalUuid: 'c', startTime: '2026-08-26T10:00:00Z', valueNum: 3 }),
      sample({
        id: 'hr', externalUuid: 'hr', metricType: 'heart_rate', code: '8867-4', vendorType: 'HKQuantityTypeIdentifierHeartRate',
        startTime: '2026-08-25T11:00:00Z', unit: '/min',
      }),
    ]);
    const ids = async (q: Partial<HealthSampleQuery>) => (await provider.listSamples('jim', { ...everything, ...q })).samples.map((s) => s.id);
    expect(await ids({ codes: ['8867-4'] })).toEqual(['hr']);
    expect(await ids({ metricTypes: ['step_count'] })).toEqual(['a', 'b', 'c']);
    expect(await ids({ vendorType: 'HKQuantityTypeIdentifierHeartRate' })).toEqual(['hr']);
    expect(await ids({ startAfter: '2026-08-25T10:00:00Z', startBefore: '2026-08-26T10:00:00Z', metricTypes: ['step_count'] })).toEqual(['b']);
    expect(await ids({ metricTypes: ['step_count'], sortAscending: false })).toEqual(['c', 'b', 'a']);
    const page = await provider.listSamples('jim', { ...everything, metricTypes: ['step_count'], limit: 1, offset: 1 });
    expect(page.samples.map((s) => s.id)).toEqual(['b']);
    expect(page.total).toBe(3);
  });

  it('hides a deleted sample from reads and lists, and a later undelete brings it back', async () => {
    await provider.insertSamples('jim', [sample({ id: 'a', externalUuid: 'e1' })]);
    await provider.insertSamples('jim', [sample({ id: 'a', externalUuid: 'e1', deleted: true })]);
    expect((await provider.listSamples('jim', everything)).total).toBe(0);
    expect(await provider.readSample('jim', 'a')).toBeUndefined();
    expect(await provider.insertSamples('jim', [sample({ id: 'a', externalUuid: 'e1', deleted: false })])).toBe(1);
    expect((await provider.listSamples('jim', everything)).total).toBe(1);
  });

  it('finds the blood-pressure halves that share a correlation id, and the rows of the days asked for', async () => {
    await provider.insertSamples('jim', [
      sample({ id: 'h1', externalUuid: 'h1', correlationUuid: 'corr-1', startTime: '2026-08-24T08:00:00Z' }),
      sample({ id: 'h2', externalUuid: 'h2', correlationUuid: 'corr-1', startTime: '2026-08-24T07:00:00Z' }),
      sample({ id: 'x', externalUuid: 'x', correlationUuid: 'corr-2' }),
      sample({ id: 'd2', externalUuid: 'd2', localDay: '2026-08-25', startTime: '2026-08-25T08:00:00Z' }),
      sample({ id: 'gone', externalUuid: 'gone', correlationUuid: 'corr-1', deleted: true }),
    ]);
    expect((await provider.rowsForCorrelation('jim', 'corr-1')).map((r) => r.id)).toEqual(['h2', 'h1']);
    expect(await provider.rowsForCorrelation('pat', 'corr-1')).toEqual([]);
    expect(await provider.rowsForLocalDays('jim', 'step_count', [])).toEqual([]);
    expect((await provider.rowsForLocalDays('jim', 'step_count', ['2026-08-25'])).map((r) => r.id)).toEqual(['d2']);
    expect((await provider.rowsForLocalDays('jim', 'step_count', ['2026-08-24', '2026-08-25'])).map((r) => r.id)).toEqual(['h2', 'h1', 'x', 'd2']);
  });

  it('summarises each metric by its latest reading, with the earliest time and the count', async () => {
    await provider.insertSamples('jim', [
      sample({ id: 's1', externalUuid: 's1', startTime: '2026-08-24T08:00:00Z', valueNum: 5 }),
      sample({ id: 's2', externalUuid: 's2', startTime: '2026-08-25T08:00:00Z', valueNum: 7, deviceName: 'Band' }),
      bp('bp1', '2026-08-26T08:00:00Z', 120, 80),
      sample({
        id: 'nocode', externalUuid: 'nocode', vendorType: 'HKQuantityTypeIdentifierMystery', metricType: '', code: '', unit: 'u',
        startTime: '2026-08-23T08:00:00Z', valueNum: 3, sourceName: '',
      }),
      sample({
        id: 'sleep', externalUuid: 'sleep', metricType: 'sleep_stage', code: '93831-6', valueNum: null, unit: '', valueText: 'asleepDeep',
        startTime: '2026-08-22T08:00:00Z',
      }),
    ]);
    const summary = await provider.summarizeMetrics('jim');
    expect(summary.map((m) => m.latest_at)).toEqual([
      '2026-08-26T08:00:00Z', '2026-08-25T08:00:00Z', '2026-08-23T08:00:00Z', '2026-08-22T08:00:00Z',
    ]);
    const steps = summary.find((m) => m.metric_type === 'step_count');
    expect(steps).toMatchObject({ code: '55423-8', value_num: 7, sample_count: 2, earliest_at: '2026-08-24T08:00:00Z', device_name: 'Band', source_name: 'Phone' });
    const pressure = summary.find((m) => m.metric_type === 'blood_pressure');
    expect(pressure?.components?.map((c) => c.value)).toEqual([120, 80]);
    expect(pressure).not.toHaveProperty('value_num');
    const stage = summary.find((m) => m.metric_type === 'sleep_stage');
    expect(stage).toMatchObject({ value_text: 'asleepDeep' });
    const unknown = summary.find((m) => m.vendor_type === 'HKQuantityTypeIdentifierMystery');
    expect(unknown).toMatchObject({ code: '', sample_count: 1, unit: 'u', value_num: 3 });
    expect(unknown).not.toHaveProperty('source_name');
    expect(await provider.summarizeMetrics('pat')).toEqual([]);
  });

  describe('series', () => {
    it('is empty, with no stats, for a window that holds nothing', async () => {
      const out = await provider.querySeries('jim', seriesQuery({ metricTypes: ['step_count'] }));
      expect(out).toMatchObject({ total: 0, downsampled: false, metric_type: 'step_count' });
      expect(out.stats).toBeUndefined();
      expect(out.points).toBeUndefined();
      expect((await provider.querySeries('jim', seriesQuery({ mode: 'daily-stats', metricTypes: ['step_count'] }))).daily).toEqual([]);
    });

    it('returns every point when they fit, with stats and the unit', async () => {
      await provider.insertSamples('jim', [
        sample({ id: 'a', externalUuid: 'a', startTime: '2026-08-24T10:00:00Z', valueNum: 2 }),
        sample({ id: 'b', externalUuid: 'b', startTime: '2026-08-24T11:00:00Z', valueNum: 6 }),
      ]);
      const out = await provider.querySeries('jim', seriesQuery({ codes: ['55423-8'], vendorType: 'HKQuantityTypeIdentifierStepCount' }));
      expect(out).toMatchObject({ total: 2, downsampled: false, code: '55423-8', vendor_type: 'HKQuantityTypeIdentifierStepCount', unit: '{steps}' });
      expect(out.stats).toEqual({ min: 2, max: 6, avg: 4 });
      expect(out.points).toEqual([{ t: '2026-08-24T10:00:00Z', v: 2 }, { t: '2026-08-24T11:00:00Z', v: 6 }]);
    });

    it('averages into buckets when there are more points than the caller asked for', async () => {
      const rows = Array.from({ length: 10 }, (_, i) => sample({
        id: `p${i}`, externalUuid: `p${i}`, startTime: `2026-08-24T10:${String(i).padStart(2, '0')}:00Z`, valueNum: i * 10,
      }));
      await provider.insertSamples('jim', rows);
      const out = await provider.querySeries('jim', seriesQuery({ metricTypes: ['step_count'], maxPoints: 2 }));
      expect(out.downsampled).toBe(true);
      expect(out.total).toBe(10);
      expect(out.points!.length).toBeLessThanOrEqual(3);
      expect(out.points!.length).toBeGreaterThan(0);
      expect(out.stats?.avg).toBe(45);
    });

    it('buckets samples that share one instant instead of dividing by a zero-length span', async () => {
      await provider.insertSamples('jim', [
        sample({ id: 'a', externalUuid: 'a', valueNum: 1 }),
        sample({ id: 'b', externalUuid: 'b', valueNum: 3 }),
        sample({ id: 'c', externalUuid: 'c', valueNum: 5 }),
      ]);
      const out = await provider.querySeries('jim', seriesQuery({ metricTypes: ['step_count'], maxPoints: 1 }));
      expect(out.downsampled).toBe(true);
      expect(out.points).toEqual([{ t: '2026-08-24T12:00:00.000Z', v: 3 }]);
    });

    it('splits a blood-pressure series into one line per component, and thins long ones', async () => {
      await provider.insertSamples('jim', [
        bp('b1', '2026-08-24T08:00:00Z', 120, 80),
        bp('b2', '2026-08-24T09:00:00Z', 130, 85),
        bp('b3', '2026-08-24T10:00:00Z', 140, 90),
        bp('b4', '2026-08-24T11:00:00Z', 150, 95),
      ]);
      const full = await provider.querySeries('jim', seriesQuery({ metricTypes: ['blood_pressure'] }));
      expect(full.total).toBe(4);
      expect(full.downsampled).toBe(false);
      expect(full.points).toBeUndefined();
      expect(full.components?.['8480-6']?.map((p) => p.v)).toEqual([120, 130, 140, 150]);
      expect(full.components?.['8462-4']?.map((p) => p.v)).toEqual([80, 85, 90, 95]);
      const thin = await provider.querySeries('jim', seriesQuery({ metricTypes: ['blood_pressure'], maxPoints: 2 }));
      expect(thin.downsampled).toBe(true);
      expect(thin.components?.['8480-6']?.length).toBeLessThan(4);
      expect(thin.components?.['8480-6']?.[0]?.v).toBeGreaterThanOrEqual(120);
    });

    it('does not add steps from two sources on one day; the larger source wins', async () => {
      await provider.insertSamples('jim', [
        sample({ id: 'p1', externalUuid: 'p1', sourceName: 'Phone', valueNum: 1000 }),
        sample({ id: 'p2', externalUuid: 'p2', sourceName: 'Phone', valueNum: 500 }),
        sample({ id: 'w1', externalUuid: 'w1', sourceName: '', deviceName: 'Watch', valueNum: 8000 }),
        sample({ id: 'u1', externalUuid: 'u1', sourceName: '', deviceName: '', sourceId: 'source-9', localDay: '2026-08-25', valueNum: 40 }),
      ]);
      const out = await provider.querySeries('jim', seriesQuery({ metricTypes: ['step_count'], mode: 'day' }));
      expect(out.total).toBe(4);
      expect(out.unit).toBe('{steps}');
      expect(out.daily).toEqual([{ date: '2026-08-24', value: 8000 }, { date: '2026-08-25', value: 40 }]);
    });

    it('reports per-day mean, minimum, maximum and count', async () => {
      await provider.insertSamples('jim', [
        sample({ id: 'a', externalUuid: 'a', valueNum: 60 }),
        sample({ id: 'b', externalUuid: 'b', valueNum: 100 }),
        sample({ id: 'c', externalUuid: 'c', localDay: '2026-08-25', valueNum: 80 }),
        sample({ id: 'n', externalUuid: 'n', valueNum: null }),
      ]);
      const out = await provider.querySeries('jim', seriesQuery({ metricTypes: ['step_count'], mode: 'daily-stats' }));
      expect(out.total).toBe(3);
      expect(out.stats).toEqual({ min: 60, max: 100, avg: 80 });
      expect(out.daily).toEqual([
        { date: '2026-08-24', value: 80, min: 60, max: 100, n: 2 },
        { date: '2026-08-25', value: 80, min: 80, max: 80, n: 1 },
      ]);
    });

    it('adds up the hours of each sleep stage per night', async () => {
      const stage = (id: string, code: string, start: string, end: string, day: string) => sample({
        id, externalUuid: id, metricType: 'sleep_stage', code, valueNum: null, unit: '', startTime: start, endTime: end, localDay: day,
      });
      await provider.insertSamples('jim', [
        stage('s1', '93831-6', '2026-08-24T02:00:00Z', '2026-08-24T03:30:00Z', '2026-08-24'),
        stage('s2', '93831-6', '2026-08-24T04:00:00Z', '2026-08-24T04:30:00Z', '2026-08-24'),
        stage('s3', '93829-0', '2026-08-24T05:00:00Z', '2026-08-24T06:00:00Z', '2026-08-24'),
        stage('s4', '93831-6', '2026-08-25T02:00:00Z', '2026-08-25T03:00:00Z', '2026-08-25'),
      ]);
      const out = await provider.querySeries('jim', seriesQuery({ metricTypes: ['sleep_stage'], mode: 'stages' }));
      expect(out.total).toBe(4);
      expect(out.nights?.map((n) => n.date)).toEqual(['2026-08-24', '2026-08-25']);
      expect(out.nights?.[0]?.stages['93831-6']).toBeCloseTo(2, 5);
      expect(out.nights?.[0]?.stages['93829-0']).toBeCloseTo(1, 5);
      expect(out.nights?.[1]?.stages).toEqual({ '93831-6': expect.closeTo(1, 5) });
    });
  });

  it('keeps one sync anchor per device and metric, newest write wins, and lists by device', async () => {
    const state = (deviceId: string, metricType: string, anchor: string) => ({
      userId: 'jim', deviceId, metricType, anchor, lastSampleEndTime: '2026-08-24T12:00:00Z', lastSyncedAt: '2026-08-24T13:00:00Z', deviceName: 'Phone',
    });
    await provider.upsertSyncStates([]);
    await provider.upsertSyncStates([state('dev-b', 'step_count', 'a1'), state('dev-a', 'step_count', 'a2'), state('dev-a', 'heart_rate', 'a3')]);
    await provider.upsertSyncState(state('dev-b', 'step_count', 'a1-new'));
    const all = await provider.listSyncStates('jim', '');
    expect(all.map((s) => `${s.deviceId}/${s.metricType}/${s.anchor}`)).toEqual(['dev-a/heart_rate/a3', 'dev-a/step_count/a2', 'dev-b/step_count/a1-new']);
    expect((await provider.listSyncStates('jim', 'dev-a')).length).toBe(2);
    expect(await provider.listSyncStates('pat', '')).toEqual([]);
    await provider.removeForOwner('jim');
    expect(await provider.listSyncStates('jim', '')).toEqual([]);
  });
});

describe('SqlitePhdSamplesProvider key handling', () => {
  it('fails the open on a wrong key and leaves no handle holding the file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'phd-wrong-'));
    const file = join(dir, 'phd-samples.db');
    try {
      const writer = new SqlitePhdSamplesProvider(file, 'right-key');
      await writer.insertSamples('jim', [row()]);
      await writer.close();
      expect(() => new SqlitePhdSamplesProvider(file, 'wrong-key')).toThrow(/not a database|encrypted|file is not/i);
      expect(() => new SqlitePhdSamplesProvider(file, "it's-quoted")).toThrow();
      const again = new SqlitePhdSamplesProvider(file, 'right-key');
      expect((await again.listSamples('jim', everything)).total).toBe(1);
      await again.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not read an encrypted file as plain, and does not open a plain file with a key', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'phd-plain-'));
    try {
      const encrypted = join(dir, 'enc.db');
      await (async () => { const p = new SqlitePhdSamplesProvider(encrypted, 'k1'); await p.insertSamples('jim', [row()]); await p.close(); })();
      expect(() => new SqlitePhdSamplesProvider(encrypted, '')).toThrow();
      const plain = join(dir, 'plain.db');
      await (async () => { const p = new SqlitePhdSamplesProvider(plain, ''); await p.insertSamples('jim', [row()]); await p.close(); })();
      expect(() => new SqlitePhdSamplesProvider(plain, 'k1')).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
