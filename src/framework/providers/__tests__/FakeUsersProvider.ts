/** An in-memory users provider (yourphr#611): what the Users and Sessions managers are unit-tested over. */
import { BaseUsersProvider, type UserRecord } from '../BaseUsersProvider.js';

export class FakeUsersProvider extends BaseUsersProvider {
  /**
   * Write a role name straight into storage, past the manager's validation (yourphr#648). Only a
   * test needs this: it is how a role deleted from the configuration after the account was created
   * is reproduced, which is the case the resolution rule exists for.
   */
  async setRoleForTest(username: string, role: string): Promise<void> {
    const record = this.rows.get(username);
    if (record) this.rows.set(username, { ...record, role });
  }

  readonly rows = new Map<string, UserRecord>();
  initialized = false;
  async initialize(): Promise<void> { this.initialized = true; }
  async create(record: Omit<UserRecord, 'createdAt' | 'email' | 'isTest'> & { createdAt?: string; email?: string; isTest?: boolean }): Promise<void> {
    if (this.rows.has(record.username)) throw new Error('UNIQUE constraint failed: auth_users.username');
    this.rows.set(record.username, { ...record, createdAt: record.createdAt ?? '2026-01-01T00:00:00Z', email: record.email ?? '', isTest: record.isTest === true });
  }
  async get(username: string): Promise<UserRecord | undefined> { return this.rows.get(username); }
  async list(): Promise<UserRecord[]> { return [...this.rows.values()]; }
  async count(): Promise<number> { return this.rows.size; }
  async setPasswordHash(username: string, hash: string, bumpGeneration: boolean): Promise<boolean> {
    const r = this.rows.get(username);
    if (!r) return false;
    r.passwordHash = hash;
    if (bumpGeneration) r.tokenGeneration++;
    return true;
  }
  async bumpGeneration(username: string): Promise<void> { const r = this.rows.get(username); if (r) r.tokenGeneration++; }
  async delete(username: string): Promise<boolean> { return this.rows.delete(username); }
  async setEmail(username: string, email: string): Promise<boolean> {
    const r = this.rows.get(username);
    if (!r) return false;
    r.email = email;
    return true;
  }
  async setTest(username: string, isTest: boolean): Promise<boolean> {
    const r = this.rows.get(username);
    if (!r) return false;
    r.isTest = isTest;
    return true;
  }
  readonly consent = new Map<string, string>();
  async consentAcceptedAt(username: string): Promise<string> { return this.consent.get(username) ?? ''; }
  async setConsentAcceptedAt(username: string, acceptedAt: string): Promise<void> { this.consent.set(username, acceptedAt); }
}
