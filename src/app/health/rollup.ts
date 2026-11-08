/**
 * Daily and spot patient-generated Observations, built for RecordsManager.saveDeviceRecord.
 *
 * Adapted from ep-ipc/yourphr sat-apple-health-ts @ d73bd992 (Scott Teglasi,
 * db707f24b4550d5c4eb7de8a523987ccd233e792 and d73bd992331ec6fcfbd25d75112ef0008040c4f5).
 * Same GNU GPL v3 as YourPHR (LICENSE.md). Modifications from that revision:
 * a daily total uses one source, not a blend of every source, and heart-rate
 * variability uses the catalog name heart_rate_variability_sdnn.
 *
 * One source per local day is not overlap detection. Two devices can still
 * both be kept as raw rows. The Observation names the sources it did not add.
 */
import type { Observation } from '@medplum/fhirtypes';
import { LOINC, OBS_CATEGORY, UCUM, lookupByMetricType, type CatalogMetric } from './catalog.js';
import { offsetMinutes } from './time.js';
import type { HealthSampleRow } from '../providers/BaseHealthProvider.js';

const HIGH_FREQUENCY = new Set(['heart_rate', 'resting_heart_rate', 'heart_rate_variability_sdnn', 'step_count', 'oxygen_saturation']);
const SPOT = new Set(['blood_pressure', 'body_mass', 'body_temperature']);
const SLEEP = 'sleep_stage';

export function isHighFrequency(metricType: string): boolean {
  return HIGH_FREQUENCY.has(metricType);
}

export function isSpot(metricType: string): boolean {
  return SPOT.has(metricType);
}

export function fhirId(parts: string[]): string {
  const id = parts.join('-').replace(/[^A-Za-z0-9.-]/g, '').slice(0, 64);
  return id.length > 0 ? id : 'pghd';
}

/**
 * Who produced the samples. The name the sender wrote (Apple Watch, the phone)
 * comes before the yourPHR source id: one signed-in upload can carry both, and
 * they must not be added just because they share that upload's source.
 * Two different names for the same physical device are not recognised.
 */
export function sourceKey(row: HealthSampleRow): string {
  return row.sourceName || row.deviceName || row.sourceId || 'unknown';
}

/**
 * Keep one source's rows for a local day.
 *
 * `sum` picks the larger total (steps). `count` picks the source with more
 * samples, then the larger total. A tie breaks on the source key so the
 * choice does not depend on row order. This does not detect overlapping
 * intervals inside one source.
 */
export function selectSource(rows: HealthSampleRow[], prefer: 'sum' | 'count'): { kept: HealthSampleRow[]; discarded: string[] } {
  const groups = new Map<string, HealthSampleRow[]>();
  for (const row of rows) {
    const key = sourceKey(row);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  if (groups.size <= 1) return { kept: rows, discarded: [] };
  let bestKey = '';
  let bestPrimary = -Infinity;
  let bestSecondary = -Infinity;
  for (const [key, list] of groups) {
    const sum = list.reduce((total, row) => total + (row.valueNum ?? 0), 0);
    const primary = prefer === 'sum' ? sum : list.length;
    const secondary = prefer === 'sum' ? list.length : sum;
    const better = primary > bestPrimary
      || (primary === bestPrimary && secondary > bestSecondary)
      || (primary === bestPrimary && secondary === bestSecondary && (bestKey === '' || key < bestKey));
    if (better) {
      bestPrimary = primary;
      bestSecondary = secondary;
      bestKey = key;
    }
  }
  return {
    kept: groups.get(bestKey) ?? [],
    discarded: [...groups.keys()].filter((key) => key !== bestKey).sort(),
  };
}

/** Steps from two sources on one local day are not added. The larger total is kept. */
export function winningSource(rows: HealthSampleRow[]): { kept: HealthSampleRow[]; discarded: string[] } {
  return selectSource(rows, 'sum');
}

function quantity(value: number, unit: string): NonNullable<Observation['valueQuantity']> {
  return { value, unit, system: UCUM, code: unit };
}

function codeOf(metric: CatalogMetric, code = metric.code): Observation['code'] {
  return {
    coding: [
      { system: LOINC, code, display: metric.display },
      ...(metric.alsoCoding ?? []).map((extra) => ({ system: LOINC, code: extra })),
    ],
  };
}

function period(localDay: string, offset: string): { start: string; end: string } {
  const startMs = Date.parse(`${localDay}T00:00:00Z`) - offsetMinutes(offset) * 60_000;
  const endMs = startMs + 24 * 60 * 60 * 1000;
  const start = new Date(startMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const end = new Date(endMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return { start, end };
}

function base(id: string, metric: CatalogMetric, subject: string, localDay: string, offset: string, code = metric.code): Observation {
  const window = period(localDay, offset);
  return {
    resourceType: 'Observation',
    id,
    status: 'final',
    category: [{ coding: [{ system: OBS_CATEGORY, code: metric.category }] }],
    code: codeOf(metric, code),
    subject: subject ? { reference: subject } : undefined,
    effectivePeriod: window,
  };
}

function overlapNote(discarded: string[]): { text: string }[] | undefined {
  if (discarded.length === 0) return undefined;
  return [{ text: `A second source was not added: ${discarded.join(', ')}` }];
}

export function dailyObservation(metricType: string, localDay: string, rows: HealthSampleRow[], subject: string): Observation | undefined {
  const metric = lookupByMetricType(metricType);
  if (!metric || rows.length === 0) return undefined;
  const { kept, discarded } = selectSource(rows, metricType === 'step_count' ? 'sum' : 'count');
  if (kept.length === 0) return undefined;
  const offset = kept[0]?.tzOffset || 'Z';
  const id = fhirId(['pghd', metricType, localDay]);
  const obs = base(id, metric, subject, localDay, offset);
  const note = overlapNote(discarded);
  if (note) obs.note = note;
  if (metricType === 'step_count') {
    const total = kept.reduce((sum, row) => sum + (row.valueNum ?? 0), 0);
    obs.valueQuantity = quantity(total, metric.canonicalUnit);
    return obs;
  }
  const values = kept.map((row) => row.valueNum).filter((value): value is number => value != null);
  if (values.length === 0) return undefined;
  const sum = values.reduce((total, value) => total + value, 0);
  const mean = sum / values.length;
  obs.valueQuantity = quantity(mean, metric.canonicalUnit);
  obs.component = [
    { code: { text: 'minimum' }, valueQuantity: quantity(Math.min(...values), metric.canonicalUnit) },
    { code: { text: 'maximum' }, valueQuantity: quantity(Math.max(...values), metric.canonicalUnit) },
  ];
  return obs;
}

export function sleepObservations(localDay: string, rows: HealthSampleRow[], subject: string): Observation[] {
  const metric = lookupByMetricType(SLEEP);
  if (!metric) return [];
  const { kept, discarded } = selectSource(rows, 'count');
  if (kept.length === 0) return [];
  const offset = kept[0]?.tzOffset || 'Z';
  const note = overlapNote(discarded);
  const byCode = new Map<string, number>();
  for (const row of kept) {
    if (!row.code || !metric.allowedValues.some((value) => value.canonical === row.code)) continue;
    const hours = (Date.parse(row.endTime) - Date.parse(row.startTime)) / 3_600_000;
    if (!Number.isFinite(hours) || hours <= 0) continue;
    byCode.set(row.code, (byCode.get(row.code) ?? 0) + hours);
  }
  return [...byCode.entries()].map(([code, hours]) => {
    const display = metric.allowedValues.find((value) => value.canonical === code)?.display ?? code;
    const obs = base(fhirId(['pghd', 'sleep', code, localDay]), metric, subject, localDay, offset, code);
    obs.code = { coding: [{ system: LOINC, code, display }] };
    obs.valueQuantity = quantity(hours, 'h');
    if (note) obs.note = note;
    return obs;
  });
}

export function spotObservation(row: HealthSampleRow, subject: string): Observation | undefined {
  const metric = lookupByMetricType(row.metricType);
  if (!metric) return undefined;
  const obs: Observation = {
    resourceType: 'Observation',
    id: fhirId(['pghd', row.externalUuid || row.id]),
    status: row.deleted ? 'entered-in-error' : 'final',
    category: [{ coding: [{ system: OBS_CATEGORY, code: metric.category }] }],
    code: codeOf(metric),
    subject: subject ? { reference: subject } : undefined,
    effectiveDateTime: row.startTime,
  };
  if (row.components) {
    try {
      const parts = JSON.parse(row.components) as { code: string; display?: string; value: number; unit: string }[];
      if (Array.isArray(parts) && parts.length > 0) {
        obs.component = parts.map((part) => ({
          code: { coding: [{ system: LOINC, code: part.code, ...(part.display ? { display: part.display } : {}) }] },
          valueQuantity: quantity(part.value, part.unit),
        }));
      }
    } catch { /* a panel without components is not a reading */ }
  } else if (row.valueNum != null) {
    obs.valueQuantity = quantity(row.valueNum, row.unit || metric.canonicalUnit);
  }
  return obs;
}

export function retracted(metricType: string, localDay: string, code?: string): Observation {
  const metric = lookupByMetricType(metricType);
  const id = code ? fhirId(['pghd', 'sleep', code, localDay]) : fhirId(['pghd', metricType, localDay]);
  return {
    resourceType: 'Observation',
    id,
    status: 'entered-in-error',
    code: metric ? codeOf(metric, code || metric.code) : { text: metricType },
  };
}

export interface RollupWriter {
  save(sourceId: string, resource: Observation): Promise<void>;
  rowsForLocalDays(metricType: string, localDays: string[]): Promise<HealthSampleRow[]>;
}

/** Re-roll the local days a batch touched, and write spot readings straight through. */
export async function publishSamples(
  rows: HealthSampleRow[],
  sourceId: string,
  subject: string,
  writer: RollupWriter,
): Promise<void> {
  const days = new Map<string, Set<string>>();
  for (const row of rows) {
    if (isSpot(row.metricType)) {
      const obs = spotObservation(row, subject);
      if (obs) await writer.save(sourceId, obs);
      continue;
    }
    if (!isHighFrequency(row.metricType) && row.metricType !== SLEEP) continue;
    const set = days.get(row.metricType) ?? new Set<string>();
    if (row.localDay) set.add(row.localDay);
    days.set(row.metricType, set);
  }
  for (const [metricType, localDays] of days) {
    const stored = await writer.rowsForLocalDays(metricType, [...localDays]);
    for (const localDay of localDays) {
      const dayRows = stored.filter((row) => row.localDay === localDay && !row.deleted);
      if (metricType === SLEEP) {
        const written = sleepObservations(localDay, dayRows, subject);
        const present = new Set(written.map((obs) => obs.code?.coding?.[0]?.code));
        for (const obs of written) await writer.save(sourceId, obs);
        const removed = new Set(rows
          .filter((row) => row.metricType === SLEEP && row.localDay === localDay && row.deleted && row.code)
          .map((row) => row.code));
        for (const code of removed) {
          if (!present.has(code)) await writer.save(sourceId, retracted(SLEEP, localDay, code));
        }
        continue;
      }
      const obs = dayRows.length > 0 ? dailyObservation(metricType, localDay, dayRows, subject) : retracted(metricType, localDay);
      if (obs) await writer.save(sourceId, obs);
    }
  }
}
