/**
 * phr.db's schema, as dated migrations for core's DatabaseManager
 * (openAddonDatabase, ngdpbase#1860). Ported from yourPHR's FHIR store
 * (src/SqliteFhirRepository.ts) with one change everywhere: every table is
 * keyed by `owner` first.
 *
 * - `owner` is the user the record is about, by identity @id (`urn:uuid`,
 *   ngdpbase identity model; rows from before are re-keyed at start), and is required:
 *   NOT NULL with no default, and never ''. yourPHR's old store let
 *   `user_id` default to '' (yourphr#812), which left rows nobody owned.
 * - Every primary key and every index starts with `owner`, so one person's
 *   reads never scan another person's rows (yourphr#537, #908, #915).
 * - Tables are prefixed `phr_`, as core requires of an add-on database.
 */
import type { Migration } from '@jwilleke/ngdpbase-types';
import { ownerKey } from './fhirIndex.js';

export const PHR_LEDGER_TABLE = 'phr_migrations';

export const PHR_MIGRATIONS: Migration[] = [
  {
    id: '20261018000000',
    description: 'phr records, history, search index and text index, keyed by owner',
    up(db) {
      db.exec(`
        CREATE TABLE phr_resources (
          owner         TEXT NOT NULL CHECK (owner <> ''),
          resource_type TEXT NOT NULL,
          id            TEXT NOT NULL,
          -- Which source a record came from. Not part of the key: FHIR identity is
          -- (resourceType, id). Recorded so a second source writing the same id is
          -- refused rather than silently overwriting the first.
          source_id     TEXT NOT NULL DEFAULT '',
          version_id    TEXT NOT NULL,
          last_updated  TEXT NOT NULL,
          deleted       INTEGER NOT NULL DEFAULT 0,
          content       TEXT NOT NULL,
          PRIMARY KEY (owner, resource_type, id)
        );
        CREATE INDEX phr_resources_owner_type_updated ON phr_resources (owner, resource_type, deleted, last_updated);
        CREATE INDEX phr_resources_owner_source ON phr_resources (owner, source_id, deleted, resource_type);
        CREATE INDEX phr_resources_owner_updated ON phr_resources (owner, deleted, last_updated);

        CREATE TABLE phr_resource_history (
          owner         TEXT NOT NULL CHECK (owner <> ''),
          resource_type TEXT NOT NULL,
          id            TEXT NOT NULL,
          version_id    TEXT NOT NULL,
          last_updated  TEXT NOT NULL,
          content       TEXT NOT NULL,
          PRIMARY KEY (owner, resource_type, id, version_id)
        );

        CREATE TABLE phr_search_index (
          owner         TEXT NOT NULL CHECK (owner <> ''),
          resource_type TEXT NOT NULL,
          resource_id   TEXT NOT NULL,
          code          TEXT NOT NULL,
          value         TEXT NOT NULL,
          PRIMARY KEY (owner, resource_type, resource_id, code, value)
        );
        CREATE INDEX phr_search_owner_lookup ON phr_search_index (owner, resource_type, code, value);
        CREATE INDEX phr_search_owner_value ON phr_search_index (owner, value);

        -- Words in a record's human-readable text, never its raw JSON (yourphr#599).
        CREATE VIRTUAL TABLE phr_search_text USING fts5(
          owner UNINDEXED, resource_type UNINDEXED, resource_id UNINDEXED, body,
          tokenize = 'porter unicode61'
        );
        -- Which text row holds which record's text, so a record's text is found by
        -- rowid, never by scanning the FTS table (yourphr#905).
        CREATE TABLE phr_text_rowids (
          owner         TEXT NOT NULL CHECK (owner <> ''),
          resource_type TEXT NOT NULL,
          resource_id   TEXT NOT NULL,
          text_rowid    INTEGER NOT NULL,
          PRIMARY KEY (owner, resource_type, resource_id)
        );
      `);
    }
  },
  {
    id: '20261019000000',
    description: 'files imported from a person\'s records folder, by fingerprint',
    up(db) {
      db.exec(`
        -- One row per file a person imported from a source (e.g. their records
        -- folder). Re-importing skips a file whose fingerprint hasn't changed, and
        -- a file missing from a later import is flagged, never deleted (yourphr#939).
        CREATE TABLE phr_source_files (
          owner        TEXT NOT NULL CHECK (owner <> ''),
          source_id    TEXT NOT NULL,
          path         TEXT NOT NULL,
          sha256       TEXT NOT NULL,
          status       TEXT NOT NULL CHECK (status IN ('imported', 'unsupported', 'unreadable', 'missing')),
          records      INTEGER NOT NULL DEFAULT 0,
          first_seen   TEXT NOT NULL,
          last_seen    TEXT NOT NULL,
          PRIMARY KEY (owner, source_id, path)
        );
      `);
    }
  },
  {
    id: '20261022000000',
    description: 'text index matches one person\'s rows only: an indexed owner key (yourphr#912)',
    up(db) {
      // The words table matched every person's rows and filtered by owner after
      // (owner UNINDEXED). An indexed owner_key column lets a search match only
      // the searcher's rows. Rows keep their rowids, so phr_text_rowids holds.
      const rows = db.prepare('SELECT rowid AS rowid, owner, resource_type, resource_id, body FROM phr_search_text').all() as
        { rowid: number; owner: string; resource_type: string; resource_id: string; body: string }[];
      db.exec(`
        DROP TABLE phr_search_text;
        CREATE VIRTUAL TABLE phr_search_text USING fts5(
          owner UNINDEXED, owner_key, resource_type UNINDEXED, resource_id UNINDEXED, body,
          tokenize = 'porter unicode61'
        );
      `);
      const insert = db.prepare('INSERT INTO phr_search_text (rowid, owner, owner_key, resource_type, resource_id, body) VALUES (?, ?, ?, ?, ?, ?)');
      for (const r of rows) insert.run(r.rowid, r.owner, ownerKey(r.owner), r.resource_type, r.resource_id, r.body);
    }
  },
  {
    id: '20261023000000',
    description: 'imported files are tracked by ngdpbase\'s import engine, not phr (yourphr#958)',
    up(db) {
      // The engine (ngdpbase#1979) fingerprints files and keeps their status in
      // its own ledger. The first import through it reads a file once more; the
      // store makes no new version of a record whose content hasn't changed.
      db.exec('DROP TABLE IF EXISTS phr_source_files;');
    }
  }
];
