/**
 * PHI storage over SQLCipher (yourphr#609): `SqliteFhirRepository` — the generic FHIR store the
 * spike proved (551 lines against 18,518 generated ones, 29/29 resource types id-for-id) — as the
 * one-active records provider. One file, one key, one handle per account (the per-user isolation
 * seam, yourphr#537). Every raw query over records lives in this file and nowhere else; the
 * store-boundary lint keeps it that way.
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import type { Bundle, Resource } from '@medplum/fhirtypes';
import type { SearchRequest, WithId } from '@medplum/core';
import { SqliteFhirRepository, sameContent } from '../../SqliteFhirRepository.js';
import { dirname } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { backupFiles, readBackupPayloads, stageInstanceRestore, RECORDS_LEDGER_TABLE, type BackupPayload, type BackupResult, type DatabaseFile } from './sqlite-backup.js';
import { ftsQuery } from './record-text.js';
import { runMigrations, type Migration, type MigrationReport } from '../../framework/providers/sqlite-migrations.js';
import { BaseRecordsProvider, type CompactReport, type IndexCondition, type RecordsWriter, type StoredRecord } from './BaseRecordsProvider.js';

const REFERENCE_SHAPE = /^[A-Z][A-Za-z]+\/[A-Za-z0-9.-]{1,64}$/;
const PARAM_NAME = /^[a-z][a-z0-9-]*$/i;
const DATE_PREFIX = /^(eq|ne|gt|ge|lt|le|sa|eb|ap)(\d.*)$/;

/**
 * One person's history for one record, and any legacy rows for it nobody could be given (yourphr#812).
 *
 * The person's own rows are the point. The unassigned rows ('' — an id two people held before
 * history carried the person) go too: they may hold the deleting person's data, and honouring a
 * deletion outweighs keeping another person's pre-#812 history of a shared Practitioner.
 */
const DELETE_HISTORY = "DELETE FROM resource_history WHERE resource_type = ? AND id = ? AND user_id IN (?, '')";

/**
 * records.db ledger entry (yourphr#812): resource_history gains the person, as resources has.
 *
 * A frozen snapshot of intent, like every ledger entry. SQLite cannot change a primary key in place,
 * so the table is rebuilt: each history row goes to the one person who holds that type/id. Where
 * two or more people hold it, the rows cannot be told apart and keep user_id '' — never guessed,
 * never given to both; they stay out of every person's history and are removed when any holder
 * deletes the record. A database already in the new shape (a fresh file) is left alone.
 */
export const HISTORY_PER_PERSON_MIGRATION: Migration = {
  id: '20260930150000',
  description: 'resource_history keyed by person — (resource_type, id, user_id, version_id); rows of ids held by several people keep user_id \'\' (yourphr#812)',
  up: (db) => {
    const columns = db.prepare("SELECT name FROM pragma_table_info('resource_history')").all() as { name: string }[];
    if (columns.some((c) => c.name === 'user_id')) return;
    db.exec(`
      CREATE TEMP TABLE sole_holder AS
        SELECT resource_type, id, MIN(user_id) AS user_id FROM resources
        GROUP BY resource_type, id HAVING COUNT(DISTINCT user_id) = 1;
      CREATE UNIQUE INDEX temp.sole_holder_key ON sole_holder (resource_type, id);
      CREATE TABLE resource_history_812 (
        resource_type TEXT NOT NULL,
        id            TEXT NOT NULL,
        user_id       TEXT NOT NULL DEFAULT '',
        version_id    TEXT NOT NULL,
        last_updated  TEXT NOT NULL,
        content       TEXT NOT NULL,
        PRIMARY KEY (resource_type, id, user_id, version_id)
      );
      INSERT INTO resource_history_812 (resource_type, id, user_id, version_id, last_updated, content)
        SELECT h.resource_type, h.id, COALESCE(s.user_id, ''), h.version_id, h.last_updated, h.content
        FROM resource_history h LEFT JOIN sole_holder s ON s.resource_type = h.resource_type AND s.id = h.id;
      DROP TABLE resource_history;
      ALTER TABLE resource_history_812 RENAME TO resource_history;
      DROP TABLE temp.sole_holder;
    `);
  },
};

export class SqliteRecordsProvider extends BaseRecordsProvider {
  private readonly handles = new Map<string, SqliteFhirRepository>();

  /** What the records ledger did at initialize — applied ids, skipped count. Undefined with no ledger. */
  migrations: MigrationReport | undefined;

  /**
   * `ledger` is the records.db migration registry (yourphr#784), run at initialize() through the
   * same runMigrations the app database uses: dated, run once, recorded, transactional, and a
   * database from a newer build is refused. An empty ledger leaves the ledger alone — the contract
   * harnesses open the store without one, and must not trip the newer-build refusal on a real file.
   */
  constructor(private readonly file: string, private readonly key: string | undefined, private readonly ledger: Migration[] = []) {
    super();
  }

  /**
   * For the contract harnesses that open a repository themselves: a provider over the same store,
   * seeded with that handle for its account. Other accounts get their own handle on the file, so
   * the per-user isolation the harnesses test is the real one.
   */
  static overRepository(repo: SqliteFhirRepository): SqliteRecordsProvider {
    const p = new SqliteRecordsProvider(repo.file, repo.key);
    p.handles.set(repo.userId ?? '', repo);
    p.borrowed.add(repo);
    return p;
  }
  /** Handles the caller owns: never closed here. */
  private readonly borrowed = new Set<SqliteFhirRepository>();
  /** The backup running now, if any — the next one waits for it (see backup). */
  private backupInFlight: Promise<unknown> = Promise.resolve();

  async initialize(): Promise<void> {
    // Open once so the schema exists and the file is proven openable under the key at boot,
    // rather than at the first request — and migrate before any account's handle opens.
    const boot = this.handle('__boot__');
    try {
      if (this.ledger.length > 0) this.migrations = runMigrations(boot.db, this.ledger, RECORDS_LEDGER_TABLE);
    } finally {
      boot.db.close();
      this.handles.delete('__boot__');
    }
  }

  async close(): Promise<void> {
    const seen = new Set<SqliteFhirRepository>();
    for (const h of this.handles.values()) {
      if (seen.has(h) || this.borrowed.has(h)) continue;
      seen.add(h);
      h.db.close();
    }
    this.handles.clear();
  }

  /** The per-account handle. Deliberately not public: a handle is the store, and the store is the provider's. */
  private handle(userId: string): SqliteFhirRepository {
    let h = this.handles.get(userId);
    if (!h) {
      h = new SqliteFhirRepository({ file: this.file, userId, key: this.key });
      this.handles.set(userId, h);
    }
    return h;
  }

  private anyDb(): InstanceType<typeof Database> {
    return this.handle('__any__').db;
  }

  private toStored(row: { resource_type: string; id: string; source_id: string; last_updated: string; content: string }): StoredRecord {
    return { resourceType: row.resource_type, id: row.id, sourceId: row.source_id, lastUpdated: row.last_updated, resource: JSON.parse(row.content) as Resource };
  }

  async search<T extends Resource>(userId: string, request: SearchRequest<T>): Promise<Bundle<WithId<T>>> {
    return this.handle(userId).search(request);
  }

  async read(userId: string, resourceType: string, id: string): Promise<StoredRecord | undefined> {
    const row = this.anyDb()
      .prepare('SELECT resource_type, id, source_id, last_updated, content FROM resources WHERE resource_type = ? AND id = ? AND user_id = ? AND deleted = 0')
      .get(resourceType, id, userId) as Parameters<SqliteRecordsProvider['toStored']>[0] | undefined;
    return row ? this.toStored(row) : undefined;
  }

  async readById(userId: string, id: string): Promise<StoredRecord | undefined> {
    const row = this.anyDb()
      .prepare('SELECT resource_type, id, source_id, last_updated, content FROM resources WHERE id = ? AND user_id = ? AND deleted = 0')
      .get(id, userId) as Parameters<SqliteRecordsProvider['toStored']>[0] | undefined;
    return row ? this.toStored(row) : undefined;
  }

  async list(userId: string, filter: { resourceType?: string; sourceId?: string } = {}): Promise<StoredRecord[]> {
    const where = ['user_id = ?', 'deleted = 0'];
    const params: unknown[] = [userId];
    if (filter.resourceType !== undefined) { where.push('resource_type = ?'); params.push(filter.resourceType); }
    if (filter.sourceId !== undefined) { where.push('source_id = ?'); params.push(filter.sourceId); }
    const rows = this.anyDb()
      .prepare(`SELECT resource_type, id, source_id, last_updated, content FROM resources WHERE ${where.join(' AND ')} ORDER BY resource_type, id`)
      .all(...params) as Parameters<SqliteRecordsProvider['toStored']>[0][];
    return rows.map((r) => this.toStored(r));
  }

  async countByType(userId: string, sourceId?: string): Promise<{ resourceType: string; count: number }[]> {
    const rows = sourceId === undefined
      ? this.anyDb().prepare('SELECT resource_type, COUNT(*) AS count FROM resources WHERE user_id = ? AND deleted = 0 GROUP BY resource_type ORDER BY resource_type').all(userId)
      : this.anyDb().prepare('SELECT resource_type, COUNT(*) AS count FROM resources WHERE user_id = ? AND source_id = ? AND deleted = 0 GROUP BY resource_type ORDER BY resource_type').all(userId, sourceId);
    return (rows as { resource_type: string; count: number }[]).map((r) => ({ resourceType: r.resource_type, count: r.count }));
  }

  async typesHeld(userId: string): Promise<string[]> {
    return (this.anyDb().prepare('SELECT DISTINCT resource_type AS t FROM resources WHERE user_id = ? AND deleted = 0 ORDER BY t').all(userId) as { t: string }[]).map((r) => r.t);
  }

  async sourceOf(userId: string, resourceType: string): Promise<Map<string, string>> {
    const rows = this.anyDb().prepare('SELECT id, source_id FROM resources WHERE resource_type = ? AND user_id = ?').all(resourceType, userId) as { id: string; source_id: string }[];
    return new Map(rows.map((r) => [r.id, r.source_id]));
  }

  async history(userId: string, resourceType: string, id: string): Promise<{ firstReceivedAt: string | null; versions: number }> {
    const row = this.anyDb()
      .prepare('SELECT MIN(last_updated) AS first, COUNT(*) AS n FROM resource_history WHERE resource_type = ? AND id = ? AND user_id = ?')
      .get(resourceType, id, userId) as { first: string | null; n: number };
    return { firstReceivedAt: row.first, versions: row.n };
  }

  async indexedSearch(userId: string, resourceType: string, where: IndexCondition[]): Promise<StoredRecord[]> {
    const clauses: string[] = [];
    const values: unknown[] = [];
    for (const cond of where) {
      if (!PARAM_NAME.test(cond.param)) throw new Error(`invalid search parameter: ${cond.param}`);
      const alternatives = cond.alternatives.map((a) => a.trim()).filter(Boolean);
      if (alternatives.length === 0) continue;
      const parts = alternatives.map((v) => {
        const prefixed = v.match(DATE_PREFIX);
        if (prefixed) {
          const op = { eq: '=', ne: '<>', gt: '>', ge: '>=', lt: '<', le: '<=', sa: '>', eb: '<', ap: '=' }[prefixed[1]!]!;
          return { sql: `si.value ${op} ?`, values: [prefixed[2]!] };
        }
        if (v.endsWith('|')) return { sql: "si.value LIKE ? ESCAPE '\\'", values: [`${v.replace(/[\\%_]/g, (c) => `\\${c}`)}%`] };
        return { sql: 'si.value = ?', values: [v] };
      });
      clauses.push(`EXISTS (SELECT 1 FROM search_index si WHERE si.resource_type = r.resource_type AND si.resource_id = r.id AND si.user_id = r.user_id AND si.code = ? AND (${parts.map((p) => p.sql).join(' OR ')}))`);
      values.push(cond.param, ...parts.flatMap((p) => p.values));
    }
    const rows = this.anyDb()
      .prepare(`SELECT r.resource_type, r.id, r.source_id, r.last_updated, r.content FROM resources r WHERE r.resource_type = ? AND r.user_id = ? AND r.deleted = 0${clauses.length ? ' AND ' + clauses.join(' AND ') : ''}`)
      .all(resourceType, userId, ...values) as Parameters<SqliteRecordsProvider['toStored']>[0][];
    return rows.map((r) => this.toStored(r));
  }

  async indexedValues(userId: string, resourceType: string, id: string, param: string): Promise<string[]> {
    if (!PARAM_NAME.test(param)) throw new Error(`invalid search parameter: ${param}`);
    return (this.anyDb()
      .prepare("SELECT value FROM search_index WHERE resource_type = ? AND resource_id = ? AND user_id = ? AND code = ? AND value LIKE '%|%'")
      .all(resourceType, id, userId, param) as { value: string }[]).map((v) => v.value);
  }

  async textSearch(userId: string, q: string, page: { limit: number; offset: number }): Promise<{ resourceType: string; id: string; snippet: string }[]> {
    const match = ftsQuery(q);
    if (match === '') return [];
    const rows = this.anyDb()
      .prepare(`SELECT t.resource_type, t.resource_id, snippet(search_text, 3, '[', ']', '…', 12) AS snippet
                FROM search_text t JOIN resources r ON r.resource_type = t.resource_type AND r.id = t.resource_id AND r.user_id = t.user_id
                WHERE t.user_id = ? AND search_text MATCH ? AND r.deleted = 0
                ORDER BY bm25(search_text) LIMIT ? OFFSET ?`)
      .all(userId, match, page.limit, page.offset) as { resource_type: string; resource_id: string; snippet: string }[];
    return rows.map((r) => ({ resourceType: r.resource_type, id: r.resource_id, snippet: r.snippet }));
  }

  async referencesFrom(userId: string, resourceType: string, id: string): Promise<string[]> {
    // A reference value is "Type/id"; a token is "system|code"; dates and strings carry neither shape.
    return (this.anyDb()
      .prepare("SELECT DISTINCT value FROM search_index WHERE resource_type = ? AND resource_id = ? AND user_id = ? AND value GLOB '[A-Z]*/*' AND value NOT LIKE '%|%' AND value NOT LIKE '% %'")
      .all(resourceType, id, userId) as { value: string }[]).map((v) => v.value).filter((v) => REFERENCE_SHAPE.test(v));
  }

  async referencedBy(userId: string, reference: string): Promise<{ resourceType: string; id: string }[]> {
    return (this.anyDb()
      .prepare('SELECT DISTINCT resource_type, resource_id FROM search_index WHERE user_id = ? AND value = ?')
      .all(userId, reference) as { resource_type: string; resource_id: string }[]).map((r) => ({ resourceType: r.resource_type, id: r.resource_id }));
  }

  writer(userId: string, sourceId: string): RecordsWriter {
    const repo = this.handle(userId);
    return {
      upsert: async (resource) => {
        const existed = await this.read(userId, resource.resourceType, resource.id ?? '');
        // Scoped to this write and restored afterwards: the handle is shared, and leaving a source
        // attributed would silently change what every later write means.
        const previous = repo.sourceId;
        repo.sourceId = sourceId;
        let changed: boolean;
        try {
          ({ changed } = await repo.upsertIfChanged(resource));
        } finally {
          repo.sourceId = previous;
        }
        return !existed ? 'created' : changed ? 'updated' : 'unchanged';
      },
      exists: async (resourceType, id) => (await this.read(userId, resourceType, id)) !== undefined,
    };
  }

  async removeBySource(userId: string, sourceId: string): Promise<number> {
    const db = this.anyDb();
    const remove = db.transaction((): number => {
      const rows = db.prepare('SELECT resource_type, id FROM resources WHERE user_id = ? AND source_id = ?').all(userId, sourceId) as { resource_type: string; id: string }[];
      const delIndex = db.prepare('DELETE FROM search_index WHERE resource_type = ? AND resource_id = ? AND user_id = ?');
      const delText = db.prepare('DELETE FROM search_text WHERE resource_type = ? AND resource_id = ? AND user_id = ?');
      const delHistory = db.prepare(DELETE_HISTORY);
      for (const r of rows) {
        delIndex.run(r.resource_type, r.id, userId);
        delText.run(r.resource_type, r.id, userId);
        delHistory.run(r.resource_type, r.id, userId);
      }
      return db.prepare('DELETE FROM resources WHERE user_id = ? AND source_id = ?').run(userId, sourceId).changes;
    });
    return remove();
  }

  async removeRecord(userId: string, resourceType: string, id: string): Promise<boolean> {
    const db = this.anyDb();
    const remove = db.transaction((): boolean => {
      db.prepare('DELETE FROM search_index WHERE resource_type = ? AND resource_id = ? AND user_id = ?').run(resourceType, id, userId);
      db.prepare('DELETE FROM search_text WHERE resource_type = ? AND resource_id = ? AND user_id = ?').run(resourceType, id, userId);
      db.prepare(DELETE_HISTORY).run(resourceType, id, userId);
      return db.prepare('DELETE FROM resources WHERE user_id = ? AND resource_type = ? AND id = ?').run(userId, resourceType, id).changes > 0;
    });
    return remove();
  }

  async removeAll(userId: string): Promise<number> {
    const db = this.anyDb();
    const remove = db.transaction((): number => {
      const rows = db.prepare('SELECT resource_type, id FROM resources WHERE user_id = ?').all(userId) as { resource_type: string; id: string }[];
      const delHistory = db.prepare(DELETE_HISTORY);
      for (const r of rows) delHistory.run(r.resource_type, r.id, userId);
      db.prepare('DELETE FROM search_index WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM search_text WHERE user_id = ?').run(userId);
      return db.prepare('DELETE FROM resources WHERE user_id = ?').run(userId).changes;
    });
    return remove();
  }

  async release(userId: string): Promise<void> {
    const h = this.handles.get(userId);
    if (h) {
      if (!this.borrowed.has(h)) h.db.close();
      this.handles.delete(userId);
    }
  }

  storage(): { location: string; sizeBytes: number } {
    return { location: this.file, sizeBytes: existsSync(this.file) ? statSync(this.file).size : 0 };
  }

  /**
   * Offline compaction (yourphr#781). Up to v3.7.2 every sync pass wrote a full history copy of
   * every record it received, changed or not, so a live file reached 8.4 GB of identical copies.
   *
   * Within each record's history (ordered by time), a run of identical copies keeps only its FIRST
   * row: "first received" and every real change survive; the repeats go. `sameContent` is the same
   * comparison the write path now uses, so "identical" means one thing everywhere.
   *
   * The current version is almost always the last repeat of a run — the latest re-sync wrote it.
   * Keeping it would leave nearly every record claiming a change it never had ("changed 1 time").
   * So a record whose current version is removed is repointed at the first copy of that content,
   * in the row and in the stored resource's meta.versionId. The resources table is otherwise
   * untouched; its row count is checked before and after and a difference is an error.
   *
   * Synchronous and whole-file: run with the server stopped (the `compact` command says so).
   */
  async compact(options: { dryRun?: boolean; vacuum?: boolean } = {}): Promise<CompactReport> {
    const db = this.anyDb();
    const dryRun = options.dryRun ?? false;
    const bytesBefore = existsSync(this.file) ? statSync(this.file).size : 0;
    const count = (sql: string): number => (db.prepare(sql).get() as { n: number }).n;
    const resources = count('SELECT COUNT(*) AS n FROM resources');
    const historyBefore = count('SELECT COUNT(*) AS n FROM resource_history');
    // History is kept per person (yourphr#812), so each person's copies are compacted on their own.
    // The exception is legacy rows the re-keying migration could not give to one person (an id two
    // people held before history carried the person, user_id ''): they cannot be told apart, so
    // they are left alone entirely, counted and reported.
    const shared = new Set<string>();
    for (const r of db.prepare("SELECT DISTINCT resource_type, id FROM resource_history WHERE user_id = ''").iterate() as Iterable<{ resource_type: string; id: string }>) {
      shared.add(`${r.resource_type}/${r.id}`);
    }
    const current = new Map<string, string>();
    for (const r of db.prepare('SELECT resource_type, id, user_id, version_id FROM resources').iterate() as Iterable<{ resource_type: string; id: string; user_id: string; version_id: string }>) {
      current.set(`${r.user_id}\u0000${r.resource_type}/${r.id}`, r.version_id);
    }

    // Collected first, deleted after: better-sqlite3 cannot write on a connection mid-iteration.
    const doomed: number[] = [];
    const repoint = new Map<string, { from: string; to: string }>();
    let group = '';
    let kept: { versionId: string; resource: Resource } | undefined;
    const rows = db.prepare("SELECT rowid, resource_type, id, user_id, version_id, content FROM resource_history WHERE user_id <> '' ORDER BY resource_type, id, user_id, last_updated, rowid")
      .iterate() as Iterable<{ rowid: number; resource_type: string; id: string; user_id: string; version_id: string; content: string }>;
    for (const row of rows) {
      const key = `${row.user_id}\u0000${row.resource_type}/${row.id}`;
      const resource = JSON.parse(row.content) as Resource;
      if (key !== group) {
        group = key;
        kept = { versionId: row.version_id, resource };
        continue;
      }
      if (kept && sameContent(kept.resource, resource)) {
        doomed.push(row.rowid);
        if (current.get(key) === row.version_id) repoint.set(key, { from: row.version_id, to: kept.versionId });
      } else {
        kept = { versionId: row.version_id, resource };
      }
    }

    if (!dryRun && doomed.length > 0) {
      const remove = db.prepare('DELETE FROM resource_history WHERE rowid = ?');
      const move = db.prepare("UPDATE resources SET version_id = ?, content = json_set(content, '$.meta.versionId', ?) WHERE user_id = ? AND resource_type = ? AND id = ? AND version_id = ?");
      const BATCH = 10_000;
      for (let i = 0; i < doomed.length; i += BATCH) {
        const slice = doomed.slice(i, i + BATCH);
        db.transaction(() => { for (const rowid of slice) remove.run(rowid); })();
      }
      db.transaction(() => {
        for (const [key, { from, to }] of repoint) {
          const nul = key.indexOf('\u0000');
          const slash = key.indexOf('/', nul);
          move.run(to, to, key.slice(0, nul), key.slice(nul + 1, slash), key.slice(slash + 1), from);
        }
      })();
      const after = count('SELECT COUNT(*) AS n FROM resources');
      if (after !== resources) throw new Error(`compact: the resources table changed from ${resources} to ${after} rows — nothing but history may be removed`);
    }

    const vacuum = !dryRun && (options.vacuum ?? true) && doomed.length > 0;
    if (vacuum) {
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.exec('VACUUM');
    }
    const integrity = String((db.pragma('quick_check') as { quick_check: string }[])[0]?.quick_check ?? 'no answer');
    return {
      resources,
      historyBefore,
      duplicates: doomed.length,
      historyAfter: dryRun ? historyBefore : count('SELECT COUNT(*) AS n FROM resource_history'),
      repointed: repoint.size,
      skippedShared: shared.size,
      bytesBefore,
      bytesAfter: existsSync(this.file) ? statSync(this.file).size : 0,
      vacuumed: vacuum,
      integrity,
      dryRun,
    };
  }

  async integrityOk(): Promise<boolean> {
    try {
      return String((this.anyDb().pragma('quick_check') as { quick_check: string }[])[0]?.quick_check ?? '').toLowerCase() === 'ok';
    } catch {
      return false;
    }
  }

  /**
   * On a worker thread (yourphr#787), with its own connection. One at a time: when the export ran on
   * the request thread two could never overlap, and two at once would race for the same file name.
   * `alsoExport` names the other databases by file and key — a handle cannot cross threads.
   */
  async backup(options: { destination: string; key: string; maxBackups?: number; now?: Date; alsoExport?: unknown[]; payloads?: BackupPayload[] }): Promise<{ file: string; sizeBytes: number; pruned: string[] }> {
    const run = (): Promise<BackupResult> => backupFiles(
      [{ file: this.file, key: this.key }, ...((options.alsoExport ?? []) as DatabaseFile[])],
      { destination: options.destination, backupKey: options.key, maxBackups: options.maxBackups, now: options.now, payloads: options.payloads }
    );
    const result = this.backupInFlight.then(run, run);
    this.backupInFlight = result.catch(() => undefined);
    return result;
  }

  async stageRestore(backupFile: string, backupKey: string): Promise<{ tables: number }> {
    return stageInstanceRestore(backupFile, backupKey, dirname(this.file), this.key ?? '');
  }

  /** The managers' payloads carried in a backup (yourphr#631); {} for one taken before they were. */
  async readPayloads(backupFile: string, backupKey: string): Promise<Record<string, BackupPayload>> {
    return readBackupPayloads(backupFile, backupKey);
  }
}
