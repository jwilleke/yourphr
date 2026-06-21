import {ResourceFhir} from '../../models/fasten/resource_fhir';
import {HistoryRow} from '../../../lib/utils/medical_history_grouping';

// Builds lightweight HistoryRow records (for the #357 grouping core) from the encounter resource-graph,
// plus a lookup back to the full ResourceFhir for detail rendering. Lives in app/ (not lib/) because it
// depends on the app ResourceFhir model. Display values are pulled from already-resolved data — the
// backend-resolved `provenance` for the provider, and light name reads for place/condition — not
// re-derived clinical logic.

export function rowKey(r: { sourceId: string; resourceId: string }): string {
  return `${r.sourceId}/${r.resourceId}`;
}

export interface BuiltRows {
  rows: HistoryRow[];
  lookup: Record<string, ResourceFhir>;
}

// MEDICAL_HISTORY_TYPES is the bounded set of record types surfaced in the by-Type view (#351). It
// deliberately uses DiagnosticReport (one row per lab panel) rather than raw Observation (one row per
// analyte — far too granular + heavy) for "Lab & Diagnostic", and keeps to higher-signal, bounded types.
export const MEDICAL_HISTORY_TYPES = [
  'Encounter',
  'DiagnosticReport',
  'MedicationRequest',
  'MedicationStatement',
  'Procedure',
  'Immunization',
  'DocumentReference',
];

// buildTypedRows turns resources of several types into one HistoryRow each, for grouping by Type. Detail
// only needs date + title here (no encounter graph), so rows carry no provider/place/condition links.
export function buildTypedRows(byType: Record<string, ResourceFhir[]>): BuiltRows {
  const rows: HistoryRow[] = [];
  const lookup: Record<string, ResourceFhir> = {};
  for (const list of Object.values(byType || {})) {
    for (const r of list || []) {
      if (!r) continue;
      const key = rowKey({sourceId: r.source_id, resourceId: r.source_resource_id});
      lookup[key] = r;
      rows.push({
        sourceId: r.source_id,
        resourceId: r.source_resource_id,
        resourceType: r.source_resource_type || '',
        title: r.sort_title || r.source_resource_type || 'Record',
        date: isoDay(r.sort_date) || undefined,
      });
    }
  }
  return {rows, lookup};
}

function isoDay(sortDate?: string | Date): string {
  if (!sortDate) return '';
  const d = new Date(sortDate);
  return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

// buildEncounterRows turns the graph's Encounter resources into one HistoryRow each.
export function buildEncounterRows(encounters: ResourceFhir[]): BuiltRows {
  const rows: HistoryRow[] = [];
  const lookup: Record<string, ResourceFhir> = {};

  for (const enc of encounters || []) {
    const related = enc.related_resources || [];

    const providers = uniq(
      related.filter((r) => r.source_resource_type === 'Practitioner').map((r) => practitionerName(r.resource_raw)),
    );
    if (providers.length === 0 && enc.provenance?.kind === 'practitioner' && enc.provenance.display) {
      providers.push(enc.provenance.display);
    }

    const places = uniq(
      related
        .filter((r) => r.source_resource_type === 'Organization' || r.source_resource_type === 'Location')
        .map((r) => nameString(r.resource_raw)),
    );
    if (places.length === 0 && enc.provenance?.kind === 'organization' && enc.provenance.display) {
      places.push(enc.provenance.display);
    }

    const relatedConditions = related.filter((r) => r.source_resource_type === 'Condition');
    const conditions = uniq(relatedConditions.map((r) => conditionTitle(r.resource_raw)));
    // Condition reference keys (sourceId/resourceId) — used to match the canonical /conditions/classified
    // master in groupHistoryByConditions (#359). Matched by identity, not by label text.
    const conditionRefs = uniq(
      relatedConditions.map((r) => rowKey({sourceId: r.source_id, resourceId: r.source_resource_id})),
    );

    const key = rowKey({sourceId: enc.source_id, resourceId: enc.source_resource_id});
    lookup[key] = enc;
    rows.push({
      sourceId: enc.source_id,
      resourceId: enc.source_resource_id,
      resourceType: enc.source_resource_type || 'Encounter',
      title: enc.sort_title || 'Encounter',
      date: encounterDate(enc) || undefined,
      providers,
      places,
      conditions,
      conditionRefs,
    });
  }
  return {rows, lookup};
}

function uniq(values: string[]): string[] {
  return Array.from(new Set((values || []).map((v) => (v || '').trim()).filter((v) => v.length > 0)));
}

// encounterDate prefers the backend-computed sort_date, falling back to the raw period.
function encounterDate(enc: ResourceFhir): string {
  if (enc.sort_date) {
    const d = new Date(enc.sort_date);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const raw: any = enc.resource_raw;
  return raw?.period?.start || raw?.period?.end || '';
}

function practitionerName(raw: any): string {
  const names = raw?.name;
  if (Array.isArray(names)) {
    for (const n of names) {
      if (n?.text) return n.text;
      const parts = [...(n?.prefix || []), ...(n?.given || []), n?.family].filter(Boolean);
      if (parts.length) return parts.join(' ');
    }
  }
  return '';
}

function nameString(raw: any): string {
  return typeof raw?.name === 'string' ? raw.name : '';
}

function conditionTitle(raw: any): string {
  if (raw?.code?.text) return raw.code.text;
  const c = (raw?.code?.coding || []).find((x: any) => x?.display);
  return c?.display || '';
}
