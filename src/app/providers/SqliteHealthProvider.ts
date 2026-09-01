/** health_samples and health_sync_states in the app database. Every raw query over them lives here. */
import type Database from 'better-sqlite3-multiple-ciphers';
import { parseComponents } from '../health/observation.js';
import {
  BaseHealthProvider,
  HEALTH_SAMPLE_INSERT_BATCH,
  type HealthDailyBucket,
  type HealthMetricSummary,
  type HealthSampleQuery,
  type HealthSampleRow,
  type HealthSeries,
  type HealthSeriesQuery,
  type HealthStageNight,
  type HealthSyncStateRow,
} from './BaseHealthProvider.js';

export const HEALTH_SAMPLES_SCHEMA = `CREATE TABLE IF NOT EXISTS health_samples (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  external_uuid TEXT NOT NULL,
  identifier_system TEXT NOT NULL DEFAULT '',
  vendor_type TEXT NOT NULL DEFAULT '',
  metric_type TEXT NOT NULL DEFAULT '',
  code_system TEXT NOT NULL DEFAULT '',
  code TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  value_num REAL,
  unit TEXT NOT NULL DEFAULT '',
  value_text TEXT NOT NULL DEFAULT '',
  components TEXT NOT NULL DEFAULT '',
  correlation_uuid TEXT NOT NULL DEFAULT '',
  source_name TEXT NOT NULL DEFAULT '',
  source_bundle_id TEXT NOT NULL DEFAULT '',
  device_name TEXT NOT NULL DEFAULT '',
  metadata TEXT NOT NULL DEFAULT '',
  UNIQUE (user_id, external_uuid)
)`;

export const HEALTH_SYNC_STATES_SCHEMA = `CREATE TABLE IF NOT EXISTS health_sync_states (
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  metric_type TEXT NOT NULL,
  anchor TEXT NOT NULL DEFAULT '',
  last_sample_end_time TEXT NOT NULL DEFAULT '',
  last_synced_at TEXT NOT NULL,
  device_name TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (user_id, device_id, metric_type)
)`;

const INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_health_sample_series ON health_samples(user_id, metric_type, start_time)`,
  `CREATE INDEX IF NOT EXISTS idx_health_sample_code ON health_samples(user_id, code, start_time)`,
  `CREATE INDEX IF NOT EXISTS idx_health_sample_correlation ON health_samples(correlation_uuid)`,
];

const ADDED_COLUMNS: { name: string; sql: string }[] = [
  { name: 'identifier_system', sql: "identifier_system TEXT NOT NULL DEFAULT ''" },
  { name: 'code_system', sql: "code_system TEXT NOT NULL DEFAULT ''" },
  { name: 'code', sql: "code TEXT NOT NULL DEFAULT ''" },
  { name: 'category', sql: "category TEXT NOT NULL DEFAULT ''" },
  { name: 'subject', sql: "subject TEXT NOT NULL DEFAULT ''" },
  { name: 'components', sql: "components TEXT NOT NULL DEFAULT ''" },
];

interface SampleSqlRow {
  id: string; user_id: string; external_uuid: string; identifier_system: string;
  vendor_type: string; metric_type: string; code_system: string; code: string; category: string; subject: string;
  start_time: string; end_time: string; value_num: number | null; unit: string; value_text: string;
  components: string; correlation_uuid: string; source_name: string; source_bundle_id: string; device_name: string; metadata: string;
}

interface SyncSqlRow {
  user_id: string; device_id: string; metric_type: string; anchor: string;
  last_sample_end_time: string; last_synced_at: string; device_name: string;
}

function toSample(r: SampleSqlRow): HealthSampleRow {
  return {
    id: r.id, userId: r.user_id, externalUuid: r.external_uuid, identifierSystem: r.identifier_system ?? '',
    vendorType: r.vendor_type, metricType: r.metric_type, codeSystem: r.code_system ?? '', code: r.code ?? '',
    category: r.category ?? '', subject: r.subject ?? '',
    startTime: r.start_time, endTime: r.end_time, valueNum: r.value_num, unit: r.unit, valueText: r.value_text,
    components: r.components ?? '', correlationUuid: r.correlation_uuid, sourceName: r.source_name,
    sourceBundleId: r.source_bundle_id, deviceName: r.device_name, metadata: r.metadata,
  };
}

function toSync(r: SyncSqlRow): HealthSyncStateRow {
  return {
    userId: r.user_id, deviceId: r.device_id, metricType: r.metric_type, anchor: r.anchor,
    lastSampleEndTime: r.last_sample_end_time, lastSyncedAt: r.last_synced_at, deviceName: r.device_name,
  };
}

function sampleWhere(query: HealthSampleQuery): { sql: string; extra: unknown[] } {
  const clauses: string[] = [];
  const extra: unknown[] = [];
  if (query.codes.length > 0) {
    clauses.push(`code IN (${query.codes.map(() => '?').join(',')})`);
    extra.push(...query.codes);
  }
  if (query.metricTypes.length > 0) {
    clauses.push(`metric_type IN (${query.metricTypes.map(() => '?').join(',')})`);
    extra.push(...query.metricTypes);
  }
  if (query.vendorType) {
    clauses.push('vendor_type = ?');
    extra.push(query.vendorType);
  }
  if (query.startAfter) {
    clauses.push('start_time >= ?');
    extra.push(query.startAfter);
  }
  if (query.startBefore) {
    clauses.push('start_time < ?');
    extra.push(query.startBefore);
  }
  return { sql: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', extra };
}

function seriesWhere(query: HealthSeriesQuery): { sql: string; extra: unknown[] } {
  return sampleWhere({
    codes: query.codes,
    metricTypes: query.metricTypes,
    vendorType: query.vendorType,
    startAfter: query.startAfter,
    startBefore: query.startBefore,
    limit: 0, offset: 0, sortAscending: true,
  });
}

export class SqliteHealthProvider extends BaseHealthProvider {
  constructor(private readonly db: InstanceType<typeof Database>) {
    super();
    db.exec(HEALTH_SAMPLES_SCHEMA);
    db.exec(HEALTH_SYNC_STATES_SCHEMA);
    this.renameVendorTypeColumn();
    this.ensureColumns();
    for (const sql of INDEXES) db.exec(sql);
  }

  private ensureColumn(name: string, ddl: string): void {
    const cols = this.db.prepare('PRAGMA table_info(health_samples)').all() as { name: string }[];
    if (!cols.some((c) => c.name === name)) {
      this.db.exec(`ALTER TABLE health_samples ADD COLUMN ${ddl}`);
    }
  }

  private ensureColumns(): void {
    for (const col of ADDED_COLUMNS) this.ensureColumn(col.name, col.sql);
  }

  /** Databases created before the vendor_type rename still have hk_type. */
  private renameVendorTypeColumn(): void {
    const cols = this.db.prepare('PRAGMA table_info(health_samples)').all() as { name: string }[];
    const names = new Set(cols.map((c) => c.name));
    if (names.has('hk_type') && !names.has('vendor_type')) {
      this.db.exec('ALTER TABLE health_samples RENAME COLUMN hk_type TO vendor_type');
    }
  }

  async initialize(): Promise<void> { /* schema ensured in the constructor */ }

  async insertSamples(userId: string, rows: HealthSampleRow[]): Promise<number> {
    if (rows.length === 0) return 0;
    const insert = this.db.prepare(`INSERT INTO health_samples (
      id, user_id, external_uuid, identifier_system, vendor_type, metric_type, code_system, code, category, subject,
      start_time, end_time, value_num, unit, value_text, components, correlation_uuid, source_name, source_bundle_id, device_name, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, external_uuid) DO NOTHING`);
    let stored = 0;
    const write = this.db.transaction((batch: HealthSampleRow[]) => {
      for (const row of batch) {
        stored += insert.run(
          row.id, userId, row.externalUuid, row.identifierSystem, row.vendorType, row.metricType,
          row.codeSystem, row.code, row.category, row.subject,
          row.startTime, row.endTime, row.valueNum, row.unit, row.valueText, row.components,
          row.correlationUuid, row.sourceName, row.sourceBundleId, row.deviceName, row.metadata,
        ).changes;
      }
    });
    for (let i = 0; i < rows.length; i += HEALTH_SAMPLE_INSERT_BATCH) {
      write(rows.slice(i, i + HEALTH_SAMPLE_INSERT_BATCH));
    }
    return stored;
  }

  async listSamples(userId: string, query: HealthSampleQuery): Promise<{ samples: HealthSampleRow[]; total: number }> {
    const { sql, extra } = sampleWhere(query);
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM health_samples WHERE user_id = ?${sql}`).get(userId, ...extra) as { n: number }).n;
    const order = query.sortAscending ? 'start_time ASC' : 'start_time DESC';
    const samples = (this.db.prepare(
      `SELECT * FROM health_samples WHERE user_id = ?${sql} ORDER BY ${order} LIMIT ? OFFSET ?`
    ).all(userId, ...extra, query.limit, query.offset) as SampleSqlRow[]).map(toSample);
    return { samples, total };
  }

  async readSample(userId: string, id: string): Promise<HealthSampleRow | undefined> {
    const row = this.db.prepare('SELECT * FROM health_samples WHERE user_id = ? AND id = ?').get(userId, id) as SampleSqlRow | undefined;
    return row ? toSample(row) : undefined;
  }

  async summarizeMetrics(userId: string): Promise<HealthMetricSummary[]> {
    const aggs = this.db.prepare(`
      SELECT CASE
               WHEN code != '' THEN code
               WHEN metric_type != '' THEN metric_type
               ELSE vendor_type
             END AS metric_key,
             MAX(start_time) AS latest, MIN(start_time) AS earliest, COUNT(*) AS cnt
      FROM health_samples WHERE user_id = ?
      GROUP BY metric_key ORDER BY latest DESC
    `).all(userId) as { metric_key: string; latest: string; earliest: string; cnt: number }[];

    const summaries: HealthMetricSummary[] = [];
    const byCode = this.db.prepare(
      `SELECT * FROM health_samples WHERE user_id = ? AND code = ? AND start_time = ? ORDER BY id DESC LIMIT 1`
    );
    const byMetric = this.db.prepare(
      `SELECT * FROM health_samples WHERE user_id = ? AND metric_type = ? AND start_time = ? ORDER BY id DESC LIMIT 1`
    );
    const byVendor = this.db.prepare(
      `SELECT * FROM health_samples WHERE user_id = ? AND vendor_type = ? AND start_time = ? ORDER BY id DESC LIMIT 1`
    );
    for (const agg of aggs) {
      const row = (
        agg.metric_key.includes('-') || /^\d/.test(agg.metric_key)
          ? byCode.get(userId, agg.metric_key, agg.latest)
          : byMetric.get(userId, agg.metric_key, agg.latest) ?? byVendor.get(userId, agg.metric_key, agg.latest)
      ) as SampleSqlRow | undefined;
      if (!row) continue;
      const components = parseComponents(row.components ?? '');
      summaries.push({
        code: row.code ?? '',
        code_system: row.code_system ?? '',
        ...(row.category ? { category: row.category } : {}),
        metric_type: row.metric_type,
        vendor_type: row.vendor_type,
        ...(row.unit ? { unit: row.unit } : {}),
        ...(row.value_num != null ? { value_num: row.value_num } : {}),
        ...(row.value_text ? { value_text: row.value_text } : {}),
        ...(components.length ? { components } : {}),
        latest_at: row.start_time,
        earliest_at: agg.earliest,
        sample_count: agg.cnt,
        ...(row.source_name ? { source_name: row.source_name } : {}),
        ...(row.device_name ? { device_name: row.device_name } : {}),
      });
    }
    return summaries;
  }

  async querySeries(userId: string, query: HealthSeriesQuery): Promise<HealthSeries> {
    const { sql, extra } = seriesWhere(query);
    const series: HealthSeries = {
      total: 0,
      downsampled: false,
      ...(query.vendorType ? { vendor_type: query.vendorType } : {}),
      ...(query.codes[0] ? { code: query.codes[0] } : {}),
      ...(query.metricTypes[0] ? { metric_type: query.metricTypes[0] } : {}),
    };
    if (query.mode === 'day') return this.seriesDay(userId, sql, extra, series);
    if (query.mode === 'daily-stats') return this.seriesDailyStats(userId, sql, extra, series);
    if (query.mode === 'stages') return this.seriesStages(userId, sql, extra, series);
    return this.seriesPoints(userId, sql, extra, series, query.maxPoints);
  }

  private unitOf(userId: string, sql: string, extra: unknown[]): string {
    const row = this.db.prepare(`SELECT unit FROM health_samples WHERE user_id = ?${sql} LIMIT 1`).get(userId, ...extra) as { unit: string } | undefined;
    return row?.unit ?? '';
  }

  private seriesPoints(userId: string, sql: string, extra: unknown[], series: HealthSeries, maxPoints: number): HealthSeries {
    const panelRows = this.db.prepare(
      `SELECT start_time, value_num, components FROM health_samples WHERE user_id = ?${sql} ORDER BY start_time ASC`
    ).all(userId, ...extra) as { start_time: string; value_num: number | null; components: string }[];
    const componentSeries = new Map<string, { t: string; v: number }[]>();
    const scalar: { t: string; v: number }[] = [];
    for (const row of panelRows) {
      const parts = parseComponents(row.components ?? '');
      if (parts.length > 0) {
        for (const part of parts) {
          const list = componentSeries.get(part.code) ?? [];
          list.push({ t: row.start_time, v: part.value });
          componentSeries.set(part.code, list);
        }
      } else if (row.value_num != null) {
        scalar.push({ t: row.start_time, v: row.value_num });
      }
    }
    if (componentSeries.size > 0) {
      series.components = Object.fromEntries(componentSeries);
      const allValues = [...componentSeries.values()].flat().map((p) => p.v);
      series.total = panelRows.length;
      series.unit = this.unitOf(userId, sql, extra);
      if (allValues.length) {
        series.stats = {
          min: Math.min(...allValues),
          max: Math.max(...allValues),
          avg: allValues.reduce((a, b) => a + b, 0) / allValues.length,
        };
      }
      const first = componentSeries.values().next().value ?? [];
      if (first.length > maxPoints) {
        series.downsampled = true;
        for (const [code, points] of componentSeries) {
          componentSeries.set(code, downsample(points, maxPoints));
        }
        series.components = Object.fromEntries(componentSeries);
      }
      return series;
    }

    const stats = this.db.prepare(
      `SELECT MIN(value_num) AS min, MAX(value_num) AS max, AVG(value_num) AS avg, COUNT(*) AS n FROM health_samples WHERE user_id = ?${sql}`
    ).get(userId, ...extra) as { min: number | null; max: number | null; avg: number | null; n: number };
    series.total = stats.n;
    if (stats.n > 0 && (stats.min != null || stats.max != null || stats.avg != null)) {
      series.stats = {
        ...(stats.min != null ? { min: stats.min } : {}),
        ...(stats.max != null ? { max: stats.max } : {}),
        ...(stats.avg != null ? { avg: stats.avg } : {}),
      };
    }
    if (stats.n === 0) return series;
    const unit = this.unitOf(userId, sql, extra);
    if (unit) series.unit = unit;

    if (stats.n <= maxPoints) {
      series.points = scalar.length ? scalar : (this.db.prepare(
        `SELECT start_time, value_num FROM health_samples WHERE user_id = ?${sql} AND value_num IS NOT NULL ORDER BY start_time ASC LIMIT ?`
      ).all(userId, ...extra, maxPoints) as { start_time: string; value_num: number }[]).map((r) => ({ t: r.start_time, v: r.value_num }));
      return series;
    }

    const span = this.db.prepare(
      `SELECT MIN(start_time) AS first, MAX(start_time) AS last FROM health_samples WHERE user_id = ?${sql}`
    ).get(userId, ...extra) as { first: string | null; last: string | null };
    const first = span.first ? Date.parse(span.first) : NaN;
    const last = span.last ? Date.parse(span.last) : NaN;
    let durationMs = last - first;
    if (!Number.isFinite(durationMs) || durationMs <= 0) durationMs = 1000;
    let bucketSeconds = Math.floor(durationMs / 1000 / maxPoints);
    if (bucketSeconds < 1) bucketSeconds = 1;

    const buckets = this.db.prepare(
      `SELECT CAST(strftime('%s', start_time) / ? AS INTEGER) * ? AS bucket, AVG(value_num) AS avg_v
       FROM health_samples WHERE user_id = ?${sql} AND value_num IS NOT NULL
       GROUP BY bucket ORDER BY bucket ASC`
    ).all(bucketSeconds, bucketSeconds, userId, ...extra) as { bucket: number; avg_v: number }[];
    series.downsampled = true;
    series.points = buckets.map((b) => ({ t: new Date(b.bucket * 1000).toISOString(), v: b.avg_v }));
    return series;
  }

  private seriesDay(userId: string, sql: string, extra: unknown[], series: HealthSeries): HealthSeries {
    series.total = (this.db.prepare(`SELECT COUNT(*) AS n FROM health_samples WHERE user_id = ?${sql}`).get(userId, ...extra) as { n: number }).n;
    const unit = this.unitOf(userId, sql, extra);
    if (unit) series.unit = unit;
    series.daily = this.db.prepare(
      `SELECT date(start_time) AS date, COALESCE(SUM(value_num), 0) AS value
       FROM health_samples WHERE user_id = ?${sql}
       GROUP BY date(start_time) ORDER BY date ASC`
    ).all(userId, ...extra) as HealthDailyBucket[];
    return series;
  }

  private seriesDailyStats(userId: string, sql: string, extra: unknown[], series: HealthSeries): HealthSeries {
    const panelRows = this.db.prepare(
      `SELECT date(start_time) AS date, value_num, components FROM health_samples WHERE user_id = ?${sql} ORDER BY start_time ASC`
    ).all(userId, ...extra) as { date: string; value_num: number | null; components: string }[];
    const fromComponents: { date: string; v: number }[] = [];
    for (const row of panelRows) {
      const parts = parseComponents(row.components ?? '');
      const sys = parts.find((p) => p.code === '8480-6') ?? parts[0];
      if (sys) fromComponents.push({ date: row.date, v: sys.value });
      else if (row.value_num != null) fromComponents.push({ date: row.date, v: row.value_num });
    }
    if (fromComponents.length && panelRows.some((r) => (r.components ?? '') !== '')) {
      const values = fromComponents.map((p) => p.v);
      series.total = panelRows.length;
      series.stats = {
        min: Math.min(...values),
        max: Math.max(...values),
        avg: values.reduce((a, b) => a + b, 0) / values.length,
      };
      const unit = this.unitOf(userId, sql, extra);
      if (unit) series.unit = unit;
      const byDate = new Map<string, { sum: number; n: number; min: number; max: number }>();
      for (const point of fromComponents) {
        const bucket = byDate.get(point.date) ?? { sum: 0, n: 0, min: point.v, max: point.v };
        bucket.sum += point.v;
        bucket.n += 1;
        bucket.min = Math.min(bucket.min, point.v);
        bucket.max = Math.max(bucket.max, point.v);
        byDate.set(point.date, bucket);
      }
      series.daily = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, b]) => ({
        date, value: b.sum / b.n, min: b.min, max: b.max, n: b.n,
      }));
      return series;
    }
    const stats = this.db.prepare(
      `SELECT MIN(value_num) AS min, MAX(value_num) AS max, AVG(value_num) AS avg, COUNT(*) AS n FROM health_samples WHERE user_id = ?${sql} AND value_num IS NOT NULL`
    ).get(userId, ...extra) as { min: number | null; max: number | null; avg: number | null; n: number };
    series.total = stats.n;
    if (stats.n > 0 && (stats.min != null || stats.max != null || stats.avg != null)) {
      series.stats = {
        ...(stats.min != null ? { min: stats.min } : {}),
        ...(stats.max != null ? { max: stats.max } : {}),
        ...(stats.avg != null ? { avg: stats.avg } : {}),
      };
    }
    const unit = this.unitOf(userId, sql, extra);
    if (unit) series.unit = unit;
    if (stats.n === 0) {
      series.daily = [];
      return series;
    }
    const rows = this.db.prepare(
      `SELECT date(start_time) AS date, MIN(value_num) AS min, MAX(value_num) AS max, AVG(value_num) AS avg, COUNT(*) AS n
       FROM health_samples WHERE user_id = ?${sql} AND value_num IS NOT NULL
       GROUP BY date(start_time) ORDER BY date ASC`
    ).all(userId, ...extra) as { date: string; min: number; max: number; avg: number; n: number }[];
    series.daily = rows.map((r) => ({ date: r.date, value: r.avg, min: r.min, max: r.max, n: r.n }));
    return series;
  }

  private seriesStages(userId: string, sql: string, extra: unknown[], series: HealthSeries): HealthSeries {
    series.total = (this.db.prepare(`SELECT COUNT(*) AS n FROM health_samples WHERE user_id = ?${sql}`).get(userId, ...extra) as { n: number }).n;
    const rows = this.db.prepare(
      `SELECT date(start_time, '-12 hours') AS date, value_text AS stage,
              SUM((julianday(end_time) - julianday(start_time)) * 24.0) AS hours
       FROM health_samples WHERE user_id = ?${sql} AND value_text != ''
       GROUP BY date(start_time, '-12 hours'), value_text
       ORDER BY date ASC`
    ).all(userId, ...extra) as { date: string; stage: string; hours: number }[];
    const byDate = new Map<string, HealthStageNight>();
    const order: string[] = [];
    for (const row of rows) {
      let night = byDate.get(row.date);
      if (!night) {
        night = { date: row.date, stages: {} };
        byDate.set(row.date, night);
        order.push(row.date);
      }
      night.stages[row.stage] = row.hours;
    }
    series.nights = order.map((d) => byDate.get(d)!);
    return series;
  }

  async upsertSyncState(row: HealthSyncStateRow): Promise<void> {
    this.db.prepare(`INSERT INTO health_sync_states
      (user_id, device_id, metric_type, anchor, last_sample_end_time, last_synced_at, device_name)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, device_id, metric_type) DO UPDATE SET
        anchor = excluded.anchor,
        last_sample_end_time = excluded.last_sample_end_time,
        last_synced_at = excluded.last_synced_at,
        device_name = excluded.device_name`)
      .run(row.userId, row.deviceId, row.metricType, row.anchor, row.lastSampleEndTime, row.lastSyncedAt, row.deviceName);
  }

  async listSyncStates(userId: string, deviceId: string): Promise<HealthSyncStateRow[]> {
    const rows = deviceId
      ? this.db.prepare(`SELECT * FROM health_sync_states WHERE user_id = ? AND device_id = ? ORDER BY device_id ASC, metric_type ASC`).all(userId, deviceId)
      : this.db.prepare(`SELECT * FROM health_sync_states WHERE user_id = ? ORDER BY device_id ASC, metric_type ASC`).all(userId);
    return (rows as SyncSqlRow[]).map(toSync);
  }

  async removeForOwner(userId: string): Promise<void> {
    this.db.prepare('DELETE FROM health_samples WHERE user_id = ?').run(userId);
    this.db.prepare('DELETE FROM health_sync_states WHERE user_id = ?').run(userId);
  }
}

function downsample(points: { t: string; v: number }[], maxPoints: number): { t: string; v: number }[] {
  if (points.length <= maxPoints) return points;
  const first = Date.parse(points[0]!.t);
  const last = Date.parse(points[points.length - 1]!.t);
  let durationMs = last - first;
  if (!Number.isFinite(durationMs) || durationMs <= 0) durationMs = 1000;
  const bucketMs = Math.max(1, durationMs / maxPoints);
  const buckets = new Map<number, { sum: number; n: number }>();
  for (const point of points) {
    const key = Math.floor((Date.parse(point.t) - first) / bucketMs);
    const bucket = buckets.get(key) ?? { sum: 0, n: 0 };
    bucket.sum += point.v;
    bucket.n += 1;
    buckets.set(key, bucket);
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([key, bucket]) => ({
    t: new Date(first + key * bucketMs).toISOString(),
    v: bucket.sum / bucket.n,
  }));
}
