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

    const conditions = uniq(
      related.filter((r) => r.source_resource_type === 'Condition').map((r) => conditionTitle(r.resource_raw)),
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
