import {groupHistory, collapseByDate, distinctTotal, typeLabel, UNKNOWN_KEY, HistoryRow} from './medical_history_grouping';

function row(p: Partial<HistoryRow>): HistoryRow {
  return {
    sourceId: 's1',
    resourceId: p.resourceId || 'r1',
    resourceType: p.resourceType || 'Encounter',
    title: p.title || 'Visit',
    date: p.date,
    providers: p.providers,
    places: p.places,
    conditions: p.conditions,
  };
}

describe('medical_history_grouping', () => {
  const rows: HistoryRow[] = [
    row({resourceId: 'e1', date: '2025-11-02', providers: ['Dr. Smith'], places: ['Clinic A'], conditions: ['Hypertension', 'Diabetes']}),
    row({resourceId: 'e2', date: '2025-11-02', providers: ['Dr. Jones'], places: ['Clinic A'], conditions: ['Hypertension']}),
    row({resourceId: 'e3', date: '2024-08-14', providers: ['Dr. Smith'], conditions: []}),
    row({resourceId: 'e4'}), // no date, no providers, no conditions -> Unknown buckets
  ];

  it('groups by date, newest first, undated last', () => {
    const g = groupHistory(rows, 'date');
    expect(g.map((x) => x.key)).toEqual(['2025-11-02', '2024-08-14', UNKNOWN_KEY]);
    expect(g[0].count).toBe(2); // e1 + e2
    expect(g[2].isUnknown).toBeTrue();
    expect(g[2].label).toBe('Undated');
  });

  it('multi-membership: a row appears under each linked condition; counts overlap', () => {
    const g = groupHistory(rows, 'condition');
    const ht = g.find((x) => x.key === 'Hypertension');
    const dm = g.find((x) => x.key === 'Diabetes');
    expect(ht?.count).toBe(2);  // e1, e2
    expect(dm?.count).toBe(1);  // e1 only
    // e1 is counted under BOTH -> overlap; distinctTotal reflects the real count.
    expect(distinctTotal(rows)).toBe(4);
    const unattributed = g.find((x) => x.isUnknown);
    expect(unattributed?.label).toBe('Unattributed');
    expect(unattributed?.count).toBe(2); // e3 (empty conditions) + e4
  });

  it('groups by provider with an Unknown provider bucket', () => {
    const g = groupHistory(rows, 'provider');
    expect(g.find((x) => x.key === 'Dr. Smith')?.count).toBe(2); // e1, e3
    expect(g.find((x) => x.isUnknown)?.label).toBe('Unknown provider'); // e4
  });

  it('Unknown bucket always sorts last', () => {
    const g = groupHistory(rows, 'place');
    expect(g[g.length - 1].isUnknown).toBeTrue();
  });

  it('groups by type with friendly labels', () => {
    const mixed = [row({resourceType: 'Encounter'}), row({resourceType: 'DiagnosticReport'}), row({resourceType: 'Procedure'})];
    const g = groupHistory(mixed, 'type');
    expect(g.map((x) => x.label).sort()).toEqual(['Lab & Diagnostic', 'Procedures', 'Visits']);
  });

  it('collapseByDate buckets detail rows by day, newest first', () => {
    const buckets = collapseByDate(rows);
    expect(buckets[0].date).toBe('2025-11-02');
    expect(buckets[0].rows.length).toBe(2);
    expect(buckets[buckets.length - 1].date).toBe(''); // undated last
  });

  it('typeLabel maps known types and passes through unknown', () => {
    expect(typeLabel('MedicationStatement')).toBe('Medications');
    expect(typeLabel('Wibble')).toBe('Wibble');
  });
});
