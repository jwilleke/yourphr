import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import { buildAddonHost, openAddonTestDatabase } from '@jwilleke/ngdpbase-types/testing';
import type { Decision, PermissionSubject } from '@jwilleke/ngdpbase-types';
import { PHR_MIGRATIONS, PHR_LEDGER_TABLE } from '../managers/migrations.js';
import { PhrRecordStore, type Db } from '../managers/PhrRecordStore.js';
import { PhrManager, type PhrCaller } from '../managers/PhrManager.js';
import { localId, localiseRecords } from '../managers/localIds.js';
import { readFolderZip } from '../importers/recordsFolder.js';

// Synthetic records from two made-up servers that both use id 12345.
const A = 'https://fhir.a.example/r4';
const B = 'https://fhir.b.example/r4';
const condition = (text: string) => ({ resourceType: 'Condition', id: '12345', code: { text }, subject: { reference: 'Patient/7' } });
const patient = { resourceType: 'Patient', id: '7', name: [{ family: 'Testperson' }] };
const bundleFrom = (base: string, ...resources: Record<string, unknown>[]) => ({
  resourceType: 'Bundle', type: 'searchset',
  entry: resources.map((resource) => ({ fullUrl: `${base}/${String(resource.resourceType)}/${String(resource.id)}`, resource }))
});

describe('phr ids for received records', () => {
  it('two servers\' records with the same id get different phr ids', () => {
    expect(localId(A, 'Condition', '12345')).not.toBe(localId(B, 'Condition', '12345'));
    expect(localId(A, 'Condition', '12345')).toMatch(/^p[0-9a-f]{32}$/);
  });

  it('takes the server from the fullUrl, then meta.source, then the import', () => {
    const fromUrl = localiseRecords([condition('x')], [`${A}/Condition/12345`], 'urn:yourphr:source:folder');
    expect(fromUrl.resources[0].id).toBe(localId(A, 'Condition', '12345'));
    const fromMeta = localiseRecords([{ ...condition('x'), meta: { source: B } }], undefined, 'urn:yourphr:source:folder');
    expect(fromMeta.resources[0].id).toBe(localId(B, 'Condition', '12345'));
    const fallback = localiseRecords([condition('x')], undefined, 'urn:yourphr:source:folder');
    expect(fallback.resources[0].id).toBe(localId('urn:yourphr:source:folder', 'Condition', '12345'));
  });

  it('rewrites references to the phr ids, including to records in other files of the same server', () => {
    const { resources } = localiseRecords([condition('x')], [`${A}/Condition/12345`], 'urn:x');
    expect((resources[0].subject as { reference: string }).reference).toBe(`Patient/${localId(A, 'Patient', '7')}`);
    const absolute = localiseRecords([{ ...condition('x'), subject: { reference: `${B}/Patient/7` } }], undefined, 'urn:x');
    expect((absolute.resources[0].subject as { reference: string }).reference).toBe(`Patient/${localId(B, 'Patient', '7')}`);
  });

  it('resolves a Bundle\'s urn:uuid references, and keeps contained "#" references', () => {
    const obs = { resourceType: 'Observation', id: 'o1', subject: { reference: 'urn:uuid:aaaa' }, performer: [{ reference: '#p' }], contained: [{ resourceType: 'Practitioner', id: 'p' }] };
    const pat = { resourceType: 'Patient', id: 'pat-1' };
    const { resources } = localiseRecords([obs, pat], ['urn:uuid:bbbb', 'urn:uuid:aaaa'], 'urn:x');
    expect((resources[0].subject as { reference: string }).reference).toBe(`Patient/${String(resources[1].id)}`);
    expect((resources[0].performer as { reference: string }[])[0].reference).toBe('#p');
    expect((resources[0].contained as { id: string }[])[0].id).toBe('p');
  });

  it('a Provenance names phr\'s record as target and the original as its source', () => {
    const local = localiseRecords([condition('x')], [`${A}/Condition/12345`], 'urn:x');
    const prov = local.provenanceFor(0, '2026-10-22T00:00:00.000Z');
    expect(prov.resourceType).toBe('Provenance');
    expect(prov.target).toEqual([{ reference: `Condition/${localId(A, 'Condition', '12345')}` }]);
    expect(prov.entity).toEqual([{ role: 'source', what: { identifier: { system: A, value: 'Condition/12345' } } }]);
    expect(prov.recorded).toBe('2026-10-22T00:00:00.000Z');
  });
});

describe('importing two servers\' records with the same id (#784)', () => {
  const defaults = JSON.parse(readFileSync(new URL('../config/default-config.json', import.meta.url), 'utf8')) as Record<string, unknown>;
  const allowAll = async (): Promise<Decision> => ({ permit: true, applicable: true, reason: 'test-allow' });
  const alice: PhrCaller = {
    subject: { username: 'alice', roles: ['reader'], isAuthenticated: true } as unknown as PermissionSubject,
    ipAddress: '127.0.0.1',
    enforceDeny: async (permission: string) => { throw new Error(`refused ${permission}`); }
  };
  const zipOf = (files: Record<string, unknown>) => readFolderZip(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(JSON.stringify(v))]))));
  let db: Db & { close(): void };
  let phr: PhrManager;
  beforeEach(() => {
    db = openAddonTestDatabase<Db & { close(): void }>('phr', { migrations: PHR_MIGRATIONS, ledgerTable: PHR_LEDGER_TABLE }, { slug: 'phr', defaults });
    const host = buildAddonHost('phr', defaults);
    const sink = { logAuditEvent: async () => 'id', flushAuditQueue: async () => {} };
    phr = new PhrManager({ store: new PhrRecordStore(db), decide: allowAll, recordAudit: (e) => host.recordAuditEvent(sink, e), host });
  });
  afterEach(() => db.close());

  it('stores both, each pointing at its own server\'s patient, never refusing or overwriting', async () => {
    const report = await phr.importFolder(alice, zipOf({
      'a/everything.json': bundleFrom(A, patient, condition('High blood pressure')),
      'b/everything.json': bundleFrom(B, patient, condition('Asthma'))
    }));
    expect(report.records).toEqual({ created: 4, updated: 0, unchanged: 0, skipped: 0, conflicts: 0 });
    const a = await phr.read(alice, 'Condition', localId(A, 'Condition', '12345'));
    const b = await phr.read(alice, 'Condition', localId(B, 'Condition', '12345'));
    expect((a?.resource.code as { text: string }).text).toBe('High blood pressure');
    expect((b?.resource.code as { text: string }).text).toBe('Asthma');
    expect((a?.resource.subject as { reference: string }).reference).toBe(`Patient/${localId(A, 'Patient', '7')}`);
    expect(await phr.read(alice, 'Patient', localId(B, 'Patient', '7'))).toBeDefined();
  });

  it('keeps a Provenance per record, out of the counts and lists, and changes it only when the record changes', async () => {
    const files = (text: string) => zipOf({ 'a/everything.json': bundleFrom(A, patient, condition(text)) });
    await phr.importFolder(alice, files('High blood pressure'));
    const provs = await phr.list(alice, 'Provenance');
    expect(provs).toHaveLength(2);
    const { counts, recent } = await phr.overview(alice, 50);
    expect(counts.some((c) => c.resourceType === 'Provenance')).toBe(true); // counted in the store…
    expect(recent.some((r) => r.resourceType === 'Provenance')).toBe(false); // …but never listed as a record
    expect((await phr.toFormOptions({}, alice.subject)).some((o) => o.value.startsWith('Provenance/'))).toBe(false);

    const changed = await phr.importFolder(alice, files('Hypertension'));
    expect(changed.records).toEqual({ created: 0, updated: 1, unchanged: 1, skipped: 0, conflicts: 0 });
    const conditionProv = (await phr.list(alice, 'Provenance')).find((p) => JSON.stringify(p.resource.target).includes(localId(A, 'Condition', '12345')));
    expect(conditionProv?.versionId).toBe('2');
  });
});
