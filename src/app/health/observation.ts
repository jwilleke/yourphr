/**
 * Reconstruct a FHIR R4 Observation from a health_samples projection row.
 * Wearable rows are never written through SqliteFhirRepository — this is export/read only.
 */
import type { Bundle, Observation, ObservationComponent } from '@medplum/fhirtypes';
import {
  HK_TYPE_SYSTEM,
  LOINC,
  OBS_CATEGORY,
  SNOMED,
  UCUM,
  codeableDisplay,
  lookupByCode,
} from './catalog.js';
import type { HealthSampleRow } from '../providers/BaseHealthProvider.js';

export interface ObservationComponentValue {
  code: string;
  display?: string;
  value: number;
  unit: string;
}

export function parseComponents(raw: string): ObservationComponentValue[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const rec = entry as Record<string, unknown>;
      const code = typeof rec.code === 'string' ? rec.code : '';
      const value = typeof rec.value === 'number' && Number.isFinite(rec.value) ? rec.value : undefined;
      if (!code || value === undefined) return [];
      return [{
        code,
        display: typeof rec.display === 'string' ? rec.display : undefined,
        value,
        unit: typeof rec.unit === 'string' ? rec.unit : '',
      }];
    });
  } catch {
    return [];
  }
}

export function serializeComponents(components: ObservationComponentValue[]): string {
  return components.length === 0 ? '' : JSON.stringify(components);
}

export function toObservation(row: HealthSampleRow, subject?: string): Observation {
  const metric = lookupByCode(row.code);
  const codeSystem = row.codeSystem || (row.code ? LOINC : HK_TYPE_SYSTEM);
  const codeValue = row.code || row.vendorType;
  const observation: Observation = {
    resourceType: 'Observation',
    id: row.id,
    status: 'final',
    identifier: row.externalUuid
      ? [{ system: row.identifierSystem || 'urn:uuid', value: row.externalUuid }]
      : undefined,
    // FHIR Observation.code is 1..1; unknown metrics still store a CodeableConcept.
    code: codeValue
      ? {
          coding: [{
            system: codeSystem,
            code: codeValue,
            ...(metric?.display ? { display: metric.display } : {}),
          }],
        }
      : { text: row.metricType || 'unknown' },
  };

  const category = row.category || metric?.category;
  if (category) {
    observation.category = [{
      coding: [{ system: OBS_CATEGORY, code: category }],
    }];
  }

  const subjectRef = subject || row.subject;
  if (subjectRef) observation.subject = { reference: subjectRef };

  if (row.startTime === row.endTime || !row.endTime) {
    observation.effectiveDateTime = row.startTime;
  } else {
    observation.effectivePeriod = { start: row.startTime, end: row.endTime };
  }

  const components = parseComponents(row.components);
  if (components.length > 0) {
    observation.component = components.map((c): ObservationComponent => ({
      code: {
        coding: [{
          system: LOINC,
          code: c.code,
          ...(c.display ? { display: c.display } : {}),
        }],
      },
      valueQuantity: quantity(c.value, c.unit || row.unit),
    }));
  } else if (row.valueNum != null) {
    observation.valueQuantity = quantity(row.valueNum, row.unit);
  } else if (row.valueText) {
    observation.valueCodeableConcept = {
      coding: [{
        system: SNOMED,
        code: row.valueText,
        display: metric ? codeableDisplay(metric, row.valueText) : row.valueText,
      }],
    };
  }

  if (row.deviceName || row.sourceName) {
    observation.device = {
      display: row.deviceName || row.sourceName,
    };
  }
  if (row.sourceName) {
    observation.meta = { ...(observation.meta ?? {}), source: row.sourceName };
  }
  if (row.vendorType) {
    const extra = { system: HK_TYPE_SYSTEM, code: row.vendorType };
    if (observation.code?.coding && !observation.code.coding.some((c) => c.code === row.vendorType)) {
      observation.code.coding.push(extra);
    }
  }
  return observation;
}

function quantity(value: number, unit: string): NonNullable<Observation['valueQuantity']> {
  return {
    value,
    unit: unit === '/min' ? 'beats/minute' : unit === 'mm[Hg]' ? 'mmHg' : unit === 'Cel' ? 'C' : unit === '{steps}' ? 'steps' : unit,
    system: UCUM,
    code: unit || undefined,
  };
}

export function toBundle(rows: HealthSampleRow[], subject?: string): Bundle<Observation> {
  const entries = rows.map((row) => {
    const resource = toObservation(row, subject);
    return {
      fullUrl: `Observation/${resource.id}`,
      resource,
    };
  });
  return {
    resourceType: 'Bundle',
    type: 'collection',
    total: entries.length,
    entry: entries,
  };
}
