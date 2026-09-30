/**
 * The agent_tokens table in the app database (yourphr#695). Every raw query over it lives here.
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import { BaseAgentTokensProvider, type AgentTokenRecord, type DeviceGrantRecord } from './BaseAgentTokensProvider.js';

/**
 * The table as the provider creates it on a fresh database. The app migration that adds it
 * (src/app.ts, 20260828140000) carries a frozen copy — keep this one current and that one
 * untouched.
 *
 * `hash` is UNIQUE: two rows sharing one hash would make verification's answer depend on row
 * order. It cannot happen from 256 bits of randomness, which is exactly why the database should
 * say so rather than trust it.
 */
export const AGENT_TOKENS_SCHEMA = `CREATE TABLE IF NOT EXISTS agent_tokens (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  scopes TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL DEFAULT '',
  revoked_at TEXT NOT NULL DEFAULT '',
  revoked_by TEXT NOT NULL DEFAULT '',
  renewals INTEGER NOT NULL DEFAULT 0,
  renewed_from TEXT NOT NULL DEFAULT '',
  grant_id TEXT NOT NULL DEFAULT ''
)`;

/**
 * Connected-device grants (yourphr#807, #808) and the refresh tokens they have spent. Kept with
 * the agent tokens because a grant's keys ARE agent tokens: one table set, one manager, one door
 * for who may act for a patient. The app migration 20260930180000 carries a frozen copy.
 */
export const DEVICE_GRANTS_SCHEMA = `CREATE TABLE IF NOT EXISTS device_grants (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  label TEXT NOT NULL,
  scopes TEXT NOT NULL,
  source_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  owner_generation INTEGER NOT NULL,
  last_upload_at TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  status_at TEXT NOT NULL DEFAULT '',
  status_by TEXT NOT NULL DEFAULT '',
  setup_hash TEXT NOT NULL DEFAULT '',
  setup_expires_at TEXT NOT NULL DEFAULT '',
  refresh_hash TEXT NOT NULL DEFAULT '',
  noticed_days TEXT NOT NULL DEFAULT ''
)`;
export const DEVICE_REFRESH_SPENT_SCHEMA = `CREATE TABLE IF NOT EXISTS device_refresh_spent (
  hash TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL,
  spent_at TEXT NOT NULL
)`;

const INDEXES = [
  // The verification lookup, on every agent request.
  `CREATE INDEX IF NOT EXISTS idx_agent_tokens_hash ON agent_tokens(hash)`,
  // The account page's list, and the per-owner live count the mint cap reads.
  `CREATE INDEX IF NOT EXISTS idx_agent_tokens_owner ON agent_tokens(owner, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_tokens_grant ON agent_tokens(grant_id)`,
  `CREATE INDEX IF NOT EXISTS idx_device_grants_owner ON device_grants(owner, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_device_grants_setup ON device_grants(setup_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_device_grants_refresh ON device_grants(refresh_hash)`,
];

interface GrantRow {
  id: string; owner: string; label: string; scopes: string; source_id: string; created_at: string;
  ends_at: string; owner_generation: number; last_upload_at: string; status: string; status_at: string;
  status_by: string; setup_hash: string; setup_expires_at: string; refresh_hash: string; noticed_days: string;
}

interface Row {
  id: string; owner: string; name: string; hash: string; prefix: string; scopes: string;
  created_at: string; expires_at: string; last_used_at: string; revoked_at: string;
  revoked_by: string; renewals: number; renewed_from: string; grant_id: string;
}

export class SqliteAgentTokensProvider extends BaseAgentTokensProvider {
  constructor(private readonly db: InstanceType<typeof Database>) {
    super();
    db.exec(AGENT_TOKENS_SCHEMA);
    db.exec(DEVICE_GRANTS_SCHEMA);
    db.exec(DEVICE_REFRESH_SPENT_SCHEMA);
    for (const sql of INDEXES) db.exec(sql);
  }

  async initialize(): Promise<void> { /* schema ensured in the constructor, like the users provider */ }

  /**
   * Scopes are stored as JSON, and a row that cannot be parsed yields NO scopes.
   *
   * Failing to the empty list is the safe direction and is load-bearing: the manager treats an
   * empty scope list as "may read nothing", never as "unrestricted", so a corrupt row disables the
   * token instead of widening it.
   */
  private toRecord(r: Row): AgentTokenRecord {
    let scopes: string[] = [];
    try {
      const parsed: unknown = JSON.parse(r.scopes);
      if (Array.isArray(parsed)) scopes = parsed.filter((s): s is string => typeof s === 'string');
    } catch {
      scopes = [];
    }
    return {
      id: r.id, owner: r.owner, name: r.name, hash: r.hash, prefix: r.prefix, scopes,
      createdAt: r.created_at, expiresAt: r.expires_at, lastUsedAt: r.last_used_at,
      revokedAt: r.revoked_at, revokedBy: r.revoked_by,
      renewals: r.renewals, renewedFrom: r.renewed_from, grantId: r.grant_id ?? '',
    };
  }

  /** Same rule as a token: scopes that cannot be parsed are NO scopes, never "everything". */
  private toGrant(r: GrantRow): DeviceGrantRecord {
    let scopes: string[] = [];
    try {
      const parsed: unknown = JSON.parse(r.scopes);
      if (Array.isArray(parsed)) scopes = parsed.filter((s): s is string => typeof s === 'string');
    } catch {
      scopes = [];
    }
    const status = (['active', 'suspended', 'revoked', 'ended'] as const).find((x) => x === r.status) ?? 'revoked';
    return {
      id: r.id, owner: r.owner, label: r.label, scopes, sourceId: r.source_id, createdAt: r.created_at,
      endsAt: r.ends_at, ownerGeneration: r.owner_generation, lastUploadAt: r.last_upload_at, status,
      statusAt: r.status_at, statusBy: r.status_by, setupHash: r.setup_hash, setupExpiresAt: r.setup_expires_at,
      refreshHash: r.refresh_hash,
      noticedDays: (r.noticed_days ?? '').split(',').filter((d) => /^\d+$/.test(d)).map(Number),
    };
  }

  async create(record: AgentTokenRecord): Promise<void> {
    this.db.prepare(`INSERT INTO agent_tokens
      (id, owner, name, hash, prefix, scopes, created_at, expires_at, last_used_at, revoked_at, revoked_by, renewals, renewed_from, grant_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(record.id, record.owner, record.name, record.hash, record.prefix, JSON.stringify(record.scopes),
        record.createdAt, record.expiresAt, record.lastUsedAt, record.revokedAt, record.revokedBy,
        record.renewals, record.renewedFrom, record.grantId ?? '');
  }

  async findByHash(hash: string): Promise<AgentTokenRecord | undefined> {
    const r = this.db.prepare('SELECT * FROM agent_tokens WHERE hash = ?').get(hash) as Row | undefined;
    return r ? this.toRecord(r) : undefined;
  }

  async get(id: string): Promise<AgentTokenRecord | undefined> {
    const r = this.db.prepare('SELECT * FROM agent_tokens WHERE id = ?').get(id) as Row | undefined;
    return r ? this.toRecord(r) : undefined;
  }

  async listForOwner(owner: string): Promise<AgentTokenRecord[]> {
    return (this.db.prepare('SELECT * FROM agent_tokens WHERE owner = ? ORDER BY created_at DESC, id').all(owner) as Row[])
      .map((r) => this.toRecord(r));
  }

  async listAll(): Promise<AgentTokenRecord[]> {
    return (this.db.prepare('SELECT * FROM agent_tokens ORDER BY created_at DESC, id').all() as Row[])
      .map((r) => this.toRecord(r));
  }

  /**
   * Live = not revoked and not yet expired. The comparison is on ISO strings, which sorts
   * correctly because every timestamp written here is UTC with the same precision.
   */
  async countLiveForOwner(owner: string, nowIso: string): Promise<number> {
    return (this.db.prepare(
      // A device grant's keys are capped by the grant limit, not this one (yourphr#808).
      `SELECT COUNT(*) AS n FROM agent_tokens WHERE owner = ? AND revoked_at = '' AND expires_at > ? AND grant_id = ''`
    ).get(owner, nowIso) as { n: number }).n;
  }

  async touch(id: string, lastUsedAt: string): Promise<void> {
    this.db.prepare('UPDATE agent_tokens SET last_used_at = ? WHERE id = ?').run(lastUsedAt, id);
  }

  async revoke(id: string, revokedAt: string, revokedBy: string): Promise<boolean> {
    return this.db.prepare(`UPDATE agent_tokens SET revoked_at = ?, revoked_by = ? WHERE id = ? AND revoked_at = ''`)
      .run(revokedAt, revokedBy, id).changes === 1;
  }

  async purge(deadBeforeIso: string): Promise<number> {
    // Dead is revoked OR expired; the cutoff applies to whichever ended it. A revoked token that
    // had not yet expired is dead from its revocation, not from its original expiry.
    return this.db.prepare(
      `DELETE FROM agent_tokens
       WHERE (revoked_at != '' AND revoked_at <= ?)
          OR (revoked_at = '' AND expires_at <= ?)`
    ).run(deadBeforeIso, deadBeforeIso).changes;
  }

  async removeForOwner(owner: string): Promise<void> {
    this.db.prepare('DELETE FROM device_refresh_spent WHERE grant_id IN (SELECT id FROM device_grants WHERE owner = ?)').run(owner);
    this.db.prepare('DELETE FROM device_grants WHERE owner = ?').run(owner);
    this.db.prepare('DELETE FROM agent_tokens WHERE owner = ?').run(owner);
  }

  async createGrant(g: DeviceGrantRecord): Promise<void> {
    this.db.prepare(`INSERT INTO device_grants
      (id, owner, label, scopes, source_id, created_at, ends_at, owner_generation, last_upload_at, status, status_at, status_by, setup_hash, setup_expires_at, refresh_hash, noticed_days)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(g.id, g.owner, g.label, JSON.stringify(g.scopes), g.sourceId, g.createdAt, g.endsAt, g.ownerGeneration,
        g.lastUploadAt, g.status, g.statusAt, g.statusBy, g.setupHash, g.setupExpiresAt, g.refreshHash, g.noticedDays.join(','));
  }

  async getGrant(id: string): Promise<DeviceGrantRecord | undefined> {
    const r = this.db.prepare('SELECT * FROM device_grants WHERE id = ?').get(id) as GrantRow | undefined;
    return r ? this.toGrant(r) : undefined;
  }

  async findGrantBySetupHash(hash: string): Promise<DeviceGrantRecord | undefined> {
    if (hash === '') return undefined;
    const r = this.db.prepare('SELECT * FROM device_grants WHERE setup_hash = ?').get(hash) as GrantRow | undefined;
    return r ? this.toGrant(r) : undefined;
  }

  async findGrantByRefreshHash(hash: string): Promise<DeviceGrantRecord | undefined> {
    if (hash === '') return undefined;
    const r = this.db.prepare('SELECT * FROM device_grants WHERE refresh_hash = ?').get(hash) as GrantRow | undefined;
    return r ? this.toGrant(r) : undefined;
  }

  async listGrantsForOwner(owner: string): Promise<DeviceGrantRecord[]> {
    return (this.db.prepare('SELECT * FROM device_grants WHERE owner = ? ORDER BY created_at DESC, id').all(owner) as GrantRow[])
      .map((r) => this.toGrant(r));
  }

  async listActiveGrants(): Promise<DeviceGrantRecord[]> {
    return (this.db.prepare("SELECT * FROM device_grants WHERE status = 'active' ORDER BY created_at, id").all() as GrantRow[]).map((r) => this.toGrant(r));
  }

  async updateGrant(g: DeviceGrantRecord): Promise<void> {
    this.db.prepare(`UPDATE device_grants SET label = ?, scopes = ?, ends_at = ?, last_upload_at = ?, status = ?, status_at = ?,
      status_by = ?, setup_hash = ?, setup_expires_at = ?, refresh_hash = ?, noticed_days = ? WHERE id = ?`)
      .run(g.label, JSON.stringify(g.scopes), g.endsAt, g.lastUploadAt, g.status, g.statusAt, g.statusBy,
        g.setupHash, g.setupExpiresAt, g.refreshHash, g.noticedDays.join(','), g.id);
  }

  async spendRefresh(hash: string, grantId: string, at: string): Promise<void> {
    this.db.prepare('INSERT OR IGNORE INTO device_refresh_spent (hash, grant_id, spent_at) VALUES (?, ?, ?)').run(hash, grantId, at);
  }

  async grantOfSpentRefresh(hash: string): Promise<string | undefined> {
    const r = this.db.prepare('SELECT grant_id FROM device_refresh_spent WHERE hash = ?').get(hash) as { grant_id: string } | undefined;
    return r?.grant_id;
  }

  async revokeKeysOfGrant(grantId: string, revokedAt: string, revokedBy: string): Promise<number> {
    return this.db.prepare(`UPDATE agent_tokens SET revoked_at = ?, revoked_by = ? WHERE grant_id = ? AND revoked_at = ''`)
      .run(revokedAt, revokedBy, grantId).changes;
  }
}
