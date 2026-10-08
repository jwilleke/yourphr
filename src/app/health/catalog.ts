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
export type ObservationCategory = 'vital-signs' | 'activity';
export type SampleAdapter = 'manual' | 'healthkit' | 'health-connect' | 'fhir';

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
  /** HealthKit names and numeric stage values. Not shared with Health Connect. */
  healthKit: readonly string[];
  /** Health Connect stage names. Not shared with HealthKit. */
  healthConnect: readonly string[];
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
  /** Extra LOINC codings stored beside `code` (US Core pulse oximetry keeps 2708-6 with 59408-5). */
  alsoCoding?: readonly string[];
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
    code: '59408-5',
    display: 'Oxygen saturation in Arterial blood by Pulse oximetry',
    alsoCoding: ['2708-6'],
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
    code: '93828-2',
    display: 'Sleep stage',
    category: 'activity',
    kind: 'codeable',
    canonicalUnit: '',
    acceptedUnits: [],
    metricType: 'sleep_stage',
    vendorKeys: ['HKCategoryTypeIdentifierSleepAnalysis', 'SleepSessionRecord'],
    allowedValues: [
      {
        canonical: '93828-2',
        display: 'Awakening',
        healthKit: ['awake', '2', 'HKCategoryValueSleepAnalysisAwake'],
        healthConnect: ['STAGE_TYPE_AWAKE', 'AWAKE', 'STAGE_TYPE_AWAKE_OUT_OF_BED', 'OUT_OF_BED', 'STAGE_TYPE_OUT_OF_BED'],
      },
      {
        canonical: '93830-8',
        display: 'Light sleep',
        healthKit: ['asleepCore', '3', 'HKCategoryValueSleepAnalysisAsleepCore'],
        healthConnect: ['STAGE_TYPE_SLEEPING_LIGHT', 'STAGE_TYPE_LIGHT', 'LIGHT'],
      },
      {
        canonical: '93831-6',
        display: 'Deep sleep',
        healthKit: ['asleepDeep', '4', 'HKCategoryValueSleepAnalysisAsleepDeep'],
        healthConnect: ['STAGE_TYPE_SLEEPING_DEEP', 'STAGE_TYPE_DEEP', 'DEEP'],
      },
      {
        canonical: '93829-0',
        display: 'REM sleep',
        healthKit: ['asleepREM', '5', 'HKCategoryValueSleepAnalysisAsleepREM'],
        healthConnect: ['STAGE_TYPE_SLEEPING_REM', 'STAGE_TYPE_REM', 'REM'],
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
  if (metric.code) BY_CODE.set(metric.code, metric);
  BY_METRIC.set(metric.metricType, metric);
  for (const extra of metric.alsoCoding ?? []) BY_CODE.set(extra, metric);
  for (const allowed of metric.allowedValues) BY_CODE.set(allowed.canonical, metric);
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
  }
  return undefined;
}

/**
 * Map a vendor stage token onto a LOINC stage code.
 * Numeric values are not shared: HealthKit `4` is deep sleep, and that number is not a Health Connect stage.
 * In bed and unspecified sleep are not one of the four night totals, so they stay unmapped.
 */
export function resolveStage(metric: CatalogMetric, value: string, adapter: SampleAdapter): string | undefined {
  const canonical = normalizeCodeableValue(metric, value);
  if (canonical) return canonical;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  const list = adapter === 'health-connect' ? 'healthConnect' : adapter === 'healthkit' ? 'healthKit' : undefined;
  if (!list) return undefined;
  for (const allowed of metric.allowedValues) {
    for (const alias of allowed[list]) {
      if (alias.toLowerCase() === trimmed.toLowerCase()) return allowed.canonical;
    }
  }
  return undefined;
}

const MASS_TO_KG = new Set(['lb', 'lbs', 'pound', 'pounds', '[lb_av]']);
const TO_CELSIUS = new Set(['degf', '[degf]', 'f', '°f', 'fahrenheit']);
const LB_TO_KG = 0.45359237;

/** Canonical UCUM quantity. `lb` becomes kg and `degF` becomes Cel; an unknown unit is refused. */
export function toCanonicalQuantity(
  metric: CatalogMetric,
  value: number,
  unitRaw: string,
  fromHealthKit: boolean,
): { value: number; unit: string; originalUnit: string } | undefined {
  const trimmed = unitRaw.trim();
  const direct = normalizeUnit(metric, trimmed);
  if (direct !== undefined) {
    return { value: normalizeQuantityValue(metric, value, fromHealthKit), unit: direct, originalUnit: trimmed };
  }
  const key = trimmed.toLowerCase();
  if (metric.canonicalUnit === 'kg' && MASS_TO_KG.has(key)) {
    return { value: Math.round(value * LB_TO_KG * 1000) / 1000, unit: 'kg', originalUnit: trimmed };
  }
  if (metric.canonicalUnit === 'Cel' && TO_CELSIUS.has(key)) {
    return { value: Math.round(((value - 32) * 5) / 9 * 100) / 100, unit: 'Cel', originalUnit: trimmed };
  }
  return undefined;
}

const RANGES: Record<string, readonly [number, number]> = {
  heart_rate: [1, 400],
  resting_heart_rate: [1, 400],
  heart_rate_variability_sdnn: [0, 500],
  step_count: [0, 1_000_000],
  oxygen_saturation: [0, 100],
  body_mass: [0.2, 500],
  body_temperature: [25, 45],
  blood_pressure: [1, 400],
  blood_pressure_systolic: [1, 400],
  blood_pressure_diastolic: [1, 400],
};

export function assertInRange(metricType: string, value: number): void {
  const range = RANGES[metricType];
  if (!range) return;
  if (value < range[0] || value > range[1]) {
    throw new Error(`${metricType} value ${value} is outside ${range[0]}–${range[1]}`);
  }
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

function expandMetric(metric: CatalogMetric, asked?: string): string[] {
  if (metric.allowedValues.length === 0) return metric.code ? [metric.code] : [];
  if (asked && metric.allowedValues.some((v) => v.canonical === asked)) return [asked];
  return metric.allowedValues.map((v) => v.canonical);
}

export function codesForQuery(metricTypes: string[], codes: string[], vendorType: string): { codes: string[]; vendorType: string } {
  const resolved = new Set<string>();
  for (const code of codes) {
    const trimmed = code.trim();
    const metric = lookupByCode(trimmed);
    if (metric) for (const c of expandMetric(metric, trimmed)) resolved.add(c);
    else if (trimmed) resolved.add(trimmed);
  }
  for (const metricType of metricTypes) {
    const metric = lookupByMetricType(metricType);
    if (metric) for (const c of expandMetric(metric)) resolved.add(c);
  }
  return { codes: [...resolved], vendorType: vendorType.trim() };
}
