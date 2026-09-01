/** The device_tokens table in the app database. Every raw query over it lives here. */
import type Database from 'better-sqlite3-multiple-ciphers';
import { BaseDeviceTokensProvider, type DeviceTokenRecord } from './BaseDeviceTokensProvider.js';

/**
 * The table as the provider creates it on a fresh database. The app migration that adds it
 * (src/app.ts) carries a frozen copy — keep this one current and that one untouched.
 */
export const DEVICE_TOKENS_SCHEMA = `CREATE TABLE IF NOT EXISTS device_tokens (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL DEFAULT '',
  revoked_at TEXT NOT NULL DEFAULT '',
  revoked_by TEXT NOT NULL DEFAULT ''
)`;

const INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_device_tokens_hash ON device_tokens(hash)`,
  `CREATE INDEX IF NOT EXISTS idx_device_tokens_owner ON device_tokens(owner, created_at DESC)`,
];

interface Row {
  id: string; owner: string; name: string; hash: string; prefix: string;
  created_at: string; expires_at: string; last_used_at: string; revoked_at: string; revoked_by: string;
}

export class SqliteDeviceTokensProvider extends BaseDeviceTokensProvider {
  constructor(private readonly db: InstanceType<typeof Database>) {
    super();
    db.exec(DEVICE_TOKENS_SCHEMA);
    for (const sql of INDEXES) db.exec(sql);
  }

  async initialize(): Promise<void> { /* schema ensured in the constructor */ }

  private toRecord(r: Row): DeviceTokenRecord {
    return {
      id: r.id, owner: r.owner, name: r.name, hash: r.hash, prefix: r.prefix,
      createdAt: r.created_at, expiresAt: r.expires_at, lastUsedAt: r.last_used_at,
      revokedAt: r.revoked_at, revokedBy: r.revoked_by,
    };
  }

  async create(record: DeviceTokenRecord): Promise<void> {
    this.db.prepare(`INSERT INTO device_tokens
      (id, owner, name, hash, prefix, created_at, expires_at, last_used_at, revoked_at, revoked_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(record.id, record.owner, record.name, record.hash, record.prefix,
        record.createdAt, record.expiresAt, record.lastUsedAt, record.revokedAt, record.revokedBy);
  }

  async findByHash(hash: string): Promise<DeviceTokenRecord | undefined> {
    const r = this.db.prepare('SELECT * FROM device_tokens WHERE hash = ?').get(hash) as Row | undefined;
    return r ? this.toRecord(r) : undefined;
  }

  async get(id: string): Promise<DeviceTokenRecord | undefined> {
    const r = this.db.prepare('SELECT * FROM device_tokens WHERE id = ?').get(id) as Row | undefined;
    return r ? this.toRecord(r) : undefined;
  }

  async listForOwner(owner: string): Promise<DeviceTokenRecord[]> {
    return (this.db.prepare('SELECT * FROM device_tokens WHERE owner = ? ORDER BY created_at DESC, id').all(owner) as Row[])
      .map((r) => this.toRecord(r));
  }

  async touch(id: string, lastUsedAt: string): Promise<void> {
    this.db.prepare('UPDATE device_tokens SET last_used_at = ? WHERE id = ?').run(lastUsedAt, id);
  }

  async revoke(id: string, revokedAt: string, revokedBy: string): Promise<boolean> {
    return this.db.prepare(`UPDATE device_tokens SET revoked_at = ?, revoked_by = ? WHERE id = ? AND revoked_at = ''`)
      .run(revokedAt, revokedBy, id).changes === 1;
  }

  async removeForOwner(owner: string): Promise<void> {
    this.db.prepare('DELETE FROM device_tokens WHERE owner = ?').run(owner);
  }
}
