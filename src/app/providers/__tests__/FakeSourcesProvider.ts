/** An in-memory sources provider for the manager specs. */
import { BaseSourcesProvider, type ConnectedSource, type DynamicClient, type NewSource } from '../BaseSourcesProvider.js';

export class FakeSourcesProvider extends BaseSourcesProvider {
  rows = new Map<number, ConnectedSource>();
  clients = new Map<number, DynamicClient>();
  initialized = false;
  private nextId = 1;
  async initialize(): Promise<void> { this.initialized = true; }
  async add(source: NewSource): Promise<ConnectedSource> {
    const row: ConnectedSource = { ...source, id: this.nextId++, lastSyncAt: 0, platformType: source.platformType ?? '', environment: source.environment ?? '', capability: source.capability ?? '' };
    this.rows.set(row.id, row);
    return { ...row };
  }
  async byId(id: number): Promise<ConnectedSource | undefined> { const r = this.rows.get(id); return r ? { ...r } : undefined; }
  async list(): Promise<ConnectedSource[]> { return [...this.rows.values()].map((r) => ({ ...r })); }
  async count(): Promise<number> { return this.rows.size; }
  private patch(id: number, change: Partial<ConnectedSource>): void { const r = this.rows.get(id); if (r) this.rows.set(id, { ...r, ...change }); }
  async clearTokens(id: number): Promise<void> { this.patch(id, { accessToken: '', refreshToken: '', expiresAt: 0 }); }
  async updateCapability(id: number, capability: string): Promise<void> { this.patch(id, { capability }); }
  async updateTokenUrl(id: number, tokenUrl: string): Promise<void> { this.patch(id, { tokenUrl }); }
  async updateTokens(id: number, accessToken: string, refreshToken: string, expiresAt: number): Promise<void> { this.patch(id, { accessToken, refreshToken, expiresAt }); }
  async markSynced(id: number, at: number): Promise<void> { this.patch(id, { lastSyncAt: at }); }
  async remove(id: number): Promise<void> { this.rows.delete(id); this.clients.delete(id); }
  async saveDynamicClient(sourceId: number, client: DynamicClient): Promise<void> { this.clients.set(sourceId, client); }
  async dynamicClientFor(sourceId: number): Promise<DynamicClient | undefined> { return this.clients.get(sourceId); }
}
