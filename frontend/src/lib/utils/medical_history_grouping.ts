// Pure grouping logic for the /medical-history master-detail view (#351). Decoupled from data loading
// and UI: it operates on lightweight HistoryRow records, so the same logic serves whatever populates
// them (encounter-graph pivot now, a backend grouping endpoint later) and is unit-testable in isolation.
//
// Rules (from the #351 decisions):
//  - Master dedup: one group per distinct dimension value.
//  - Multi-membership: a row that links several providers/places/conditions appears under EACH
//    ("completeness wins for a PHR") — so group counts intentionally OVERLAP; report a distinct total
//    separately.
//  - No guessing: a row that states none of the active dimension goes to an explicit Unknown bucket,
//    never inferred.
//  - Detail is date-ordered (newest first) and date-collapsed (one header per day).

export type GroupDimension = 'date' | 'condition' | 'provider' | 'place' | 'type';

// UNKNOWN_KEY tags the explicit "not stated" bucket so the UI can style/sort it (always rendered last).
export const UNKNOWN_KEY = '__unknown__';

export interface HistoryRow {
  sourceId: string;
  resourceId: string;
  resourceType: string;
  title: string;
  date?: string;        // ISO date/dateTime the record states; undefined when none (never fabricated)
  providers?: string[]; // resolved "who" — clinician/org names
  places?: string[];    // facility / organization / location names
  conditions?: string[]; // linked condition labels
}

export interface HistoryGroup {
  key: string;        // dimension value, or UNKNOWN_KEY
  label: string;      // display label
  count: number;      // rows in this group (counts overlap across groups under multi-membership)
  isUnknown: boolean; // the explicit "not stated" bucket
  rows: HistoryRow[]; // newest first
}

export interface DateBucket {
  date: string;       // YYYY-MM-DD, or '' for undated
  rows: HistoryRow[];
}

// groupHistory pivots rows by the active dimension into deduped, counted, date-sorted master groups.
export function groupHistory(rows: HistoryRow[], dim: GroupDimension): HistoryGroup[] {
  const groups = new Map<string, HistoryGroup>();

  const add = (key: string, label: string, isUnknown: boolean, row: HistoryRow) => {
    let g = groups.get(key);
    if (!g) {
      g = { key, label, count: 0, isUnknown, rows: [] };
      groups.set(key, g);
    }
    g.rows.push(row);
  };

  for (const row of rows) {
    for (const m of membershipsFor(row, dim)) {
      add(m.key, m.label, m.isUnknown, row);
    }
  }

  const out = Array.from(groups.values());
  for (const g of out) {
    g.rows.sort(byDateDesc);
    g.count = g.rows.length;
  }
  // Sort groups by most-recent activity (desc); the Unknown bucket always sinks to the bottom.
  out.sort((a, b) => {
    if (a.isUnknown !== b.isUnknown) return a.isUnknown ? 1 : -1;
    return cmpDateDesc(mostRecent(a.rows), mostRecent(b.rows));
  });
  return out;
}

// membershipsFor returns the group(s) a row belongs to for the dimension (multiple → multi-membership).
function membershipsFor(row: HistoryRow, dim: GroupDimension): { key: string; label: string; isUnknown: boolean }[] {
  switch (dim) {
    case 'date': {
      const d = dayOf(row.date);
      return d ? [{ key: d, label: d, isUnknown: false }] : [unknown('Undated')];
    }
    case 'type':
      return [{ key: row.resourceType || UNKNOWN_KEY, label: typeLabel(row.resourceType), isUnknown: !row.resourceType }];
    case 'provider':
      return fromList(row.providers, 'Unknown provider');
    case 'place':
      return fromList(row.places, 'Unknown place');
    case 'condition':
      return fromList(row.conditions, 'Unattributed');
  }
}

function fromList(values: string[] | undefined, unknownLabel: string): { key: string; label: string; isUnknown: boolean }[] {
  const clean = (values || []).map((v) => v.trim()).filter((v) => v.length > 0);
  const uniq = Array.from(new Set(clean));
  if (uniq.length === 0) return [unknown(unknownLabel)];
  return uniq.map((v) => ({ key: v, label: v, isUnknown: false }));
}

function unknown(label: string) {
  return { key: UNKNOWN_KEY, label, isUnknown: true };
}

// collapseByDate groups detail rows under one header per day, newest first; undated rows sink last.
export function collapseByDate(rows: HistoryRow[]): DateBucket[] {
  const buckets = new Map<string, DateBucket>();
  for (const row of [...rows].sort(byDateDesc)) {
    const date = dayOf(row.date);
    const k = date || '';
    let b = buckets.get(k);
    if (!b) {
      b = { date: k, rows: [] };
      buckets.set(k, b);
    }
    b.rows.push(row);
  }
  const out = Array.from(buckets.values());
  out.sort((a, b) => {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
  });
  return out;
}

// distinctTotal is the real record count across overlapping groups (for an honest "N records" header).
export function distinctTotal(rows: HistoryRow[]): number {
  return new Set(rows.map((r) => `${r.sourceId}/${r.resourceType}/${r.resourceId}`)).size;
}

// typeLabel maps a FHIR resourceType to a patient-friendly record-type label.
export function typeLabel(resourceType: string): string {
  switch (resourceType) {
    case 'Encounter': return 'Visits';
    case 'DiagnosticReport': return 'Lab & Diagnostic';
    case 'Observation': return 'Observations & Vitals';
    case 'MedicationRequest':
    case 'MedicationStatement':
    case 'MedicationDispense':
    case 'Medication': return 'Medications';
    case 'Procedure': return 'Procedures';
    case 'Immunization': return 'Immunizations';
    case 'DocumentReference': return 'Documents';
    case 'Condition': return 'Conditions';
    case 'AllergyIntolerance': return 'Allergies';
    case 'CarePlan': return 'Care Plans';
    default: return resourceType || 'Other';
  }
}

// dayOf returns the YYYY-MM-DD portion of an ISO date/dateTime, or '' when absent/malformed.
function dayOf(date?: string): string {
  if (!date) return '';
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(date.trim());
  return m ? m[1] : '';
}

function mostRecent(rows: HistoryRow[]): string {
  return rows.length ? (rows[0].date || '') : '';
}

function byDateDesc(a: HistoryRow, b: HistoryRow): number {
  return cmpDateDesc(a.date || '', b.date || '');
}

// cmpDateDesc sorts ISO date strings newest-first; empties sink to the end.
function cmpDateDesc(a: string, b: string): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a < b ? 1 : a > b ? -1 : 0;
}
