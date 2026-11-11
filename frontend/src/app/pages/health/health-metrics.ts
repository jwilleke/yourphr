import {HealthMetricSummary} from '../../models/fasten/health-sample';

export type VizKind = 'line' | 'dual-line' | 'bar-daily' | 'sleep-stages' | 'table';

export const LOINC_HEART_RATE = '8867-4';
export const LOINC_RESTING_HR = '40443-4';
export const LOINC_HRV = '80404-7';
export const LOINC_BP_PANEL = '85354-9';
export const LOINC_BP_SYS = '8480-6';
export const LOINC_BP_DIA = '8462-4';
export const LOINC_STEPS = '55423-8';
export const LOINC_WEIGHT = '29463-7';
export const LOINC_OXYGEN = '59408-5';
export const LOINC_OXYGEN_ALSO = '2708-6';
export const LOINC_TEMP = '8310-5';
export const LOINC_SLEEP_AWAKE = '93828-2';
export const LOINC_SLEEP_REM = '93829-0';
export const LOINC_SLEEP_LIGHT = '93830-8';
export const LOINC_SLEEP_DEEP = '93831-6';

export interface MetricDef {
  id: string
  label: string
  codes: string[]
  viz: VizKind
  unit?: string
  // Unrecognized vendor types have no code; the series endpoint filters on vendor_type instead.
  vendorType?: string
}

export interface CatalogEntry {
  id: string
  def: MetricDef
  summaries: HealthMetricSummary[]
  latestLabel: string
}

export const KNOWN_METRICS: MetricDef[] = [
  {id: 'heart_rate', label: 'Heart Rate', codes: [LOINC_HEART_RATE], viz: 'line', unit: 'bpm'},
  {id: 'blood_pressure', label: 'Blood Pressure', codes: [LOINC_BP_PANEL], viz: 'dual-line', unit: 'mmHg'},
  {id: 'resting_heart_rate', label: 'Resting Heart Rate', codes: [LOINC_RESTING_HR], viz: 'line', unit: 'bpm'},
  {id: 'heart_rate_variability_sdnn', label: 'Heart Rate Variability (SDNN)', codes: [LOINC_HRV], viz: 'line', unit: 'ms'},
  {id: 'step_count', label: 'Steps', codes: [LOINC_STEPS], viz: 'bar-daily', unit: 'steps'},
  {id: 'sleep_stage', label: 'Sleep', codes: [LOINC_SLEEP_AWAKE, LOINC_SLEEP_LIGHT, LOINC_SLEEP_DEEP, LOINC_SLEEP_REM], viz: 'sleep-stages'},
  {id: 'oxygen_saturation', label: 'Oxygen', codes: [LOINC_OXYGEN, LOINC_OXYGEN_ALSO], viz: 'line', unit: '%'},
  {id: 'body_mass', label: 'Weight', codes: [LOINC_WEIGHT], viz: 'line', unit: 'kg'},
  {id: 'body_temperature', label: 'Body Temperature', codes: [LOINC_TEMP], viz: 'line', unit: '°C'},
];

export const SLEEP_AWAKE = LOINC_SLEEP_AWAKE;
export const SLEEP_LIGHT = LOINC_SLEEP_LIGHT;
export const SLEEP_DEEP = LOINC_SLEEP_DEEP;
export const SLEEP_REM = LOINC_SLEEP_REM;

export const SLEEP_STAGE_ORDER = [SLEEP_AWAKE, SLEEP_LIGHT, SLEEP_DEEP, SLEEP_REM] as const;

export const SLEEP_STAGE_LABELS: Record<string, string> = {
  [SLEEP_AWAKE]: 'Awake',
  [SLEEP_LIGHT]: 'Light',
  [SLEEP_DEEP]: 'Deep',
  [SLEEP_REM]: 'REM',
  awake: 'Awake',
  asleepCore: 'Light',
  asleepDeep: 'Deep',
  asleepREM: 'REM',
};

export const SLEEP_ASLEEP_STAGES = [SLEEP_LIGHT, SLEEP_DEEP, SLEEP_REM, 'asleepCore', 'asleepDeep', 'asleepREM'] as const;

export function asleepHours(stages: Record<string, number> | undefined): number {
  if (!stages) return 0;
  return SLEEP_ASLEEP_STAGES.reduce((sum, stage) => sum + (stages[stage] || 0), 0);
}

export function isAsleepStageLabel(label: string | undefined): boolean {
  return !!label && ['Light', 'Core', 'Deep', 'REM'].includes(label);
}

export type WeightUnit = 'kg' | 'lbs' | 'st';

export const WEIGHT_UNITS: {id: WeightUnit, label: string}[] = [
  {id: 'kg', label: 'kg'},
  {id: 'lbs', label: 'lbs'},
  {id: 'st', label: 'stone'},
];

export const WEIGHT_UNIT_STORAGE_KEY = 'yourphr.health.weightUnit';

const KG_TO_LB = 2.2046226218;

export function kgToWeightUnit(kg: number, unit: WeightUnit): number {
  if (unit === 'lbs') return kg * KG_TO_LB;
  if (unit === 'st') return kg * KG_TO_LB / 14;
  return kg;
}

export function weightUnitLabel(unit: WeightUnit): string {
  if (unit === 'lbs') return 'lbs';
  if (unit === 'st') return 'st';
  return 'kg';
}

// Stone is shown as stones + remaining pounds (12 st 11 lb). kg and lbs stay decimal.
export function formatWeight(kg: number, unit: WeightUnit): string {
  if (unit === 'st') {
    const totalLb = kg * KG_TO_LB;
    let stones = Math.floor(totalLb / 14);
    let pounds = Math.round(totalLb - stones * 14);
    if (pounds === 14) {
      stones += 1;
      pounds = 0;
    }
    return `${stones} st ${pounds} lb`;
  }
  if (unit === 'lbs') return `${(kg * KG_TO_LB).toFixed(1)} lbs`;
  return `${Number.isInteger(kg) ? String(kg) : kg.toFixed(1)} kg`;
}

// Chart y-values for stone are decimal stone; tooltips convert back to st + remaining lb.
export function formatStoneFromDecimal(st: number): string {
  const kg = st * 14 / KG_TO_LB;
  return formatWeight(kg, 'st');
}

// HealthKit's percent unit is a fraction of 1 (0.97 = 97%). Values already in 0–100 pass through
// so a reading stored as FHIR % still displays as 97%.
export function asPercent(value: number): number {
  if (value >= 0 && value <= 1) return Math.round(value * 1000) / 10;
  return value;
}

export function parseStoredWeightUnit(raw: string | null): WeightUnit {
  if (raw === 'lbs' || raw === 'st' || raw === 'kg') return raw;
  return 'kg';
}

function summaryKey(summary: HealthMetricSummary): string {
  return summary.code || summary.metric_type || '';
}

// groupSummaries folds the backend's one-row-per-code catalog into the UI list: blood pressure
// is one entry, unknown vendor types still appear, and known types keep a stable order.
export function groupSummaries(summaries: HealthMetricSummary[]): CatalogEntry[] {
  const byKey = new Map<string, HealthMetricSummary>();
  const unknown: HealthMetricSummary[] = [];
  for (const summary of summaries || []) {
    const key = summaryKey(summary);
    if (key) {
      byKey.set(key, summary);
    } else {
      unknown.push(summary);
    }
  }

  const used = new Set<string>();
  const entries: CatalogEntry[] = [];
  for (const def of KNOWN_METRICS) {
    const matched = def.codes.map((c) => byKey.get(c) || byKey.get(def.id)).filter((s): s is HealthMetricSummary => !!s);
    if (def.id === 'blood_pressure' && !matched.length) {
      const sys = byKey.get('blood_pressure_systolic');
      const dia = byKey.get('blood_pressure_diastolic');
      if (sys) matched.push(sys);
      if (dia) matched.push(dia);
    }
    if (!matched.length) continue;
    def.codes.forEach((c) => used.add(c));
    used.add(def.id);
    if (def.id === 'blood_pressure') {
      used.add('blood_pressure_systolic');
      used.add('blood_pressure_diastolic');
    }
    entries.push({
      id: def.id,
      def,
      summaries: matched,
      latestLabel: formatLatest(def, matched),
    });
  }

  for (const [key, summary] of byKey) {
    if (used.has(key) || used.has(summary.metric_type) || used.has(summary.code)) continue;
    const def = fallbackDef(summary);
    entries.push({id: def.id, def, summaries: [summary], latestLabel: formatLatest(def, [summary])});
  }
  for (const summary of unknown) {
    const def = fallbackDef(summary);
    entries.push({id: def.id, def, summaries: [summary], latestLabel: formatLatest(def, [summary])});
  }
  return entries;
}

export function seriesMode(viz: VizKind): 'points' | 'day' | 'daily-stats' | 'stages' {
  if (viz === 'bar-daily') return 'day';
  if (viz === 'sleep-stages') return 'stages';
  if (viz === 'dual-line') return 'points';
  if (viz === 'line') return 'daily-stats';
  return 'points';
}

export function humanizeMetricType(metricType: string): string {
  return (metricType || '')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function humanizeVendorType(vendorType: string): string {
  const stripped = (vendorType || '')
    .replace(/^HKQuantityTypeIdentifier/, '')
    .replace(/^HKCategoryTypeIdentifier/, '')
    .replace(/^HKCorrelationTypeIdentifier/, '');
  if (!stripped || stripped === vendorType) return vendorType || 'Unknown metric';
  return stripped.replace(/([a-z])([A-Z])/g, '$1 $2');
}

export function formatLatest(def: MetricDef, summaries: HealthMetricSummary[], weightUnit: WeightUnit = 'kg'): string {
  if (def.viz === 'dual-line') {
    const panel = summaries.find((s) => s.code === LOINC_BP_PANEL) || summaries[0];
    const sys = componentValue(panel, LOINC_BP_SYS) ?? summaries.find((s) => s.metric_type === 'blood_pressure_systolic')?.value_num;
    const dia = componentValue(panel, LOINC_BP_DIA) ?? summaries.find((s) => s.metric_type === 'blood_pressure_diastolic')?.value_num;
    const sysVal = sys != null ? String(Math.round(sys)) : '—';
    const diaVal = dia != null ? String(Math.round(dia)) : '—';
    return `${sysVal}/${diaVal} mmHg`;
  }
  const latest = newest(summaries);
  if (!latest) return '';
  if (def.viz === 'sleep-stages' && latest.value_text) {
    return SLEEP_STAGE_LABELS[latest.value_text] || latest.value_text;
  }
  if (latest.value_num == null) {
    return latest.value_text || '';
  }
  if (def.id === 'body_mass') return formatWeight(latest.value_num, weightUnit);
  const unit = displayUnit(def, latest.unit);
  return `${formatNumber(latest.value_num, def)}${unit ? ' ' + unit : ''}`;
}

export function displayUnit(def: MetricDef, stored?: string, weightUnit: WeightUnit = 'kg'): string {
  if (def.id === 'body_mass') return weightUnitLabel(weightUnit);
  if (def.unit) return def.unit;
  if (stored === 'count/min' || stored === '/min') return 'bpm';
  if (stored === 'mm[Hg]') return 'mmHg';
  if (stored === 'Cel') return '°C';
  if (stored === '{steps}') return 'steps';
  return stored || '';
}

export function componentValue(summary: HealthMetricSummary | undefined, code: string): number | undefined {
  return summary?.components?.find((c) => c.code === code)?.value;
}

function fallbackDef(summary: HealthMetricSummary): MetricDef {
  const hasNum = summary.value_num != null || (summary.components?.length ?? 0) > 0;
  if (summary.code) {
    return {
      id: summary.code,
      label: humanizeMetricType(summary.metric_type) || summary.code,
      codes: [summary.code],
      viz: hasNum ? 'line' : 'table',
      unit: displayUnit({id: '', label: '', codes: [], viz: 'line'}, summary.unit),
    };
  }
  if (summary.metric_type) {
    return {
      id: summary.metric_type,
      label: humanizeMetricType(summary.metric_type),
      codes: [],
      viz: hasNum ? 'line' : 'table',
      unit: displayUnit({id: '', label: '', codes: [], viz: 'line'}, summary.unit),
    };
  }
  return {
    id: `vendor:${summary.vendor_type}`,
    label: humanizeVendorType(summary.vendor_type),
    codes: [],
    viz: hasNum ? 'line' : 'table',
    unit: summary.unit,
    vendorType: summary.vendor_type,
  };
}

function newest(summaries: HealthMetricSummary[]): HealthMetricSummary | undefined {
  return [...summaries].sort((a, b) => Date.parse(b.latest_at) - Date.parse(a.latest_at))[0];
}

function formatNumber(value: number, def: MetricDef): string {
  const n = def.id === 'oxygen_saturation' ? asPercent(value) : value;
  if (def.id === 'step_count') return Math.round(n).toLocaleString();
  if (def.unit === 'kg' || def.unit === '°C' || def.unit === '%') {
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  }
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
