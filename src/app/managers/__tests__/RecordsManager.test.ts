import { beforeEach, describe, expect, it } from 'vitest';
import type { Resource } from '@medplum/fhirtypes';
import { Engine } from '../../../framework/Engine.js';
import { ApiContext, ApiError } from '../../../framework/ApiContext.js';
import { RecordsManager, type AggregationRow } from '../RecordsManager.js';
import { FakeRecordsProvider } from '../../providers/__tests__/FakeRecordsProvider.js';
import { FakeFavoritesProvider } from '../../providers/__tests__/FakeFavoritesProvider.js';
import { ConfigurationManager } from '../../../framework/ConfigurationManager.js';
import { PolicyManager } from '../../../framework/managers/PolicyManager.js';
import { FakeConfigProvider } from '../../../framework/providers/__tests__/FakeConfigProvider.js';

const LOINC = 'http://loinc.org';
const SNOMED = 'http://snomed.info/sct';
const obs = (id: string, code: string, display: string, date: string, system = LOINC): Resource =>
  ({ resourceType: 'Observation', id, status: 'final', code: { coding: [{ system, code, display }] }, effectiveDateTime: date } as Resource);

let provider: FakeRecordsProvider;
let favorites: FakeFavoritesProvider;
let engine: Engine;
let records: RecordsManager;
let alice: ApiContext;
let bob: ApiContext;

beforeEach(async () => {
  provider = new FakeRecordsProvider();
  favorites = new FakeFavoritesProvider();
  engine = new Engine();
  records = new RecordsManager(engine, provider, favorites);
  engine.register('configuration', new ConfigurationManager(engine, new FakeConfigProvider(), { env: {} }))
    .register('policy', new PolicyManager(engine));
  engine.register('records', records);
  await engine.initialize();
  alice = ApiContext.from({ username: 'alice', role: 'user' }, engine);
  bob = ApiContext.from({ username: 'bob', role: 'user' }, engine);
  provider.seed('alice', 'source-1', obs('o1', '718-7', 'Hemoglobin', '2024-01-10'));
  provider.seed('alice', 'source-1', obs('o2', '718-7', 'Hemoglobin', '2024-05-10'));
  provider.seed('alice', 'source-2', obs('o3', '2345-7', 'Glucose', '2024-03-10'));
  provider.seed('alice', 'source-1', { resourceType: 'Condition', id: 'c1', code: { text: 'Hypertension', coding: [{ system: SNOMED, code: '38341003' }] }, clinicalStatus: { coding: [{ code: 'active' }] }, recordedDate: '2024-07-01' } as Resource);
  provider.seed('alice', '', { resourceType: 'Condition', id: 'c2', code: { text: 'Typed in' } } as Resource);
  provider.seed('bob', 'source-9', obs('o9', '718-7', 'Hemoglobin', '2025-01-01'));
});

describe('RecordsManager — the one door, scoped to whoever is asking', () => {
  it('initialises its provider with the engine and closes it on shutdown', async () => {
    expect(provider.initialized).toBe(true);
    await engine.shutdown();
    expect(provider.closed).toBe(true);
  });

  it('refuses an anonymous caller on every read', async () => {
    const nobody = ApiContext.anonymous(engine);
    await expect(records.list(nobody, 'Observation')).rejects.toBeInstanceOf(ApiError);
    await expect(records.countsByType(nobody)).rejects.toMatchObject({ status: 401 });
  });

  it('lists in resource_fhir shape with the real source attribution, and ?sourceID narrows', async () => {
    const all = await records.list(alice, 'Observation');
    expect(all.map((r) => r['source_resource_id'])).toEqual(['o1', 'o2', 'o3']);
    expect(all.map((r) => r['source_id'])).toEqual(['source-1', 'source-1', 'source-2']);
    expect((await records.list(alice, 'Observation', { sourceId: 'source-2' })).map((r) => r['source_resource_id'])).toEqual(['o3']);
    expect(await records.list(bob, 'Observation')).toHaveLength(1);
  });

  // yourphr#696: what the person said is kept; what nobody has confirmed is not a chart fact.
  it('holds a needs-review record out of the lists, the counts, the dashboard and search — and keeps it', async () => {
    const quarantined = {
      resourceType: 'Observation',
      id: 'o-review',
      status: 'final',
      code: { text: 'peak flow' }, // their words, uncoded — nothing invented
      meta: { tag: [{ system: 'https://yourphr.org/fhir/CodeSystem/record-origin', code: 'needs-review' }] },
    };
    await records.writer(alice, 'source-1').upsert(quarantined as never);

    expect((await records.list(alice, 'Observation')).map((r) => r['source_resource_id'])).not.toContain('o-review');
    expect(await records.countsByType(alice)).toEqual([{ resource_type: 'Condition', count: 2 }, { resource_type: 'Observation', count: 3 }]);
    expect((await records.recent(alice, 50)).map((r) => r.source_resource_id)).not.toContain('o-review');
    expect((await records.searchText(alice, 'peak flow')).map((r) => r.source_resource_id)).not.toContain('o-review');

    // Kept, not deleted: it is still addressable, which is what the review queue will read.
    expect((await records.detail(alice, 'o-review'))['source_resource_id']).toBe('o-review');
  });

  it('detail finds a record by id without its type; a missing one is a 404', async () => {
    expect((await records.detail(alice, 'c1'))['source_resource_type']).toBe('Condition');
    await expect(records.detail(alice, 'o9')).rejects.toMatchObject({ status: 404 }); // bob's
  });

  it('counts by type, per source, and the types held', async () => {
    expect(await records.countsByType(alice)).toEqual([{ resource_type: 'Condition', count: 2 }, { resource_type: 'Observation', count: 3 }]);
    expect(await records.sourceCounts(alice, 'source-1')).toEqual([{ source_id: 'source-1', resource_type: 'Condition', count: 1 }, { source_id: 'source-1', resource_type: 'Observation', count: 2 }]);
    expect(await records.typesHeld(alice)).toEqual(['Condition', 'Observation']);
  });

  it('recent: newest first across types, limited', async () => {
    const recent = await records.recent(alice, 2);
    expect(recent.map((r) => `${r.source_resource_type}/${r.source_resource_id}@${r.date}`)).toEqual(['Condition/c1@2024-07-01', 'Observation/o2@2024-05-10']);
  });

  it('the typed query: grouped by code with max(sort_date), system-only tokens, count_by, and refusals', async () => {
    const grouped = (await records.query(alice, { from: 'Observation', where: { code: `${LOINC}|` }, aggregations: { order_by: { field: 'sort_date', fn: 'max' }, group_by: { field: 'code' } } })) as AggregationRow[];
    expect(grouped).toEqual([{ label: `${LOINC}|718-7`, value: '2024-05-10' }, { label: `${LOINC}|2345-7`, value: '2024-03-10' }]);
    const rows = (await records.query(alice, { from: 'Observation', where: { code: '718-7,2345-7' } })) as Record<string, unknown>[];
    expect(rows.map((r) => r['source_resource_id'])).toEqual(['o2', 'o3', 'o1']);
    const counted = (await records.query(alice, { from: 'Observation', aggregations: { count_by: { field: 'code' } } })) as AggregationRow[];
    expect(counted[0]).toEqual({ label: `${LOINC}|718-7`, value: 2 });
    await expect(records.query(alice, { from: 'Observation; DROP TABLE x' })).rejects.toMatchObject({ status: 400 });
    await expect(records.query(alice, { from: 'Observation', where: { 'bad param': 'x' } })).rejects.toMatchObject({ status: 400 });
    await expect(records.query(alice, { from: 'Observation', aggregations: { group_by: { field: 'code' }, order_by: { field: 'issued' } } })).rejects.toMatchObject({ status: 400 });
  });

  it('the views run over the caller\'s records only', async () => {
    const conditions = await records.conditions(alice);
    expect(conditions.map((c) => c.sourceResourceId)).toEqual(['c1', 'c2']);
    expect(conditions[0]?.state).toBe('Active');
    expect(await records.conditions(bob)).toEqual([]);
    expect(await records.allergies(alice)).toEqual([]);
    expect(await records.medications(alice)).toEqual([]);
  });

  it('provenance names the source through the app-supplied display, or the raw id, or this instance', async () => {
    records.sourceDisplay = (id) => (id === 'source-1' ? 'Fake Regional' : '');
    expect((await records.provenance(alice, 'Condition', 'c1'))?.sourceDisplay).toBe('Fake Regional');
    expect((await records.provenance(alice, 'Observation', 'o3'))?.sourceDisplay).toBe('source-2');
    expect((await records.provenance(alice, 'Condition', 'c2'))?.sourceDisplay).toBe('This instance (manual entry or upload)');
    expect(await records.provenance(bob, 'Condition', 'c1')).toBeUndefined();
  });

  it('the writer upserts for the caller and one source, and a cross-source collision is refused', async () => {
    const w = records.writer(alice, 'source-1');
    expect(await w.upsert(obs('o1', '718-7', 'Hemoglobin', '2024-01-11'))).toBe('updated');
    expect(await w.upsert(obs('o5', '718-7', 'Hemoglobin', '2024-08-01'))).toBe('created');
    await expect(records.writer(alice, 'source-2').upsert(obs('o1', '718-7', 'x', '2024-01-12'))).rejects.toThrow('cross-source id collision');
    expect(await records.exists(alice, 'Observation', 'o5')).toBe(true);
    expect(await records.exists(bob, 'Observation', 'o5')).toBe(false);
  });

  it('export, remove by source, and remove all (which releases the handle) act on the caller only', async () => {
    expect((await records.exportSource(alice, 'source-1')).total).toBe(3);
    expect(await records.removeSource(alice, 'source-1')).toBe(3);
    expect(await records.countsByType(alice)).toEqual([{ resource_type: 'Condition', count: 1 }, { resource_type: 'Observation', count: 1 }]);
    expect(await records.removeAll(alice)).toBe(2);
    expect(provider.released).toEqual(['alice']);
    expect(await records.list(bob, 'Observation')).toHaveLength(1);
  });

  it('backup() goes through the provider and reports its file; restore() is staged, not live', async () => {
    const b = await records.backup({ destination: '/dest', key: 'k' });
    expect(b.manager).toBe('records');
    expect(b.files).toEqual(['/dest/fake.db']);
    expect(provider.backups).toEqual([{ destination: '/dest', key: 'k' }]);
    await expect(records.restore({ manager: 'backups', takenAt: 'now' }, { key: 'k' })).rejects.toMatchObject({ status: 400 });
    await records.restore({ manager: 'backups', takenAt: 'now', files: ['/dest/fake.db'] }, { key: 'travel-key' });
    expect(provider.staged).toEqual([{ backupFile: '/dest/fake.db', backupKey: 'travel-key' }]);
    expect(await records.integrityOk()).toBe(true);
  });

  it('storage() answers the admin Database card for the PHI store, and refuses a member (yourphr#619)', () => {
    const admin = ApiContext.from({ username: 'ops', role: 'admin' }, engine);
    expect(records.storage(admin)).toEqual({ location: ':memory:', sizeBytes: 0 });
    expect(() => records.storage(alice)).toThrow(/admin/);
  });

  it('favourites go through the same door: owner-scoped, Practitioner only, idempotent, gone with the account', async () => {
    expect(favorites.initialized).toBe(true);
    const fav = { source_id: 'source-1', resource_type: 'Practitioner', resource_id: 'dr-a' };
    expect(await records.addFavorite(alice, fav)).toEqual(fav);
    await records.addFavorite(alice, fav);
    await records.addFavorite(bob, { ...fav, resource_id: 'dr-b' });
    expect(await records.favorites(alice, 'Practitioner')).toEqual([fav]);
    expect(await records.favorites(bob, 'Practitioner')).toEqual([{ ...fav, resource_id: 'dr-b' }]);
    await expect(records.favorites(alice, 'Patient')).rejects.toMatchObject({ status: 400, message: 'only Practitioner resources are supported' });
    await expect(records.addFavorite(alice, { ...fav, resource_type: 'Patient' })).rejects.toMatchObject({ status: 400 });
    await expect(records.addFavorite(alice, { ...fav, resource_id: '' })).rejects.toMatchObject({ status: 400, message: 'invalid request payload' });
    await expect(records.favorites(ApiContext.anonymous(engine), 'Practitioner')).rejects.toMatchObject({ status: 401 });
    expect(await records.removeFavorite(bob, fav)).toBe(false);
    expect(await records.removeFavorite(alice, fav)).toBe(true);
    await records.addFavorite(alice, fav);
    await records.removeAll(alice);
    expect(await records.favorites(alice, 'Practitioner')).toEqual([]);
    expect(await records.favorites(bob, 'Practitioner')).toHaveLength(1);
    const bare = new RecordsManager(new Engine(), new FakeRecordsProvider());
    await expect(bare.favorites(alice, 'Practitioner')).rejects.toMatchObject({ status: 501 });
  });

  it('the MedicalHistory graph: each requested encounter with everything reachable through references, both ways, Binary excluded, newest first', async () => {
    const ref = (r: string) => ({ reference: r });
    provider.seed('alice', 'source-1', { resourceType: 'Encounter', id: 'e1', period: { start: '2024-03-01' }, participant: [{ individual: ref('Practitioner/dr-1') }], serviceProvider: ref('Organization/org-1'), diagnosis: [{ condition: ref('Condition/c1') }] } as Resource);
    provider.seed('alice', 'source-1', { resourceType: 'Practitioner', id: 'dr-1', name: [{ text: 'Dr One' }] } as Resource);
    provider.seed('alice', 'source-1', { resourceType: 'Organization', id: 'org-1', name: 'Clinic' } as Resource);
    provider.seed('alice', 'source-1', { resourceType: 'Observation', id: 'ob-e1', status: 'final', code: { text: 'BP' }, effectiveDateTime: '2024-03-02', encounter: ref('Encounter/e1') } as Resource);
    provider.seed('alice', 'source-1', { resourceType: 'DocumentReference', id: 'doc-1', status: 'current', date: '2024-03-01', context: { encounter: [ref('Encounter/e1')] }, content: [{ attachment: { url: 'Binary/bin-1' } }] } as Resource);
    provider.seed('alice', 'source-1', { resourceType: 'Binary', id: 'bin-1', contentType: 'text/plain' } as Resource);
    provider.seed('alice', 'source-1', { resourceType: 'Encounter', id: 'e2', period: { start: '2024-05-01' }, reasonReference: [ref('Condition/missing')] } as Resource);
    provider.seed('bob', 'source-9', { resourceType: 'Encounter', id: 'e-bob', period: { start: '2024-01-01' } } as Resource);
    const ids = [
      { source_id: 'source-1', source_resource_type: 'Encounter', source_resource_id: 'e1' },
      { source_id: 'source-1', source_resource_type: 'Encounter', source_resource_id: 'e2' },
      { source_id: 'source-9', source_resource_type: 'Encounter', source_resource_id: 'e-bob' }, // not alice's: absent, never someone else's record
    ];
    const graph = await records.graph(alice, 'MedicalHistory', ids);
    expect(Object.keys(graph.results)).toEqual(['Encounter']);
    const encounters = graph.results['Encounter']!;
    expect(encounters.map((e) => e['source_resource_id'])).toEqual(['e2', 'e1']);
    const e1 = encounters[1]!;
    const relatedIds = (e1['related_resources'] as Record<string, unknown>[]).map((r) => `${r['source_resource_type']}/${r['source_resource_id']}`);
    expect(relatedIds).toEqual(expect.arrayContaining(['Practitioner/dr-1', 'Organization/org-1', 'Condition/c1', 'Observation/ob-e1', 'DocumentReference/doc-1']));
    expect(relatedIds).not.toContain('Binary/bin-1');
    expect(relatedIds.indexOf('Condition/c1')).toBeLessThan(relatedIds.indexOf('Observation/ob-e1')); // newest first: c1 was recorded 2024-07-01, the observation 2024-03-02
    expect((e1['related_resources'] as Record<string, unknown>[])[0]).toMatchObject({ source_id: 'source-1', resource_raw: expect.objectContaining({ resourceType: 'Condition', id: 'c1' }) });
    expect((encounters[0]!['related_resources'] as unknown[])).toEqual([]); // a dangling reference is not invented
    await expect(records.graph(alice, 'AddressBook', ids)).rejects.toMatchObject({ status: 400 });
    await expect(records.graph(alice, 'MedicalHistory', [])).rejects.toMatchObject({ status: 400 });
    await expect(records.graph(ApiContext.anonymous(engine), 'MedicalHistory', ids)).rejects.toMatchObject({ status: 401 });
  });

  it('find anything by words: every word must match the record\'s own text, best first with a snippet; user A never sees user B', async () => {
    provider.seed('alice', 'source-1', { resourceType: 'MedicationStatement', id: 'm1', status: 'active', medicationCodeableConcept: { text: 'Metformin 500 MG oral tablet', coding: [{ system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '860975' }] }, effectiveDateTime: '2023-06-01', note: [{ text: 'take with the evening meal' }] } as Resource);
    provider.seed('alice', 'source-1', { resourceType: 'DocumentReference', id: 'doc-c', status: 'current', date: '2023-02-10', type: { text: 'Cardiology consult note' }, description: 'Follow-up after the stress test' } as Resource);
    provider.seed('bob', 'source-9', { resourceType: 'MedicationStatement', id: 'm-bob', status: 'active', medicationCodeableConcept: { text: 'Metformin 1000 MG' } } as Resource);
    const hits = await records.searchText(alice, 'metformin');
    expect(hits.map((h) => h.source_resource_id)).toEqual(['m1']);
    expect(hits[0]).toMatchObject({ source_id: 'source-1', source_resource_type: 'MedicationStatement', title: 'Metformin 500 MG oral tablet', date: '2023-06-01', snippet: expect.stringContaining('metformin') });
    expect((await records.searchText(alice, 'cardiology 2023')).map((h) => h.source_resource_id)).toEqual(['doc-c']);
    expect(await records.searchText(alice, 'evening meal')).toHaveLength(1);
    expect(await records.searchText(alice, '860975')).toEqual([]); // a bare code is not a word a person knows
    expect(await records.searchText(alice, 'm')).toEqual([]); // under two characters: nothing, as Go's box
    expect((await records.searchText(bob, 'metformin')).map((h) => h.source_resource_id)).toEqual(['m-bob']);
    expect(await records.searchText(alice, 'metformin', { limit: 1, page: 1 })).toEqual([]);
    await expect(records.searchText(ApiContext.anonymous(engine), 'metformin')).rejects.toMatchObject({ status: 401 });
  });
});
