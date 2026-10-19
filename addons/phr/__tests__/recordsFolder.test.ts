import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import { buildAddonHost, openAddonTestDatabase } from '@jwilleke/ngdpbase-types/testing';
import type { Decision, PermissionSubject } from '@jwilleke/ngdpbase-types';
import { PHR_MIGRATIONS, PHR_LEDGER_TABLE } from '../managers/migrations.js';
import { PhrRecordStore, type Db } from '../managers/PhrRecordStore.js';
import { PhrManager, type PhrCaller } from '../managers/PhrManager.js';
import { readFolderZip, FolderError } from '../importers/recordsFolder.js';

// Synthetic records only: no real person, no real provider.
const patient = { resourceType: 'Patient', id: 'p1', name: [{ family: 'Testperson', given: ['Synthetic'] }] };
const glucose = (value: number) => ({ resourceType: 'Observation', id: 'obs-glucose', status: 'final', code: { text: 'Glucose' }, valueQuantity: { value, unit: 'mg/dL' } });
const bundle = (...resources: object[]) => ({ resourceType: 'Bundle', type: 'collection', entry: resources.map((resource) => ({ resource })) });

function zipOf(files: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
}

const defaults = JSON.parse(readFileSync(new URL('../config/default-config.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const allowAll = async (): Promise<Decision> => ({ permit: true, applicable: true, reason: 'test-allow' });
function caller(username: string): PhrCaller {
  return {
    subject: { username, roles: ['reader'], isAuthenticated: true } as unknown as PermissionSubject,
    ipAddress: '127.0.0.1',
    enforceDeny: async (permission: string) => { throw new Error(`refused ${permission}`); }
  };
}

describe('reading a records-folder zip', () => {
  it('reads FHIR JSON bundles and NDJSON, and lists everything else as not read yet', () => {
    const files = readFolderZip(zipOf({
      'Export/fhir/everything.json': JSON.stringify(bundle(patient, glucose(112))),
      'Export/fhir/Observation.ndjson': `${JSON.stringify(glucose(98))}\n\n`,
      'Export/ccda/visit.xml': '<ClinicalDocument/>',
      'Export/scans/letter.pdf': '%PDF-1.4',
      'Export/broken.json': '{ not json',
      'Export/.DS_Store': 'x',
      '__MACOSX/Export/._everything.json': 'x'
    }));
    expect(files.map((f) => [f.path, f.kind])).toEqual([
      ['Export/broken.json', 'unreadable'],
      ['Export/ccda/visit.xml', 'unsupported'],
      ['Export/fhir/Observation.ndjson', 'fhir'],
      ['Export/fhir/everything.json', 'fhir'],
      ['Export/scans/letter.pdf', 'unsupported']
    ]);
    const everything = files.find((f) => f.path.endsWith('everything.json'));
    expect(everything?.kind === 'fhir' && everything.resources.length).toBe(2);
    expect(files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256))).toBe(true);
  });

  it('never echoes a file\'s content in a reason', () => {
    const [f] = readFolderZip(zipOf({ 'x.json': '{"name": "Synthetic Testperson", oops' }));
    expect(f.kind).toBe('unreadable');
    expect(JSON.stringify(f)).not.toContain('Testperson');
  });

  it('refuses something that isn\'t a zip', () => {
    expect(() => readFolderZip(strToU8('hello'))).toThrow(FolderError);
  });

  it('refuses a zip that expands past the limits, importing nothing', () => {
    const zip = zipOf({ 'a.json': 'x'.repeat(5000), 'b.json': 'y'.repeat(5000) });
    expect(() => readFolderZip(zip, { maxEntries: 10, maxEntryBytes: 1_000_000, maxTotalBytes: 8000 })).toThrow(/once expanded/);
    expect(() => readFolderZip(zip, { maxEntries: 1, maxEntryBytes: 1_000_000, maxTotalBytes: 1_000_000 })).toThrow(/more than 1 files/);
  });
});

describe('importing a records folder through PhrManager', () => {
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

  const folder = (value: number, extra: Record<string, string> = {}) => readFolderZip(zipOf({
    'fhir/everything.json': JSON.stringify(bundle(patient, glucose(value))),
    'ccda/visit.xml': '<ClinicalDocument/>',
    ...extra
  }));

  it('imports the records, owned by the person importing, with one audit event', async () => {
    const report = await phr.importFolder(caller('alice'), folder(112));
    expect(report.files).toEqual({ imported: 1, unchanged: 0, unsupported: 1, unreadable: 0, missing: 0 });
    expect(report.records).toEqual({ created: 2, updated: 0, unchanged: 0, skipped: 0, conflicts: 0 });
    expect((await phr.read(caller('alice'), 'Observation', 'obs-glucose'))?.resource.valueQuantity).toEqual({ value: 112, unit: 'mg/dL' });
    expect(await phr.read(caller('bob'), 'Observation', 'obs-glucose')).toBeUndefined();
    const imports = audit.filter((e) => e.action === 'phr-write');
    expect(imports).toHaveLength(1);
    expect((imports[0].metadata as Record<string, unknown>).owner).toBe('alice');
    expect(JSON.stringify(audit)).not.toContain('Glucose');
  });

  it('importing the same folder again changes nothing', async () => {
    await phr.importFolder(caller('alice'), folder(112));
    const again = await phr.importFolder(caller('alice'), folder(112));
    expect(again.files).toEqual({ imported: 0, unchanged: 2, unsupported: 0, unreadable: 0, missing: 0 });
    expect(again.records).toEqual({ created: 0, updated: 0, unchanged: 0, skipped: 0, conflicts: 0 });
    expect((await phr.history(caller('alice'), 'Observation', 'obs-glucose')).length).toBe(1);
  });

  it('a changed file updates just its changed records, keeping history', async () => {
    await phr.importFolder(caller('alice'), folder(112));
    const changed = await phr.importFolder(caller('alice'), folder(98));
    expect(changed.files.imported).toBe(1);
    expect(changed.records).toEqual({ created: 0, updated: 1, unchanged: 1, skipped: 0, conflicts: 0 });
    expect((await phr.history(caller('alice'), 'Observation', 'obs-glucose')).map((r) => r.versionId)).toEqual(['2', '1']);
  });

  it('a file missing from a later import is flagged, and its records are kept', async () => {
    await phr.importFolder(caller('alice'), folder(112, { 'fhir/extra.ndjson': JSON.stringify({ resourceType: 'Condition', id: 'c1', code: { text: 'Test condition' } }) }));
    const later = await phr.importFolder(caller('alice'), folder(112));
    expect(later.files.missing).toBe(1);
    expect(await phr.read(caller('alice'), 'Condition', 'c1')).toBeDefined();
  });

  it('two people importing the same file keep separate records', async () => {
    await phr.importFolder(caller('alice'), folder(112));
    await phr.importFolder(caller('bob'), folder(150));
    expect((await phr.read(caller('alice'), 'Observation', 'obs-glucose'))?.resource.valueQuantity).toEqual({ value: 112, unit: 'mg/dL' });
    expect((await phr.read(caller('bob'), 'Observation', 'obs-glucose'))?.resource.valueQuantity).toEqual({ value: 150, unit: 'mg/dL' });
  });

  it('nobody can import into another person\'s records', async () => {
    await expect(phr.importFolder(caller('bob'), folder(112), 'folder', 'alice')).rejects.toThrow(/refused/);
    expect(await phr.read(caller('alice'), 'Observation', 'obs-glucose')).toBeUndefined();
  });

  it('skips records with no id, and refuses to let the folder overwrite another source\'s record', async () => {
    await phr.write(caller('alice'), glucose(70), 'epic');
    const report = await phr.importFolder(caller('alice'), readFolderZip(zipOf({
      'a.json': JSON.stringify(bundle(glucose(112), { resourceType: 'Observation', code: { text: 'no id' } }))
    })));
    expect(report.records).toEqual({ created: 0, updated: 0, unchanged: 0, skipped: 1, conflicts: 1 });
    expect((await phr.read(caller('alice'), 'Observation', 'obs-glucose'))?.sourceId).toBe('epic');
  });
});
