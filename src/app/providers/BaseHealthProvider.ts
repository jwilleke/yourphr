/**
 * Health samples storage — Observation-shaped projection for wearable PGHD.
 * Ownership is always a user_id the manager supplies — never a value from the body.
 */

export const HEALTH_SAMPLE_DEFAULT_LIMIT = 500;
export const HEALTH_SAMPLE_MAX_LIMIT = 5000;
export const HEALTH_SERIES_DEFAULT_POINTS = 400;
export const HEALTH_SERIES_MAX_POINTS = 2000;
export const HEALTH_SAMPLE_INSERT_BATCH = 250;

export type HealthSeriesMode = 'points' | 'day' | 'daily-stats' | 'stages';

export interface HealthComponentValue {
  code: string;
  display?: string;
  value: number;
  unit: string;
}

export interface HealthSampleRow {
  id: string;
  userId: string;
  externalUuid: string;
  identifierSystem: string;
  vendorType: string;
  metricType: string;
  codeSystem: string;
  code: string;
  category: string;
  subject: string;
  startTime: string;
  endTime: string;
  valueNum: number | null;
  unit: string;
  valueText: string;
  components: string;
  correlationUuid: string;
  sourceName: string;
  sourceBundleId: string;
  deviceName: string;
  metadata: string;
}

export interface HealthSyncStateRow {
  userId: string;
  deviceId: string;
  metricType: string;
  anchor: string;
  lastSampleEndTime: string;
  lastSyncedAt: string;
  deviceName: string;
}

export interface HealthSampleQuery {
  codes: string[];
  metricTypes: string[];
  vendorType: string;
  startAfter?: string;
  startBefore?: string;
  limit: number;
  offset: number;
  sortAscending: boolean;
}

export interface HealthSeriesQuery {
  codes: string[];
  metricTypes: string[];
  vendorType: string;
  startAfter?: string;
  startBefore?: string;
  maxPoints: number;
  mode: HealthSeriesMode;
}

export interface HealthMetricSummary {
  code: string;
  code_system: string;
  category?: string;
  metric_type: string;
  vendor_type: string;
  unit?: string;
  value_num?: number;
  value_text?: string;
  components?: HealthComponentValue[];
  latest_at: string;
  earliest_at: string;
  sample_count: number;
  source_name?: string;
  device_name?: string;
}

export interface HealthSeriesPoint { t: string; v: number }
export interface HealthDailyBucket {
  date: string;
  /** SUM for mode=day, AVG for mode=daily-stats. */
  value: number;
  min?: number;
  max?: number;
  n?: number;
}
export interface HealthStageNight { date: string; stages: Record<string, number> }
export interface HealthSeriesStats { min?: number; max?: number; avg?: number }

export interface HealthSeries {
  code?: string;
  metric_type?: string;
  vendor_type?: string;
  unit?: string;
  total: number;
  downsampled: boolean;
  points?: HealthSeriesPoint[];
  daily?: HealthDailyBucket[];
  nights?: HealthStageNight[];
  stats?: HealthSeriesStats;
  components?: Record<string, HealthSeriesPoint[]>;
}

export abstract class BaseHealthProvider {
  abstract initialize(): Promise<void>;
  /** Inserts, skipping (user_id, external_uuid) duplicates. Returns how many rows were actually written. */
  abstract insertSamples(userId: string, rows: HealthSampleRow[]): Promise<number>;
  abstract listSamples(userId: string, query: HealthSampleQuery): Promise<{ samples: HealthSampleRow[]; total: number }>;
  abstract readSample(userId: string, id: string): Promise<HealthSampleRow | undefined>;
  abstract summarizeMetrics(userId: string): Promise<HealthMetricSummary[]>;
  abstract querySeries(userId: string, query: HealthSeriesQuery): Promise<HealthSeries>;
  abstract upsertSyncState(row: HealthSyncStateRow): Promise<void>;
  abstract listSyncStates(userId: string, deviceId: string): Promise<HealthSyncStateRow[]>;
  abstract removeForOwner(userId: string): Promise<void>;
}
