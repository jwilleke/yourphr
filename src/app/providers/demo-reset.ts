/**
 * Demo reset: put the baked-in baseline back, at startup, before anything opens the databases
 * (yourphr#645).
 *
 * It lives among the PROVIDERS, beside sqlite-backup.ts, for the reason the store-boundary guard
 * exists (yourphr#609): it opens the database file directly to read the accounts it is about to
 * destroy, and the driver belongs to providers. It is a function rather than a class because it
 * runs before the engine exists — the same shape as the staged restore it follows.
 *
 * WHY IN THE APP AND NOT IN kubectl. A public demo is only safe to leave alone if it heals itself.
 * Go decided this (yourphr#518) and it is right: an operator should not have to be present for the
 * demo to be clean, and "restart the pod" is something an image bump already does on its own.
 *
 * THIS IS THE ONE CODE PATH THAT DELIBERATELY DESTROYS A LIVE DATABASE, so it is armed three ways
 * and then still has to prove what it is about to destroy:
 *
 *   1. `yourphr.demo.enabled` — this is a demo at all.
 *   2. `yourphr.demo.reset-on-restart` — and it is the self-healing kind.
 *   3. `yourphr.demo.baseline.dir` names a directory that actually holds a baseline.
 *
 * Go's third switch was `bootstrap.seed.restore`, a separate feature flag for installing a seed.
 * Here the baseline PATH is the flag: no baseline, nothing to restore, nothing destroyed. One fewer
 * setting that can be true while the thing it describes is absent.
 *
 * THE PROOF. Every account in the existing database must be one this demo owns — the demo account,
 * the demo admin, or the bootstrap admin. One unrecognised account and the reset is refused and the
 * instance starts normally WITH ITS DATA INTACT. A production instance that somehow arrives here
 * misconfigured must survive it; that is the whole point of proving rather than trusting the flags.
 *
 * ENCRYPTED DATABASES ARE REFUSED. The baseline ships in a public image, so it is plaintext, and
 * installing it over an instance configured with a key would produce databases the app cannot open.
 * This bites harder here than in Go, because these instances encrypt at rest by default — which is
 * the correct direction for a refusal to bite in.
 *
 * THE OPERATOR'S ACCOUNT IS KEPT (yourphr#886). The bootstrap admin's row and passkeys are read
 * before the files are replaced and written back after, so a reset never locks the operator out of
 * their own demo. The baseline itself holds no admin; the first start on a fresh volume provisions
 * one and writes .admin_bootstrap_password, as on any other install.
 *
 * SESSIONS. Go deleted its JWT signing key so tokens minted before a reset could not verify. This
 * stack used to regenerate its session key at every boot, which ended every session for free; since
 * yourphr#815 the key is kept in .env, so that no longer holds — see the known gaps in
 * docs/guides/demo-mode.md.
 */
import { copyFileSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';
import { AUTH_CREDENTIALS_SCHEMA } from '../../framework/providers/SqliteCredentialsProvider.js';

/** The two files a baseline holds, named for what they are rather than for the live filenames. */
export const BASELINE_APP = 'app.db';
export const BASELINE_RECORDS = 'records.db';

export interface DemoResetRequest {
  /** Both live database paths, resolved from configuration exactly as the boot resolves them. */
  appDbPath: string;
  recordsDbPath: string;
  /** The directory holding the baked-in baseline; '' when the instance ships none. */
  baselineDir: string;
  /** Armed only when both are true. */
  demoEnabled: boolean;
  resetOnRestart: boolean;
  /** Non-empty means at-rest encryption, which refuses the reset outright. */
  databaseKey: string;
  /** The accounts this demo is allowed to hold. Anything else refuses the reset. */
  allowedAccounts: string[];
  /**
   * The accounts carried ACROSS the reset (yourphr#886): the operator's. Their row — password, role,
   * token generation — and their passkeys are read from the live database and written into the
   * restored one, so the operator is never locked out of their own demo. Must be a subset of
   * `allowedAccounts`; the proof is unchanged.
   */
  keepAccounts?: string[];
  log: (line: string) => void;
}

/** Why a reset did not happen, for the log and for the harness to assert against. */
export type DemoResetOutcome =
  | { applied: true }
  | { applied: false; reason: 'not-armed' | 'no-baseline' | 'encrypted' | 'foreign-account' | 'unreadable' };

/**
 * Replace the live databases with the baseline, or refuse and explain. Returns what happened so a
 * caller can log it once; every refusal leaves the instance exactly as it was found.
 */
export function applyDemoReset(request: DemoResetRequest): DemoResetOutcome {
  const { appDbPath, recordsDbPath, baselineDir, log } = request;

  if (!request.demoEnabled || !request.resetOnRestart) return { applied: false, reason: 'not-armed' };

  const baselineApp = join(baselineDir, BASELINE_APP);
  const baselineRecords = join(baselineDir, BASELINE_RECORDS);
  if (baselineDir === '' || !existsSync(baselineApp) || !existsSync(baselineRecords)) {
    log(`demo reset: armed, but no baseline at ${baselineDir || '(unset)'} — nothing was destroyed`);
    return { applied: false, reason: 'no-baseline' };
  }

  if (request.databaseKey !== '') {
    log('demo reset: refused — this instance encrypts its databases at rest and the baseline is plaintext; the instance starts normally with its data intact');
    return { applied: false, reason: 'encrypted' };
  }

  // Nothing to prove on a first boot: no database means no data to destroy.
  if (existsSync(appDbPath)) {
    const foreign = foreignAccount(appDbPath, request.allowedAccounts, log);
    if (foreign === 'unreadable') return { applied: false, reason: 'unreadable' };
    if (foreign !== undefined) {
      log(`demo reset: REFUSED — this database holds ${JSON.stringify(foreign)}, which is not one of this demo's accounts (${request.allowedAccounts.filter(Boolean).join(', ')}). The instance starts normally with its data intact.`);
      return { applied: false, reason: 'foreign-account' };
    }
  }

  // Read BEFORE anything is replaced: the operator's account is the one thing the reset must keep.
  const keep = (request.keepAccounts ?? []).filter((name) => name !== '');
  const kept = existsSync(appDbPath) && keep.length > 0 ? readKept(appDbPath, keep, log) : undefined;
  if (kept === 'unreadable') return { applied: false, reason: 'unreadable' };

  log(`demo reset: replacing the live databases with the baseline at ${baselineDir} — every account and record in them is being discarded except ${keep.join(', ') || 'none'} (yourphr.demo.reset-on-restart)`);
  install(baselineApp, appDbPath);
  install(baselineRecords, recordsDbPath);
  if (kept && kept.users.length > 0) writeKept(appDbPath, kept, log);
  log('demo reset: the instance now holds the baked-in SYNTHETIC baseline and a shared demo account, not real data');
  return { applied: true };
}

/**
 * The first account that does not belong to this demo, or undefined when every one does.
 * 'unreadable' when the database cannot be opened or has no accounts table — refuse rather than
 * guess: an unreadable database is not a proven one.
 */
function foreignAccount(appDbPath: string, allowed: string[], log: (line: string) => void): string | undefined | 'unreadable' {
  const permitted = new Set(allowed.filter((name) => name !== '').map((name) => name.toLowerCase()));
  let db: InstanceType<typeof Database> | undefined;
  try {
    db = new Database(appDbPath, { readonly: true, fileMustExist: true });
    const rows = db.prepare('SELECT username FROM auth_users').all() as { username: string }[];
    for (const row of rows) {
      if (!permitted.has(String(row.username).toLowerCase())) return row.username;
    }
    return undefined;
  } catch (err) {
    log(`demo reset: refused — could not read the existing database to prove it belongs to a demo (${(err as Error).message}); the instance starts normally with its data intact`);
    return 'unreadable';
  } finally {
    db?.close();
  }
}

/** The rows a reset carries across: the kept accounts and their stored credentials (passkeys). */
interface KeptRows { users: Record<string, unknown>[]; credentials: Record<string, unknown>[] }

/**
 * The kept accounts' rows, read from the live database before it is replaced. A database with no
 * credentials table (one from before yourphr#876) simply has no passkeys to keep. 'unreadable' when
 * the accounts cannot be read — refuse rather than reset and lock the operator out.
 */
function readKept(appDbPath: string, keep: string[], log: (line: string) => void): KeptRows | 'unreadable' {
  const names = keep.map((n) => n.toLowerCase());
  const marks = names.map(() => '?').join(', ');
  let db: InstanceType<typeof Database> | undefined;
  try {
    db = new Database(appDbPath, { readonly: true, fileMustExist: true });
    const users = db.prepare(`SELECT * FROM auth_users WHERE lower(username) IN (${marks})`).all(...names) as Record<string, unknown>[];
    const hasCredentials = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'auth_credentials'").get() !== undefined;
    const credentials = hasCredentials
      ? db.prepare(`SELECT * FROM auth_credentials WHERE lower(username) IN (${marks})`).all(...names) as Record<string, unknown>[]
      : [];
    return { users, credentials };
  } catch (err) {
    log(`demo reset: refused — could not read the operator's account to keep it (${(err as Error).message}); the instance starts normally with its data intact`);
    return 'unreadable';
  } finally {
    db?.close();
  }
}

/**
 * Write the kept rows into the restored database, replacing any same-named account the baseline
 * holds. Only the columns both schemas have are copied: the baseline is built by the same image, so
 * in practice that is every column, and the app's migrations add anything else when it opens.
 * Passkey rows stay valid as they are — they are signed with YOURPHR_CREDENTIALS_KEY, which lives in
 * .env and is not touched by a reset.
 */
function writeKept(appDbPath: string, kept: KeptRows, log: (line: string) => void): void {
  const db = new Database(appDbPath);
  try {
    const columnsOf = (table: string): Set<string> =>
      new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
    const insert = (table: string, row: Record<string, unknown>, columns: Set<string>): void => {
      const names = Object.keys(row).filter((c) => columns.has(c));
      db.prepare(`INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...names.map((c) => row[c]));
    };
    db.transaction(() => {
      const userColumns = columnsOf('auth_users');
      for (const row of kept.users) {
        db.prepare('DELETE FROM auth_users WHERE lower(username) = lower(?)').run(row['username']);
        insert('auth_users', row, userColumns);
      }
      if (kept.credentials.length > 0) {
        db.exec(AUTH_CREDENTIALS_SCHEMA);
        const credentialColumns = columnsOf('auth_credentials');
        for (const row of kept.credentials) {
          db.prepare('DELETE FROM auth_credentials WHERE id = ? OR (kind = ? AND subject = ?)').run(row['id'], row['kind'], row['subject']);
          insert('auth_credentials', row, credentialColumns);
        }
      }
    })();
    log(`demo reset: kept ${kept.users.map((u) => String(u['username'])).join(', ')} — password, role and ${kept.credentials.length} passkey(s) carried across (yourphr#886)`);
  } finally {
    db.close();
  }
}

/**
 * Copy one baseline file over a live one, taking its WAL and shared-memory siblings with it. Leaving
 * a -wal behind would have SQLite replay the old instance's uncommitted pages onto the baseline,
 * which is a corrupt database wearing a fresh file's name.
 */
function install(from: string, to: string): void {
  for (const sibling of [`${to}-wal`, `${to}-shm`]) {
    if (existsSync(sibling)) rmSync(sibling, { force: true });
  }
  copyFileSync(from, to);
}

/** Does this directory hold a usable baseline? Used by the image build and the harnesses. */
export function baselineIsPresent(dir: string): boolean {
  if (dir === '' || !existsSync(dir)) return false;
  const names = new Set(readdirSync(dir));
  return [BASELINE_APP, BASELINE_RECORDS].every((f) => names.has(f) && statSync(join(dir, f)).size > 0);
}
