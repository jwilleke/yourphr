/**
 * The accounts table in the app database (yourphr#611). Every raw query over auth_users lives here.
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import { BaseUsersProvider, type UserRecord } from './BaseUsersProvider.js';

/**
 * The table as the provider creates it on a fresh database. The app migration that added `role`
 * (src/app.ts, 20260822090000) carries a frozen copy of the pre-role shape — keep this one current
 * and that one untouched.
 */
export const AUTH_USERS_SCHEMA = `CREATE TABLE IF NOT EXISTS auth_users (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  token_generation INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  email TEXT NOT NULL DEFAULT '',
  is_test INTEGER NOT NULL DEFAULT 0
)`;

interface Row { username: string; password_hash: string; token_generation: number; created_at: string; role: string; email?: string; is_test?: number }

export class SqliteUsersProvider extends BaseUsersProvider {
  constructor(private readonly db: InstanceType<typeof Database>) {
    super();
    db.exec(AUTH_USERS_SCHEMA);
    db.exec(`CREATE TABLE IF NOT EXISTS legal_consent (
      user_id TEXT PRIMARY KEY,
      accepted_at TEXT NOT NULL DEFAULT ''
    )`);
  }

  async initialize(): Promise<void> { /* the schema is ensured in the constructor, before any migration-dependent caller */ }

  private toRecord(r: Row): UserRecord {
    // The STORED name, unresolved. Storage is not where a role is interpreted (yourphr#648): the
    // provider cannot see the configured roles, and resolving here without them would demote every
    // admin to `user` on read. UsersManager.roleOf does the resolving, against the policy.
    return { username: r.username, passwordHash: r.password_hash, tokenGeneration: r.token_generation, role: String(r.role ?? ''), createdAt: r.created_at, email: String(r.email ?? ''), isTest: r.is_test === 1 };
  }

  async create(record: Omit<UserRecord, 'createdAt' | 'email' | 'isTest'> & { createdAt?: string; email?: string; isTest?: boolean }): Promise<void> {
    this.db.prepare('INSERT INTO auth_users (username, password_hash, token_generation, created_at, role, email, is_test) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(record.username, record.passwordHash, record.tokenGeneration, record.createdAt ?? new Date().toISOString(), record.role, record.email ?? '', record.isTest === true ? 1 : 0);
  }

  async get(username: string): Promise<UserRecord | undefined> {
    const r = this.db.prepare('SELECT * FROM auth_users WHERE username = ?').get(username) as Row | undefined;
    return r ? this.toRecord(r) : undefined;
  }

  async list(): Promise<UserRecord[]> {
    return (this.db.prepare('SELECT * FROM auth_users ORDER BY created_at, username').all() as Row[]).map((r) => this.toRecord(r));
  }

  async count(): Promise<number> {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM auth_users').get() as { n: number }).n;
  }

  async setPasswordHash(username: string, hash: string, bumpGeneration: boolean): Promise<boolean> {
    const sql = bumpGeneration
      ? 'UPDATE auth_users SET password_hash = ?, token_generation = token_generation + 1 WHERE username = ?'
      : 'UPDATE auth_users SET password_hash = ? WHERE username = ?';
    return this.db.prepare(sql).run(hash, username).changes === 1;
  }

  async bumpGeneration(username: string): Promise<void> {
    this.db.prepare('UPDATE auth_users SET token_generation = token_generation + 1 WHERE username = ?').run(username);
  }

  async delete(username: string): Promise<boolean> {
    return this.db.prepare('DELETE FROM auth_users WHERE username = ?').run(username).changes > 0;
  }

  async setEmail(username: string, email: string): Promise<boolean> {
    return this.db.prepare('UPDATE auth_users SET email = ? WHERE username = ?').run(email, username).changes === 1;
  }

  async setTest(username: string, isTest: boolean): Promise<boolean> {
    return this.db.prepare('UPDATE auth_users SET is_test = ? WHERE username = ?').run(isTest ? 1 : 0, username).changes === 1;
  }

  async consentAcceptedAt(username: string): Promise<string> {
    const row = this.db.prepare('SELECT accepted_at FROM legal_consent WHERE user_id = ?').get(username) as { accepted_at: string } | undefined;
    return (row?.accepted_at ?? '').trim();
  }

  async setConsentAcceptedAt(username: string, acceptedAt: string): Promise<void> {
    this.db
      .prepare('INSERT INTO legal_consent (user_id, accepted_at) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET accepted_at = excluded.accepted_at')
      .run(username, acceptedAt);
  }
}
