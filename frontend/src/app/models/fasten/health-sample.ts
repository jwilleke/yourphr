// Mirrors GET /api/secure/health/metrics and /health/series. Hand-maintained (not tygo-exported).

export interface HealthComponentValue {
  code: string
  display?: string
  value: number
  unit: string
}

export interface HealthMetricSummary {
  code: string
  code_system?: string
  category?: string
  metric_type: string
  vendor_type: string
  unit?: string
  value_num?: number
  value_text?: string
  components?: HealthComponentValue[]
  latest_at: string
  earliest_at: string
  sample_count: number
  source_name?: string
  device_name?: string
}

export interface HealthMetricsCatalog {
  last_synced_at?: string
  metrics: HealthMetricSummary[]
}

export interface HealthSeriesPoint {
  t: string
  v: number
}

export interface HealthDailyBucket {
  date: string
  value: number
  min?: number
  max?: number
  n?: number
}

export interface HealthStageNight {
  date: string
  stages: Record<string, number>
}

export interface HealthSeriesStats {
  min?: number
  max?: number
  avg?: number
}

export interface HealthSeries {
  code?: string
  metric_type?: string
  vendor_type?: string
  unit?: string
  total: number
  downsampled: boolean
  points?: HealthSeriesPoint[]
  daily?: HealthDailyBucket[]
  nights?: HealthStageNight[]
  stats?: HealthSeriesStats
  components?: Record<string, HealthSeriesPoint[]>
}

export interface HealthSample {
  id: string
  external_uuid: string
  identifier_system?: string
  vendor_type: string
  metric_type: string
  code?: string
  code_system?: string
  category?: string
  start_time: string
  end_time: string
  value_num?: number
  unit?: string
  value_text?: string
  components?: HealthComponentValue[]
  correlation_uuid?: string
  source_name?: string
  device_name?: string
}

export interface HealthSamplePage {
  total: number
  count: number
  offset: number
  samples: HealthSample[]
}

export interface HealthSeriesQuery {
  codes?: string[]
  metricTypes?: string[]
  vendorType?: string
  startAfter?: string
  startBefore?: string
  mode?: 'points' | 'day' | 'daily-stats' | 'stages'
}

export interface HealthSampleQuery {
  codes?: string[]
  metricTypes?: string[]
  vendorType?: string
  startAfter?: string
  startBefore?: string
  limit?: number
  offset?: number
  sort?: 'asc' | 'desc'
}
