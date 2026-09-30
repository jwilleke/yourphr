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
import { Worker } from 'node:worker_threads';
import Database from 'better-sqlite3-multiple-ciphers';
import type { SqliteFhirRepository } from '../../SqliteFhirRepository.js';

const SUFFIX = '-yourphr-backup.db';
/** What one of our artifacts is called — the backup-storage provider lists by it. */
export const BACKUP_SUFFIX = SUFFIX;
/**
 * Every name a backup has been written under, newest first (yourphr#790). Listing, pruning and
 * restore match all of them, so backups written before the rename are still counted, pruned and
 * restorable. The names begin with the timestamp, so a mixed list still sorts in time order.
 */
export const BACKUP_SUFFIXES = [SUFFIX, '-yourphr-spike-backup.db'] as const;
const isOurs = (name: string): boolean => BACKUP_SUFFIXES.some((s) => name.endsWith(s));
/**
 * Which database a backed-up table returns to. A backup holds every database's tables in one file,
 * so each name belongs to exactly one: records.db's are listed, phd-samples.db's carry the `phd_`
 * prefix, and everything else belongs to the app database.
 */
/** records.db's migration ledger (yourphr#784) — its own name, so a restore can return it to records.db. */
export const RECORDS_LEDGER_TABLE = 'records_schema_migrations';
export const RECORDS_TABLES = new Set(['resources', 'resource_history', 'search_index', 'search_text', RECORDS_LEDGER_TABLE]);
/**
 * phd-samples.db (yourphr#805, #314): raw connected-device samples, PHD = Personal Health Device.
 * Every table in it — its migration ledger included (`phd_schema_migrations`) — is named with this
 * prefix, which is the whole contract: it is how a restore sends them back to that file and
 * nowhere else. A table without it would be restored into the app database.
 */
export const PHD_TABLE_PREFIX = 'phd_';
export const isPhdTable = (table: string): boolean => table.startsWith(PHD_TABLE_PREFIX);
/**
 * Managers' own backup payloads (yourphr#631) — today the configuration's overrides, ngdpbase's
 * ConfigurationManager.backup(). One row per manager, JSON, inside the same encrypted file. It
 * belongs to neither database, so a restore stages it into neither: readBackupPayloads() reads it.
 */
export const BACKUP_PAYLOAD_TABLE = 'backup_payloads';
/** A manager's payload as it travels in a backup: who, when, and what (JSON-serialisable). */
export interface BackupPayload { manager: string; takenAt: string; payload: unknown }
/** The staged halves a restore writes next to the live files; applied at the next start. */
export const STAGED_RECORDS = 'records.db.staged';
export const STAGED_APP = 'spike.db.staged';
export const STAGED_PHD_SAMPLES = 'phd-samples.db.staged';

/**
 * Copies every table, index, trigger and view from the main database into the attached schema,
 * inside one transaction — a consistent snapshot even against concurrent writers, because SQLite
 * gives the transaction a stable read view. This is sqlcipher_export()'s documented behavior,
 * spelled out.
 */
function exportInto(db: InstanceType<typeof Database>, schema: string, only?: (table: string) => boolean): void {
  db.exec('BEGIN');
  try {
    copyObjects(db, 'main', schema, only);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** The copy itself, from one schema of the connection into another, inside the caller's transaction. */
function copyObjects(db: InstanceType<typeof Database>, from: string, schema: string, only?: (table: string) => boolean): void {
  const allObjects = (db
    .prepare(
      `SELECT type, name, tbl_name, sql FROM ${from}.sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'trigger' THEN 2 ELSE 3 END`
    )
    .all() as { type: string; name: string; tbl_name: string; sql: string }[]);
  // A virtual table (FTS5, yourphr#599) owns shadow tables named <table>_data, _idx, _content,
  // _docsize, _config: recreating the virtual table recreates them, and recreating them by hand is
  // refused ("object name reserved"). Their rows come back through the INSERT into the virtual
  // table — so they are skipped whether or not the virtual table itself is in this half.
  const virtual = allObjects.filter((o) => /^CREATE VIRTUAL TABLE/i.test(o.sql)).map((o) => o.name);
  const shadow = (name: string): boolean => virtual.some((v) => name.startsWith(`${v}_`));
  const objects = allObjects.filter((o) => !only || only(o.tbl_name));

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
      db.exec(`INSERT INTO ${schema}."${object.name}" SELECT * FROM ${from}."${object.name}"`);
    }
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

/** One database a backup copies: where it is and the key it opens under (none = plaintext). */
export interface DatabaseFile {
  file: string;
  key?: string;
  /**
   * Copied only when the file exists at backup time (yourphr#805): phd-samples.db is created when
   * device samples are turned on, so an instance without it backs up exactly as before.
   */
  optional?: boolean;
}

export interface BackupOptions {
  destination: string;
  backupKey: string;
  maxBackups?: number;
  now?: Date;
  /** Managers' payloads to carry in the same file (yourphr#631). Plain data: it crosses to the worker. */
  payloads?: BackupPayload[];
}

/**
 * Writes an encrypted, consistent backup of `sources` into ONE file in `destination`, then prunes
 * beyond `maxBackups` (oldest first; the date-first names sort chronologically). The first source is
 * the records file; the rest belong in the same backup (yourphr#602): the app database with the
 * accounts, sources, tokens and catalog — a backup of the records alone is not a backup of the
 * instance. Table names must not collide; they do not, by construction.
 *
 * Synchronous, and long on a real instance: call it from a worker (backupFiles), never from the
 * thread that answers requests (yourphr#787).
 */
export function backupFilesSync(sources: DatabaseFile[], options: BackupOptions): BackupResult {
  const backupKey = options.backupKey.trim();
  if (backupKey === '') {
    throw new Error('a backup key is required — backups are always encrypted (see backup.encryption.key)');
  }
  const [first, ...rest] = sources.filter((s) => !s.optional || existsSync(s.file));
  if (!first) throw new Error('a backup needs at least one database to copy');
  mkdirSync(options.destination, { recursive: true });
  // Second-precision names collide when two backups are taken back to back (a backup, then the
  // restore that backs up first); the second gets a suffix rather than an ATTACH onto the first.
  const stem = backupFileName(options.now ?? new Date()).slice(0, -SUFFIX.length);
  let file = join(options.destination, stem + SUFFIX);
  for (let n = 2; existsSync(file); n++) file = join(options.destination, `${stem}-${n}${SUFFIX}`);

  // A connection of the backup's own, opened the way SqliteFhirRepository opens the records file,
  // with every other source and the backup ATTACHed to it. ATTACH cannot bind the KEY clause, so
  // keys are escaped inline exactly as the repository escapes its own key pragma; filenames stay bound.
  const db = new Database(first.file);
  try {
    if (first.key) {
      db.pragma("cipher='sqlcipher'");
      db.pragma(`key=${quoteKey(first.key)}`);
    }
    const schemas = ['main'];
    rest.forEach((source, i) => {
      db.prepare(`ATTACH DATABASE ? AS src${i} KEY ${quoteKey(source.key ?? '')}`).run(source.file);
      schemas.push(`src${i}`);
    });
    db.prepare(`ATTACH DATABASE ? AS backup KEY ${quoteKey(backupKey)}`).run(file);

    // One snapshot across stores (yourphr#608). The live files are in WAL mode, so this read
    // transaction never blocks the server's writers, and the server's writes never reach it. Each
    // file's snapshot starts at its first read; the single statement below reads them all, so the
    // snapshots are taken together — microseconds apart, where the live app itself writes the two
    // files in separate transactions. Nothing here waits on the server, and the server waits on nothing here.
    db.exec('BEGIN');
    try {
      db.prepare(`SELECT ${schemas.map((s) => `(SELECT COUNT(*) FROM ${s}.sqlite_master)`).join(' + ')} AS n`).get();
      for (const schema of schemas) copyObjects(db, schema, 'backup');
      // The managers' payloads (yourphr#631), in the same transaction and the same encrypted file.
      db.exec(`CREATE TABLE backup.${BACKUP_PAYLOAD_TABLE} (manager TEXT PRIMARY KEY, taken_at TEXT NOT NULL, payload TEXT NOT NULL)`);
      const put = db.prepare(`INSERT INTO backup.${BACKUP_PAYLOAD_TABLE} (manager, taken_at, payload) VALUES (?, ?, ?)`);
      for (const p of options.payloads ?? []) put.run(p.manager, p.takenAt, JSON.stringify(p.payload ?? null));
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  } finally {
    db.close();
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

/**
 * backupFilesSync on a worker thread (yourphr#787): the export is minutes of synchronous SQLite on a
 * large instance, and on the request thread it answered nothing — not the household, not the
 * liveness probe — until it finished. The worker opens its own connection; keys travel in
 * workerData (memory), never argv or the environment.
 */
export function backupFiles(sources: DatabaseFile[], options: BackupOptions): Promise<BackupResult> {
  // Compiled, the worker is the .js beside this file. From source (tsx, vitest) it is the .ts, and
  // the worker needs tsx's loader to read it.
  const fromSource = import.meta.url.endsWith('.ts');
  const entry = new URL(fromSource ? './sqlite-backup-worker.ts' : './sqlite-backup-worker.js', import.meta.url);
  return new Promise((resolve, reject) => {
    const worker = new Worker(entry, { workerData: { sources, options }, ...(fromSource ? { execArgv: ['--import', 'tsx'] } : {}) });
    let settled = false;
    worker.once('message', (m: { ok: true; result: BackupResult } | { ok: false; error: string }) => {
      settled = true;
      if (m.ok) resolve(m.result);
      else reject(new Error(m.error));
    });
    worker.once('error', (err) => { settled = true; reject(err); });
    worker.once('exit', (code) => { if (!settled) reject(new Error(`the backup worker exited (code ${code}) without a result`)); });
  });
}

/** The repository's own file, plus `alsoExport`, in one backup. Synchronous: tests and harnesses; the server uses backupFiles. */
export function backupDatabase(repo: SqliteFhirRepository, options: BackupOptions & { alsoExport?: DatabaseFile[] }): BackupResult {
  return backupFilesSync([{ file: repo.file, key: repo.key }, ...(options.alsoExport ?? [])], options);
}

/** Backups in `dir`, newest first (the date-first names make name order time order). */
export function listBackups(dir: string): { name: string; sizeBytes: number; modified: string }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(isOurs)
    .sort()
    .reverse()
    .map((name) => {
      const st = statSync(join(dir, name));
      return { name, sizeBytes: st.size, modified: st.mtime.toISOString() };
    });
}

export function isBackupFileName(name: string): boolean {
  return isOurs(name) && !name.includes('/') && !name.includes('\\') && !name.includes('..');
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
export function stageInstanceRestore(backupFile: string, backupKey: string, dataDir: string, targetKey: string): { tables: number; phdSamples: boolean } {
  const records = stageRestore(backupFile, backupKey, join(dataDir, STAGED_RECORDS), targetKey, (t) => RECORDS_TABLES.has(t));
  stageRestore(backupFile, backupKey, join(dataDir, STAGED_APP), targetKey, (t) => !RECORDS_TABLES.has(t) && !isPhdTable(t) && t !== BACKUP_PAYLOAD_TABLE);
  // phd-samples.db is staged only when the backup carries it. A backup taken before device samples
  // existed has none of its tables, and staging an EMPTY file would wipe every sample on restart;
  // the live file is left as it is instead.
  const phdSamples = backupHasTable(backupFile, backupKey, isPhdTable);
  if (phdSamples) stageRestore(backupFile, backupKey, join(dataDir, STAGED_PHD_SAMPLES), targetKey, isPhdTable);
  return { tables: records.tables, phdSamples };
}

function backupHasTable(backupFile: string, backupKey: string, match: (table: string) => boolean): boolean {
  const db = new Database(backupFile, { readonly: true, fileMustExist: true });
  try {
    db.pragma("cipher='sqlcipher'");
    db.pragma(`key=${quoteKey(backupKey)}`);
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
    return names.some((n) => match(n.name));
  } finally {
    db.close();
  }
}

/**
 * The managers' payloads in a backup (yourphr#631), by manager. Empty for a backup taken before
 * they were carried — the caller says so rather than treating that as "no settings". Throws the
 * same way staging does when the key is wrong.
 */
export function readBackupPayloads(backupFile: string, backupKey: string): Record<string, BackupPayload> {
  const db = new Database(backupFile, { readonly: true, fileMustExist: true });
  try {
    db.pragma("cipher='sqlcipher'");
    db.pragma(`key=${quoteKey(backupKey)}`);
    const present = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(BACKUP_PAYLOAD_TABLE);
    if (!present) return {};
    const rows = db.prepare(`SELECT manager, taken_at, payload FROM ${BACKUP_PAYLOAD_TABLE}`).all() as { manager: string; taken_at: string; payload: string }[];
    return Object.fromEntries(rows.map((r) => [r.manager, { manager: r.manager, takenAt: r.taken_at, payload: JSON.parse(r.payload) as unknown }]));
  } catch (err) {
    throw new Error(`backup cannot be read — wrong key, or not a backup: ${(err as Error).message}`);
  } finally {
    db.close();
  }
}
