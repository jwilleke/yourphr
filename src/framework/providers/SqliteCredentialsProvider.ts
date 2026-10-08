/**
 * The credentials store in the app database (yourphr#876, decision 1: beside `auth_users`, under the
 * same at-rest encryption and in every backup). Ported from ngdpbase's `FileCredentialsProvider`:
 * the same row, the same canonical form, the same HMAC-SHA-256 signature and the same quarantine —
 * only the place the rows live differs.
 *
 * Why sign rows that are already in an encrypted database: the encryption key opens the whole file,
 * so anyone holding it could add a passkey for any account by inserting a row. The signing key is a
 * second, separate secret; a row it did not sign is never used.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3-multiple-ciphers';
import { BaseCredentialsProvider, type CredentialKind, type CredentialRecord, type RejectedCredential } from './BaseCredentialsProvider.js';

/**
 * The table as the provider creates it on a fresh database. The app migration that adds it
 * (src/app.ts, 20261008090000) carries a frozen copy — keep this one current and that one untouched.
 * `(kind, subject)` is UNIQUE: one passkey can never belong to two rows.
 */
export const AUTH_CREDENTIALS_SCHEMA = `CREATE TABLE IF NOT EXISTS auth_credentials (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  kind TEXT NOT NULL,
  subject TEXT NOT NULL,
  secret TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  sig TEXT NOT NULL DEFAULT '',
  UNIQUE (kind, subject)
)`;

const KINDS: ReadonlySet<string> = new Set(['passkey', 'totp', 'email', 'sms', 'device']);

interface Row { id: string; username: string; kind: string; subject: string; secret: string; label: string; created_at: string; last_used_at: string | null; sig: string }

/** ngdpbase's canonical form, field for field, so a signature means the same thing in both. */
function canonical(r: CredentialRecord): string {
  return JSON.stringify([r.id, r.username, r.kind, r.subject, r.secret, r.label, r.createdAt, r.lastUsedAt ?? null]);
}

function toRecord(row: Row): CredentialRecord {
  return {
    id: row.id, username: row.username, kind: row.kind as CredentialKind, subject: row.subject, secret: row.secret,
    label: row.label, createdAt: row.created_at, ...(row.last_used_at ? { lastUsedAt: row.last_used_at } : {}),
  };
}

export class SqliteCredentialsProvider extends BaseCredentialsProvider {
  /** Rows that passed their check, by id. Read at open; every write goes through the table and here. */
  private readonly trusted = new Map<string, CredentialRecord>();
  private rejected: RejectedCredential[] = [];

  constructor(private readonly db: InstanceType<typeof Database>, private readonly key: string) {
    super();
    // No key, no store: a row signed with nothing proves nothing (ngdpbase refuses the same way).
    if (key === '') throw new Error('credentials store: YOURPHR_CREDENTIALS_KEY is not set');
    db.exec(AUTH_CREDENTIALS_SCHEMA);
  }

  private sign(r: CredentialRecord): string {
    return createHmac('sha256', this.key).update(canonical(r)).digest('base64');
  }

  private signedBy(r: CredentialRecord, sig: string): boolean {
    const expected = Buffer.from(this.sign(r));
    const given = Buffer.from(sig);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  async initialize(onRejected: (rejected: RejectedCredential[]) => void): Promise<void> {
    this.trusted.clear();
    const rejected: RejectedCredential[] = [];
    for (const row of this.db.prepare('SELECT * FROM auth_credentials ORDER BY created_at, id').all() as Row[]) {
      const wellFormed = typeof row.id === 'string' && typeof row.username === 'string' && KINDS.has(row.kind)
        && typeof row.subject === 'string' && typeof row.secret === 'string' && typeof row.created_at === 'string';
      if (!wellFormed) { rejected.push({ row: { id: row.id, username: row.username }, reason: 'malformed' }); continue; }
      const record = toRecord(row);
      if (row.sig === '') { rejected.push({ row: { id: record.id, username: record.username, kind: record.kind, label: record.label }, reason: 'unsigned' }); continue; }
      if (!this.signedBy(record, row.sig)) { rejected.push({ row: { id: record.id, username: record.username, kind: record.kind, label: record.label }, reason: 'bad-signature' }); continue; }
      this.trusted.set(record.id, record);
    }
    this.rejected = rejected;
    if (rejected.length > 0) onRejected(rejected);
  }

  quarantined(): RejectedCredential[] {
    return [...this.rejected];
  }

  async list(username: string): Promise<CredentialRecord[]> {
    return [...this.trusted.values()].filter((r) => r.username === username).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async get(id: string): Promise<CredentialRecord | null> {
    return this.trusted.get(id) ?? null;
  }

  async add(record: CredentialRecord): Promise<void> {
    if (this.trusted.has(record.id)) throw new Error('credentials store: duplicate id');
    if (this.findBySubject(record.kind, record.subject)) throw new Error('credentials store: that credential is already registered');
    this.db.prepare('INSERT INTO auth_credentials (id, username, kind, subject, secret, label, created_at, last_used_at, sig) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(record.id, record.username, record.kind, record.subject, record.secret, record.label, record.createdAt, record.lastUsedAt ?? null, this.sign(record));
    this.trusted.set(record.id, { ...record });
  }

  async remove(id: string): Promise<boolean> {
    if (!this.trusted.has(id)) return false;
    this.db.prepare('DELETE FROM auth_credentials WHERE id = ?').run(id);
    this.trusted.delete(id);
    return true;
  }

  findBySubject(kind: CredentialKind, subject: string): CredentialRecord | null {
    for (const r of this.trusted.values()) if (r.kind === kind && r.subject === subject) return { ...r };
    return null;
  }

  async touch(id: string, at: string, secret?: string): Promise<void> {
    const current = this.trusted.get(id);
    if (!current) return;
    this.save({ ...current, lastUsedAt: at, ...(secret !== undefined ? { secret } : {}) });
  }

  async relabel(id: string, label: string): Promise<boolean> {
    const current = this.trusted.get(id);
    if (!current) return false;
    this.save({ ...current, label });
    return true;
  }

  /** Every change is re-signed: a row's signature always covers what is on disk now. */
  private save(next: CredentialRecord): void {
    this.db.prepare('UPDATE auth_credentials SET secret = ?, label = ?, last_used_at = ?, sig = ? WHERE id = ?')
      .run(next.secret, next.label, next.lastUsedAt ?? null, this.sign(next), next.id);
    this.trusted.set(next.id, next);
  }
}
