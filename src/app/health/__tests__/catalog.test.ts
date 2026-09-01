import { describe, expect, it } from 'vitest';
import {
  allMetrics,
  codesForQuery,
  componentOf,
  lookup,
  lookupByCode,
  lookupByMetricType,
  normalizeCodeableValue,
  normalizeQuantityValue,
  normalizeUnit,
} from '../catalog.js';

describe('lookup', () => {
  it('maps HealthKit and Health Connect keys onto the same LOINC', () => {
    expect(lookup('HKQuantityTypeIdentifierHeartRate')?.code).toBe('8867-4');
    expect(lookup('HeartRateRecord')?.code).toBe('8867-4');
    expect(lookup('HKQuantityTypeIdentifierHeartRate')?.category).toBe('vital-signs');
  });

  it('maps a sleep category type', () => {
    const metric = lookup('HKCategoryTypeIdentifierSleepAnalysis');
    expect(metric?.code).toBe('93832-4');
    expect(metric?.kind).toBe('codeable');
    expect(metric?.category).toBe('sleep');
  });

  it('maps blood pressure halves onto the panel', () => {
    expect(lookup('HKQuantityTypeIdentifierBloodPressureSystolic')?.code).toBe('85354-9');
    expect(lookup('BloodPressureRecord')?.kind).toBe('panel');
    expect(lookupByMetricType('blood_pressure_diastolic')?.code).toBe('85354-9');
  });

  it('resolves HealthKit and metric-type keys to blood-pressure components', () => {
    const panel = lookup('BloodPressureRecord')!;
    expect(componentOf(panel, 'HKQuantityTypeIdentifierBloodPressureSystolic')?.code).toBe('8480-6');
    expect(componentOf(panel, 'HKQuantityTypeIdentifierBloodPressureDiastolic')?.code).toBe('8462-4');
    expect(componentOf(panel, 'blood_pressure_systolic')?.code).toBe('8480-6');
    expect(componentOf(panel, '8480-6')?.metricType).toBe('blood_pressure_systolic');
    expect(componentOf(panel, 'BloodPressureRecord')).toBeUndefined();
  });

  it('reports unknown types as missing rather than throwing', () => {
    expect(lookup('HKQuantityTypeIdentifierSomethingAppleShippedLastTuesday')).toBeUndefined();
  });

  it('trims whitespace', () => {
    expect(lookup('  HKQuantityTypeIdentifierStepCount\n')?.metricType).toBe('step_count');
  });
});

describe('lookupByCode and lookupByMetricType', () => {
  it('finds a known LOINC, including system|code form', () => {
    expect(lookupByCode('8867-4')?.kind).toBe('quantity');
    expect(lookupByCode('http://loinc.org|8867-4')?.display).toBe('Heart rate');
    expect(lookupByCode('not-a-code')).toBeUndefined();
  });

  it('finds a known name and refuses an empty or unknown one', () => {
    expect(lookupByMetricType('heart_rate')?.canonicalUnit).toBe('/min');
    expect(lookupByMetricType('not_a_metric')).toBeUndefined();
    expect(lookupByMetricType('  ')).toBeUndefined();
  });
});

describe('normalizeUnit', () => {
  const heart = lookup('HKQuantityTypeIdentifierHeartRate')!;
  const mass = lookup('HKQuantityTypeIdentifierBodyMass')!;
  const bp = lookup('HKQuantityTypeIdentifierBloodPressureSystolic')!;

  it('accepts HealthKit spelling and aliases, collapsing them to UCUM', () => {
    expect(normalizeUnit(heart, 'count/min')).toBe('/min');
    expect(normalizeUnit(heart, 'bpm')).toBe('/min');
    expect(normalizeUnit(bp, 'MMHG')).toBe('mm[Hg]');
    expect(normalizeUnit(mass, ' kg ')).toBe('kg');
  });

  it('rejects a wrong unit, a unit of another metric, and the empty string', () => {
    expect(normalizeUnit(mass, 'lb')).toBeUndefined();
    expect(normalizeUnit(heart, 'mmHg')).toBeUndefined();
    expect(normalizeUnit(heart, '')).toBeUndefined();
  });
});

describe('normalizeCodeableValue', () => {
  const sleep = lookup('HKCategoryTypeIdentifierSleepAnalysis')!;

  it('stores SNOMED, accepting HealthKit names and integer enums as aliases', () => {
    expect(normalizeCodeableValue(sleep, '248220008')).toBe('248220008');
    expect(normalizeCodeableValue(sleep, 'asleepDeep')).toBe('248220008');
    expect(normalizeCodeableValue(sleep, 'ASLEEPREM')).toBe('248218000');
    expect(normalizeCodeableValue(sleep, '4')).toBe('248220008');
    expect(normalizeCodeableValue(sleep, '0')).toBe('133877004');
    expect(normalizeCodeableValue(sleep, 'asleep')).toBe('248171000');
    expect(normalizeCodeableValue(sleep, 'HKCategoryValueSleepAnalysisAwake')).toBe('248218006');
    expect(normalizeCodeableValue(sleep, 'STAGE_TYPE_SLEEPING_DEEP')).toBe('248220008');
    expect(normalizeCodeableValue(sleep, 'STAGE_TYPE_SLEEPING_LIGHT')).toBe('248219008');
    expect(normalizeCodeableValue(sleep, 'STAGE_TYPE_SLEEPING_REM')).toBe('248218000');
    expect(normalizeCodeableValue(sleep, 'STAGE_TYPE_SLEEPING')).toBe('248171000');
    expect(normalizeCodeableValue(sleep, 'STAGE_TYPE_AWAKE')).toBe('248218006');
  });

  it('rejects an unknown stage, an out-of-range enum, and the empty string', () => {
    expect(normalizeCodeableValue(sleep, 'dreaming')).toBeUndefined();
    expect(normalizeCodeableValue(sleep, '99')).toBeUndefined();
    expect(normalizeCodeableValue(sleep, '')).toBeUndefined();
  });
});

describe('normalizeQuantityValue', () => {
  const oxygen = lookup('HKQuantityTypeIdentifierOxygenSaturation')!;

  it('scales a HealthKit fraction onto 0–100 and leaves a percent alone', () => {
    expect(normalizeQuantityValue(oxygen, 0.97, true)).toBe(97);
    expect(normalizeQuantityValue(oxygen, 97, true)).toBe(97);
    expect(normalizeQuantityValue(oxygen, 0.97, false)).toBe(0.97);
  });
});

describe('codesForQuery', () => {
  it('folds metric names, LOINC, and panel component codes onto the stored code', () => {
    expect(codesForQuery(['heart_rate'], [], '').codes).toEqual(['8867-4']);
    expect(codesForQuery(['blood_pressure_systolic'], [], '').codes).toEqual(['85354-9']);
    expect(codesForQuery([], ['8480-6'], '').codes).toEqual(['85354-9']);
    expect(codesForQuery([], [], 'HKQuantityTypeIdentifierHeartRate').vendorType).toBe('HKQuantityTypeIdentifierHeartRate');
  });
});

describe('the catalog is self-consistent', () => {
  it('every quantity accepts its own canonical unit and every codeable accepts its own values', () => {
    for (const metric of allMetrics()) {
      expect(metric.code, `${metric.metricType} has no LOINC`).not.toBe('');
      expect(metric.metricType, `${metric.code} has no metric type`).not.toBe('');
      expect(metric.vendorKeys.length, `${metric.code} has no vendor keys`).toBeGreaterThan(0);
      if (metric.kind === 'quantity') {
        expect(metric.canonicalUnit).not.toBe('');
        expect(metric.allowedValues).toHaveLength(0);
        expect(normalizeUnit(metric, metric.canonicalUnit)).toBe(metric.canonicalUnit);
      } else if (metric.kind === 'codeable') {
        expect(metric.canonicalUnit).toBe('');
        expect(metric.allowedValues.length).toBeGreaterThan(0);
        for (const allowed of metric.allowedValues) {
          expect(normalizeCodeableValue(metric, allowed.canonical)).toBe(allowed.canonical);
        }
      } else {
        expect(metric.components.length).toBeGreaterThan(0);
      }
    }
  });
});
