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
  // The person's own records — their Patient, their devices — live in the account's `manual`
  // source, so this spec needs something that names one. Only manualSource is ever reached here.
  engine.register('sources', {
    dependsOn: [], initialize: async () => {}, shutdown: async () => {},
    manualSource: async () => ({ id: 7 }),
    // source-7 is the account's own; source-2 is a provider's, and source-3 an uploaded file,
    // which is manual too — the person chose it.
    isManual: async (_ctx: unknown, publicId: string) => publicId === 'source-7' || publicId === 'source-3' || publicId === '',
    // Two connected sources: one the person signed in to, one they uploaded a file from.
    list: async () => [
      { id: 7, display: 'Added by you', platformType: 'manual', patient: '' },
      { id: 2, display: 'Fake Regional Health', platformType: 'ehr', patient: 'pa' },
      { id: 3, display: 'Old records.xml', platformType: 'manual', patient: 'px' },
    ],
  } as never);
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

/**
 * The Patient each source sent, as it arrived (yourphr#761) — seeded per test rather than for every
 * one, so the counts the other specs assert stay about the records those specs are describing.
 */
const seedSourcePatients = (): void => {
  provider.seed('alice', 'source-2', { resourceType: 'Patient', id: 'pa', name: [{ given: ['Jane'], family: 'Doe' }], birthDate: '1971-04-02', identifier: [{ system: 'http://fake.example.org/mrn', value: 'E12345' }] } as Resource);
  provider.seed('alice', 'source-3', { resourceType: 'Patient', id: 'px', name: [{ given: ['Sam'], family: 'Doe' }], birthDate: '2014-06-01', identifier: [{ system: 'http://city.example.org/mrn', value: 'C999' }] } as Resource);
};

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

  // yourphr#762: the person can see what is waiting and say it is right.
  it('lists what awaits review with the reasons in the words they were shown, and confirming returns it to the chart', async () => {
    const waiting = {
      resourceType: 'Observation',
      id: 'o-wait',
      status: 'final',
      code: { text: 'peak flow' },
      note: [{ text: '"peak flow" is not a measurement this release knows how to code, so it is stored as written' }],
      meta: { tag: [{ system: 'https://yourphr.org/fhir/CodeSystem/record-origin', code: 'needs-review' }] },
    };
    await records.writer(alice, 'source-1').upsert(waiting as never);

    const queue = await records.awaitingReview(alice);
    expect(queue).toEqual([{ source_id: 'source-1', source_resource_type: 'Observation', source_resource_id: 'o-wait', title: 'peak flow', reasons: [waiting.note[0]!.text] }]);
    expect(await records.awaitingReview(bob)).toEqual([]); // never another account's

    await records.confirmReview(alice, 'o-wait');
    expect(await records.awaitingReview(alice)).toEqual([]);
    expect((await records.list(alice, 'Observation')).map((r) => r['source_resource_id'])).toContain('o-wait'); // now a chart fact

    // The note stays: why it was once uncertain is part of the record's story.
    expect(((await records.detail(alice, 'o-wait'))['resource_raw'] as { note?: unknown[] }).note).toHaveLength(1);
  });

  it('refuses to confirm a record that is not waiting, and one that is not the caller\'s', async () => {
    await expect(records.confirmReview(alice, 'o1')).rejects.toMatchObject({ status: 409 });
    await expect(records.confirmReview(alice, 'o9')).rejects.toMatchObject({ status: 404 }); // bob's
  });

  // yourphr#762, decided 2026-09-23: discarding leaves NOTHING behind.
  it('discards a waiting record without a trace — no row, no history, nothing to say it existed', async () => {
    const mistake = {
      resourceType: 'Observation',
      id: 'o-oops',
      status: 'final',
      code: { text: 'peek flow' },
      note: [{ text: '"peek flow" is not a measurement this release knows how to code, so it is stored as written' }],
      meta: { tag: [{ system: 'https://yourphr.org/fhir/CodeSystem/record-origin', code: 'needs-review' }] },
    };
    await records.writer(alice, 'source-1').upsert(mistake as never);

    await records.discardReview(alice, 'o-oops');

    expect(await records.awaitingReview(alice)).toEqual([]);
    await expect(records.detail(alice, 'o-oops')).rejects.toMatchObject({ status: 404 });
    expect(await provider.history('alice', 'Observation', 'o-oops')).toEqual({ firstReceivedAt: null, versions: 0 });
    expect(await records.searchText(alice, 'peek flow')).toEqual([]);
  });

  it('refuses to discard a record that is a chart fact, and one that is not the caller\'s', async () => {
    await expect(records.discardReview(alice, 'o1')).rejects.toMatchObject({ status: 409 }); // in the chart, not waiting
    await expect(records.discardReview(alice, 'o9')).rejects.toMatchObject({ status: 404 }); // bob's
    expect((await records.detail(alice, 'o1'))['source_resource_id']).toBe('o1'); // still there
  });

  // yourphr#764: a measured reading and a remembered one are different evidence.
  it('makes a device record from the name the person typed, and reuses it next time', async () => {
    const first = await records.deviceFor(alice, 'Omron cuff');
    const again = await records.deviceFor(alice, '  omron CUFF  '); // the same cuff, typed differently
    expect(again.id).toBe(first.id);

    const stored = (await records.detail(alice, first.id))['resource_raw'] as Record<string, unknown>;
    expect(stored['deviceName']).toEqual([{ name: 'Omron cuff', type: 'user-friendly-name' }]);
    // Nothing a name is not: no manufacturer, no model, no serial number, no type coding.
    expect(stored['manufacturer']).toBeUndefined();
    expect(stored['modelNumber']).toBeUndefined();
    expect(stored['serialNumber']).toBeUndefined();
    expect(stored['type']).toBeUndefined();
    expect(await records.ownDevices(alice)).toEqual([{ id: first.id, name: 'Omron cuff' }]);
    expect(await records.ownDevices(bob)).toEqual([]); // never another account's
  });

  it('resolves a device by id, by name, or to nothing when none was named', async () => {
    const cuff = await records.deviceFor(alice, 'Omron cuff');
    expect(await records.deviceReference(alice, cuff.id, '')).toBe(`Device/${cuff.id}`);
    expect(await records.deviceReference(alice, '', 'Omron cuff')).toBe(`Device/${cuff.id}`);
    expect(await records.deviceReference(alice, '', '')).toBe(''); // naming none is an answer
    // A device that is not theirs is a client mistake, not a fact to record.
    await expect(records.deviceReference(bob, cuff.id, '')).rejects.toMatchObject({ status: 400 });
  });

  // yourphr#761: sameness is asserted by the person, prefilled from the evidence, never inferred.
  it('reports each source identity with its evidence, and preselects only what the person authenticated to', async () => {
    seedSourcePatients();
    const identities = await records.sourceIdentities(alice);
    expect(identities.map((i) => [i.sourceId, i.suggested, i.answer])).toEqual([
      ['source-2', 'self', ''],   // signed in there, and the token named this record
      ['source-3', '', ''],       // a file they uploaded says nothing about whose record it is
    ]);
    expect(identities[0]!.evidence[0]).toContain('You signed in to Fake Regional Health yourself');
    expect(identities[0]!.demographics).toEqual({ name: 'Jane Doe', birthDate: '1971-04-02', gender: '' });
    // Two records about different people: surfaced as a disagreement, never resolved here.
    expect(identities[0]!.conflicts.join(' ')).toContain('different date of birth');
  });

  // The bug this issue exists to fix: until #761 the person record learned from EVERY source, so a
  // parent with proxy access to a child's portal had the child's MRN land on their own record.
  it('learns an identifier only from a source the person has confirmed is about them', async () => {
    seedSourcePatients();
    const before = (await records.detail(alice, (await records.selfPatient(alice)).id))['resource_raw'] as { identifier?: unknown[] };
    expect(before.identifier).toBeUndefined(); // nothing is assumed from a connection alone

    await records.assertIdentity(alice, 'source-2', 'self');
    await records.assertIdentity(alice, 'source-3', 'not-self');

    const after = (await records.detail(alice, (await records.selfPatient(alice)).id))['resource_raw'] as { identifier?: { value?: string }[] };
    expect(after.identifier?.map((i) => i.value)).toEqual(['E12345']); // theirs only
    expect((await records.sourceIdentities(alice)).map((i) => i.answer)).toEqual(['self', 'not-self']);
  });

  it('lets the person change their mind, and the person record follows', async () => {
    seedSourcePatients();
    await records.assertIdentity(alice, 'source-2', 'self');
    await records.assertIdentity(alice, 'source-2', 'not-self');
    const person = (await records.detail(alice, (await records.selfPatient(alice)).id))['resource_raw'] as { identifier?: unknown[] };
    expect(person.identifier).toBeUndefined();
  });

  it('records the assertion as a Provenance about that Patient, and moves no clinical record', async () => {
    seedSourcePatients();
    await records.assertIdentity(alice, 'source-2', 'self');
    const provenance = (await records.list(alice, 'Provenance'));
    expect(provenance).toHaveLength(1);
    const raw = provenance[0]!['resource_raw'] as { target?: { reference?: string }[]; agent?: { who?: { reference?: string } }[]; activity?: { coding?: { code?: string }[] } };
    expect(raw.target?.[0]?.reference).toBe('Patient/pa');
    expect(raw.activity?.coding?.[0]?.code).toBe('self');
    expect(raw.agent?.[0]?.who?.reference).toMatch(/^Patient\//);
    // The source's own Patient is untouched, and its records still belong to it.
    expect((await records.detail(alice, 'pa'))['source_id']).toBe('source-2');
    // The reading that source sent still belongs to it: an identity answer moves no clinical record.
    expect((await records.list(alice, 'Observation', { sourceId: 'source-2' })).map((r) => r['source_resource_id'])).toEqual(['o3']);
  });

  it('refuses an answer that is neither, and a source that is not theirs', async () => {
    seedSourcePatients();
    await expect(records.assertIdentity(alice, 'source-2', 'maybe' as never)).rejects.toMatchObject({ status: 400 });
    await expect(records.assertIdentity(alice, 'source-99', 'self')).rejects.toMatchObject({ status: 404 });
  });

  // yourphr#771: the Address book's delete button did nothing for as long as the path existed.
  it('deletes a record the person entered themselves', async () => {
    provider.seed('alice', 'source-7', { resourceType: 'Practitioner', id: 'p-mine', name: [{ text: 'Dr Typed In' }] } as Resource);
    await records.deleteOwnRecord(alice, 'Practitioner', 'p-mine');
    await expect(records.detail(alice, 'p-mine')).rejects.toMatchObject({ status: 404 });
  });

  it('deletes one from a file they uploaded, because they chose that file', async () => {
    provider.seed('alice', 'source-3', { resourceType: 'Practitioner', id: 'p-upload', name: [{ text: 'Dr From A File' }] } as Resource);
    await records.deleteOwnRecord(alice, 'Practitioner', 'p-upload');
    await expect(records.detail(alice, 'p-upload')).rejects.toMatchObject({ status: 404 });
  });

  // The refusal that matters: the next sync would fetch it again, and a delete that undoes itself
  // is worse than one that never happened.
  it('refuses to delete what a provider sent, and says what to do instead', async () => {
    provider.seed('alice', 'source-2', { resourceType: 'Practitioner', id: 'p-theirs', name: [{ text: 'Dr From Epic' }] } as Resource);
    await expect(records.deleteOwnRecord(alice, 'Practitioner', 'p-theirs')).rejects.toMatchObject({ status: 409 });
    await expect(records.deleteOwnRecord(alice, 'Practitioner', 'p-theirs')).rejects.toThrow(/would not last|Disconnect the source/);
    expect((await records.detail(alice, 'p-theirs'))['source_resource_id']).toBe('p-theirs'); // still there
  });

  it('refuses another account\'s record, and a type that does not match the id', async () => {
    provider.seed('alice', 'source-7', { resourceType: 'Practitioner', id: 'p-mine', name: [{ text: 'Dr Typed In' }] } as Resource);
    await expect(records.deleteOwnRecord(alice, 'Practitioner', 'o9')).rejects.toMatchObject({ status: 404 }); // bob's
    // A type that does not match the stored record is a 404, not a delete of whatever shares the id.
    await expect(records.deleteOwnRecord(alice, 'Condition', 'p-mine')).rejects.toMatchObject({ status: 404 });
    expect((await records.detail(alice, 'p-mine'))['source_resource_id']).toBe('p-mine');
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
