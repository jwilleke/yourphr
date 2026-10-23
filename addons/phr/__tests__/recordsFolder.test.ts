import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildAddonHost, openAddonTestDatabase } from '@jwilleke/ngdpbase-types/testing';
import type { Decision, PermissionSubject } from '@jwilleke/ngdpbase-types';
import { PHR_MIGRATIONS, PHR_LEDGER_TABLE } from '../managers/migrations.js';
import { PhrRecordStore, type Db } from '../managers/PhrRecordStore.js';
import { PhrManager, type PhrCaller } from '../managers/PhrManager.js';
import { readFolderFile } from '../importers/recordsFolder.js';
import { localId } from '../managers/localIds.js';
import { fileItem, importFiles, shimFor } from './importHelpers.js';

/** phr's own id for a record this test's files (source 'folder', no server named) call `id`. */
const pid = (type: string, id: string, source = 'folder') => localId(`urn:yourphr:source:${source}`, type, id);
const GLUCOSE = pid('Observation', 'obs-glucose');

// Synthetic records only: no real person, no real provider.
const patient = { resourceType: 'Patient', id: 'p1', name: [{ family: 'Testperson', given: ['Synthetic'] }] };
const glucose = (value: number) => ({ resourceType: 'Observation', id: 'obs-glucose', status: 'final', code: { text: 'Glucose' }, valueQuantity: { value, unit: 'mg/dL' } });
const bundle = (...resources: object[]) => ({ resourceType: 'Bundle', type: 'collection', entry: resources.map((resource) => ({ resource })) });
const bytes = (s: string) => new TextEncoder().encode(s);

const defaults = JSON.parse(readFileSync(new URL('../config/default-config.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const allowAll = async (): Promise<Decision> => ({ permit: true, applicable: true, reason: 'test-allow' });
function caller(username: string): PhrCaller {
  return {
    subject: { username, roles: ['reader'], isAuthenticated: true } as unknown as PermissionSubject,
    ipAddress: '127.0.0.1',
    enforceDeny: async (permission: string) => { throw new Error(`refused ${permission}`); }
  };
}

describe('reading one file from a records download', () => {
  it('reads FHIR JSON bundles and NDJSON, and names everything else for what it is', () => {
    const files = {
      'Export/fhir/everything.json': JSON.stringify(bundle(patient, glucose(112))),
      'Export/fhir/Observation.ndjson': `${JSON.stringify(glucose(98))}\n\n`,
      'Export/ccr/visit.xml': '<ContinuityOfCareRecord/>',
      'Export/scans/letter.pdf': '%PDF-1.4',
      'Export/broken.json': '{ not json'
    };
    const read = Object.entries(files).map(([path, text]) => readFolderFile(path, bytes(text)));
    expect(read.map((f) => [f.path, f.kind])).toEqual([
      ['Export/fhir/everything.json', 'fhir'],
      ['Export/fhir/Observation.ndjson', 'fhir'],
      ['Export/ccr/visit.xml', 'unsupported'],
      ['Export/scans/letter.pdf', 'unsupported'],
      ['Export/broken.json', 'unreadable']
    ]);
    expect(read[0].kind === 'fhir' && read[0].resources.length).toBe(2);
  });

  it('never echoes a file\'s content in a reason', () => {
    const f = readFolderFile('x.json', bytes('{"name": "Synthetic Testperson", oops'));
    expect(f.kind).toBe('unreadable');
    expect(JSON.stringify(f)).not.toContain('Testperson');
  });

  it('the engine hands phr only the files phr reads: FHIR JSON, NDJSON and C-CDA, by content too', () => {
    expect(shimFor(fileItem('a.json', bundle(patient)))?.name).toBe('fhir');
    expect(shimFor(fileItem('a.ndjson', `${JSON.stringify(glucose(1))}\n`))?.name).toBe('fhir');
    expect(shimFor(fileItem('a.json', { not: 'fhir' }))).toBeUndefined();
    expect(shimFor(fileItem('visit.xml', '<ContinuityOfCareRecord/>'))).toBeUndefined();
    expect(shimFor(fileItem('letter.pdf', '%PDF-1.4'))).toBeUndefined();
  });
});

describe('importing a file through PhrManager', () => {
  let db: Db & { close(): void };
  let audit: Record<string, unknown>[];
  let phr: PhrManager;

  beforeEach(() => {
    db = openAddonTestDatabase<Db & { close(): void }>('phr', { migrations: PHR_MIGRATIONS, ledgerTable: PHR_LEDGER_TABLE }, { slug: 'phr', defaults });
    audit = [];
    const host = buildAddonHost('phr', defaults);
    const sink = { logAuditEvent: async (e: Record<string, unknown>) => { audit.push(e); return 'id'; }, flushAuditQueue: async () => {} };
    phr = new PhrManager({ store: new PhrRecordStore(db), decide: allowAll, recordAudit: (e) => host.recordAuditEvent(sink, e), host });
  });
  afterEach(() => db.close());

  const download = (value: number, extra: Record<string, string> = {}) => ({
    'fhir/everything.json': JSON.stringify(bundle(patient, glucose(value))),
    'ccr/visit.xml': '<ContinuityOfCareRecord/>',
    ...extra
  });

  it('imports the records, owned by the person importing, with one audit event per file', async () => {
    const report = await importFiles(phr, caller('alice'), download(112));
    expect(report).toEqual({ created: 2, updated: 0, unchanged: 0, skipped: 0, conflicts: 0 });
    expect((await phr.read(caller('alice'), 'Observation', GLUCOSE))?.resource.valueQuantity).toEqual({ value: 112, unit: 'mg/dL' });
    expect(await phr.read(caller('bob'), 'Observation', GLUCOSE)).toBeUndefined();
    const imports = audit.filter((e) => e.action === 'phr-write');
    expect(imports).toHaveLength(1);
    expect((imports[0].metadata as Record<string, unknown>).owner).toBe('alice');
    expect(JSON.stringify(audit)).not.toContain('Glucose');
  });

  it('importing the same file again makes no new versions', async () => {
    await importFiles(phr, caller('alice'), download(112));
    const again = await importFiles(phr, caller('alice'), download(112));
    expect(again).toEqual({ created: 0, updated: 0, unchanged: 2, skipped: 0, conflicts: 0 });
    expect((await phr.history(caller('alice'), 'Observation', GLUCOSE)).length).toBe(1);
  });

  it('a changed file updates just its changed records, keeping history', async () => {
    await importFiles(phr, caller('alice'), download(112));
    const changed = await importFiles(phr, caller('alice'), download(98));
    expect(changed).toEqual({ created: 0, updated: 1, unchanged: 1, skipped: 0, conflicts: 0 });
    expect((await phr.history(caller('alice'), 'Observation', GLUCOSE)).map((r) => r.versionId)).toEqual(['2', '1']);
  });

  it('two people importing the same file keep separate records', async () => {
    await importFiles(phr, caller('alice'), download(112));
    await importFiles(phr, caller('bob'), download(150));
    expect((await phr.read(caller('alice'), 'Observation', GLUCOSE))?.resource.valueQuantity).toEqual({ value: 112, unit: 'mg/dL' });
    expect((await phr.read(caller('bob'), 'Observation', GLUCOSE))?.resource.valueQuantity).toEqual({ value: 150, unit: 'mg/dL' });
  });

  it('nobody can import into another person\'s records', async () => {
    await expect(importFiles(phr, caller('bob'), download(112), 'alice')).rejects.toThrow(/refused/);
    expect(await phr.read(caller('alice'), 'Observation', GLUCOSE)).toBeUndefined();
  });

  it('skips records with no id, and keeps a same-id record from another source as its own record (#784)', async () => {
    await phr.write(caller('alice'), glucose(70), 'epic');
    const report = await importFiles(phr, caller('alice'), {
      'a.json': JSON.stringify(bundle(glucose(112), { resourceType: 'Observation', code: { text: 'no id' } }))
    });
    expect(report).toEqual({ created: 1, updated: 0, unchanged: 0, skipped: 1, conflicts: 0 });
    expect((await phr.read(caller('alice'), 'Observation', 'obs-glucose'))?.resource.valueQuantity).toEqual({ value: 70, unit: 'mg/dL' });
    expect((await phr.read(caller('alice'), 'Observation', GLUCOSE))?.resource.valueQuantity).toEqual({ value: 112, unit: 'mg/dL' });
  });
});
