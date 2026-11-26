/**
 * The auth_sessions table in the app database (yourphr#814). Every raw query over it lives here.
 *
 * The app database is the encrypted one (`yourphr.database.encryption.key`), so session records
 * sit beside the accounts they belong to, under the same key, and nothing new is stored unlocked.
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import { BaseSessionsProvider, type SessionRecord } from './BaseSessionsProvider.js';

/**
 * The table as the provider creates it on a fresh database. The app migration that adds it
 * (src/app.ts, 20261126120000) carries a frozen copy — keep this one current and that one
 * untouched.
 */
export const AUTH_SESSIONS_SCHEMA = `CREATE TABLE IF NOT EXISTS auth_sessions (
  sid TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  generation INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  cap_at INTEGER NOT NULL
)`;

interface Row { sid: string; username: string; generation: number; created_at: number; last_seen_at: number; expires_at: number; cap_at: number }

const toRecord = (r: Row): SessionRecord => ({
  sid: r.sid, username: r.username, generation: r.generation, createdAt: r.created_at, lastSeenAt: r.last_seen_at, expiresAt: r.expires_at, capAt: r.cap_at,
});

export class SqliteSessionsProvider extends BaseSessionsProvider {
  constructor(private readonly db: InstanceType<typeof Database>) {
    super();
    db.exec(AUTH_SESSIONS_SCHEMA);
    db.exec('CREATE INDEX IF NOT EXISTS idx_auth_sessions_username ON auth_sessions(username)');
  }

  async initialize(): Promise<void> { /* the schema is ensured in the constructor */ }

  async create(r: SessionRecord): Promise<void> {
    this.db.prepare('INSERT INTO auth_sessions (sid, username, generation, created_at, last_seen_at, expires_at, cap_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(r.sid, r.username, r.generation, r.createdAt, r.lastSeenAt, r.expiresAt, r.capAt);
  }

  async get(sid: string): Promise<SessionRecord | undefined> {
    const r = this.db.prepare('SELECT * FROM auth_sessions WHERE sid = ?').get(sid) as Row | undefined;
    return r ? toRecord(r) : undefined;
  }

  async touch(sid: string, lastSeenAt: number, expiresAt: number): Promise<void> {
    this.db.prepare('UPDATE auth_sessions SET last_seen_at = ?, expires_at = ? WHERE sid = ?').run(lastSeenAt, expiresAt, sid);
  }

  async delete(sid: string): Promise<boolean> {
    return this.db.prepare('DELETE FROM auth_sessions WHERE sid = ?').run(sid).changes > 0;
  }

  async deleteForUser(username: string): Promise<number> {
    return this.db.prepare('DELETE FROM auth_sessions WHERE username = ?').run(username).changes;
  }

  async listForUser(username: string): Promise<SessionRecord[]> {
    return (this.db.prepare('SELECT * FROM auth_sessions WHERE username = ? ORDER BY created_at DESC, sid').all(username) as Row[]).map(toRecord);
  }

  async prune(nowSeconds: number): Promise<number> {
    return this.db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ? OR cap_at <= ?').run(nowSeconds, nowSeconds).changes;
  }
}
