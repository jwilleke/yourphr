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

/** The driver calls the store uses (better-sqlite3, as core's DatabaseManager hands it). */
export interface Db {
  prepare(sql: string): Statement;
  transaction<T>(fn: () => T): () => T;
}
interface Statement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): { changes: number };
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

/** One person's records. Every method is bound to the owner the handle was made for. */
export interface OwnerHandle {
  readonly owner: string;
  read(resourceType: string, id: string): StoredRecord | undefined;
  list(resourceType: string, limit?: number): StoredRecord[];
  history(resourceType: string, id: string): StoredRecord[];
  put(resource: Record<string, unknown>, sourceId: string): StoredRecord;
  remove(resourceType: string, id: string): boolean;
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
          const existing = db.prepare('SELECT source_id, version_id FROM phr_resources WHERE owner = ? AND resource_type = ? AND id = ?')
            .get(owner, resourceType, id) as { source_id: string; version_id: string } | undefined;
          if (existing && existing.source_id !== sourceId) {
            throw new StoreError(409, `${resourceType}/${id} already came from another source`);
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
          return { resourceType, id, sourceId, versionId, lastUpdated, deleted: false, resource: stored };
        })();
      },
      remove(resourceType, id) {
        const r = db.prepare('UPDATE phr_resources SET deleted = 1, last_updated = ? WHERE owner = ? AND resource_type = ? AND id = ? AND deleted = 0')
          .run(now().toISOString(), owner, resourceType, id);
        return r.changes > 0;
      }
    };
  }
}
