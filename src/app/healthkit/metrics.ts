/**
 * HealthKit lookup kept as a thin alias of the Observation catalog so older imports still resolve.
 */
export {
  allMetrics,
  lookup,
  lookupByMetricType,
  normalizeCodeableValue as normalizeCategoryValue,
  normalizeUnit,
  type CatalogMetric as Metric,
  type MetricKind,
} from '../health/catalog.js';
