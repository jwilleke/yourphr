/** The connected_sources and dynamic_clients tables in the app database (yourphr#612). */
import type Database from 'better-sqlite3-multiple-ciphers';
import { BaseSourcesProvider, type ConnectedSource, type DynamicClient, type NewSource } from './BaseSourcesProvider.js';

export class SqliteSourcesProvider extends BaseSourcesProvider {
  constructor(private readonly db: InstanceType<typeof Database>) {
    super();
    db.exec(`CREATE TABLE IF NOT EXISTS connected_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      display TEXT NOT NULL,
      fhir_base_url TEXT NOT NULL,
      token_url TEXT NOT NULL,
      client_id TEXT NOT NULL,
      patient TEXT NOT NULL,
      resource_types TEXT NOT NULL,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL DEFAULT '',
      expires_at INTEGER NOT NULL DEFAULT 0,
      platform_type TEXT NOT NULL DEFAULT '',
      environment TEXT NOT NULL DEFAULT '',
      last_sync_at INTEGER NOT NULL DEFAULT 0,
      capability TEXT NOT NULL DEFAULT ''
    )`);
    db.exec(`CREATE TABLE IF NOT EXISTS dynamic_clients (
      source_id INTEGER PRIMARY KEY,
      client_id TEXT NOT NULL,
      client_secret TEXT NOT NULL DEFAULT '',
      registration_access_token TEXT NOT NULL DEFAULT '',
      registration_client_uri TEXT NOT NULL DEFAULT '',
      registered_at TEXT NOT NULL
    )`);
  }

  async initialize(): Promise<void> { /* schema ensured in the constructor */ }

  private toSource(r: Record<string, unknown>): ConnectedSource {
    return {
      id: r['id'] as number, userId: r['user_id'] as string, display: r['display'] as string, fhirBaseUrl: r['fhir_base_url'] as string,
      tokenUrl: r['token_url'] as string, clientId: r['client_id'] as string, patient: r['patient'] as string,
      resourceTypes: (r['resource_types'] as string).split(',').filter(Boolean), accessToken: r['access_token'] as string,
      refreshToken: r['refresh_token'] as string, expiresAt: r['expires_at'] as number, lastSyncAt: r['last_sync_at'] as number,
      platformType: (r['platform_type'] as string | undefined) ?? '', environment: (r['environment'] as string | undefined) ?? '',
      capability: (r['capability'] as string | undefined) ?? '',
    };
  }

  async add(source: NewSource): Promise<ConnectedSource> {
    const info = this.db
      .prepare(`INSERT INTO connected_sources (user_id, display, fhir_base_url, token_url, client_id, patient, resource_types, access_token, refresh_token, expires_at, platform_type, environment)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(source.userId, source.display, source.fhirBaseUrl, source.tokenUrl, source.clientId, source.patient, source.resourceTypes.join(','),
        source.accessToken, source.refreshToken, source.expiresAt, source.platformType ?? '', source.environment ?? '');
    return (await this.byId(Number(info.lastInsertRowid)))!;
  }

  async byId(id: number): Promise<ConnectedSource | undefined> {
    const r = this.db.prepare('SELECT * FROM connected_sources WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return r ? this.toSource(r) : undefined;
  }

  async list(): Promise<ConnectedSource[]> {
    return (this.db.prepare('SELECT * FROM connected_sources ORDER BY id').all() as Record<string, unknown>[]).map((r) => this.toSource(r));
  }

  async count(): Promise<number> {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM connected_sources').get() as { n: number }).n;
  }

  async clearTokens(id: number): Promise<void> {
    this.db.prepare("UPDATE connected_sources SET access_token = '', refresh_token = '', expires_at = 0 WHERE id = ?").run(id);
  }

  /** The distilled CapabilityStatement (yourphr#756). '' means never read, or read and unusable. */
  async updateCapability(id: number, capability: string): Promise<void> {
    this.db.prepare('UPDATE connected_sources SET capability = ? WHERE id = ?').run(capability, id);
  }

  async updateTokenUrl(id: number, tokenUrl: string): Promise<void> {
    this.db.prepare('UPDATE connected_sources SET token_url = ? WHERE id = ?').run(tokenUrl, id);
  }

  async updateTokens(id: number, accessToken: string, refreshToken: string, expiresAt: number): Promise<void> {
    this.db.prepare('UPDATE connected_sources SET access_token = ?, refresh_token = ?, expires_at = ? WHERE id = ?').run(accessToken, refreshToken, expiresAt, id);
  }

  async markSynced(id: number, at: number): Promise<void> {
    this.db.prepare('UPDATE connected_sources SET last_sync_at = ? WHERE id = ?').run(at, id);
  }

  async remove(id: number): Promise<void> {
    this.db.prepare('DELETE FROM dynamic_clients WHERE source_id = ?').run(id);
    this.db.prepare('DELETE FROM connected_sources WHERE id = ?').run(id);
  }

  async saveDynamicClient(sourceId: number, client: DynamicClient): Promise<void> {
    this.db
      .prepare(`INSERT INTO dynamic_clients (source_id, client_id, client_secret, registration_access_token, registration_client_uri, registered_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(source_id) DO UPDATE SET client_id=excluded.client_id, client_secret=excluded.client_secret,
                  registration_access_token=excluded.registration_access_token, registration_client_uri=excluded.registration_client_uri, registered_at=excluded.registered_at`)
      .run(sourceId, client.clientId, client.clientSecret, client.registrationAccessToken, client.registrationClientUri, new Date().toISOString());
  }

  async dynamicClientFor(sourceId: number): Promise<DynamicClient | undefined> {
    const row = this.db.prepare('SELECT * FROM dynamic_clients WHERE source_id = ?').get(sourceId) as Record<string, string> | undefined;
    return row ? { clientId: row['client_id'] ?? '', clientSecret: row['client_secret'] ?? '', registrationAccessToken: row['registration_access_token'] ?? '', registrationClientUri: row['registration_client_uri'] ?? '' } : undefined;
  }
}
