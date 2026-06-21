import {buildEncounterRows, buildTypedRows, rowKey} from './medical_history_rows';
import {ResourceFhir} from '../../models/fasten/resource_fhir';

function enc(p: Partial<ResourceFhir>): ResourceFhir {
  return new ResourceFhir({
    source_id: p.source_id || 's1',
    source_resource_type: 'Encounter',
    source_resource_id: p.source_resource_id || 'e1',
    sort_title: p.sort_title || 'Office Visit',
    sort_date: p.sort_date,
    resource_raw: p.resource_raw || {resourceType: 'Encounter'},
    related_resources: p.related_resources || [],
    provenance: p.provenance,
  } as any);
}

describe('buildEncounterRows', () => {
  it('extracts providers, places, conditions, and date from the encounter graph', () => {
    const e = enc({
      source_resource_id: 'e1',
      sort_date: new Date('2025-11-02T10:00:00Z') as any,
      related_resources: [
        {source_resource_type: 'Practitioner', resource_raw: {name: [{text: 'Dr. Jane Smith'}]}} as any,
        {source_resource_type: 'Organization', resource_raw: {name: 'Clinic A'}} as any,
        {source_resource_type: 'Location', resource_raw: {name: 'Building 2'}} as any,
        {source_resource_type: 'Condition', resource_raw: {code: {text: 'Hypertension'}}} as any,
        {source_resource_type: 'Condition', resource_raw: {code: {coding: [{display: 'Diabetes'}]}}} as any,
      ],
    });
    const {rows, lookup} = buildEncounterRows([e]);
    expect(rows.length).toBe(1);
    const r = rows[0];
    expect(r.date).toBe('2025-11-02');
    expect(r.providers).toEqual(['Dr. Jane Smith']);
    expect(r.places.sort()).toEqual(['Building 2', 'Clinic A']);
    expect(r.conditions.sort()).toEqual(['Diabetes', 'Hypertension']);
    expect(lookup[rowKey(r)]).toBe(e);
  });

  it('falls back to provenance for provider/place when no related practitioner/org', () => {
    const e = enc({
      source_resource_id: 'e2',
      provenance: {kind: 'practitioner', display: 'Dr. Who', level: 1},
      related_resources: [],
    });
    const {rows} = buildEncounterRows([e]);
    expect(rows[0].providers).toEqual(['Dr. Who']);
    expect(rows[0].places).toEqual([]);
  });

  it('leaves date undefined and lists empty when the record states nothing', () => {
    const {rows} = buildEncounterRows([enc({source_resource_id: 'e3'})]);
    expect(rows[0].date).toBeUndefined();
    expect(rows[0].providers).toEqual([]);
    expect(rows[0].conditions).toEqual([]);
  });
});

describe('buildTypedRows', () => {
  const res = (type: string, id: string, date?: string): ResourceFhir => new ResourceFhir({
    source_id: 's1', source_resource_type: type, source_resource_id: id,
    sort_title: `${type} ${id}`, sort_date: date ? (new Date(date) as any) : undefined,
  } as any);

  it('builds one row per resource across types, with date + resourceType + lookup', () => {
    const byType = {
      Encounter: [res('Encounter', 'e1', '2025-11-02T10:00:00Z')],
      DiagnosticReport: [res('DiagnosticReport', 'd1', '2025-08-14T00:00:00Z')],
      MedicationRequest: [res('MedicationRequest', 'm1')],
    };
    const {rows, lookup} = buildTypedRows(byType);
    expect(rows.length).toBe(3);
    expect(rows.find((r) => r.resourceType === 'Encounter')?.date).toBe('2025-11-02');
    expect(rows.find((r) => r.resourceType === 'MedicationRequest')?.date).toBeUndefined(); // no date stated
    const enc = rows.find((r) => r.resourceType === 'Encounter')!;
    expect(lookup[rowKey(enc)].source_resource_id).toBe('e1');
  });

  it('tolerates empty/missing type buckets', () => {
    const {rows} = buildTypedRows({Encounter: [], Procedure: undefined as any});
    expect(rows).toEqual([]);
  });
});
