import { describe, expect, it } from 'vitest';
import { toBundle, toObservation } from '../observation.js';
import type { HealthSampleRow } from '../../providers/BaseHealthProvider.js';

function row(over: Partial<HealthSampleRow> = {}): HealthSampleRow {
  return {
    id: 'obs-1',
    userId: 'jim',
    externalUuid: 'aaa-1',
    identifierSystem: 'urn:uuid',
    vendorType: 'HKQuantityTypeIdentifierHeartRate',
    metricType: 'heart_rate',
    codeSystem: 'http://loinc.org',
    code: '8867-4',
    category: 'vital-signs',
    subject: '',
    startTime: '2026-08-24T12:00:00Z',
    endTime: '2026-08-24T12:00:00Z',
    valueNum: 72,
    unit: '/min',
    valueText: '',
    components: '',
    correlationUuid: '',
    sourceName: 'Apple Watch',
    sourceBundleId: 'com.apple.health',
    deviceName: 'Apple Watch',
    metadata: '',
    ...over,
  };
}

describe('toObservation', () => {
  it('builds a US Core vital-signs heart rate', () => {
    const obs = toObservation(row(), 'Patient/p1');
    expect(obs.resourceType).toBe('Observation');
    expect(obs.status).toBe('final');
    expect(obs.code?.coding?.[0]).toMatchObject({ system: 'http://loinc.org', code: '8867-4' });
    expect(obs.category?.[0]?.coding?.[0]?.code).toBe('vital-signs');
    expect(obs.effectiveDateTime).toBe('2026-08-24T12:00:00Z');
    expect(obs.valueQuantity).toMatchObject({ value: 72, system: 'http://unitsofmeasure.org', code: '/min' });
    expect(obs.subject?.reference).toBe('Patient/p1');
    expect(obs.device?.display).toBe('Apple Watch');
  });

  it('puts blood pressure into components', () => {
    const obs = toObservation(row({
      code: '85354-9',
      metricType: 'blood_pressure',
      vendorType: 'HKCorrelationTypeIdentifierBloodPressure',
      valueNum: null,
      unit: 'mm[Hg]',
      components: JSON.stringify([
        { code: '8480-6', display: 'Systolic blood pressure', value: 128, unit: 'mm[Hg]' },
        { code: '8462-4', display: 'Diastolic blood pressure', value: 82, unit: 'mm[Hg]' },
      ]),
    }));
    expect(obs.valueQuantity).toBeUndefined();
    expect(obs.component).toHaveLength(2);
    expect(obs.component?.[0]?.code?.coding?.[0]?.code).toBe('8480-6');
    expect(obs.component?.[0]?.valueQuantity?.value).toBe(128);
    expect(obs.component?.[1]?.code?.coding?.[0]?.code).toBe('8462-4');
  });

  it('still emits Observation.code when the metric is unknown', () => {
    const obs = toObservation(row({
      code: '',
      codeSystem: '',
      vendorType: '',
      metricType: 'future_metric',
    }));
    expect(obs.code).toEqual({ text: 'future_metric' });
  });

  it('encodes sleep as a period and a SNOMED value', () => {
    const obs = toObservation(row({
      id: 'sleep-1',
      code: '93832-4',
      category: 'sleep',
      metricType: 'sleep_stage',
      vendorType: 'HKCategoryTypeIdentifierSleepAnalysis',
      startTime: '2026-08-24T04:00:00Z',
      endTime: '2026-08-24T06:00:00Z',
      valueNum: null,
      unit: '',
      valueText: '248220008',
    }));
    expect(obs.effectivePeriod).toEqual({ start: '2026-08-24T04:00:00Z', end: '2026-08-24T06:00:00Z' });
    expect(obs.valueCodeableConcept?.coding?.[0]).toMatchObject({
      system: 'http://snomed.info/sct',
      code: '248220008',
    });
  });
});

describe('toBundle', () => {
  it('wraps rows in a collection Bundle', () => {
    const bundle = toBundle([row(), row({ id: 'obs-2', externalUuid: 'aaa-2' })]);
    expect(bundle.resourceType).toBe('Bundle');
    expect(bundle.type).toBe('collection');
    expect(bundle.total).toBe(2);
    expect(bundle.entry?.[0]?.resource?.id).toBe('obs-1');
  });
});
