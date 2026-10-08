/**
 * Health samples — the one door for wearable PGHD ingest and the Health page reads.
 *
 * High-frequency samples stay in phd-samples.db. The daily and spot Observations are written
 * through RecordsManager.saveDeviceRecord, which is the only door into the record.
 *
 * Ownership is always ctx.username. Nothing in the request body names the account.
 */
import { randomBytes } from 'node:crypto';
import { BaseManager, type BackupData } from '../../framework/BaseManager.js';
import type { Engine } from '../../framework/Engine.js';
import { ApiError, type ApiContext } from '../../framework/ApiContext.js';
import type { Bundle, Observation } from '@medplum/fhirtypes';
import {
  HK_TYPE_SYSTEM,
  LOINC,
  assertInRange,
  codesForQuery,
  componentOf,
  lookup,
  lookupByCode,
  lookupByMetricType,
  normalizeUnit,
  resolveStage,
  toCanonicalQuantity,
  type SampleAdapter,
} from '../health/catalog.js';
import { parseOffsetTimestamp, type Stamped } from '../health/time.js';
import { isHighFrequency, publishSamples, type RollupWriter } from '../health/rollup.js';
import { DEVICE_PLATFORM_TYPE } from './SourcesManager.js';
import { serializeComponents, toBundle, toObservation, type ObservationComponentValue } from '../health/observation.js';
import {
  HEALTH_SAMPLE_DEFAULT_LIMIT,
  HEALTH_SAMPLE_MAX_LIMIT,
  HEALTH_SERIES_DEFAULT_POINTS,
  HEALTH_SERIES_MAX_POINTS,
  type BaseHealthProvider,
  type HealthMetricSummary,
  type HealthSampleQuery,
  type HealthSampleRow,
  type HealthDailyBucket,
  type HealthSeries,
  type HealthSeriesMode,
} from '../providers/BaseHealthProvider.js';

declare module '../../framework/Engine.js' {
  interface ManagerRegistry {
    health: HealthManager;
  }
}

export const HEALTH_SAMPLE_MAX_BATCH = 5000;
export const HEALTH_SAMPLE_MAX_REPORTED_ERRORS = 50;

export interface HealthSampleInput {
  resourceType?: unknown;
  uuid?: unknown;
  type?: unknown;
  start?: unknown;
  end?: unknown;
  value?: unknown;
  unit?: unknown;
  value_text?: unknown;
  source_name?: unknown;
  source_bundle_id?: unknown;
  device_name?: unknown;
  correlation_uuid?: unknown;
  metadata?: unknown;
  identifier?: unknown;
  status?: unknown;
  category?: unknown;
  code?: unknown;
  effectiveDateTime?: unknown;
  effectivePeriod?: unknown;
  valueQuantity?: unknown;
  valueCodeableConcept?: unknown;
  component?: unknown;
  device?: unknown;
  meta?: unknown;
}

export interface HealthSampleRejection {
  uuid: string;
  type: string;
  reason: string;
}

export interface HealthSampleIngestResult {
  received: number;
  accepted: number;
  stored: number;
  duplicates: number;
  rejected: number;
  errors?: HealthSampleRejection[];
}

export interface HealthSampleListItem {
  id: string;
  external_uuid: string;
  identifier_system?: string;
  vendor_type: string;
  metric_type: string;
  code?: string;
  code_system?: string;
  category?: string;
  start_time: string;
  end_time: string;
  value_num?: number;
  unit?: string;
  value_text?: string;
  components?: ObservationComponentValue[];
  correlation_uuid?: string;
  source_name?: string;
  device_name?: string;
}

export interface HealthSyncStateView {
  device_id: string;
  metric_type: string;
  anchor: string;
  last_sample_end_time?: string;
  last_synced_at: string;
  device_name?: string;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parseTime(value: unknown, field: string): Stamped {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} is required`);
  return parseOffsetTimestamp(value, field);
}

const MAX_TEXT = 200;
const MAX_ANCHORS = 32;
const MAX_ANCHOR = 1024;
const SERIES_DEFAULT_DAYS = 30;

function cap(value: string, field: string, max = MAX_TEXT): string {
  if (value.length > max) throw new Error(`${field} is longer than ${max} characters`);
  return value;
}

function optionalTime(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new ApiError(400, `${field} must be RFC 3339 with an explicit offset`);
  try {
    return parseTime(value, field).utc;
  } catch (err) {
    throw new ApiError(400, (err as Error).message);
  }
}

function clamp(n: number, fallback: number, max: number): number {
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n > max ? max : Math.trunc(n);
}

function emptyRow(): HealthSampleRow {
  return {
    id: randomBytes(12).toString('hex'),
    userId: '',
    externalUuid: '',
    identifierSystem: '',
    adapter: '',
    vendorType: '',
    metricType: '',
    codeSystem: '',
    code: '',
    category: '',
    subject: '',
    startTime: '',
    endTime: '',
    tzOffset: '',
    localDay: '',
    valueNum: null,
    unit: '',
    originalUnit: '',
    valueText: '',
    valueSystem: '',
    components: '',
    correlationUuid: '',
    sourceName: '',
    sourceBundleId: '',
    deviceName: '',
    sourceId: '',
    metadata: '',
    deleted: false,
  };
}

function applyMetricQuantity(row: HealthSampleRow, metric: ReturnType<typeof lookup>, value: number, unitRaw: string, fromHealthKit: boolean): void {
  if (!metric) return;
  row.metricType = metric.metricType;
  row.code = metric.code;
  row.codeSystem = LOINC;
  row.category = metric.category;
  const canonical = toCanonicalQuantity(metric, value, unitRaw, fromHealthKit);
  if (canonical === undefined) {
    throw new Error(`${metric.metricType} expects unit "${metric.canonicalUnit}", got "${unitRaw}"`);
  }
  assertInRange(metric.metricType, canonical.value);
  row.valueNum = canonical.value;
  row.unit = canonical.unit;
  row.originalUnit = canonical.originalUnit;
}

function codingOf(value: unknown): { system: string; code: string; display?: string } | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const rec = value as Record<string, unknown>;
  const coding = Array.isArray(rec.coding) ? rec.coding[0] : undefined;
  if (!coding || typeof coding !== 'object') {
    const code = asString(rec.code);
    return code ? { system: asString(rec.system), code } : undefined;
  }
  const c = coding as Record<string, unknown>;
  const code = asString(c.code);
  if (!code) return undefined;
  return { system: asString(c.system), code, display: asString(c.display) || undefined };
}

function identifierOf(input: HealthSampleInput): { system: string; value: string } {
  if (Array.isArray(input.identifier) && input.identifier[0] && typeof input.identifier[0] === 'object') {
    const first = input.identifier[0] as Record<string, unknown>;
    const value = asString(first.value).trim();
    if (value) return { system: asString(first.system) || 'urn:uuid', value };
  }
  return { system: 'urn:uuid', value: asString(input.uuid).trim() };
}

function effectiveOf(input: HealthSampleInput): { start: Stamped; end: Stamped } {
  const period = input.effectivePeriod && typeof input.effectivePeriod === 'object'
    ? input.effectivePeriod as Record<string, unknown>
    : undefined;
  if (period?.start) {
    const start = parseTime(period.start, 'effectivePeriod.start');
    const end = period.end ? parseTime(period.end, 'effectivePeriod.end') : start;
    return { start, end };
  }
  if (input.effectiveDateTime) {
    const start = parseTime(input.effectiveDateTime, 'effectiveDateTime');
    return { start, end: start };
  }
  const start = parseTime(input.start, 'start');
  if (input.end === undefined || input.end === null || input.end === '') return { start, end: start };
  const end = parseTime(input.end, 'end');
  return { start, end };
}

function stampRow(row: HealthSampleRow, start: Stamped, end: Stamped): void {
  if (Date.parse(end.utc) < Date.parse(start.utc)) throw new Error('end is before start');
  row.startTime = start.utc;
  row.endTime = end.utc;
  row.tzOffset = start.offset;
  row.localDay = start.localDay;
}

function adapterOf(input: HealthSampleInput): SampleAdapter {
  if (isObservation(input)) return 'fhir';
  const type = asString(input.type);
  if (type.startsWith('HK')) return 'healthkit';
  if (type.endsWith('Record') || type.includes('STAGE_TYPE')) return 'health-connect';
  return 'manual';
}

function isObservation(input: HealthSampleInput): boolean {
  return asString(input.resourceType) === 'Observation' || (!!input.code && !input.type);
}

function buildFromObservation(input: HealthSampleInput): HealthSampleRow {
  const id = identifierOf(input);
  if (id.value === '') throw new Error('identifier or uuid is required');
  const { start, end } = effectiveOf(input);

  const row = emptyRow();
  row.externalUuid = cap(id.value, 'identifier');
  row.identifierSystem = id.system;
  stampRow(row, start, end);
  row.adapter = 'fhir';
  row.deleted = input.status === 'entered-in-error';
  const meta = input.meta && typeof input.meta === 'object' ? input.meta as Record<string, unknown> : undefined;
  row.sourceName = cap(asString(input.source_name) || asString(meta?.source), 'source_name');
  row.sourceBundleId = cap(asString(input.source_bundle_id), 'source_bundle_id');
  const device = input.device && typeof input.device === 'object' ? input.device as Record<string, unknown> : undefined;
  row.deviceName = cap(asString(device?.display) || asString(input.device_name), 'device_name');

  const code = codingOf(input.code);
  const vendorKey = code?.system === HK_TYPE_SYSTEM ? code.code : code?.code ?? '';
  const metric = (code ? lookupByCode(code.code) : undefined) ?? lookup(vendorKey);
  row.vendorType = lookup(vendorKey) ? vendorKey : (code?.system === HK_TYPE_SYSTEM ? code.code : '');

  const qty = input.valueQuantity && typeof input.valueQuantity === 'object'
    ? input.valueQuantity as Record<string, unknown>
    : undefined;
  const concept = codingOf(input.valueCodeableConcept);

  const rawComponents = Array.isArray(input.component) ? input.component : [];
  const components: ObservationComponentValue[] = [];
  for (const raw of rawComponents) {
    if (!raw || typeof raw !== 'object') continue;
    const rec = raw as Record<string, unknown>;
    const c = codingOf(rec.code);
    const q = rec.valueQuantity && typeof rec.valueQuantity === 'object' ? rec.valueQuantity as Record<string, unknown> : undefined;
    const value = asNumber(q?.value);
    if (!c || value === undefined) continue;
    const compMetric = lookupByCode(c.code);
    const unitHint = asString(q?.code) || asString(q?.unit);
    const unit = compMetric
      ? (normalizeUnit(compMetric, unitHint || metric?.canonicalUnit || '') ?? unitHint)
      : unitHint;
    components.push({ code: c.code, display: c.display, value, unit });
  }

  if (metric) {
    row.metricType = metric.metricType;
    row.code = metric.code;
    row.codeSystem = LOINC;
    row.category = metric.category;
    if (metric.kind === 'panel' || components.length > 0) {
      if (components.length === 0) throw new Error(`${metric.metricType} requires component values`);
      row.components = serializeComponents(components);
      row.unit = metric.canonicalUnit;
    } else if (metric.kind === 'quantity') {
      const value = asNumber(qty?.value);
      if (value === undefined) throw new Error(`${metric.metricType} requires a numeric value`);
      applyMetricQuantity(row, metric, value, asString(qty?.code) || asString(qty?.unit) || asString(input.unit), false);
    } else {
      const text = concept?.code || asString(input.value_text);
      const value = resolveStage(metric, text, 'fhir') ?? (text.trim() === '' ? undefined : text.trim());
      if (value === undefined) throw new Error(`${metric.metricType} does not accept value "${text}"`);
      const known = resolveStage(metric, text, 'fhir');
      row.code = known ?? '';
      row.valueText = cap(value, 'value');
      row.valueSystem = concept?.system || (known ? LOINC : '');
    }
  } else {
    row.code = code?.code ?? '';
    row.codeSystem = code?.system ?? '';
    if (qty && asNumber(qty.value) !== undefined) {
      row.valueNum = asNumber(qty.value) ?? null;
      row.unit = asString(qty.code) || asString(qty.unit);
    } else if (concept) {
      row.valueText = concept.code;
    } else if (components.length) {
      row.components = serializeComponents(components);
    } else {
      const value = asNumber(input.value);
      row.valueNum = value === undefined ? null : value;
      row.unit = asString(input.unit).trim();
      row.valueText = asString(input.value_text).trim();
    }
  }

  if (input.metadata && typeof input.metadata === 'object') {
    try { row.metadata = cap(JSON.stringify(input.metadata), 'metadata', 2000); } catch { throw new Error('metadata is not serializable'); }
  }
  return row;
}

function buildFromHealthKit(input: HealthSampleInput): HealthSampleRow {
  const externalUuid = asString(input.uuid).trim();
  if (externalUuid === '') throw new Error('uuid is required');
  const vendorType = asString(input.type).trim();
  if (vendorType === '') throw new Error('type is required');
  const { start, end } = effectiveOf({ ...input, start: input.start, end: input.end });

  const row = emptyRow();
  row.externalUuid = cap(externalUuid, 'uuid');
  row.identifierSystem = 'urn:uuid';
  row.adapter = adapterOf(input);
  row.vendorType = vendorType;
  stampRow(row, start, end);
  row.deleted = input.metadata !== undefined && typeof input.metadata === 'object' && (input.metadata as Record<string, unknown>)['deleted'] === true;
  row.correlationUuid = cap(asString(input.correlation_uuid), 'correlation_uuid');
  row.sourceName = cap(asString(input.source_name), 'source_name');
  row.sourceBundleId = cap(asString(input.source_bundle_id), 'source_bundle_id');
  row.deviceName = cap(asString(input.device_name), 'device_name');

  const metric = lookup(vendorType);
  if (!metric) {
    const value = asNumber(input.value);
    row.valueNum = value === undefined ? null : value;
    row.unit = asString(input.unit).trim();
    row.valueText = asString(input.value_text).trim();
  } else if (metric.kind === 'panel') {
    const value = asNumber(input.value);
    if (value === undefined) throw new Error(`${metric.metricType} requires a numeric value`);
    const canonical = toCanonicalQuantity(metric, value, asString(input.unit), true);
    if (canonical === undefined) {
      throw new Error(`${metric.metricType} expects unit "${metric.canonicalUnit}", got "${asString(input.unit)}"`);
    }
    assertInRange(componentOf(metric, vendorType)?.metricType ?? metric.metricType, canonical.value);
    const component = componentOf(metric, vendorType) ?? componentOf(metric, asString(input.type));
    if (!component) throw new Error(`${vendorType} is not a blood-pressure component`);
    row.metricType = metric.metricType;
    row.code = metric.code;
    row.codeSystem = LOINC;
    row.category = metric.category;
    row.unit = canonical.unit;
    row.originalUnit = canonical.originalUnit;
    row.components = serializeComponents([{ code: component.code, display: component.display, value: canonical.value, unit: canonical.unit }]);
  } else if (metric.kind === 'quantity') {
    const value = asNumber(input.value);
    if (value === undefined) throw new Error(`${metric.metricType} requires a numeric value`);
    applyMetricQuantity(row, metric, value, asString(input.unit), true);
  } else {
    row.metricType = metric.metricType;
    row.category = metric.category;
    const rawStage = asString(input.value_text);
    const value = resolveStage(metric, rawStage, row.adapter === 'health-connect' ? 'health-connect' : 'healthkit');
    row.code = value ?? '';
    row.codeSystem = value ? LOINC : '';
    row.valueText = cap(value || rawStage, 'value');
    row.valueSystem = value ? LOINC : '';
    if (rawStage.trim() === '') throw new Error(`${metric.metricType} does not accept value ""`);
  }

  if (input.metadata && typeof input.metadata === 'object') {
    try { row.metadata = cap(JSON.stringify(input.metadata), 'metadata', 2000); } catch { throw new Error('metadata is not serializable'); }
  }
  return row;
}

function buildSample(input: HealthSampleInput): HealthSampleRow {
  return isObservation(input) ? buildFromObservation(input) : buildFromHealthKit(input);
}

function mergeBloodPressure(rows: HealthSampleRow[]): HealthSampleRow[] {
  const panels = new Map<string, HealthSampleRow>();
  const out: HealthSampleRow[] = [];
  for (const row of rows) {
    if (row.code !== '85354-9' || !row.correlationUuid) {
      out.push(row);
      continue;
    }
    const existing = panels.get(row.correlationUuid);
    if (!existing) {
      const copy = { ...row, externalUuid: row.correlationUuid || row.externalUuid, vendorType: 'HKCorrelationTypeIdentifierBloodPressure' };
      panels.set(row.correlationUuid, copy);
      continue;
    }
    const merged = [...parseComponentsSafe(existing.components), ...parseComponentsSafe(row.components)];
    const byCode = new Map(merged.map((c) => [c.code, c]));
    existing.components = serializeComponents([...byCode.values()]);
    if (Date.parse(row.startTime) < Date.parse(existing.startTime)) existing.startTime = row.startTime;
    if (Date.parse(row.endTime) > Date.parse(existing.endTime)) existing.endTime = row.endTime;
  }
  out.push(...panels.values());
  return out;
}

function parseComponentsSafe(raw: string): ObservationComponentValue[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as ObservationComponentValue[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** A window longer than 45 days is weeks; longer than 180 is months. Steps and sleep add. Rates average the daily means. */
function coarsenDaily(daily: HealthDailyBucket[], how: 'sum' | 'mean', startAfter?: string, startBefore?: string): HealthDailyBucket[] {
  if (!startAfter || !startBefore || daily.length === 0) return daily;
  const span = (Date.parse(startBefore) - Date.parse(startAfter)) / 86_400_000;
  if (!Number.isFinite(span) || span <= 45) return daily;
  const keyOf = span <= 180
    ? (date: string) => {
        const instant = new Date(`${date}T00:00:00Z`);
        const monday = new Date(instant.getTime() - ((instant.getUTCDay() + 6) % 7) * 86_400_000);
        return monday.toISOString().slice(0, 10);
      }
    : (date: string) => `${date.slice(0, 7)}-01`;
  const groups = new Map<string, HealthDailyBucket[]>();
  for (const bucket of daily) {
    const key = keyOf(bucket.date);
    const list = groups.get(key) ?? [];
    list.push(bucket);
    groups.set(key, list);
  }
  return [...groups.entries()].sort().map(([date, list]) => {
    const total = list.reduce((sum, bucket) => sum + bucket.value, 0);
    return { date, value: how === 'sum' ? total : total / list.length, n: list.length };
  });
}

function expandBundle(raw: unknown): unknown[] {
  if (!raw || typeof raw !== 'object') return [];
  const rec = raw as Record<string, unknown>;
  if (asString(rec.resourceType) !== 'Bundle' || !Array.isArray(rec.entry)) return [];
  return rec.entry.map((e) => (e && typeof e === 'object' ? (e as Record<string, unknown>).resource : undefined)).filter(Boolean);
}

export class HealthManager extends BaseManager {
  readonly name = 'health' as const;
  override readonly dependsOn = [] as const;

  constructor(engine: Engine, private readonly provider: BaseHealthProvider) {
    super(engine);
  }

  override async initialize(config: Record<string, unknown> = {}): Promise<void> {
    await this.provider.initialize();
    await super.initialize(config);
  }

  private who(ctx: ApiContext): string {
    ctx.requireAuthenticated();
    return ctx.username;
  }

  private async subjectFor(ctx: ApiContext): Promise<string> {
    if (!this.engine.has('records') || !this.engine.has('sources')) return '';
    try {
      return (await this.engine.managers.records.selfPatient(ctx)).reference;
    } catch {
      return '';
    }
  }

  async ingest(
    ctx: ApiContext,
    body: {
      device?: { device_id?: unknown; name?: unknown };
      samples?: unknown;
      anchors?: unknown;
      resourceType?: unknown;
      entry?: unknown;
    }
  ): Promise<HealthSampleIngestResult> {
    const userId = this.who(ctx);
    const sourceId = await this.sourceFor(ctx, body);
    const deviceId = asString(body.device?.device_id).trim() || sourceId;

    if (body.samples !== undefined && !Array.isArray(body.samples) && asString(body.resourceType) !== 'Bundle') {
      throw new ApiError(400, 'invalid request: samples must be an array');
    }
    const rawSamples = Array.isArray(body.samples) ? body.samples : expandBundle(body);
    if (rawSamples.length > HEALTH_SAMPLE_MAX_BATCH) {
      throw new ApiError(400, `batch contains ${rawSamples.length} samples; the maximum is ${HEALTH_SAMPLE_MAX_BATCH}`);
    }

    const accepted: HealthSampleRow[] = [];
    const errors: HealthSampleRejection[] = [];
    let rejected = 0;
    const latestEnd = new Map<string, string>();
    const subject = await this.subjectFor(ctx);

    for (const raw of rawSamples) {
      const input = (raw && typeof raw === 'object' ? raw : {}) as HealthSampleInput;
      try {
        const sample = buildSample(input);
        sample.subject = subject;
        sample.sourceId = sourceId;
        accepted.push(sample);
        if (sample.metricType) {
          const current = latestEnd.get(sample.metricType);
          if (!current || sample.endTime > current) latestEnd.set(sample.metricType, sample.endTime);
        }
      } catch (err) {
        rejected++;
        if (errors.length < HEALTH_SAMPLE_MAX_REPORTED_ERRORS) {
          errors.push({
            uuid: identifierOf(input).value || asString(input.uuid),
            type: asString(input.type) || codingOf(input.code)?.code || '',
            reason: (err as Error).message,
          });
        }
      }
    }

    const merged = await this.pairBloodPressure(userId, accepted);
    const stored = await this.provider.insertSamples(userId, merged);
    await this.tombstoneBloodPressureHalves(userId, merged);
    if (this.engine.has('records') && this.engine.has('sources')) {
      const heldSource = new Map<string, string>();
      await publishSamples(merged, sourceId, subject, {
        save: async (preferred, resource) => {
          const id = typeof resource.id === 'string' ? resource.id : '';
          let target = preferred;
          if (id && heldSource.has(id)) target = heldSource.get(id)!;
          else if (id) {
            try {
              const existing = asString((await this.engine.managers.records.detail(ctx, id))['source_id']);
              if (existing) target = existing;
            } catch { /* this day's observation does not exist yet */ }
          }
          await this.engine.managers.records.saveDeviceRecord(ctx, target, resource as never);
          if (id) heldSource.set(id, target);
        },
        rowsForLocalDays: (metricType, localDays) => this.provider.rowsForLocalDays(userId, metricType, localDays),
      });
    }
    const now = new Date().toISOString();
    const anchors = body.anchors && typeof body.anchors === 'object' && !Array.isArray(body.anchors)
      ? body.anchors as Record<string, unknown>
      : {};
    const anchorEntries = Object.entries(anchors);
    if (anchorEntries.length > MAX_ANCHORS) throw new ApiError(400, `at most ${MAX_ANCHORS} anchors`);
    const syncRows = [];
    for (const [metricTypeRaw, anchorRaw] of anchorEntries) {
      const metricType = metricTypeRaw.trim();
      if (metricType === '') continue;
      const anchor = asString(anchorRaw);
      if (anchor.length > MAX_ANCHOR) throw new ApiError(400, 'anchor is longer than 1024 characters');
      syncRows.push({
        userId,
        deviceId,
        metricType: cap(metricType, 'anchor metric', 64),
        anchor,
        lastSampleEndTime: latestEnd.get(metricType) ?? latestEnd.get(lookupByMetricType(metricType)?.metricType ?? '') ?? '',
        lastSyncedAt: now,
        deviceName: cap(asString(body.device?.name), 'device.name'),
      });
    }
    await this.provider.upsertSyncStates(syncRows);

    return {
      received: rawSamples.length,
      accepted: merged.length,
      stored,
      duplicates: Math.max(0, merged.length - stored),
      rejected,
      ...(errors.length > 0 ? { errors } : {}),
    };
  }

  private parseListQuery(query: {
    codes?: string[];
    metricTypes?: string[];
    vendorType?: string;
    startAfter?: unknown;
    startBefore?: unknown;
    limit?: unknown;
    offset?: unknown;
    sort?: unknown;
  }): HealthSampleQuery {
    const resolved = codesForQuery(query.metricTypes ?? [], query.codes ?? [], query.vendorType ?? '');
    return {
      codes: resolved.codes,
      metricTypes: resolved.codes.length ? [] : (query.metricTypes ?? []),
      vendorType: resolved.codes.length ? '' : resolved.vendorType,
      startAfter: optionalTime(query.startAfter, 'start_after'),
      startBefore: optionalTime(query.startBefore, 'start_before'),
      limit: clamp(Number(query.limit), HEALTH_SAMPLE_DEFAULT_LIMIT, HEALTH_SAMPLE_MAX_LIMIT),
      offset: Math.max(0, Math.trunc(Number(query.offset) || 0)),
      sortAscending: String(query.sort ?? '').toLowerCase() === 'asc',
    };
  }

  async list(
    ctx: ApiContext,
    query: {
      codes?: string[];
      metricTypes?: string[];
      vendorType?: string;
      startAfter?: unknown;
      startBefore?: unknown;
      limit?: unknown;
      offset?: unknown;
      sort?: unknown;
    }
  ): Promise<{ total: number; count: number; offset: number; samples: HealthSampleListItem[] }> {
    const userId = this.who(ctx);
    if (query.limit !== undefined && query.limit !== '' && !Number.isFinite(Number(query.limit))) {
      throw new ApiError(400, 'limit must be an integer');
    }
    if (query.offset !== undefined && query.offset !== '' && !Number.isFinite(Number(query.offset))) {
      throw new ApiError(400, 'offset must be an integer');
    }
    const parsed = this.parseListQuery(query);
    const { samples, total } = await this.provider.listSamples(userId, parsed);
    return {
      total,
      count: samples.length,
      offset: parsed.offset,
      samples: samples.map((s) => this.toListItem(s)),
    };
  }

  async observation(ctx: ApiContext, id: string): Promise<Observation> {
    const userId = this.who(ctx);
    const row = await this.provider.readSample(userId, id);
    if (!row) throw new ApiError(404, 'not found');
    return toObservation(row, row.subject || await this.subjectFor(ctx));
  }

  async bundle(
    ctx: ApiContext,
    query: {
      codes?: string[];
      metricTypes?: string[];
      vendorType?: string;
      startAfter?: unknown;
      startBefore?: unknown;
    }
  ): Promise<Bundle<Observation>> {
    const userId = this.who(ctx);
    const parsed = this.parseListQuery({ ...query, limit: HEALTH_SAMPLE_MAX_LIMIT, offset: 0, sort: 'asc' });
    parsed.limit = HEALTH_SAMPLE_MAX_LIMIT;
    const { samples } = await this.provider.listSamples(userId, parsed);
    return toBundle(samples, samples[0]?.subject || await this.subjectFor(ctx));
  }

  private toListItem(s: HealthSampleRow): HealthSampleListItem {
    const components = parseComponentsSafe(s.components);
    return {
      id: s.id,
      external_uuid: s.externalUuid,
      ...(s.identifierSystem ? { identifier_system: s.identifierSystem } : {}),
      vendor_type: s.vendorType,
      metric_type: s.metricType,
      ...(s.code ? { code: s.code } : {}),
      ...(s.codeSystem ? { code_system: s.codeSystem } : {}),
      ...(s.category ? { category: s.category } : {}),
      start_time: s.startTime,
      end_time: s.endTime,
      ...(s.valueNum != null ? { value_num: s.valueNum } : {}),
      ...(s.unit ? { unit: s.unit } : {}),
      ...(s.valueText ? { value_text: s.valueText } : {}),
      ...(components.length ? { components } : {}),
      ...(s.correlationUuid ? { correlation_uuid: s.correlationUuid } : {}),
      ...(s.sourceName ? { source_name: s.sourceName } : {}),
      ...(s.deviceName ? { device_name: s.deviceName } : {}),
    };
  }

  async metrics(ctx: ApiContext): Promise<{ last_synced_at?: string; metrics: HealthMetricSummary[] }> {
    const userId = this.who(ctx);
    const metrics = await this.provider.summarizeMetrics(userId);
    const states = await this.provider.listSyncStates(userId, '');
    let last: string | undefined;
    for (const state of states) {
      if (!last || state.lastSyncedAt > last) last = state.lastSyncedAt;
    }
    return { metrics, ...(last ? { last_synced_at: last } : {}) };
  }

  async series(
    ctx: ApiContext,
    query: {
      codes?: string[];
      metricTypes?: string[];
      vendorType?: string;
      startAfter?: unknown;
      startBefore?: unknown;
      maxPoints?: unknown;
      mode?: unknown;
    }
  ): Promise<HealthSeries> {
    const userId = this.who(ctx);
    const modeRaw = asString(query.mode).trim() || 'points';
    if (modeRaw !== 'points' && modeRaw !== 'day' && modeRaw !== 'daily-stats' && modeRaw !== 'stages') {
      throw new ApiError(400, 'mode must be points, day, daily-stats, or stages');
    }
    const resolved = codesForQuery(query.metricTypes ?? [], query.codes ?? [], query.vendorType ?? '');
    if (resolved.codes.length === 0 && resolved.vendorType === '') {
      throw new ApiError(400, 'code, metric_type, or vendor_type is required');
    }
    if (query.maxPoints !== undefined && query.maxPoints !== '' && !Number.isFinite(Number(query.maxPoints))) {
      throw new ApiError(400, 'max_points must be an integer');
    }
    let startAfter = optionalTime(query.startAfter, 'start_after');
    let startBefore = optionalTime(query.startBefore, 'start_before');
    if (!startAfter && !startBefore) {
      const until = new Date();
      startBefore = until.toISOString().replace(/\.\d{3}Z$/, 'Z');
      startAfter = new Date(until.getTime() - SERIES_DEFAULT_DAYS * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    }
    const metric = lookupByCode(resolved.codes[0] ?? '') ?? lookupByMetricType((query.metricTypes ?? [])[0] ?? '');
    const detailPoints = modeRaw === 'points' && (!metric || isHighFrequency(metric.metricType));
    if (this.engine.has('records') && !detailPoints) {
      return this.seriesFromObservations(ctx, resolved.codes, modeRaw as HealthSeriesMode, startAfter, startBefore);
    }
    return this.provider.querySeries(userId, {
      codes: resolved.codes,
      metricTypes: resolved.codes.length ? [] : (query.metricTypes ?? []),
      vendorType: resolved.codes.length ? '' : resolved.vendorType,
      startAfter,
      startBefore,
      maxPoints: clamp(Number(query.maxPoints), HEALTH_SERIES_DEFAULT_POINTS, HEALTH_SERIES_MAX_POINTS),
      mode: modeRaw as HealthSeriesMode,
    });
  }

  async syncState(ctx: ApiContext, deviceId?: string): Promise<HealthSyncStateView[]> {
    const userId = this.who(ctx);
    return (await this.provider.listSyncStates(userId, deviceId?.trim() ?? '')).map((s) => ({
      device_id: s.deviceId,
      metric_type: s.metricType,
      anchor: s.anchor,
      ...(s.lastSampleEndTime ? { last_sample_end_time: s.lastSampleEndTime } : {}),
      last_synced_at: s.lastSyncedAt,
      ...(s.deviceName ? { device_name: s.deviceName } : {}),
    }));
  }

  async removeForUser(ctx: ApiContext): Promise<void> {
    await this.provider.removeForOwner(this.who(ctx));
  }

  override async shutdown(): Promise<void> {
    await this.provider.close();
  }

  /** Charts read the daily and spot Observations. A long window sums steps and sleep and averages the daily means. */
  private async seriesFromObservations(
    ctx: ApiContext,
    codes: string[],
    mode: HealthSeriesMode,
    startAfter?: string,
    startBefore?: string,
  ): Promise<HealthSeries> {
    const listed = await this.engine.managers.records.list(ctx, 'Observation');
    const wanted = new Set(codes);
    const readings: { date: string; code: string; value: number; min?: number; max?: number; components: { code: string; value: number }[] }[] = [];
    for (const item of listed) {
      const obs = item['resource_raw'] as Observation | undefined;
      if (!obs?.id?.startsWith('pghd-') || obs.status !== 'final') continue;
      const code = obs.code?.coding?.[0]?.code ?? '';
      const components = (obs.component ?? []).flatMap((part) => {
        const partCode = part.code?.coding?.[0]?.code ?? '';
        const value = part.valueQuantity?.value;
        if (!partCode || value == null) return [];
        return [{ code: partCode, value }];
      });
      if (wanted.size > 0 && !wanted.has(code) && !components.some((part) => wanted.has(part.code))) continue;
      const dated = /-(\d{4}-\d{2}-\d{2})$/.exec(obs.id)?.[1] ?? (obs.effectiveDateTime ?? obs.effectivePeriod?.start ?? '').slice(0, 10);
      if (dated.length < 10) continue;
      if (startAfter && dated < startAfter.slice(0, 10)) continue;
      if (startBefore && dated >= startBefore.slice(0, 10)) continue;
      const min = obs.component?.find((part) => part.code?.text === 'minimum')?.valueQuantity?.value;
      const max = obs.component?.find((part) => part.code?.text === 'maximum')?.valueQuantity?.value;
      readings.push({
        date: dated,
        code,
        value: obs.valueQuantity?.value ?? 0,
        ...(min != null ? { min } : {}),
        ...(max != null ? { max } : {}),
        components,
      });
    }
    const series: HealthSeries = { total: readings.length, downsampled: false, ...(codes[0] ? { code: codes[0] } : {}) };
    if (mode === 'stages') {
      const nights = new Map<string, Record<string, number>>();
      for (const reading of readings) {
        const stages = nights.get(reading.date) ?? {};
        stages[reading.code] = (stages[reading.code] ?? 0) + reading.value;
        nights.set(reading.date, stages);
      }
      series.nights = [...nights.entries()].sort().map(([date, stages]) => ({ date, stages }));
      return series;
    }
    if (mode === 'points') {
      const componentSeries = new Map<string, { t: string; v: number }[]>();
      const points: { t: string; v: number }[] = [];
      for (const reading of readings) {
        const measured = reading.components.filter((part) => part.code !== 'minimum' && part.code !== 'maximum');
        if (measured.length > 0) {
          for (const part of measured) {
            const list = componentSeries.get(part.code) ?? [];
            list.push({ t: `${reading.date}T00:00:00Z`, v: part.value });
            componentSeries.set(part.code, list);
          }
        } else {
          points.push({ t: `${reading.date}T00:00:00Z`, v: reading.value });
        }
      }
      if (componentSeries.size > 0) series.components = Object.fromEntries(componentSeries);
      else series.points = points;
      return series;
    }
    const byDate = new Map<string, typeof readings>();
    for (const reading of readings) {
      const list = byDate.get(reading.date) ?? [];
      list.push(reading);
      byDate.set(reading.date, list);
    }
    const daily = [...byDate.entries()].sort().map(([date, list]): HealthDailyBucket => {
      const values = list.map((item) => item.value);
      const total = values.reduce((sum, value) => sum + value, 0);
      const mins = list.flatMap((item) => item.min == null ? [] : [item.min]);
      const maxs = list.flatMap((item) => item.max == null ? [] : [item.max]);
      return {
        date,
        value: mode === 'day' ? total : (values.length ? total / values.length : 0),
        ...(mins.length ? { min: Math.min(...mins) } : {}),
        ...(maxs.length ? { max: Math.max(...maxs) } : {}),
        n: list.length,
      };
    });
    series.daily = coarsenDaily(daily, mode === 'day' ? 'sum' : 'mean', startAfter, startBefore);
    series.downsampled = series.daily.length < daily.length;
    return series;
  }

  /** A device grant writes only into the source it already owns. A signed-in session reuses one upload source. */
  private async sourceFor(
    ctx: ApiContext,
    body: { source_id?: unknown; device?: { device_id?: unknown } },
  ): Promise<string> {
    const named = asString(body.source_id).trim();
    const grantId = ctx.viaToken?.grantId;
    if (ctx.viaToken && !grantId) {
      throw new ApiError(403, 'only a connected device the patient allowed may add health samples');
    }
    if (grantId) {
      if (!this.engine.has('agentTokens')) throw new ApiError(403, 'this device has no source');
      const owned = await this.engine.managers.agentTokens.sourceIdForGrant(grantId);
      if (!owned) throw new ApiError(403, 'this device has no source');
      if (named && named !== owned) throw new ApiError(403, 'a device writes only into its own source');
      return owned;
    }
    if (!this.engine.has('sources')) return named;
    const sources = await this.engine.managers.sources.list(ctx);
    const existing = sources.find((source) => source.platformType === DEVICE_PLATFORM_TYPE && source.display === 'Uploaded by you');
    const owned = existing ? `source-${existing.id}` : `source-${(await this.engine.managers.sources.addDeviceSource(ctx, 'Uploaded by you')).id}`;
    if (named && named !== owned) throw new ApiError(403, 'an upload writes only into its own source');
    return owned;
  }

  private async pairBloodPressure(userId: string, rows: HealthSampleRow[]): Promise<HealthSampleRow[]> {
    const incoming = new Set(rows.map((row) => row.externalUuid));
    const within = mergeBloodPressure(rows);
    const out: HealthSampleRow[] = [];
    for (const row of within) {
      if (!row.correlationUuid) {
        out.push(row);
        continue;
      }
      const existing = (await this.provider.rowsForCorrelation(userId, row.correlationUuid))
        .filter((prior) => !incoming.has(prior.externalUuid));
      const combined = mergeBloodPressure([...existing, row]);
      const panel = combined.find((item) => item.correlationUuid === row.correlationUuid) ?? row;
      panel.externalUuid = row.correlationUuid;
      panel.sourceId = row.sourceId;
      out.push(panel);
    }
    return out;
  }

  private async tombstoneBloodPressureHalves(userId: string, rows: HealthSampleRow[]): Promise<void> {
    const seen = new Set<string>();
    const tombstones: HealthSampleRow[] = [];
    for (const row of rows) {
      if (!row.correlationUuid || seen.has(row.correlationUuid)) continue;
      seen.add(row.correlationUuid);
      const stored = await this.provider.rowsForCorrelation(userId, row.correlationUuid);
      for (const prior of stored) {
        if (prior.externalUuid === row.externalUuid) continue;
        tombstones.push({ ...prior, deleted: true });
      }
    }
    if (tombstones.length > 0) await this.provider.insertSamples(userId, tombstones);
  }

  async backup(): Promise<BackupData> {
    return { manager: this.name, takenAt: new Date().toISOString() };
  }

  async restore(): Promise<void> { /* restored with the app database */ }
}
