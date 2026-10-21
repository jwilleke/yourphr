/**
 * The only code in phr that touches phr.db (the store door). PhrManager is
 * the only caller; a test (__tests__/storeDoor.test.ts) refuses SQL anywhere
 * else in phr.
 *
 * The store decides nothing. It hands out a handle bound to one owner, and
 * every statement that handle runs carries `owner = ?` with the owner it was
 * bound to. A caller can't name another owner per call.
 */

import type { DatabaseManager } from '@jwilleke/ngdpbase-types';
import { PHR_LEDGER_TABLE, PHR_MIGRATIONS } from './migrations.js';
import { ftsQuery, indexEntries, textFor, type SearchFilter } from './fhirIndex.js';

/** The driver calls the store uses (better-sqlite3, as core's DatabaseManager hands it). */
export interface Db {
  prepare(sql: string): Statement;
  transaction<T>(fn: () => T): () => T;
}
interface Statement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
}

/** A FHIR resource as phr stores it: the JSON plus where it came from. */
export interface StoredRecord {
  resourceType: string;
  id: string;
  sourceId: string;
  versionId: string;
  lastUpdated: string;
  deleted: boolean;
  resource: Record<string, unknown>;
}

interface Row {
  resource_type: string; id: string; source_id: string; version_id: string;
  last_updated: string; deleted: number; content: string;
}

const toRecord = (r: Row): StoredRecord => ({
  resourceType: r.resource_type, id: r.id, sourceId: r.source_id, versionId: r.version_id,
  lastUpdated: r.last_updated, deleted: r.deleted === 1, resource: JSON.parse(r.content) as Record<string, unknown>
});

export class StoreError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

/** What a write did: a new record, a new version of a changed one, or nothing (same content). */
export type PutOutcome = 'created' | 'updated' | 'unchanged';

/** A file as a source last saw it. */
export interface SourceFile {
  path: string;
  sha256: string;
  status: 'imported' | 'unsupported' | 'unreadable' | 'missing';
  records: number;
  firstSeen: string;
  lastSeen: string;
}

/** The record without its version stamp, so the same content compares equal. */
function withoutMeta(resource: Record<string, unknown>): string {
  const meta = { ...(resource.meta as Record<string, unknown> | undefined) };
  delete meta.versionId;
  delete meta.lastUpdated;
  const rest: Record<string, unknown> = { ...resource };
  if (Object.keys(meta).length) rest.meta = meta; else delete rest.meta;
  return JSON.stringify(rest);
}

/** One person's records. Every method is bound to the owner the handle was made for. */
export interface OwnerHandle {
  readonly owner: string;
  read(resourceType: string, id: string): StoredRecord | undefined;
  list(resourceType: string, limit?: number): StoredRecord[];
  history(resourceType: string, id: string): StoredRecord[];
  put(resource: Record<string, unknown>, sourceId: string): StoredRecord & { outcome: PutOutcome };
  remove(resourceType: string, id: string): boolean;
  /** The files a source holds for this owner, as last seen. */
  sourceFiles(sourceId: string): SourceFile[];
  /** Record that a file was seen in an import, with its fingerprint and result. */
  noteSourceFile(sourceId: string, file: { path: string; sha256: string; status: SourceFile['status']; records: number }): void;
  /** Mark files a source held before but not in this import as missing. Nothing is deleted. */
  markMissing(sourceId: string, seenPaths: readonly string[]): number;
  /** Run several store calls as one transaction. */
  inTransaction<T>(fn: () => T): T;
  /** One kind of this owner's records matching every filter, newest first. */
  search(resourceType: string, filters: readonly SearchFilter[], page?: { count?: number; offset?: number }): { total: number; records: StoredRecord[] };
  /** This owner's records whose words match, any kind, best matches first. */
  findText(query: string, limit?: number): StoredRecord[];
  /** How many records of each kind this owner holds. */
  countsByType(): { resourceType: string; count: number }[];
  /** This owner's most recently stored records, any kind. */
  recent(limit?: number): StoredRecord[];
}

/** One filter as an EXISTS against the generic index, with the owner carried through. */
function filterSql(filter: SearchFilter): { sql: string; values: unknown[] } {
  const exists = (clause: string, values: unknown[]) => ({
    sql: `EXISTS (SELECT 1 FROM phr_search_index si WHERE si.owner = r.owner AND si.resource_type = r.resource_type AND si.resource_id = r.id AND si.code = ? AND ${clause})`,
    values: [filter.code, ...values]
  });
  switch (filter.operator) {
    case 'eq': return exists('si.value = ?', [filter.value]);
    case 'contains': return exists('si.value LIKE ?', [`%${filter.value.toLowerCase()}%`]);
    case 'sw': return exists('si.value LIKE ?', [`${filter.value.toLowerCase()}%`]);
    case 'gt': return exists('si.value > ?', [filter.value]);
    case 'ge': return exists('si.value >= ?', [filter.value]);
    case 'lt': return exists('si.value < ?', [filter.value]);
    case 'le': return exists('si.value <= ?', [filter.value]);
    case 'missing': {
      const missing = filter.value === 'true';
      return {
        sql: `${missing ? 'NOT ' : ''}EXISTS (SELECT 1 FROM phr_search_index si WHERE si.owner = r.owner AND si.resource_type = r.resource_type AND si.resource_id = r.id AND si.code = ?)`,
        values: [filter.code]
      };
    }
    default:
      throw new StoreError(400, `search operator "${String((filter as { operator: unknown }).operator)}" is not supported`);
  }
}

/**
 * Open phr.db through core: the declared database (ngdpbase.addons.phr.database,
 * encrypt "required"), its migrations run under phr's own ledger. Core refuses
 * an undeclared database, and one that needs a key the site doesn't have; the
 * error goes up to register(), and phr being site-critical puts the site in
 * maintenance rather than running without its records.
 */
export function openPhrStore(databases: DatabaseManager | undefined): PhrRecordStore {
  if (!databases) throw new StoreError(500, "ngdpbase's DatabaseManager is not available");
  if (!databases.isEnabled()) {
    throw new StoreError(500, "the site's database is off: set ngdpbase.database.provider to \"sqlite\" and NGDPBASE_DATABASE_KEY, then restart");
  }
  const db = databases.openAddonDatabase<Db>('phr', { migrations: PHR_MIGRATIONS, ledgerTable: PHR_LEDGER_TABLE });
  return new PhrRecordStore(db);
}

export class PhrRecordStore {
  constructor(private readonly db: Db, private readonly now: () => Date = () => new Date()) {}

  /** A handle for one owner. An empty owner is refused: a row nobody owns can't exist. */
  forOwner(owner: string): OwnerHandle {
    if (typeof owner !== 'string' || owner === '') throw new StoreError(500, 'a record handle needs an owner');
    const db = this.db;
    const now = this.now;
    /** Drop a record's index rows and its text row (found by key, never by scanning the FTS table). */
    const forgetIndex = (resourceType: string, id: string): void => {
      db.prepare('DELETE FROM phr_search_index WHERE owner = ? AND resource_type = ? AND resource_id = ?').run(owner, resourceType, id);
      const key = db.prepare('SELECT text_rowid FROM phr_text_rowids WHERE owner = ? AND resource_type = ? AND resource_id = ?')
        .get(owner, resourceType, id) as { text_rowid: number } | undefined;
      if (key) {
        db.prepare('DELETE FROM phr_search_text WHERE rowid = ?').run(key.text_rowid);
        db.prepare('DELETE FROM phr_text_rowids WHERE owner = ? AND resource_type = ? AND resource_id = ?').run(owner, resourceType, id);
      }
    };
    /** Rebuild one record's index from its content. */
    const reindex = (resourceType: string, id: string, resource: Record<string, unknown>): void => {
      forgetIndex(resourceType, id);
      const insert = db.prepare('INSERT OR IGNORE INTO phr_search_index (owner, resource_type, resource_id, code, value) VALUES (?, ?, ?, ?, ?)');
      for (const e of indexEntries(resource)) insert.run(owner, resourceType, id, e.code, e.value);
      const body = textFor(resource);
      if (body !== '') {
        const row = db.prepare('INSERT INTO phr_search_text (owner, resource_type, resource_id, body) VALUES (?, ?, ?, ?)').run(owner, resourceType, id, body);
        db.prepare('INSERT OR REPLACE INTO phr_text_rowids (owner, resource_type, resource_id, text_rowid) VALUES (?, ?, ?, ?)')
          .run(owner, resourceType, id, Number(row.lastInsertRowid));
      }
    };
    return {
      owner,
      read(resourceType, id) {
        const row = db.prepare(
          'SELECT resource_type, id, source_id, version_id, last_updated, deleted, content FROM phr_resources WHERE owner = ? AND resource_type = ? AND id = ? AND deleted = 0'
        ).get(owner, resourceType, id) as Row | undefined;
        return row ? toRecord(row) : undefined;
      },
      list(resourceType, limit = 1000) {
        return (db.prepare(
          'SELECT resource_type, id, source_id, version_id, last_updated, deleted, content FROM phr_resources WHERE owner = ? AND resource_type = ? AND deleted = 0 ORDER BY last_updated DESC LIMIT ?'
        ).all(owner, resourceType, limit) as Row[]).map(toRecord);
      },
      history(resourceType, id) {
        return (db.prepare(
          "SELECT resource_type, id, '' AS source_id, version_id, last_updated, 0 AS deleted, content FROM phr_resource_history WHERE owner = ? AND resource_type = ? AND id = ? ORDER BY CAST(version_id AS INTEGER) DESC"
        ).all(owner, resourceType, id) as Row[]).map(toRecord);
      },
      put(resource, sourceId) {
        const resourceType = resource.resourceType;
        const id = resource.id;
        if (typeof resourceType !== 'string' || resourceType === '') throw new StoreError(400, 'a record needs a resourceType');
        if (typeof id !== 'string' || id === '') throw new StoreError(400, 'a record needs an id');
        return db.transaction(() => {
          const existing = db.prepare('SELECT source_id, version_id, last_updated, deleted, content FROM phr_resources WHERE owner = ? AND resource_type = ? AND id = ?')
            .get(owner, resourceType, id) as { source_id: string; version_id: string; last_updated: string; deleted: number; content: string } | undefined;
          if (existing && existing.source_id !== sourceId) {
            throw new StoreError(409, `${resourceType}/${id} already came from another source`);
          }
          // The same content again (a re-import): no new version, no history row.
          if (existing && existing.deleted === 0 && withoutMeta(JSON.parse(existing.content) as Record<string, unknown>) === withoutMeta(resource)) {
            return {
              resourceType, id, sourceId, versionId: existing.version_id, lastUpdated: existing.last_updated, deleted: false,
              resource: JSON.parse(existing.content) as Record<string, unknown>, outcome: 'unchanged' as const
            };
          }
          const versionId = String(existing ? Number(existing.version_id) + 1 : 1);
          const lastUpdated = now().toISOString();
          const stored = { ...resource, meta: { ...(resource.meta as Record<string, unknown> | undefined), versionId, lastUpdated } };
          const content = JSON.stringify(stored);
          db.prepare(`INSERT INTO phr_resources (owner, resource_type, id, source_id, version_id, last_updated, deleted, content)
                      VALUES (?, ?, ?, ?, ?, ?, 0, ?)
                      ON CONFLICT (owner, resource_type, id) DO UPDATE SET
                        version_id = excluded.version_id, last_updated = excluded.last_updated, deleted = 0, content = excluded.content`)
            .run(owner, resourceType, id, sourceId, versionId, lastUpdated, content);
          db.prepare('INSERT INTO phr_resource_history (owner, resource_type, id, version_id, last_updated, content) VALUES (?, ?, ?, ?, ?, ?)')
            .run(owner, resourceType, id, versionId, lastUpdated, content);
          reindex(resourceType, id, stored);
          return { resourceType, id, sourceId, versionId, lastUpdated, deleted: false, resource: stored, outcome: existing ? 'updated' as const : 'created' as const };
        })();
      },
      remove(resourceType, id) {
        return db.transaction(() => {
          const r = db.prepare('UPDATE phr_resources SET deleted = 1, last_updated = ? WHERE owner = ? AND resource_type = ? AND id = ? AND deleted = 0')
            .run(now().toISOString(), owner, resourceType, id);
          if (r.changes > 0) forgetIndex(resourceType, id);
          return r.changes > 0;
        })();
      },
      sourceFiles(sourceId) {
        return (db.prepare('SELECT path, sha256, status, records, first_seen, last_seen FROM phr_source_files WHERE owner = ? AND source_id = ? ORDER BY path')
          .all(owner, sourceId) as { path: string; sha256: string; status: SourceFile['status']; records: number; first_seen: string; last_seen: string }[])
          .map((r) => ({ path: r.path, sha256: r.sha256, status: r.status, records: r.records, firstSeen: r.first_seen, lastSeen: r.last_seen }));
      },
      noteSourceFile(sourceId, file) {
        const at = now().toISOString();
        db.prepare(`INSERT INTO phr_source_files (owner, source_id, path, sha256, status, records, first_seen, last_seen)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT (owner, source_id, path) DO UPDATE SET
                      sha256 = excluded.sha256, status = excluded.status, records = excluded.records, last_seen = excluded.last_seen`)
          .run(owner, sourceId, file.path, file.sha256, file.status, file.records, at, at);
      },
      markMissing(sourceId, seenPaths) {
        const seen = new Set(seenPaths);
        const gone = (db.prepare("SELECT path FROM phr_source_files WHERE owner = ? AND source_id = ? AND status <> 'missing'")
          .all(owner, sourceId) as { path: string }[]).filter((r) => !seen.has(r.path));
        const mark = db.prepare("UPDATE phr_source_files SET status = 'missing' WHERE owner = ? AND source_id = ? AND path = ?");
        for (const r of gone) mark.run(owner, sourceId, r.path);
        return gone.length;
      },
      inTransaction(fn) {
        return db.transaction(fn)();
      },
      search(resourceType, filters, page = {}) {
        // EVERY query carries the owner, bound by this handle.
        const where = ['r.owner = ?', 'r.resource_type = ?', 'r.deleted = 0'];
        const params: unknown[] = [owner, resourceType];
        for (const f of filters) { const { sql, values } = filterSql(f); where.push(sql); params.push(...values); }
        const clause = where.join(' AND ');
        const total = (db.prepare(`SELECT COUNT(*) AS n FROM phr_resources r WHERE ${clause}`).get(...params) as { n: number }).n;
        const count = Math.min(Math.max(page.count ?? 20, 1), 1000);
        const offset = Math.max(page.offset ?? 0, 0);
        const rows = db.prepare(
          `SELECT r.resource_type, r.id, r.source_id, r.version_id, r.last_updated, r.deleted, r.content FROM phr_resources r WHERE ${clause} ORDER BY r.last_updated DESC, r.id LIMIT ? OFFSET ?`
        ).all(...params, count, offset) as Row[];
        return { total, records: rows.map(toRecord) };
      },
      countsByType() {
        return (db.prepare('SELECT resource_type, COUNT(*) AS n FROM phr_resources WHERE owner = ? AND deleted = 0 GROUP BY resource_type ORDER BY n DESC, resource_type')
          .all(owner) as { resource_type: string; n: number }[]).map((r) => ({ resourceType: r.resource_type, count: r.n }));
      },
      recent(limit = 10) {
        return (db.prepare(
          'SELECT resource_type, id, source_id, version_id, last_updated, deleted, content FROM phr_resources WHERE owner = ? AND deleted = 0 ORDER BY last_updated DESC, id LIMIT ?'
        ).all(owner, Math.min(Math.max(limit, 1), 200)) as Row[]).map(toRecord);
      },
      findText(query, limit = 50) {
        const match = ftsQuery(query);
        if (match === '') return [];
        const rows = db.prepare(
          `SELECT r.resource_type, r.id, r.source_id, r.version_id, r.last_updated, r.deleted, r.content
             FROM phr_search_text t
             JOIN phr_resources r ON r.owner = t.owner AND r.resource_type = t.resource_type AND r.id = t.resource_id
            WHERE phr_search_text MATCH ? AND t.owner = ? AND r.deleted = 0
            ORDER BY bm25(phr_search_text) LIMIT ?`
        ).all(match, owner, Math.min(Math.max(limit, 1), 500)) as Row[];
        return rows.map(toRecord);
      }
    };
  }
}
