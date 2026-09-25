/**
 * Encrypted database backup — the TypeScript-first build that retires yourphr#461 without touching
 * the frozen Go stack. The Go product refuses backup while at-rest encryption is on (#367), because
 * its VACUUM INTO would write a PLAINTEXT snapshot of an encrypted database; #545 made that refusal
 * loud. This module is the lift: the backup itself is ciphertext, so the exclusion has nothing left
 * to protect.
 *
 * The design point the strategy doc called out: the DATABASE PROVIDER owns the connection and is
 * the only component holding the key, so it is the only component that can export correctly. The
 * mechanism: ATTACH an empty database under the BACKUP key and copy schema + rows into it inside
 * one transaction, then DETACH. (SQLCipher's sqlcipher_export() is exactly this loop; the
 * SQLite3MultipleCiphers build this repo uses does not ship that convenience function, so the loop
 * is written out — same pages, same guarantee.) The copy is transactional (consistent against live
 * writes) and encrypted from its first byte — there is no plaintext intermediate on disk at any
 * moment.
 *
 * Decisions, with reasons:
 *   - A backup key is REQUIRED, always — even for a plaintext source database. A backup is the file
 *     that leaves the machine (NAS, cloud, a USB stick in a drawer), which makes it the copy most
 *     likely to be lost; "the database is plaintext so the backup may as well be" gets the risk
 *     exactly backwards.
 *   - The backup key is its own secret (backup.encryption.key), not the database key: the file that
 *     travels and the file that stays should not fall to the same compromise. Same key is allowed,
 *     just never assumed.
 *   - No gzip, deliberately (the Go filename convention carries .gz): ciphertext does not compress,
 *     and a backup that DID compress would be evidence of plaintext where none belongs. Size parity
 *     with the database is the expected, checkable shape.
 *   - Restore STAGES: the backup is opened under its key, integrity-checked, exported to a fresh
 *     file under the TARGET key, and the caller swaps files. Never on top of a live database.
 */
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';
import type { SqliteFhirRepository } from '../../SqliteFhirRepository.js';

const SUFFIX = '-yourphr-spike-backup.db';
/** What one of our artifacts is called — the backup-storage provider lists by it. */
export const BACKUP_SUFFIX = SUFFIX;
/** Tables that live in records.db; everything else in a backup belongs to the app database. */
export const RECORDS_TABLES = new Set(['resources', 'resource_history', 'search_index', 'search_text']);
/** The staged halves a restore writes next to the live files; applied at the next start. */
export const STAGED_RECORDS = 'records.db.staged';
export const STAGED_APP = 'spike.db.staged';

/**
 * Copies every table, index, trigger and view from the main database into the attached schema,
 * inside one transaction — a consistent snapshot even against concurrent writers, because SQLite
 * gives the transaction a stable read view. This is sqlcipher_export()'s documented behavior,
 * spelled out.
 */
function exportInto(db: InstanceType<typeof Database>, schema: string, only?: (table: string) => boolean): void {
  const allObjects = (db
    .prepare(
      "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'trigger' THEN 2 ELSE 3 END"
    )
    .all() as { type: string; name: string; tbl_name: string; sql: string }[]);
  // A virtual table (FTS5, yourphr#599) owns shadow tables named <table>_data, _idx, _content,
  // _docsize, _config: recreating the virtual table recreates them, and recreating them by hand is
  // refused ("object name reserved"). Their rows come back through the INSERT into the virtual
  // table — so they are skipped whether or not the virtual table itself is in this half.
  const virtual = allObjects.filter((o) => /^CREATE VIRTUAL TABLE/i.test(o.sql)).map((o) => o.name);
  const shadow = (name: string): boolean => virtual.some((v) => name.startsWith(`${v}_`));
  const objects = allObjects.filter((o) => !only || only(o.tbl_name));

  db.exec('BEGIN');
  try {
    for (const object of objects) {
      if (shadow(object.name)) continue;
      // Re-point the DDL at the attached schema. CREATE TABLE x -> CREATE TABLE "schema".x is the
      // one rewrite sqlcipher_export performs; sqlite_master SQL never carries a schema prefix.
      const ddl = object.sql.replace(
        /^(CREATE (?:TABLE|INDEX|UNIQUE INDEX|TRIGGER|VIEW|VIRTUAL TABLE))\s+(?:IF NOT EXISTS\s+)?("[^"]+"|\[[^\]]+\]|\S+)/i,
        (_m, head: string, name: string) => `${head} ${schema}.${name}`
      );
      db.exec(ddl);
      if (object.type === 'table') {
        db.exec(`INSERT INTO ${schema}."${object.name}" SELECT * FROM main."${object.name}"`);
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** SQLCipher key pragma escaping, matching SqliteFhirRepository. */
function quoteKey(key: string): string {
  return `'${key.replace(/'/g, "''")}'`;
}

export function backupFileName(now: Date): string {
  return now.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-') + SUFFIX;
}

export interface BackupResult {
  file: string;
  sizeBytes: number;
  pruned: string[];
}

/**
 * Writes an encrypted, consistent backup of the repository's live database into `destination`,
 * then prunes beyond `maxBackups` (oldest first; the date-first names sort chronologically).
 */
export function backupDatabase(
  repo: SqliteFhirRepository,
  options: {
    destination: string;
    backupKey: string;
    maxBackups?: number;
    now?: Date;
    /**
     * Other databases that belong in the same backup (yourphr#602): the app database with the
     * accounts, sources, tokens and catalog. A backup of the records alone is not a backup of
     * the instance. Table names must not collide — they do not, by construction.
     */
    alsoExport?: InstanceType<typeof Database>[];
  }
): BackupResult {
  const backupKey = options.backupKey.trim();
  if (backupKey === '') {
    throw new Error('a backup key is required — backups are always encrypted (see backup.encryption.key)');
  }
  mkdirSync(options.destination, { recursive: true });
  // Second-precision names collide when two backups are taken back to back (a backup, then the
  // restore that backs up first); the second gets a suffix rather than an ATTACH onto the first.
  const stem = backupFileName(options.now ?? new Date()).slice(0, -SUFFIX.length);
  let file = join(options.destination, stem + SUFFIX);
  for (let n = 2; existsSync(file); n++) file = join(options.destination, `${stem}-${n}${SUFFIX}`);

  // ATTACH cannot bind the KEY clause, so the key is escaped inline exactly as the repository
  // escapes its own key pragma. The filename IS bindable and stays bound.
  // One snapshot across stores (yourphr#608): the records file and the app database are exported
  // one after the other, and nothing can write between them ONLY because this loop is synchronous
  // (better-sqlite3) and nothing else writes these files — no worker thread, no second process. Keep
  // it that way: an `await` in here, or an async driver, lets a sync land between the two exports
  // and the backup restores records from one moment and settings or audit from another.
  for (const db of [repo.db, ...(options.alsoExport ?? [])]) {
    db.prepare(`ATTACH DATABASE ? AS backup KEY ${quoteKey(backupKey)}`).run(file);
    try {
      exportInto(db, 'backup');
    } finally {
      db.prepare('DETACH DATABASE backup').run();
    }
  }

  const pruned: string[] = [];
  const max = options.maxBackups ?? 0;
  if (max > 0) {
    const backups = listBackups(options.destination);
    for (const old of backups.slice(max)) {
      unlinkSync(join(options.destination, old.name));
      pruned.push(old.name);
    }
  }
  return { file, sizeBytes: statSync(file).size, pruned };
}

/** Backups in `dir`, newest first (the date-first names make name order time order). */
export function listBackups(dir: string): { name: string; sizeBytes: number; modified: string }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(SUFFIX))
    .sort()
    .reverse()
    .map((name) => {
      const st = statSync(join(dir, name));
      return { name, sizeBytes: st.size, modified: st.mtime.toISOString() };
    });
}

export function isBackupFileName(name: string): boolean {
  return name.endsWith(SUFFIX) && !name.includes('/') && !name.includes('\\') && !name.includes('..');
}

export interface RestoreResult {
  stagedFile: string;
  tables: number;
}

/**
 * Stages a restore: opens the backup under its key, integrity-checks it, and exports it to
 * `stagedFile` under `targetKey` (empty = plaintext target, for an unencrypted deployment).
 * The caller swaps the staged file into place — never on top of a live database.
 */
export function stageRestore(
  backupFile: string,
  backupKey: string,
  stagedFile: string,
  targetKey: string,
  /** Which tables belong in this staged file — a backup holds two databases' worth (see backupDatabase). */
  only?: (table: string) => boolean
): RestoreResult {
  const db = new Database(backupFile, { readonly: false });
  try {
    db.pragma("cipher='sqlcipher'");
    db.pragma(`key=${quoteKey(backupKey)}`);
    let integrity: string;
    try {
      integrity = (db.pragma('integrity_check') as { integrity_check: string }[])[0]?.integrity_check ?? 'failed';
    } catch (err) {
      throw new Error(`backup cannot be read — wrong key, or not a backup: ${(err as Error).message}`);
    }
    if (integrity !== 'ok') {
      throw new Error(`backup failed its integrity check: ${integrity}`);
    }
    db.prepare(`ATTACH DATABASE ? AS staged KEY ${quoteKey(targetKey)}`).run(stagedFile);
    try {
      exportInto(db, 'staged', only);
    } finally {
      db.prepare('DETACH DATABASE staged').run();
    }
    const tables = (db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get() as { n: number }).n;
    return { stagedFile, tables };
  } finally {
    db.close();
  }
}

/**
 * Stage a whole-instance restore (yourphr#602, #615): both halves of a backup are exported under
 * the live key into <dataDir>/*.staged; the next start swaps them in. Live files are never touched.
 */
export function stageInstanceRestore(backupFile: string, backupKey: string, dataDir: string, targetKey: string): { tables: number } {
  const records = stageRestore(backupFile, backupKey, join(dataDir, STAGED_RECORDS), targetKey, (t) => RECORDS_TABLES.has(t));
  stageRestore(backupFile, backupKey, join(dataDir, STAGED_APP), targetKey, (t) => !RECORDS_TABLES.has(t));
  return { tables: records.tables };
}
