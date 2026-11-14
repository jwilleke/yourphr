/**
 * Daily rollup of wearable samples into Observations (yourphr#314). Synthetic rows only.
 */
import { describe, expect, it } from 'vitest';
import type { Observation } from '@medplum/fhirtypes';
import {
  dailyObservation,
  fhirId,
  isHighFrequency,
  isSpot,
  publishSamples,
  retracted,
  selectSource,
  sleepObservations,
  sourceKey,
  spotObservation,
  winningSource,
  type RollupWriter,
} from '../rollup.js';
import type { HealthSampleRow } from '../../providers/BaseHealthProvider.js';

function row(over: Partial<HealthSampleRow> = {}): HealthSampleRow {
  return {
    id: 'row-1', userId: 'jim', externalUuid: 'ext-1', identifierSystem: 'urn:uuid', adapter: 'healthkit',
    vendorType: 'HKQuantityTypeIdentifierStepCount', metricType: 'step_count', codeSystem: 'http://loinc.org',
    code: '55423-8', category: 'activity', subject: '', startTime: '2026-08-24T12:00:00Z', endTime: '2026-08-24T12:00:00Z',
    tzOffset: 'Z', localDay: '2026-08-24', valueNum: 10, unit: '{steps}', originalUnit: 'count', valueText: '',
    valueSystem: '', components: '', correlationUuid: '', sourceName: 'Phone', sourceBundleId: '', deviceName: '',
    sourceId: 'source-1', metadata: '', deleted: false,
    ...over,
  };
}

const sleep = (code: string, start: string, end: string, over: Partial<HealthSampleRow> = {}) => row({
  id: `sleep-${code}-${start}`, externalUuid: `sleep-${code}-${start}`, metricType: 'sleep_stage', code, category: 'activity',
  vendorType: 'HKCategoryTypeIdentifierSleepAnalysis', startTime: start, endTime: end, valueNum: null, unit: '', ...over,
});

describe('metric classes', () => {
  it('separates high-frequency, spot and everything else', () => {
    expect(isHighFrequency('step_count')).toBe(true);
    expect(isHighFrequency('blood_pressure')).toBe(false);
    expect(isSpot('blood_pressure')).toBe(true);
    expect(isSpot('step_count')).toBe(false);
  });
});

describe('fhirId', () => {
  it('joins the parts, drops characters FHIR ids do not allow, and caps the length at 64', () => {
    expect(fhirId(['pghd', 'step_count', '2026-08-24'])).toBe('pghd-stepcount-2026-08-24');
    expect(fhirId(['a'.repeat(100)])).toHaveLength(64);
  });

  it('falls back to a fixed id when nothing is left', () => {
    expect(fhirId(['___', '///'])).toBe('-');
    expect(fhirId(['___'])).toBe('pghd');
  });
});

describe('sourceKey', () => {
  it('pairs the upload source with the name the sender wrote, falling back to the device name', () => {
    expect(sourceKey(row({ sourceName: 'Watch', deviceName: 'Dev', sourceId: 'src' }))).toBe('src / Watch');
    expect(sourceKey(row({ sourceName: '', deviceName: 'Dev', sourceId: 'src' }))).toBe('src / Dev');
    expect(sourceKey(row({ sourceName: '', deviceName: '', sourceId: 'src' }))).toBe('src');
    expect(sourceKey(row({ sourceName: 'Watch', deviceName: '', sourceId: '' }))).toBe('Watch');
    expect(sourceKey(row({ sourceName: '', deviceName: '', sourceId: '' }))).toBe('unknown');
  });
});

describe('selectSource', () => {
  it('keeps everything when only one source reported', () => {
    const rows = [row({ valueNum: 1 }), row({ id: 'r2', valueNum: 2 })];
    expect(selectSource(rows, 'sum')).toEqual({ kept: rows, discarded: [] });
  });

  it('keeps the source with the larger total for a sum, and names the one it dropped', () => {
    const phone = row({ id: 'p', sourceName: 'Phone', valueNum: 1000 });
    const watch = row({ id: 'w', sourceName: 'Watch', valueNum: 8000 });
    expect(winningSource([phone, watch])).toEqual({ kept: [watch], discarded: ['source-1 / Phone'] });
  });

  it('keeps the source with more samples for a count, even when its total is smaller', () => {
    const phone = [row({ id: 'p1', sourceName: 'Phone', valueNum: 100 })];
    const watch = [
      row({ id: 'w1', sourceName: 'Watch', valueNum: 1 }),
      row({ id: 'w2', sourceName: 'Watch', valueNum: 1 }),
    ];
    const out = selectSource([...phone, ...watch], 'count');
    expect(out.kept.map((r) => r.id)).toEqual(['w1', 'w2']);
    expect(out.discarded).toEqual(['source-1 / Phone']);
  });

  it('breaks a count tie on the larger total, then on the source name, whatever the row order', () => {
    const a = row({ id: 'a', sourceName: 'Alpha', valueNum: 5 });
    const b = row({ id: 'b', sourceName: 'Beta', valueNum: 9 });
    expect(selectSource([a, b], 'count').kept).toEqual([b]);
    expect(selectSource([b, a], 'count').kept).toEqual([b]);
    const tieA = row({ id: 'ta', sourceName: 'Alpha', valueNum: 5 });
    const tieB = row({ id: 'tb', sourceName: 'Beta', valueNum: 5 });
    expect(selectSource([tieB, tieA], 'sum').kept).toEqual([tieA]);
    expect(selectSource([tieA, tieB], 'sum').kept).toEqual([tieA]);
  });

  it('counts a row with no value as zero', () => {
    const a = row({ id: 'a', sourceName: 'Alpha', valueNum: null });
    const b = row({ id: 'b', sourceName: 'Beta', valueNum: 3 });
    expect(selectSource([a, b], 'sum').kept).toEqual([b]);
  });
});

describe('dailyObservation', () => {
  it('adds one source\'s steps into one Observation covering that local day in its offset', () => {
    const rows = [
      row({ id: 'a', valueNum: 100, tzOffset: '-04:00' }),
      row({ id: 'b', valueNum: 40, tzOffset: '-04:00' }),
    ];
    const obs = dailyObservation('step_count', '2026-08-24', rows, 'Patient/p1');
    expect(obs?.id).toBe('pghd-stepcount-2026-08-24');
    expect(obs?.status).toBe('final');
    expect(obs?.valueQuantity).toMatchObject({ value: 140, code: '{steps}' });
    expect(obs?.subject).toEqual({ reference: 'Patient/p1' });
    expect(obs?.effectivePeriod).toEqual({ start: '2026-08-24T04:00:00Z', end: '2026-08-25T04:00:00Z' });
    expect(obs?.note).toBeUndefined();
  });

  it('reads a positive offset as a day that started the evening before in UTC', () => {
    const obs = dailyObservation('step_count', '2026-08-24', [row({ tzOffset: '+05:30' })], '');
    expect(obs?.effectivePeriod).toEqual({ start: '2026-08-23T18:30:00Z', end: '2026-08-24T18:30:00Z' });
    expect(obs?.subject).toBeUndefined();
  });

  it('treats a row with no offset as UTC', () => {
    const obs = dailyObservation('step_count', '2026-08-24', [row({ tzOffset: '' })], '');
    expect(obs?.effectivePeriod?.start).toBe('2026-08-24T00:00:00Z');
  });

  it('does not add two sources, and says which one it left out', () => {
    const obs = dailyObservation('step_count', '2026-08-24', [
      row({ id: 'p', sourceName: 'Phone', valueNum: 1000 }),
      row({ id: 'w', sourceName: 'Watch', valueNum: 8000 }),
    ], '');
    expect(obs?.valueQuantity?.value).toBe(8000);
    expect(obs?.note?.[0]?.text).toBe('A second source was not added: source-1 / Phone');
  });

  it('reports the mean with its minimum and maximum for a rate', () => {
    const rows = ['60', '70', '110'].map((v, i) => row({
      id: `h${i}`, metricType: 'heart_rate', code: '8867-4', category: 'vital-signs', valueNum: Number(v), unit: '/min',
    }));
    const obs = dailyObservation('heart_rate', '2026-08-24', rows, '');
    expect(obs?.valueQuantity).toMatchObject({ value: 80, code: '/min' });
    expect(obs?.component?.map((c) => [c.code?.text, c.valueQuantity?.value])).toEqual([['minimum', 60], ['maximum', 110]]);
    expect(obs?.category?.[0]?.coding?.[0]?.code).toBe('vital-signs');
  });

  it('keeps the second LOINC coding pulse oximetry carries', () => {
    const obs = dailyObservation('oxygen_saturation', '2026-08-24', [row({ metricType: 'oxygen_saturation', valueNum: 97 })], '');
    expect(obs?.code?.coding?.map((c) => c.code)).toEqual(['59408-5', '2708-6']);
  });

  it('writes nothing for an unknown metric, no rows, or a rate with no numeric values', () => {
    expect(dailyObservation('no_such_metric', '2026-08-24', [row()], '')).toBeUndefined();
    expect(dailyObservation('step_count', '2026-08-24', [], '')).toBeUndefined();
    expect(dailyObservation('heart_rate', '2026-08-24', [row({ metricType: 'heart_rate', valueNum: null })], '')).toBeUndefined();
  });
});

describe('sleepObservations', () => {
  it('sums hours per stage and writes one Observation per stage with a stage-keyed id', () => {
    const out = sleepObservations('2026-08-24', [
      sleep('93831-6', '2026-08-24T02:00:00Z', '2026-08-24T03:30:00Z'),
      sleep('93831-6', '2026-08-24T04:00:00Z', '2026-08-24T04:30:00Z'),
      sleep('93829-0', '2026-08-24T05:00:00Z', '2026-08-24T06:00:00Z'),
    ], 'Patient/p1');
    expect(out.map((o) => o.id)).toEqual(['pghd-sleep-93831-6-2026-08-24', 'pghd-sleep-93829-0-2026-08-24']);
    expect(out[0]?.valueQuantity).toMatchObject({ value: 2, code: 'h' });
    expect(out[0]?.code?.coding?.[0]).toMatchObject({ code: '93831-6', display: 'Deep sleep' });
    expect(out[1]?.valueQuantity?.value).toBe(1);
  });

  it('skips a stage the catalog does not know, a missing code, and an interval that is empty or backwards', () => {
    const out = sleepObservations('2026-08-24', [
      sleep('99999-9', '2026-08-24T02:00:00Z', '2026-08-24T03:00:00Z'),
      sleep('', '2026-08-24T02:00:00Z', '2026-08-24T03:00:00Z'),
      sleep('93831-6', '2026-08-24T04:00:00Z', '2026-08-24T04:00:00Z'),
      sleep('93831-6', '2026-08-24T05:00:00Z', '2026-08-24T04:00:00Z'),
    ], '');
    expect(out).toEqual([]);
  });

  it('keeps one source\'s stages and notes the other', () => {
    const out = sleepObservations('2026-08-24', [
      sleep('93831-6', '2026-08-24T02:00:00Z', '2026-08-24T03:00:00Z', { sourceName: 'Watch' }),
      sleep('93830-8', '2026-08-24T03:00:00Z', '2026-08-24T03:30:00Z', { sourceName: 'Phone' }),
      sleep('93829-0', '2026-08-24T03:30:00Z', '2026-08-24T04:00:00Z', { sourceName: 'Watch' }),
    ], '');
    expect(out.map((o) => o.code?.coding?.[0]?.code).sort()).toEqual(['93829-0', '93831-6']);
    expect(out[0]?.note?.[0]?.text).toContain('Phone');
  });

  it('writes nothing for a day with no rows', () => {
    expect(sleepObservations('2026-08-24', [], '')).toEqual([]);
  });
});

describe('spotObservation', () => {
  const panel = (over: Partial<HealthSampleRow> = {}) => row({
    id: 'bp-1', externalUuid: 'corr-1', metricType: 'blood_pressure', code: '85354-9', category: 'vital-signs', valueNum: null, unit: 'mm[Hg]',
    components: JSON.stringify([
      { code: '8480-6', display: 'Systolic blood pressure', value: 120, unit: 'mm[Hg]' },
      { code: '8462-4', value: 80, unit: 'mm[Hg]' },
    ]), ...over,
  });

  it('carries each blood-pressure half as a component of one panel at its own instant', () => {
    const obs = spotObservation(panel(), 'Patient/p1');
    expect(obs?.id).toBe('pghd-corr-1');
    expect(obs?.status).toBe('final');
    expect(obs?.effectiveDateTime).toBe('2026-08-24T12:00:00Z');
    expect(obs?.component?.map((c) => [c.code?.coding?.[0]?.code, c.valueQuantity?.value])).toEqual([['8480-6', 120], ['8462-4', 80]]);
    expect(obs?.component?.[0]?.code?.coding?.[0]?.display).toBe('Systolic blood pressure');
    expect(obs?.component?.[1]?.code?.coding?.[0]).not.toHaveProperty('display');
  });

  it('marks a deleted reading entered-in-error', () => {
    expect(spotObservation(panel({ deleted: true }), '')?.status).toBe('entered-in-error');
  });

  it('writes a panel whose components are not readable without any component', () => {
    expect(spotObservation(panel({ components: '{not json' }), '')?.component).toBeUndefined();
    expect(spotObservation(panel({ components: '[]' }), '')?.component).toBeUndefined();
  });

  it('uses the single value of a scalar spot reading, in its stored or canonical unit', () => {
    const weight = row({ metricType: 'body_mass', code: '29463-7', valueNum: 68.04, unit: 'kg', externalUuid: '', id: 'w-1' });
    expect(spotObservation(weight, '')?.valueQuantity).toMatchObject({ value: 68.04, code: 'kg' });
    expect(spotObservation(weight, '')?.id).toBe('pghd-w-1');
    expect(spotObservation({ ...weight, unit: '' }, '')?.valueQuantity?.code).toBe('kg');
    expect(spotObservation({ ...weight, valueNum: null }, '')?.valueQuantity).toBeUndefined();
  });

  it('does not write a reading for a metric the catalog does not know', () => {
    expect(spotObservation(row({ metricType: 'mystery' }), '')).toBeUndefined();
  });
});

describe('retracted', () => {
  it('names the daily Observation it retracts, coded when the metric is known', () => {
    const obs = retracted('step_count', '2026-08-24');
    expect(obs).toMatchObject({ id: 'pghd-stepcount-2026-08-24', status: 'entered-in-error' });
    expect(obs.code?.coding?.[0]?.code).toBe('55423-8');
  });

  it('names a sleep stage by its code', () => {
    const obs = retracted('sleep_stage', '2026-08-24', '93831-6');
    expect(obs.id).toBe('pghd-sleep-93831-6-2026-08-24');
    expect(obs.code?.coding?.[0]?.code).toBe('93831-6');
  });

  it('falls back to text for a metric the catalog does not know', () => {
    expect(retracted('mystery', '2026-08-24').code).toEqual({ text: 'mystery' });
  });
});

describe('publishSamples', () => {
  function fakeWriter(stored: HealthSampleRow[]) {
    const saved: { source: string; resource: Observation }[] = [];
    const asked: { metricType: string; days: string[] }[] = [];
    const writer: RollupWriter = {
      save: async (source, resource) => { saved.push({ source, resource }); },
      rowsForLocalDays: async (metricType, days) => {
        asked.push({ metricType, days });
        return stored.filter((r) => r.metricType === metricType && days.includes(r.localDay));
      },
    };
    return { writer, saved, asked };
  }

  it('re-rolls each touched day once from what is stored, not from the batch alone', async () => {
    const stored = [row({ id: 'a', valueNum: 100 }), row({ id: 'b', valueNum: 50 })];
    const { writer, saved, asked } = fakeWriter(stored);
    await publishSamples([row({ id: 'b', valueNum: 50 }), row({ id: 'b2', valueNum: 1 })], 'source-9', 'Patient/p1', writer);
    expect(asked).toEqual([{ metricType: 'step_count', days: ['2026-08-24'] }]);
    expect(saved).toHaveLength(1);
    // Steps belong to the source that won the day (rollupSource), here the stored rows' source.
    expect(saved[0]?.source).toBe('source-1');
    expect(saved[0]?.resource.valueQuantity?.value).toBe(150);
  });

  it('retracts a day whose every row is deleted', async () => {
    const { writer, saved } = fakeWriter([row({ id: 'a', deleted: true })]);
    await publishSamples([row({ id: 'a', deleted: true })], 's', '', writer);
    expect(saved.map((s) => [s.resource.id, s.resource.status])).toEqual([['pghd-stepcount-2026-08-24', 'entered-in-error']]);
  });

  it('writes a spot reading straight through without reading the day back', async () => {
    const { writer, saved, asked } = fakeWriter([]);
    await publishSamples([row({ metricType: 'body_mass', code: '29463-7', valueNum: 70, unit: 'kg', externalUuid: 'w1' })], 's', '', writer);
    expect(asked).toEqual([]);
    expect(saved[0]?.resource.id).toBe('pghd-w1');
  });

  it('ignores a metric nothing rolls up', async () => {
    const { writer, saved, asked } = fakeWriter([]);
    await publishSamples([
      row({ metricType: 'body_temperature_extra' }),
      row({ metricType: 'mystery' }),
      row({ metricType: '' }),
    ], 's', '', writer);
    expect(saved).toEqual([]);
    expect(asked).toEqual([]);
  });

  it('a row with no local day adds no day to re-roll', async () => {
    const { writer, asked } = fakeWriter([]);
    await publishSamples([row({ localDay: '' })], 's', '', writer);
    expect(asked).toEqual([{ metricType: 'step_count', days: [] }]);
  });

  it('writes the stages that are left for a sleep day and retracts a stage that was deleted from it', async () => {
    const deep = sleep('93831-6', '2026-08-24T02:00:00Z', '2026-08-24T03:00:00Z');
    const rem = sleep('93829-0', '2026-08-24T04:00:00Z', '2026-08-24T05:00:00Z');
    const { writer, saved } = fakeWriter([deep]);
    await publishSamples([deep, { ...rem, deleted: true }], 's', '', writer);
    expect(saved.map((s) => [s.resource.id, s.resource.status])).toEqual([
      ['pghd-sleep-93831-6-2026-08-24', 'final'],
      ['pghd-sleep-93829-0-2026-08-24', 'entered-in-error'],
    ]);
  });

  it('does not retract a deleted stage that another stored row still covers', async () => {
    const deep = sleep('93831-6', '2026-08-24T02:00:00Z', '2026-08-24T03:00:00Z');
    const { writer, saved } = fakeWriter([deep]);
    await publishSamples([{ ...deep, deleted: true }], 's', '', writer);
    expect(saved.map((s) => s.resource.status)).toEqual(['final']);
  });
});
