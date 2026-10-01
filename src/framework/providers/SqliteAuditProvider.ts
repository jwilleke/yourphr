/** The access_events table in the app database (yourphr#614). */
import type Database from 'better-sqlite3-multiple-ciphers';
import { BaseAuditProvider, type AccessEvent } from './BaseAuditProvider.js';

export class SqliteAuditProvider extends BaseAuditProvider {
  constructor(private readonly db: InstanceType<typeof Database>) {
    super();
    db.exec(`CREATE TABLE IF NOT EXISTS access_events (
      user_id TEXT NOT NULL,
      actor_username TEXT NOT NULL,
      category TEXT NOT NULL,
      day TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      first_at TEXT NOT NULL,
      last_at TEXT NOT NULL,
      PRIMARY KEY (user_id, actor_username, category, day)
    )`);
  }

  async initialize(): Promise<void> { /* schema ensured in the constructor */ }

  async healthCheck(): Promise<boolean> {
    try {
      return this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'access_events'").get() !== undefined;
    } catch {
      return false;
    }
  }

  async record(owner: string, actor: string, category: string, at: Date): Promise<void> {
    const iso = at.toISOString();
    this.db
      .prepare(`INSERT INTO access_events (user_id, actor_username, category, day, count, first_at, last_at) VALUES (?, ?, ?, ?, 1, ?, ?)
                ON CONFLICT(user_id, actor_username, category, day) DO UPDATE SET count = count + 1, last_at = excluded.last_at`)
      .run(owner, actor, category, iso.slice(0, 10), iso, iso);
  }

  async importEvent(owner: string, e: AccessEvent): Promise<boolean> {
    return this.db
      .prepare('INSERT OR IGNORE INTO access_events (user_id, actor_username, category, day, count, first_at, last_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(owner, e.actor_username, e.category, e.day, e.count, e.first_at, e.last_at).changes > 0;
  }

  async list(owner: string): Promise<AccessEvent[]> {
    return this.db
      .prepare('SELECT actor_username, category, day, count, first_at, last_at FROM access_events WHERE user_id = ? ORDER BY day DESC, last_at DESC, category')
      .all(owner) as AccessEvent[];
  }

  async removeForOwner(owner: string): Promise<void> {
    this.db.prepare('DELETE FROM access_events WHERE user_id = ?').run(owner);
  }

  async trim(owner: string, beforeDay: string, keepCategory: string): Promise<number> {
    return this.db.prepare('DELETE FROM access_events WHERE user_id = ? AND day < ? AND category != ?').run(owner, beforeDay, keepCategory).changes;
  }
}
