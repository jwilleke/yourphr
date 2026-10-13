import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Resource } from '@medplum/fhirtypes';
import { HISTORY_PER_PERSON_MIGRATION, PGHD_TAG_MIGRATION, RESOURCE_READ_INDEXES_MIGRATION, SqliteRecordsProvider, TEXT_ROWIDS_MIGRATION } from '../SqliteRecordsProvider.js';
import { RecordsManager } from '../../managers/RecordsManager.js';
import { SqliteFhirRepository } from '../../../SqliteFhirRepository.js';
import Database from 'better-sqlite3-multiple-ciphers';
import { backupDatabase, stageInstanceRestore, STAGED_APP, STAGED_PHD_SAMPLES, STAGED_RECORDS, RECORDS_LEDGER_TABLE } from '../sqlite-backup.js';
import { ApiContext } from '../../../framework/ApiContext.js';
import { Engine } from '../../../framework/Engine.js';
import { runMigrations } from '../../../framework/providers/sqlite-migrations.js';
import { SqliteDatabaseProvider } from '../../../framework/providers/SqliteDatabaseProvider.js';

const LOINC = 'http://loinc.org';
const obs = (id: string, code: string, date: string, system = LOINC): Resource =>
  ({ resourceType: 'Observation', id, status: 'final', code: { coding: [{ system, code, display: code }] }, effectiveDateTime: date } as Resource);

let dir: string;
let provider: SqliteRecordsProvider;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'spike-provider-'));
  provider = new SqliteRecordsProvider(join(dir, 'records.db'), 'unit-key');
  await provider.initialize();
  const w = provider.writer('alice', 'source-1');
  await w.upsert(obs('o1', '718-7', '2024-01-10'));
  await w.upsert(obs('o2', '718-7', '2024-05-10'));
  await w.upsert(obs('o3', '2345-7', '2024-03-10'));
  await w.upsert(obs('o4', 'BP', '2024-09-10', 'urn:local'));
  await provider.writer('bob', 'source-9').upsert(obs('o9', '718-7', '2025-01-01'));
});
afterEach(async () => { await provider.close(); rmSync(dir, { recursive: true, force: true }); });

describe('SqliteRecordsProvider — PHI storage over SQLCipher, scoped per account', () => {
  it('reads, lists, counts and attributes per account', async () => {
    expect((await provider.read('alice', 'Observation', 'o1'))?.sourceId).toBe('source-1');
    expect(await provider.read('bob', 'Observation', 'o1')).toBeUndefined();
    expect((await provider.readById('alice', 'o3'))?.resourceType).toBe('Observation');
    expect((await provider.list('alice')).map((r) => r.id)).toEqual(['o1', 'o2', 'o3', 'o4']);
    expect(await provider.countByType('alice')).toEqual([{ resourceType: 'Observation', count: 4 }]);
    expect(await provider.typesHeld('bob')).toEqual(['Observation']);
    expect([...(await provider.sourceOf('alice', 'Observation')).entries()]).toContainEqual(['o1', 'source-1']);
  });

  it('the writer reports created vs updated, keeps history, and refuses a cross-source collision', async () => {
    const w = provider.writer('alice', 'source-1');
    expect(await w.upsert(obs('o1', '718-7', '2024-01-11'))).toBe('updated');
    expect(await w.upsert(obs('o5', '718-7', '2024-08-01'))).toBe('created');
    expect(await w.exists('Observation', 'o5')).toBe(true);
    const h = await provider.history('alice', 'Observation', 'o1');
    expect(h.versions).toBeGreaterThanOrEqual(2);
    expect(h.firstReceivedAt).not.toBeNull();
    await expect(provider.writer('alice', 'source-2').upsert(obs('o1', '718-7', '2024-01-12'))).rejects.toThrow(/collision/);
  });

  it('a re-sync of an identical record writes nothing: no new version, no history row (yourphr#781)', async () => {
    const w = provider.writer('alice', 'source-1');
    const before = await provider.history('alice', 'Observation', 'o1');
    // What every 15-minute sync pass does: the provider sends the same record again.
    expect(await w.upsert(obs('o1', '718-7', '2024-01-10'))).toBe('unchanged');
    expect(await w.upsert(obs('o1', '718-7', '2024-01-10'))).toBe('unchanged');
    expect((await provider.history('alice', 'Observation', 'o1')).versions).toBe(before.versions);
    // Key order and the provider's own meta stamps are not content.
    const reordered = { effectiveDateTime: '2024-01-10', code: { coding: [{ display: '718-7', code: '718-7', system: 'http://loinc.org' }] }, status: 'final', id: 'o1', resourceType: 'Observation', meta: { versionId: 'provider-v9', lastUpdated: '2030-01-01T00:00:00Z' } } as Resource;
    expect(await w.upsert(reordered)).toBe('unchanged');
    // A real change is one new version, exactly.
    expect(await w.upsert(obs('o1', '718-7', '2024-01-11'))).toBe('updated');
    expect((await provider.history('alice', 'Observation', 'o1')).versions).toBe(before.versions + 1);
  });

  it('an identical record from ANOTHER source is still a collision, not quietly unchanged', async () => {
    await expect(provider.writer('alice', 'source-2').upsert(obs('o1', '718-7', '2024-01-10'))).rejects.toThrow(/collision/);
  });

  it('indexed search: exact token, system|code, system-only prefix, OR within a parameter, AND across; grouped values', async () => {
    const ids = async (where: Parameters<SqliteRecordsProvider['indexedSearch']>[2]) => (await provider.indexedSearch('alice', 'Observation', where)).map((r) => r.id).sort();
    expect(await ids([{ param: 'code', alternatives: ['718-7'] }])).toEqual(['o1', 'o2']);
    expect(await ids([{ param: 'code', alternatives: [`${LOINC}|2345-7`] }])).toEqual(['o3']);
    expect(await ids([{ param: 'code', alternatives: [`${LOINC}|`] }])).toEqual(['o1', 'o2', 'o3']);
    expect(await ids([{ param: 'code', alternatives: ['718-7', '2345-7'] }])).toEqual(['o1', 'o2', 'o3']);
    expect(await ids([{ param: 'code', alternatives: ['718-7'] }, { param: 'date', alternatives: ['ge2024-03-01'] }])).toEqual(['o2']);
    expect(await provider.indexedValues('alice', 'Observation', 'o1', 'code')).toEqual([`${LOINC}|718-7`]);
    await expect(provider.indexedSearch('alice', 'Observation', [{ param: 'bad param', alternatives: ['x'] }])).rejects.toThrow('invalid search parameter');
  });

  it('removes by source and by account, releases a handle, passes integrity, and writes an encrypted backup', async () => {
    expect(await provider.removeBySource('alice', 'source-1')).toBe(4);
    expect(await provider.list('alice')).toEqual([]);
    expect(await provider.list('bob')).toHaveLength(1);
    expect(await provider.removeAll('bob')).toBe(1);
    await provider.release('bob');
    expect(await provider.integrityOk()).toBe(true);
    const b = await provider.backup({ destination: join(dir, 'backups'), key: 'travelling' });
    expect(b.sizeBytes).toBeGreaterThan(0);
  });
});

describe('SqliteRecordsProvider — find anything by words (yourphr#599)', () => {
  it('finds a contained implant Procedure through the manager using Porter stemming', async () => {
    await provider.writer('alice', 'source-1').upsert({
      resourceType: 'Device',
      id: 'implant-search',
      type: { text: 'Synthetic stent' },
      contained: [{
        resourceType: 'Procedure',
        id: 'removal',
        status: 'completed',
        code: { text: 'Implant removal' },
        performedDateTime: '2024-06',
        focalDevice: [{ manipulated: { reference: '#' } }],
      }],
    } as Resource);

    const engine = new Engine();
    const records = new RecordsManager(engine, provider);
    const ctx = ApiContext.from({ username: 'alice', role: 'user' }, engine);
    const hits = await records.searchText(ctx, 'implant removing');

    expect(hits).toContainEqual(expect.objectContaining({
      source_resource_type: 'Procedure',
      source_resource_id: 'implant-search#removal',
    }));
  });

  it('indexes the record\'s own text into FTS5 on the same write, searches per owner with a snippet, and forgets a deleted record', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'spike-fts-spec-'));
    const provider = new SqliteRecordsProvider(join(dir, 'records.db'), 'at-rest-key');
    await provider.initialize();
    const alice = provider.writer('alice', 'source-1');
    const bob = provider.writer('bob', 'source-9');
    await alice.upsert({ resourceType: 'MedicationStatement', id: 'm1', status: 'active', medicationCodeableConcept: { text: 'Metformin 500 MG oral tablet' }, effectiveDateTime: '2023-06-01' } as never);
    await alice.upsert({ resourceType: 'DocumentReference', id: 'd1', status: 'current', type: { text: 'Cardiology consult note' }, date: '2023-02-10' } as never);
    await bob.upsert({ resourceType: 'MedicationStatement', id: 'm9', status: 'active', medicationCodeableConcept: { text: 'Metformin 1000 MG' } } as never);
    expect((await provider.textSearch('alice', 'metformin', { limit: 10, offset: 0 })).map((h) => h.id)).toEqual(['m1']);
    expect((await provider.textSearch('alice', 'metformin', { limit: 10, offset: 0 }))[0]?.snippet).toMatch(/\[Metformin\]/);
    expect((await provider.textSearch('alice', 'cardio', { limit: 10, offset: 0 })).map((h) => h.id)).toEqual(['d1']); // the last word is a prefix
    expect((await provider.textSearch('bob', 'metformin', { limit: 10, offset: 0 })).map((h) => h.id)).toEqual(['m9']);
    expect(await provider.textSearch('alice', '"; DROP TABLE resources; --', { limit: 10, offset: 0 })).toEqual([]);
    expect(await provider.textMatches('Implant removal', 'implant removing')).toBe(true);
    expect(await provider.textMatches('Implant placement', 'implant removing')).toBe(false);
    await provider.removeBySource('alice', 'source-1');
    expect(await provider.textSearch('alice', 'metformin', { limit: 10, offset: 0 })).toEqual([]);
    await provider.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('compact — removing the identical history copies v3.7.2 and earlier wrote (yourphr#781)', () => {
  it('keeps the first copy and every real change, repoints the current version, and touches nothing else', async () => {
    // Build the bloat the old way: updateResource writes a full version every time, as every sync
    // pass did up to v3.7.2. A (x3 identical), then a real change to B (x2 identical).
    const file = join(dir, 'bloated.db');
    const repo = new SqliteFhirRepository({ file, key: 'unit-key', userId: 'carol', sourceId: 'source-1' });
    const A = obs('c1', '718-7', '2024-01-10');
    const B = obs('c1', '718-7', '2024-02-10');
    for (const r of [A, A, A, B, B]) await repo.updateResource(r);
    await repo.updateResource(obs('c2', '2345-7', '2024-03-10')); // one version: nothing to remove
    const p = SqliteRecordsProvider.overRepository(repo);
    const before = await p.history('carol', 'Observation', 'c1');
    expect(before.versions).toBe(5);

    const dry = await p.compact({ dryRun: true });
    expect(dry).toMatchObject({ resources: 2, historyBefore: 6, duplicates: 3, historyAfter: 6, repointed: 1, dryRun: true, vacuumed: false, integrity: 'ok' });
    expect((await p.history('carol', 'Observation', 'c1')).versions).toBe(5);

    const done = await p.compact();
    expect(done).toMatchObject({ resources: 2, historyBefore: 6, duplicates: 3, historyAfter: 3, repointed: 1, dryRun: false, vacuumed: true, integrity: 'ok' });
    const after = await p.history('carol', 'Observation', 'c1');
    expect(after.versions).toBe(2); // A, then B: "changed 1 time", which is the truth
    expect(after.firstReceivedAt).toBe(before.firstReceivedAt);

    // The record reads as it did, and its current version is one that still exists in history.
    const stored = await p.read('carol', 'Observation', 'c1');
    expect((stored?.resource as { effectiveDateTime?: string }).effectiveDateTime).toBe('2024-02-10');
    const versionId = (stored?.resource as { meta?: { versionId?: string } }).meta?.versionId;
    const held = repo.db.prepare('SELECT COUNT(*) AS n FROM resource_history WHERE id = ? AND version_id = ?').get('c1', versionId) as { n: number };
    expect(held.n).toBe(1);
    expect((await p.history('carol', 'Observation', 'c2')).versions).toBe(1);

    // Running it again finds nothing more to do.
    expect(await p.compact()).toMatchObject({ duplicates: 0, repointed: 0, skippedShared: 0, vacuumed: false, integrity: 'ok' });
    repo.db.close();
  });

  it('compacts each person\'s copies of a shared record id on their own (yourphr#812)', async () => {
    const file = join(dir, 'shared.db');
    const carol = new SqliteFhirRepository({ file, key: 'unit-key', userId: 'carol', sourceId: 'source-1' });
    const dave = new SqliteFhirRepository({ file, key: 'unit-key', userId: 'dave', sourceId: 'source-2' });
    const A = obs('same-id', '718-7', '2024-01-10');
    for (const r of [A, A, A]) await carol.updateResource(r);
    for (const r of [A, A]) await dave.updateResource(r);
    await carol.updateResource(obs('only-carol', '718-7', '2024-05-10'));
    await carol.updateResource(obs('only-carol', '718-7', '2024-05-10'));
    const p = SqliteRecordsProvider.overRepository(carol);
    expect(await p.compact()).toMatchObject({ skippedShared: 0, duplicates: 4, integrity: 'ok' });
    const per = (user: string) => (carol.db.prepare("SELECT COUNT(*) AS n FROM resource_history WHERE id = 'same-id' AND user_id = ?").get(user) as { n: number }).n;
    expect([per('carol'), per('dave')]).toEqual([1, 1]);
    // Each person's current version still exists in their own history.
    for (const repo of [carol, dave]) {
      const v = (await repo.readResource('Observation', 'same-id')).meta?.versionId;
      expect((carol.db.prepare('SELECT COUNT(*) AS n FROM resource_history WHERE id = ? AND user_id = ? AND version_id = ?').get('same-id', repo.userId, v) as { n: number }).n).toBe(1);
    }
    carol.db.close(); dave.db.close();
  });
});

describe('history is kept per person — a shared record id never mixes two people (yourphr#812)', () => {
  const practitioner = (family: string): Resource => ({ resourceType: 'Practitioner', id: 'pr-shared', name: [{ family }] } as Resource);

  it('reads count only the asker\'s own versions', async () => {
    await provider.writer('alice', 'source-1').upsert(practitioner('Smith'));
    await provider.writer('bob', 'source-9').upsert(practitioner('Smith'));
    await provider.writer('bob', 'source-9').upsert(practitioner('Smith-Jones'));
    expect((await provider.history('alice', 'Practitioner', 'pr-shared')).versions).toBe(1);
    expect((await provider.history('bob', 'Practitioner', 'pr-shared')).versions).toBe(2);
  });

  it('deleting a record, a source or an account removes only that person\'s history', async () => {
    for (const [user, source] of [['alice', 'source-1'], ['bob', 'source-9']] as const) await provider.writer(user, source).upsert(practitioner('Smith'));
    await provider.removeRecord('alice', 'Practitioner', 'pr-shared');
    expect((await provider.history('bob', 'Practitioner', 'pr-shared')).versions).toBe(1);
    await provider.writer('alice', 'source-1').upsert(practitioner('Smith'));
    await provider.removeBySource('alice', 'source-1');
    expect((await provider.history('bob', 'Practitioner', 'pr-shared')).versions).toBe(1);
    await provider.writer('alice', 'source-1').upsert(practitioner('Smith'));
    await provider.removeAll('alice');
    expect((await provider.history('bob', 'Practitioner', 'pr-shared')).versions).toBe(1);
    expect((await provider.history('alice', 'Practitioner', 'pr-shared')).versions).toBe(0);
  });
});

describe('HISTORY_PER_PERSON_MIGRATION re-keys a database made before #812', () => {
  it('gives each row to its sole holder, keeps rows of shared ids unassigned, and is idempotent', () => {
    const db = new Database(join(dir, 'old.db'));
    db.exec(`
      CREATE TABLE resources (resource_type TEXT, id TEXT, user_id TEXT, PRIMARY KEY (resource_type, id, user_id));
      CREATE TABLE resource_history (resource_type TEXT NOT NULL, id TEXT NOT NULL, version_id TEXT NOT NULL, last_updated TEXT NOT NULL, content TEXT NOT NULL, PRIMARY KEY (resource_type, id, version_id));
      INSERT INTO resources VALUES ('Observation', 'mine', 'alice'), ('Practitioner', 'shared', 'alice'), ('Practitioner', 'shared', 'bob');
      INSERT INTO resource_history VALUES ('Observation', 'mine', 'v1', 't1', '{}'), ('Observation', 'mine', 'v2', 't2', '{}'),
        ('Practitioner', 'shared', 'v1', 't1', '{}'), ('Observation', 'gone', 'v1', 't1', '{}');
    `);
    const report = runMigrations(db, [HISTORY_PER_PERSON_MIGRATION], RECORDS_LEDGER_TABLE);
    expect(report.applied).toEqual(['20260930150000']);
    const rows = db.prepare('SELECT resource_type || \'/\' || id || \'@\' || user_id AS k, COUNT(*) AS n FROM resource_history GROUP BY 1 ORDER BY 1').all();
    expect(rows).toEqual([
      { k: 'Observation/gone@', n: 1 }, // no holder left: unassigned, never guessed
      { k: 'Observation/mine@alice', n: 2 },
      { k: 'Practitioner/shared@', n: 1 }, // two holders: cannot be told apart
    ]);
    // Already in the new shape: the step is a no-op, so a fresh file (created new-shape) is safe.
    HISTORY_PER_PERSON_MIGRATION.up(db);
    expect((db.prepare('SELECT COUNT(*) AS n FROM resource_history').get() as { n: number }).n).toBe(4);
    db.close();
  });
});

describe('the records.db migration ledger (yourphr#784)', () => {
  const baseline = { id: '20260927120000', description: 'records baseline', up: () => undefined };

  it('is written on first start, skipped on the next, and leaves the records exactly as they were', async () => {
    await provider.close();
    const ledgered = new SqliteRecordsProvider(join(dir, 'records.db'), 'unit-key', [baseline]);
    await ledgered.initialize();
    expect(ledgered.migrations).toEqual({ applied: ['20260927120000'], skipped: 0 });
    expect((await ledgered.list('alice')).map((r) => r.id)).toEqual(['o1', 'o2', 'o3', 'o4']);
    await ledgered.close();
    const again = new SqliteRecordsProvider(join(dir, 'records.db'), 'unit-key', [baseline]);
    await again.initialize();
    expect(again.migrations).toEqual({ applied: [], skipped: 1 });
    await again.close();
    provider = new SqliteRecordsProvider(join(dir, 'records.db'), 'unit-key');
  });

  it('refuses a records database written by a newer build', async () => {
    await provider.close();
    const newer = new SqliteRecordsProvider(join(dir, 'records.db'), 'unit-key', [baseline, { id: '20991231000000', description: 'from the future', up: () => undefined }]);
    await newer.initialize();
    await newer.close();
    const older = new SqliteRecordsProvider(join(dir, 'records.db'), 'unit-key', [baseline]);
    await expect(older.initialize()).rejects.toThrow(/newer than this build.*20991231000000/);
    provider = new SqliteRecordsProvider(join(dir, 'records.db'), 'unit-key');
  });

  it('with no ledger (the contract harnesses) it never touches the ledger, even on a ledgered file', async () => {
    await provider.close();
    const ledgered = new SqliteRecordsProvider(join(dir, 'records.db'), 'unit-key', [baseline, { id: '20991231000000', description: 'from the future', up: () => undefined }]);
    await ledgered.initialize();
    await ledgered.close();
    const bare = new SqliteRecordsProvider(join(dir, 'records.db'), 'unit-key');
    await bare.initialize();
    expect(bare.migrations).toBeUndefined();
    await bare.close();
    provider = new SqliteRecordsProvider(join(dir, 'records.db'), 'unit-key');
  });
});

describe('backup and restore keep the two ledgers apart (yourphr#784)', () => {
  it('a backup holds both databases\' ledgers, and a restore returns each to its own file', async () => {
    await provider.close();
    const baseline = { id: '20260927120000', description: 'records baseline', up: () => undefined };
    const records = new SqliteRecordsProvider(join(dir, 'records.db'), 'unit-key', [baseline]);
    await records.initialize();
    await records.close();
    const app = new Database(join(dir, 'spike.db'));
    app.pragma("cipher='sqlcipher'");
    app.pragma("key='unit-key'");
    runMigrations(app, [{ id: '20260820200000', description: 'app baseline', up: () => undefined }]);

    const repo = new SqliteFhirRepository({ file: join(dir, 'records.db'), key: 'unit-key', userId: 'alice' });
    const taken = backupDatabase(repo, { destination: join(dir, 'backups'), backupKey: 'backup-key', alsoExport: [{ file: join(dir, 'spike.db'), key: 'unit-key' }] });
    repo.db.close();
    app.close();

    stageInstanceRestore(taken.file, 'backup-key', dir, 'unit-key');
    const open = (name: string): InstanceType<typeof Database> => {
      const db = new Database(join(dir, name));
      db.pragma("cipher='sqlcipher'");
      db.pragma("key='unit-key'");
      return db;
    };
    const tables = (db: InstanceType<typeof Database>): string[] => (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%migrations'").all() as { name: string }[]).map((r) => r.name);
    const stagedRecords = open(STAGED_RECORDS);
    const stagedApp = open(STAGED_APP);
    expect(tables(stagedRecords)).toEqual([RECORDS_LEDGER_TABLE]);
    expect(tables(stagedApp)).toEqual(['schema_migrations']);
    expect((stagedRecords.prepare(`SELECT id FROM ${RECORDS_LEDGER_TABLE}`).all() as { id: string }[]).map((r) => r.id)).toEqual(['20260927120000']);
    expect((stagedApp.prepare('SELECT id FROM schema_migrations').all() as { id: string }[]).map((r) => r.id)).toEqual(['20260820200000']);
    stagedRecords.close();
    stagedApp.close();
    provider = new SqliteRecordsProvider(join(dir, 'records.db'), 'unit-key');
  });
});

describe('a backup runs off the request thread (yourphr#787)', () => {
  const openApp = (): InstanceType<typeof Database> => {
    // Opened by the real provider, not set to WAL by hand: that hid yourphr#867, where the app
    // database was never in WAL at all.
    const app = new SqliteDatabaseProvider(join(dir, 'spike.db'), 'unit-key', []).handle;
    app.exec("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY); INSERT OR IGNORE INTO users VALUES ('alice')");
    return app;
  };

  it('leaves the event loop free while it exports', async () => {
    openApp().close();
    // Queued before the call: a synchronous export would finish, and its promise settle, before this runs.
    let loopRan = false;
    setImmediate(() => { loopRan = true; });
    const taken = await provider.backup({ destination: join(dir, 'backups'), key: 'backup-key', alsoExport: [{ file: join(dir, 'spike.db'), key: 'unit-key' }] });
    expect(loopRan).toBe(true);
    expect(taken.sizeBytes).toBeGreaterThan(0);
  });

  it('writes both databases into one file that restores, while the server keeps its own connections open', async () => {
    const app = openApp();
    const taken = await provider.backup({ destination: join(dir, 'backups'), key: 'backup-key', alsoExport: [{ file: join(dir, 'spike.db'), key: 'unit-key' }] });
    app.close();
    stageInstanceRestore(taken.file, 'backup-key', dir, 'unit-key');
    const open = (name: string): InstanceType<typeof Database> => {
      const db = new Database(join(dir, name));
      db.pragma("cipher='sqlcipher'");
      db.pragma("key='unit-key'");
      return db;
    };
    const records = open(STAGED_RECORDS);
    const staged = open(STAGED_APP);
    expect((records.prepare('SELECT COUNT(*) AS n FROM resources').get() as { n: number }).n).toBe(5);
    expect((staged.prepare('SELECT id FROM users').all() as { id: string }[]).map((r) => r.id)).toEqual(['alice']);
    records.close();
    staged.close();
  });

  it('takes two requested together one after the other, into two files', async () => {
    openApp().close();
    const now = new Date('2026-09-28T02:00:00Z');
    const opts = { destination: join(dir, 'backups'), key: 'backup-key', now, alsoExport: [{ file: join(dir, 'spike.db'), key: 'unit-key' }] };
    const [a, b] = await Promise.all([provider.backup(opts), provider.backup(opts)]);
    expect(a.file).not.toBe(b.file);
  });

  it('reports a failure instead of hanging', async () => {
    await expect(provider.backup({ destination: join(dir, 'backups'), key: '   ' })).rejects.toThrow(/backup key is required/);
  });
});

describe('phd-samples.db, the third database, travels in backups (yourphr#805)', () => {
  const open = (file: string): InstanceType<typeof Database> => {
    const db = new Database(file);
    db.pragma("cipher='sqlcipher'");
    db.pragma("key='unit-key'");
    return db;
  };
  const names = (db: InstanceType<typeof Database>): string[] => (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((r) => r.name);

  it('backs up and restores all three, each table returned to its own file', async () => {
    await provider.close();
    const app = open(join(dir, 'spike.db'));
    app.exec("CREATE TABLE users (name TEXT); INSERT INTO users VALUES ('alice');");
    app.close();
    const phd = open(join(dir, 'phd-samples.db'));
    phd.exec("CREATE TABLE phd_samples (metric TEXT, value REAL, at TEXT); INSERT INTO phd_samples VALUES ('heart-rate', 61, '2026-09-30T07:15:00-04:00'); CREATE TABLE phd_schema_migrations (id TEXT);");
    phd.close();

    const repo = new SqliteFhirRepository({ file: join(dir, 'records.db'), key: 'unit-key', userId: 'alice' });
    const taken = backupDatabase(repo, {
      destination: join(dir, 'backups'), backupKey: 'backup-key',
      alsoExport: [{ file: join(dir, 'spike.db'), key: 'unit-key' }, { file: join(dir, 'phd-samples.db'), key: 'unit-key', optional: true }],
    });
    repo.db.close();

    expect(stageInstanceRestore(taken.file, 'backup-key', dir, 'unit-key').phdSamples).toBe(true);
    const stagedPhd = open(join(dir, STAGED_PHD_SAMPLES));
    const stagedApp = open(join(dir, STAGED_APP));
    expect(names(stagedPhd)).toEqual(['phd_samples', 'phd_schema_migrations']);
    expect(stagedPhd.prepare('SELECT value FROM phd_samples').get()).toEqual({ value: 61 });
    expect(names(stagedApp)).toEqual(['users']); // no phd_ table leaks into the app database
    stagedPhd.close(); stagedApp.close();
    provider = new SqliteRecordsProvider(join(dir, 'records.db'), 'unit-key');
  });

  it('an instance without phd-samples.db backs up as before, and restoring that backup leaves a live phd-samples.db alone', async () => {
    await provider.close();
    const repo = new SqliteFhirRepository({ file: join(dir, 'records.db'), key: 'unit-key', userId: 'alice' });
    const taken = backupDatabase(repo, {
      destination: join(dir, 'backups'), backupKey: 'backup-key',
      alsoExport: [{ file: join(dir, 'absent-phd-samples.db'), key: 'unit-key', optional: true }],
    });
    repo.db.close();
    expect(existsSync(join(dir, 'absent-phd-samples.db'))).toBe(false); // the backup did not create it

    expect(stageInstanceRestore(taken.file, 'backup-key', dir, 'unit-key').phdSamples).toBe(false);
    // Staging an empty file here would wipe every sample at the next start.
    expect(existsSync(join(dir, STAGED_PHD_SAMPLES))).toBe(false);
    provider = new SqliteRecordsProvider(join(dir, 'records.db'), 'unit-key');
  });
});

describe('PGHD_TAG_MIGRATION rewrites patient-reported to pghd on current records (yourphr#806)', () => {
  it('replaces the code and display, keeps every other tag, touches nothing else, and is idempotent', () => {
    const db = new Database(join(dir, 'pghd.db'));
    const O = 'https://yourphr.org/fhir/CodeSystem/record-origin';
    db.exec('CREATE TABLE resources (resource_type TEXT, id TEXT, user_id TEXT, content TEXT)');
    const put = db.prepare('INSERT INTO resources VALUES (?, ?, ?, ?)');
    put.run('Observation', 'typed', 'jim', JSON.stringify({ resourceType: 'Observation', id: 'typed', meta: { tag: [{ system: O, code: 'patient-reported', display: 'Patient-reported (YourPHR)' }, { system: O, code: 'needs-review', display: 'Needs review' }] } }));
    put.run('Observation', 'epic', 'jim', JSON.stringify({ resourceType: 'Observation', id: 'epic', note: [{ text: 'patient-reported pain' }] }));
    runMigrations(db, [PGHD_TAG_MIGRATION], RECORDS_LEDGER_TABLE);
    const read = (id: string) => JSON.parse((db.prepare('SELECT content FROM resources WHERE id = ?').get(id) as { content: string }).content);
    expect(read('typed').meta.tag).toEqual([
      { system: O, code: 'pghd', display: 'Patient-generated health data (PGHD)' },
      { system: O, code: 'needs-review', display: 'Needs review' },
    ]);
    expect(read('epic')).toEqual({ resourceType: 'Observation', id: 'epic', note: [{ text: 'patient-reported pain' }] }); // the words, not a tag
    PGHD_TAG_MIGRATION.up(db);
    expect(read('typed').meta.tag).toHaveLength(2);
    db.close();
  });
});

describe('search text is keyed by record, so a delete never scans the FTS table (yourphr#905)', () => {
  const note = (id: string, text: string): Resource => ({ resourceType: 'Condition', id, code: { text } } as Resource);
  const db = (): InstanceType<typeof Database> => (provider as unknown as { anyDb(): InstanceType<typeof Database> }).anyDb();
  const n = (sql: string): number => (db().prepare(sql).get() as { n: number }).n;

  it('every text row has a key, and removing a source bigger than one batch takes its records, text and keys', async () => {
    const w = provider.writer('alice', 'source-big');
    for (let i = 0; i < 450; i++) await w.upsert(note(`c${i}`, `zebrafinch condition ${i}`));
    expect(n('SELECT count(*) n FROM search_text')).toBe(n('SELECT count(*) n FROM text_rowids'));
    expect((await provider.textSearch('alice', 'zebrafinch', { limit: 5, offset: 0 })).length).toBe(5);

    expect(await provider.removeBySource('alice', 'source-big')).toBe(450);
    expect(await provider.textSearch('alice', 'zebrafinch', { limit: 5, offset: 0 })).toEqual([]);
    expect(n("SELECT count(*) n FROM text_rowids WHERE resource_type = 'Condition'")).toBe(0);
    expect(n('SELECT count(*) n FROM search_text')).toBe(n('SELECT count(*) n FROM text_rowids'));
    // Nobody else's records went with it.
    expect((await provider.textSearch('bob', '718', { limit: 5, offset: 0 })).map((h) => h.id)).toEqual(['o9']);
  });

  it('TEXT_ROWIDS_MIGRATION keys an older store, keeps the newest text row per record, and drops older duplicates', () => {
    const d = db();
    d.exec('DELETE FROM text_rowids');
    d.prepare('INSERT INTO search_text (resource_type, resource_id, user_id, body) VALUES (?, ?, ?, ?)').run('Observation', 'o1', 'alice', 'newest text for o1');
    const distinct = n('SELECT count(*) n FROM (SELECT DISTINCT resource_type, resource_id, user_id FROM search_text)');
    TEXT_ROWIDS_MIGRATION.up(d);
    expect(n('SELECT count(*) n FROM text_rowids')).toBe(distinct);
    expect(n('SELECT count(*) n FROM search_text')).toBe(distinct);
    const kept = d.prepare("SELECT t.body FROM search_text t JOIN text_rowids k ON k.text_rowid = t.rowid WHERE k.resource_id = 'o1' AND k.user_id = 'alice'").get() as { body: string };
    expect(kept.body).toBe('newest text for o1');
  });

  it('a backup and restore keep each text row\'s rowid, so the keys still point at the right rows', async () => {
    await provider.removeRecord('alice', 'Observation', 'o2'); // a gap in the rowids, as a real store has
    await provider.close();
    const repo = new SqliteFhirRepository({ file: join(dir, 'records.db'), key: 'unit-key', userId: 'alice' });
    const taken = backupDatabase(repo, { destination: join(dir, 'backups'), backupKey: 'backup-key' });
    repo.db.close();
    stageInstanceRestore(taken.file, 'backup-key', dir, 'unit-key');
    const staged = new Database(join(dir, STAGED_RECORDS));
    staged.pragma("cipher='sqlcipher'");
    staged.pragma("key='unit-key'");
    const keys = staged.prepare('SELECT k.resource_id, t.resource_id AS text_id FROM text_rowids k LEFT JOIN search_text t ON t.rowid = k.text_rowid').all() as { resource_id: string; text_id: string | null }[];
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) => k.text_id === k.resource_id)).toBe(true);
    staged.close();
    provider = new SqliteRecordsProvider(join(dir, 'records.db'), 'unit-key');
  });
});

describe('per-person reads go through an index, never a scan of record content (yourphr#908)', () => {
  const plan = (sql: string, ...args: unknown[]): string =>
    ((provider as unknown as { anyDb(): InstanceType<typeof Database> }).anyDb().prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args) as { detail: string }[]).map((r) => r.detail).join(' | ');

  it('the dashboard summary, a source\'s counts, recent items and a record by id each search an index', () => {
    expect(plan('SELECT resource_type, COUNT(*) AS count FROM resources WHERE user_id = ? AND deleted = 0 GROUP BY resource_type ORDER BY resource_type', 'alice')).toMatch(/COVERING INDEX idx_resources_user_type/);
    expect(plan('SELECT resource_type, COUNT(*) AS count FROM resources WHERE user_id = ? AND source_id = ? AND deleted = 0 GROUP BY resource_type ORDER BY resource_type', 'alice', 'source-1')).toMatch(/INDEX idx_resources_user_source/);
    expect(plan('SELECT content FROM resources WHERE user_id = ? AND deleted = 0 ORDER BY last_updated DESC, id LIMIT 5', 'alice')).toMatch(/INDEX idx_resources_user_updated/);
    expect(plan('SELECT content FROM resources WHERE id = ? AND user_id = ? AND deleted = 0', 'o1', 'alice')).toMatch(/INDEX idx_resources_user_id/);
  });

  it('RESOURCE_READ_INDEXES_MIGRATION creates them on a store made before #908, and is idempotent', () => {
    const db = (provider as unknown as { anyDb(): InstanceType<typeof Database> }).anyDb();
    for (const ix of ['idx_resources_user_type', 'idx_resources_user_source', 'idx_resources_user_updated', 'idx_resources_user_id']) db.exec(`DROP INDEX ${ix}`);
    RESOURCE_READ_INDEXES_MIGRATION.up(db);
    RESOURCE_READ_INDEXES_MIGRATION.up(db);
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'resources' AND name LIKE 'idx_resources_%'").all() as { name: string }[]).map((r) => r.name).sort();
    expect(names).toEqual(['idx_resources_user_id', 'idx_resources_user_source', 'idx_resources_user_type', 'idx_resources_user_updated']);
  });
});
