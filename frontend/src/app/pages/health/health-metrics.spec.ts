import {HealthMetricSummary} from '../../models/fasten/health-sample';
import {
  asPercent,
  asleepHours,
  CatalogEntry,
  formatLatest,
  formatWeight,
  groupSummaries,
  humanizeVendorType,
  kgToWeightUnit,
  KNOWN_METRICS,
  parseStoredWeightUnit,
  seriesMode,
} from './health-metrics';

describe('groupSummaries', () => {
  const hr: HealthMetricSummary = {
    code: '8867-4',
    metric_type: 'heart_rate',
    vendor_type: 'HKQuantityTypeIdentifierHeartRate',
    unit: '/min',
    value_num: 72,
    latest_at: '2026-08-24T12:00:00Z',
    earliest_at: '2026-01-01T00:00:00Z',
    sample_count: 10,
  };
  const bp: HealthMetricSummary = {
    code: '85354-9',
    metric_type: 'blood_pressure',
    vendor_type: 'HKCorrelationTypeIdentifierBloodPressure',
    unit: 'mm[Hg]',
    latest_at: '2026-08-24T08:00:00Z',
    earliest_at: '2026-01-01T00:00:00Z',
    sample_count: 4,
    components: [
      {code: '8480-6', value: 118, unit: 'mm[Hg]'},
      {code: '8462-4', value: 76, unit: 'mm[Hg]'},
    ],
  };
  const unknown: HealthMetricSummary = {
    code: '',
    metric_type: '',
    vendor_type: 'HKQuantityTypeIdentifierRespiratoryRate',
    unit: 'count/min',
    value_num: 16,
    latest_at: '2026-08-24T09:00:00Z',
    earliest_at: '2026-08-20T00:00:00Z',
    sample_count: 2,
  };

  it('shows a blood pressure panel as one catalog row', () => {
    const entries = groupSummaries([hr, bp]);
    const bpEntry = entries.find((e) => e.id === 'blood_pressure');
    expect(bpEntry).toBeTruthy();
    expect(bpEntry.def.viz).toBe('dual-line');
    expect(bpEntry.latestLabel).toBe('118/76 mmHg');
    expect(entries.find((e) => e.id === 'heart_rate').latestLabel).toBe('72 bpm');
  });

  it('keeps unknown vendor types in the catalog with a line fallback', () => {
    const entries = groupSummaries([unknown]);
    expect(entries.length).toBe(1);
    expect(entries[0].id).toBe('vendor:HKQuantityTypeIdentifierRespiratoryRate');
    expect(entries[0].def.viz).toBe('line');
    expect(entries[0].def.vendorType).toBe('HKQuantityTypeIdentifierRespiratoryRate');
    expect(entries[0].def.label).toBe('Respiratory Rate');
  });

  it('lists known metrics before unknown ones and in registry order', () => {
    const entries = groupSummaries([unknown, bp, hr]);
    expect(entries.map((e) => e.id)).toEqual([
      'heart_rate',
      'blood_pressure',
      'vendor:HKQuantityTypeIdentifierRespiratoryRate',
    ]);
  });
});

describe('seriesMode', () => {
  it('maps visualizations onto the series endpoint modes', () => {
    expect(seriesMode('line')).toBe('points');
    expect(seriesMode('dual-line')).toBe('points');
    expect(seriesMode('bar-daily')).toBe('day');
    expect(seriesMode('sleep-stages')).toBe('stages');
  });
});

describe('humanizeVendorType', () => {
  it('strips the HealthKit prefix', () => {
    expect(humanizeVendorType('HKQuantityTypeIdentifierRespiratoryRate')).toBe('Respiratory Rate');
  });
});

describe('formatLatest', () => {
  it('renders a known metric from the registry', () => {
    const def = KNOWN_METRICS.find((m) => m.id === 'heart_rate');
    const entry: CatalogEntry = {
      id: def.id,
      def,
      summaries: [{
        code: '8867-4',
        metric_type: 'heart_rate',
        vendor_type: 'HKQuantityTypeIdentifierHeartRate',
        unit: '/min',
        value_num: 72.4,
        latest_at: '2026-08-24T12:00:00Z',
        earliest_at: '2026-01-01T00:00:00Z',
        sample_count: 1,
      }],
      latestLabel: '',
    };
    expect(formatLatest(entry.def, entry.summaries)).toBe('72.4 bpm');
  });

  it('converts weight using the selected unit', () => {
    const def = KNOWN_METRICS.find((m) => m.id === 'body_mass');
    const summaries = [{
      code: '29463-7',
      metric_type: 'body_mass',
      vendor_type: 'HKQuantityTypeIdentifierBodyMass',
      unit: 'kg',
      value_num: 81.2,
      latest_at: '2026-08-24T12:00:00Z',
      earliest_at: '2026-01-01T00:00:00Z',
      sample_count: 1,
    }];
    expect(formatLatest(def, summaries, 'kg')).toBe('81.2 kg');
    expect(formatLatest(def, summaries, 'lbs')).toBe('179.0 lbs');
    expect(formatLatest(def, summaries, 'st')).toBe('12 st 11 lb');
  });

  it('renders HealthKit oxygen fractions as a percentage', () => {
    const def = KNOWN_METRICS.find((m) => m.id === 'oxygen_saturation');
    const summaries = [{
      code: '2708-6',
      metric_type: 'oxygen_saturation',
      vendor_type: 'HKQuantityTypeIdentifierOxygenSaturation',
      unit: '%',
      value_num: 0.97,
      latest_at: '2026-08-24T12:00:00Z',
      earliest_at: '2026-08-01T00:00:00Z',
      sample_count: 1,
    }];
    expect(formatLatest(def, summaries)).toBe('97 %');
  });
});

describe('weight units', () => {
  it('converts kilograms to pounds and decimal stone', () => {
    expect(kgToWeightUnit(81.2, 'kg')).toBe(81.2);
    expect(kgToWeightUnit(81.2, 'lbs')).toBeCloseTo(179.015, 3);
    expect(kgToWeightUnit(81.2, 'st')).toBeCloseTo(12.787, 3);
  });

  it('formats headlines as kg, lbs, or stones plus remaining pounds', () => {
    expect(formatWeight(81.2, 'kg')).toBe('81.2 kg');
    expect(formatWeight(81.2, 'lbs')).toBe('179.0 lbs');
    expect(formatWeight(81.2, 'st')).toBe('12 st 11 lb');
  });

  it('carries remaining pounds into the next stone when they round to 14', () => {
    // 14 lb exactly is 1 st 0 lb.
    expect(formatWeight(14 / 2.2046226218, 'st')).toBe('1 st 0 lb');
  });

  it('reads only kg, lbs, or st from storage', () => {
    expect(parseStoredWeightUnit('lbs')).toBe('lbs');
    expect(parseStoredWeightUnit('st')).toBe('st');
    expect(parseStoredWeightUnit('kg')).toBe('kg');
    expect(parseStoredWeightUnit('stone')).toBe('kg');
    expect(parseStoredWeightUnit(null)).toBe('kg');
  });
});

describe('asPercent', () => {
  it('turns HealthKit fractions into 0–100 and leaves already-percent values alone', () => {
    expect(asPercent(0.97)).toBe(97);
    expect(asPercent(0.978)).toBe(97.8);
    expect(asPercent(1)).toBe(100);
    expect(asPercent(97)).toBe(97);
    expect(asPercent(98.5)).toBe(98.5);
  });
});

describe('asleepHours', () => {
  it('sums core, deep, REM, and unspecified, and ignores awake and in-bed', () => {
    expect(asleepHours({
      '248219008': 4.2,
      '248220008': 1.5,
      '248218000': 1.8,
      '248171000': 0.3,
      '248218006': 0.4,
      '133877004': 8.5,
    })).toBeCloseTo(7.8, 5);
    expect(asleepHours({})).toBe(0);
  });
});
