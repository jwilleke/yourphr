/**
 * Vendor-neutral Observation catalog for wearable PGHD.
 *
 * Canonical identity is LOINC + UCUM + Observation.category. HealthKit type identifiers and
 * Health Connect record class names are vendor keys that resolve to the same row. A key
 * missing from this table is still stored (empty code), because a companion that ships a new
 * metric before the server knows about it should not lose the user's data. A known type with
 * a unit this table does not accept is rejected.
 */

export const LOINC = 'http://loinc.org';
export const UCUM = 'http://unitsofmeasure.org';
export const SNOMED = 'http://snomed.info/sct';
export const OBS_CATEGORY = 'http://terminology.hl7.org/CodeSystem/observation-category';
export const HK_TYPE_SYSTEM = 'https://developer.apple.com/documentation/healthkit';

export type MetricKind = 'quantity' | 'codeable' | 'panel';
export type ObservationCategory = 'vital-signs' | 'activity' | 'sleep';

export interface ComponentDef {
  code: string;
  display: string;
  metricType: string;
  /** HealthKit / Health Connect identifiers that resolve to this component. */
  vendorKeys?: readonly string[];
}

export interface AllowedValue {
  canonical: string;
  display: string;
  aliases: readonly string[];
}

export interface CatalogMetric {
  code: string;
  display: string;
  category: ObservationCategory;
  kind: MetricKind;
  /** UCUM code. Empty for codeable / panel-without-primary-value. */
  canonicalUnit: string;
  acceptedUnits: readonly string[];
  /** Dual-write name used by anchors and older clients. */
  metricType: string;
  vendorKeys: readonly string[];
  allowedValues: readonly AllowedValue[];
  components: readonly ComponentDef[];
  /** HealthKit % is often 0–1; FHIR/UCUM % is 0–100. */
  scaleFractionToPercent: boolean;
}

const CATALOG: CatalogMetric[] = [
  {
    code: '8867-4',
    display: 'Heart rate',
    category: 'vital-signs',
    kind: 'quantity',
    canonicalUnit: '/min',
    acceptedUnits: ['/min', 'count/min', 'count/minute', 'bpm'],
    metricType: 'heart_rate',
    vendorKeys: ['HKQuantityTypeIdentifierHeartRate', 'HeartRateRecord'],
    allowedValues: [],
    components: [],
    scaleFractionToPercent: false,
  },
  {
    code: '40443-4',
    display: 'Resting heart rate',
    category: 'vital-signs',
    kind: 'quantity',
    canonicalUnit: '/min',
    acceptedUnits: ['/min', 'count/min', 'count/minute', 'bpm'],
    metricType: 'resting_heart_rate',
    vendorKeys: ['HKQuantityTypeIdentifierRestingHeartRate', 'RestingHeartRateRecord'],
    allowedValues: [],
    components: [],
    scaleFractionToPercent: false,
  },
  {
    code: '80404-7',
    display: 'Heart rate variability SDNN',
    category: 'vital-signs',
    kind: 'quantity',
    canonicalUnit: 'ms',
    acceptedUnits: ['ms', 'msec', 'millisecond', 'milliseconds'],
    metricType: 'heart_rate_variability_sdnn',
    vendorKeys: ['HKQuantityTypeIdentifierHeartRateVariabilitySDNN'],
    allowedValues: [],
    components: [],
    scaleFractionToPercent: false,
  },
  {
    code: '85354-9',
    display: 'Blood pressure panel',
    category: 'vital-signs',
    kind: 'panel',
    canonicalUnit: 'mm[Hg]',
    acceptedUnits: ['mm[Hg]', 'mmHg'],
    metricType: 'blood_pressure',
    vendorKeys: [
      'HKCorrelationTypeIdentifierBloodPressure',
      'BloodPressureRecord',
      'HKQuantityTypeIdentifierBloodPressureSystolic',
      'HKQuantityTypeIdentifierBloodPressureDiastolic',
    ],
    allowedValues: [],
    components: [
      {
        code: '8480-6',
        display: 'Systolic blood pressure',
        metricType: 'blood_pressure_systolic',
        vendorKeys: ['HKQuantityTypeIdentifierBloodPressureSystolic'],
      },
      {
        code: '8462-4',
        display: 'Diastolic blood pressure',
        metricType: 'blood_pressure_diastolic',
        vendorKeys: ['HKQuantityTypeIdentifierBloodPressureDiastolic'],
      },
    ],
    scaleFractionToPercent: false,
  },
  {
    code: '55423-8',
    display: 'Number of steps',
    category: 'activity',
    kind: 'quantity',
    canonicalUnit: '{steps}',
    acceptedUnits: ['{steps}', 'count', 'steps'],
    metricType: 'step_count',
    vendorKeys: ['HKQuantityTypeIdentifierStepCount', 'StepsRecord'],
    allowedValues: [],
    components: [],
    scaleFractionToPercent: false,
  },
  {
    code: '29463-7',
    display: 'Body weight',
    category: 'vital-signs',
    kind: 'quantity',
    canonicalUnit: 'kg',
    acceptedUnits: ['kg', 'kilogram', 'kilograms'],
    metricType: 'body_mass',
    vendorKeys: ['HKQuantityTypeIdentifierBodyMass', 'WeightRecord'],
    allowedValues: [],
    components: [],
    scaleFractionToPercent: false,
  },
  {
    code: '2708-6',
    display: 'Oxygen saturation',
    category: 'vital-signs',
    kind: 'quantity',
    canonicalUnit: '%',
    acceptedUnits: ['%', 'percent'],
    metricType: 'oxygen_saturation',
    vendorKeys: ['HKQuantityTypeIdentifierOxygenSaturation', 'OxygenSaturationRecord'],
    allowedValues: [],
    components: [],
    scaleFractionToPercent: true,
  },
  {
    code: '8310-5',
    display: 'Body temperature',
    category: 'vital-signs',
    kind: 'quantity',
    canonicalUnit: 'Cel',
    acceptedUnits: ['Cel', 'degC', '°C', 'C', 'celsius'],
    metricType: 'body_temperature',
    vendorKeys: ['HKQuantityTypeIdentifierBodyTemperature', 'BodyTemperatureRecord'],
    allowedValues: [],
    components: [],
    scaleFractionToPercent: false,
  },
  {
    code: '93832-4',
    display: 'Sleep duration',
    category: 'sleep',
    kind: 'codeable',
    canonicalUnit: '',
    acceptedUnits: [],
    metricType: 'sleep_stage',
    vendorKeys: ['HKCategoryTypeIdentifierSleepAnalysis', 'SleepSessionRecord'],
    allowedValues: [
      {
        canonical: '248218006',
        display: 'Awake',
        aliases: [
          'awake',
          '2',
          'HKCategoryValueSleepAnalysisAwake',
          '89129007',
          'STAGE_TYPE_AWAKE',
          'AWAKE',
          'STAGE_TYPE_AWAKE_OUT_OF_BED',
          'OUT_OF_BED',
          'STAGE_TYPE_OUT_OF_BED',
        ],
      },
      {
        canonical: '248219008',
        display: 'Light sleep',
        aliases: [
          'asleepCore',
          '3',
          'HKCategoryValueSleepAnalysisAsleepCore',
          'STAGE_TYPE_SLEEPING_LIGHT',
          'STAGE_TYPE_LIGHT',
          'LIGHT',
        ],
      },
      {
        canonical: '248220008',
        display: 'Deep sleep',
        aliases: [
          'asleepDeep',
          '4',
          'HKCategoryValueSleepAnalysisAsleepDeep',
          'STAGE_TYPE_SLEEPING_DEEP',
          'STAGE_TYPE_DEEP',
          'DEEP',
        ],
      },
      {
        canonical: '248218000',
        display: 'REM sleep',
        aliases: [
          'asleepREM',
          '5',
          'HKCategoryValueSleepAnalysisAsleepREM',
          'STAGE_TYPE_SLEEPING_REM',
          'STAGE_TYPE_REM',
          'REM',
        ],
      },
      {
        canonical: '248171000',
        display: 'Asleep',
        aliases: [
          'asleepUnspecified',
          'asleep',
          '1',
          'HKCategoryValueSleepAnalysisAsleepUnspecified',
          'STAGE_TYPE_SLEEPING',
          'SLEEPING',
          'STAGE_TYPE_UNKNOWN',
          'UNKNOWN',
        ],
      },
      {
        canonical: '133877004',
        display: 'In bed',
        aliases: [
          'inBed',
          '0',
          'HKCategoryValueSleepAnalysisInBed',
          'STAGE_TYPE_AWAKE_IN_BED',
          'AWAKE_IN_BED',
        ],
      },
    ],
    components: [],
    scaleFractionToPercent: false,
  },
];

const BY_VENDOR = new Map<string, CatalogMetric>();
const BY_CODE = new Map<string, CatalogMetric>();
const BY_METRIC = new Map<string, CatalogMetric>();

for (const metric of CATALOG) {
  BY_CODE.set(metric.code, metric);
  BY_METRIC.set(metric.metricType, metric);
  for (const key of metric.vendorKeys) BY_VENDOR.set(key, metric);
  for (const component of metric.components) {
    BY_CODE.set(component.code, metric);
    BY_METRIC.set(component.metricType, metric);
  }
}

export function allMetrics(): readonly CatalogMetric[] {
  return CATALOG;
}

export function lookup(vendorKey: string): CatalogMetric | undefined {
  return BY_VENDOR.get(vendorKey.trim());
}

export function lookupByCode(code: string): CatalogMetric | undefined {
  const wanted = code.trim();
  if (wanted === '') return undefined;
  const pipe = wanted.lastIndexOf('|');
  return BY_CODE.get(pipe >= 0 ? wanted.slice(pipe + 1) : wanted);
}

export function lookupByMetricType(metricType: string): CatalogMetric | undefined {
  const wanted = metricType.trim();
  if (wanted === '') return undefined;
  return BY_METRIC.get(wanted);
}

export function componentOf(metric: CatalogMetric, codeOrMetricType: string): ComponentDef | undefined {
  const wanted = codeOrMetricType.trim();
  return metric.components.find((c) =>
    c.code === wanted
    || c.metricType === wanted
    || (c.vendorKeys ?? []).includes(wanted)
  );
}

export function normalizeUnit(metric: CatalogMetric, unit: string): string | undefined {
  const trimmed = unit.trim();
  for (const accepted of metric.acceptedUnits) {
    if (accepted.toLowerCase() === trimmed.toLowerCase()) return metric.canonicalUnit;
  }
  return undefined;
}

export function normalizeCodeableValue(metric: CatalogMetric, value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  for (const allowed of metric.allowedValues) {
    if (allowed.canonical.toLowerCase() === trimmed.toLowerCase()) return allowed.canonical;
    for (const alias of allowed.aliases) {
      if (alias.toLowerCase() === trimmed.toLowerCase()) return allowed.canonical;
    }
  }
  return undefined;
}

export function codeableDisplay(metric: CatalogMetric, canonical: string): string {
  return metric.allowedValues.find((v) => v.canonical === canonical)?.display ?? canonical;
}

/** HealthKit % samples arrive as a fraction of 1; FHIR % is 0–100. */
export function normalizeQuantityValue(metric: CatalogMetric, value: number, fromHealthKit: boolean): number {
  if (metric.scaleFractionToPercent && fromHealthKit && value >= 0 && value <= 1) {
    return Math.round(value * 1000) / 10;
  }
  return value;
}

export function codesForQuery(metricTypes: string[], codes: string[], vendorType: string): { codes: string[]; vendorType: string } {
  const resolved = new Set<string>();
  for (const code of codes) {
    const metric = lookupByCode(code);
    if (metric) resolved.add(metric.code);
    else if (code.trim()) resolved.add(code.trim());
  }
  for (const metricType of metricTypes) {
    const metric = lookupByMetricType(metricType);
    if (metric) resolved.add(metric.code);
  }
  return { codes: [...resolved], vendorType: vendorType.trim() };
}
