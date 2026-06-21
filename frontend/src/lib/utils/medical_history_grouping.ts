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
  conditionRefs?: string[]; // linked condition keys (sourceId/resourceId) — match the canonical master (#359)
}

export interface HistoryGroup {
  key: string;        // dimension value, or UNKNOWN_KEY
  label: string;      // display label
  subLabel?: string;  // secondary line (e.g. a condition's state) — optional
  count: number;      // rows in this group (counts overlap across groups under multi-membership)
  isUnknown: boolean; // the explicit "not stated" bucket
  rows: HistoryRow[]; // newest first
}

// ConditionMaster is a canonical condition (from /conditions/classified), decoupled from the app model
// so this lib stays pure. `key` matches HistoryRow.conditionRefs (sourceId/resourceId). (#359)
export interface ConditionMaster {
  key: string;
  label: string;
  state?: string;
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

// groupHistoryByConditions builds the by-Condition master from the canonical conditions list
// (/conditions/classified) so EVERY condition appears — not only encounter-linked ones (#359). Each row
// is assigned to the condition(s) it references (multi-membership). Rows referencing no canonical
// condition go to an explicit "Unattributed" bucket. Conditions with no linked records are kept (the
// whole point is to surface them), sorted after those that have records; Unattributed sinks last.
export function groupHistoryByConditions(rows: HistoryRow[], conditions: ConditionMaster[]): HistoryGroup[] {
  const groups = new Map<string, HistoryGroup>();
  for (const c of conditions || []) {
    if (!c?.key || groups.has(c.key)) continue;
    groups.set(c.key, { key: c.key, label: c.label || 'Condition', subLabel: c.state, count: 0, isUnknown: false, rows: [] });
  }
  const unattributed: HistoryGroup = { key: UNKNOWN_KEY, label: 'Unattributed', count: 0, isUnknown: true, rows: [] };

  for (const row of rows || []) {
    const refs = Array.from(new Set((row.conditionRefs || []).filter((r) => groups.has(r))));
    if (refs.length === 0) {
      unattributed.rows.push(row);
      continue;
    }
    for (const ref of refs) {
      groups.get(ref)!.rows.push(row);
    }
  }

  const out = Array.from(groups.values());
  for (const g of out) {
    g.rows.sort(byDateDesc);
    g.count = g.rows.length;
  }
  // Conditions with linked records first (most-recent activity desc); empty ones next (alpha by label).
  out.sort((a, b) => {
    const aEmpty = a.rows.length === 0, bEmpty = b.rows.length === 0;
    if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
    if (aEmpty && bEmpty) return a.label.localeCompare(b.label);
    return cmpDateDesc(mostRecent(a.rows), mostRecent(b.rows));
  });
  if (unattributed.rows.length) {
    unattributed.rows.sort(byDateDesc);
    unattributed.count = unattributed.rows.length;
    out.push(unattributed);
  }
  return out;
}

// membershipsFor returns the group(s) a row belongs to for the dimension (multiple → multi-membership).
function membershipsFor(row: HistoryRow, dim: GroupDimension): { key: string; label: string; isUnknown: boolean }[] {
  switch (dim) {
    case 'date': {
      const d = dayOf(row.date);
      return d ? [{ key: d, label: d, isUnknown: false }] : [unknown('Undated')];
    }
    case 'type': {
      // Key by the patient-friendly CATEGORY (typeLabel), not the raw FHIR type, so related types merge
      // into one group (e.g. MedicationRequest + MedicationStatement -> "Medications").
      if (!row.resourceType) return [unknown('Other')];
      const label = typeLabel(row.resourceType);
      return [{ key: label, label, isUnknown: false }];
    }
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
