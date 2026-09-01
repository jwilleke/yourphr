/**
 * Health samples — the one door for wearable PGHD ingest and the Health page reads.
 *
 * Rows are Observation-shaped (LOINC, UCUM, category) but they are NOT written through the FHIR
 * store. SqliteFhirRepository indexes every resource through FHIRPath; a year of five-minute
 * heart rate would not finish. Samples live in the app database. Reconstruct Observation JSON
 * on read/export via toObservation().
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
  codesForQuery,
  componentOf,
  lookup,
  lookupByCode,
  lookupByMetricType,
  normalizeCodeableValue,
  normalizeQuantityValue,
  normalizeUnit,
} from '../health/catalog.js';
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

function parseTime(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} is required`);
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new Error(`${field} must be an RFC3339 timestamp`);
  return new Date(ms).toISOString();
}

function optionalTime(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new ApiError(400, `${field} must be an RFC3339 timestamp`);
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new ApiError(400, `${field} must be an RFC3339 timestamp`);
  return new Date(ms).toISOString();
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
    vendorType: '',
    metricType: '',
    codeSystem: '',
    code: '',
    category: '',
    subject: '',
    startTime: '',
    endTime: '',
    valueNum: null,
    unit: '',
    valueText: '',
    components: '',
    correlationUuid: '',
    sourceName: '',
    sourceBundleId: '',
    deviceName: '',
    metadata: '',
  };
}

function applyMetricQuantity(row: HealthSampleRow, metric: ReturnType<typeof lookup>, value: number, unitRaw: string, fromHealthKit: boolean): void {
  if (!metric) return;
  row.metricType = metric.metricType;
  row.code = metric.code;
  row.codeSystem = LOINC;
  row.category = metric.category;
  const unit = normalizeUnit(metric, unitRaw);
  if (unit === undefined) {
    throw new Error(`${metric.metricType} expects unit "${metric.canonicalUnit}", got "${unitRaw}"`);
  }
  row.valueNum = normalizeQuantityValue(metric, value, fromHealthKit);
  row.unit = unit;
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

function effectiveOf(input: HealthSampleInput): { start: string; end: string } {
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

function isObservation(input: HealthSampleInput): boolean {
  return asString(input.resourceType) === 'Observation' || (!!input.code && !input.type);
}

function buildFromObservation(input: HealthSampleInput): HealthSampleRow {
  const id = identifierOf(input);
  if (id.value === '') throw new Error('identifier or uuid is required');
  const { start, end } = effectiveOf(input);
  if (Date.parse(end) < Date.parse(start)) throw new Error('end is before start');

  const row = emptyRow();
  row.externalUuid = id.value;
  row.identifierSystem = id.system;
  row.startTime = start;
  row.endTime = end;
  const meta = input.meta && typeof input.meta === 'object' ? input.meta as Record<string, unknown> : undefined;
  row.sourceName = asString(input.source_name) || asString(meta?.source);
  row.sourceBundleId = asString(input.source_bundle_id);
  const device = input.device && typeof input.device === 'object' ? input.device as Record<string, unknown> : undefined;
  row.deviceName = asString(device?.display) || asString(input.device_name);

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
      const value = normalizeCodeableValue(metric, text);
      if (value === undefined) throw new Error(`${metric.metricType} does not accept value "${text}"`);
      row.valueText = value;
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
    try { row.metadata = JSON.stringify(input.metadata); } catch { throw new Error('metadata is not serializable'); }
  }
  return row;
}

function buildFromHealthKit(input: HealthSampleInput): HealthSampleRow {
  const externalUuid = asString(input.uuid).trim();
  if (externalUuid === '') throw new Error('uuid is required');
  const vendorType = asString(input.type).trim();
  if (vendorType === '') throw new Error('type is required');
  const { start, end } = effectiveOf({ ...input, start: input.start, end: input.end });
  if (Date.parse(end) < Date.parse(start)) throw new Error('end is before start');

  const row = emptyRow();
  row.externalUuid = externalUuid;
  row.identifierSystem = 'urn:uuid';
  row.vendorType = vendorType;
  row.startTime = start;
  row.endTime = end;
  row.correlationUuid = asString(input.correlation_uuid);
  row.sourceName = asString(input.source_name);
  row.sourceBundleId = asString(input.source_bundle_id);
  row.deviceName = asString(input.device_name);

  const metric = lookup(vendorType);
  if (!metric) {
    const value = asNumber(input.value);
    row.valueNum = value === undefined ? null : value;
    row.unit = asString(input.unit).trim();
    row.valueText = asString(input.value_text).trim();
  } else if (metric.kind === 'panel') {
    const value = asNumber(input.value);
    if (value === undefined) throw new Error(`${metric.metricType} requires a numeric value`);
    const unit = normalizeUnit(metric, asString(input.unit));
    if (unit === undefined) {
      throw new Error(`${metric.metricType} expects unit "${metric.canonicalUnit}", got "${asString(input.unit)}"`);
    }
    const component = componentOf(metric, vendorType) ?? componentOf(metric, asString(input.type));
    if (!component) throw new Error(`${vendorType} is not a blood-pressure component`);
    row.metricType = metric.metricType;
    row.code = metric.code;
    row.codeSystem = LOINC;
    row.category = metric.category;
    row.unit = unit;
    row.components = serializeComponents([{ code: component.code, display: component.display, value, unit }]);
  } else if (metric.kind === 'quantity') {
    const value = asNumber(input.value);
    if (value === undefined) throw new Error(`${metric.metricType} requires a numeric value`);
    applyMetricQuantity(row, metric, value, asString(input.unit), true);
  } else {
    row.metricType = metric.metricType;
    row.code = metric.code;
    row.codeSystem = LOINC;
    row.category = metric.category;
    const value = normalizeCodeableValue(metric, asString(input.value_text));
    if (value === undefined) {
      throw new Error(`${metric.metricType} does not accept value "${asString(input.value_text)}"`);
    }
    row.valueText = value;
  }

  if (input.metadata && typeof input.metadata === 'object') {
    try { row.metadata = JSON.stringify(input.metadata); } catch { throw new Error('metadata is not serializable'); }
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
    if (!this.engine.has('records')) return '';
    try {
      const patients = await this.engine.managers.records.list(ctx, 'Patient', { limit: 1 });
      const first = patients[0] as { source_resource_id?: unknown } | undefined;
      const id = asString(first?.source_resource_id);
      return id ? `Patient/${id}` : '';
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
    const deviceId = asString(body.device?.device_id).trim();
    if (deviceId === '') throw new ApiError(400, 'device.device_id is required');

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

    const merged = mergeBloodPressure(accepted);
    const stored = await this.provider.insertSamples(userId, merged);
    const now = new Date().toISOString();
    const anchors = body.anchors && typeof body.anchors === 'object' && !Array.isArray(body.anchors)
      ? body.anchors as Record<string, unknown>
      : {};
    for (const [metricTypeRaw, anchorRaw] of Object.entries(anchors)) {
      const metricType = metricTypeRaw.trim();
      if (metricType === '') continue;
      await this.provider.upsertSyncState({
        userId,
        deviceId,
        metricType,
        anchor: asString(anchorRaw),
        lastSampleEndTime: latestEnd.get(metricType) ?? latestEnd.get(lookupByMetricType(metricType)?.metricType ?? '') ?? '',
        lastSyncedAt: now,
        deviceName: asString(body.device?.name),
      });
    }

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
    return this.provider.querySeries(userId, {
      codes: resolved.codes,
      metricTypes: resolved.codes.length ? [] : (query.metricTypes ?? []),
      vendorType: resolved.codes.length ? '' : resolved.vendorType,
      startAfter: optionalTime(query.startAfter, 'start_after'),
      startBefore: optionalTime(query.startBefore, 'start_before'),
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

  async backup(): Promise<BackupData> {
    return { manager: this.name, takenAt: new Date().toISOString() };
  }

  async restore(): Promise<void> { /* restored with the app database */ }
}
