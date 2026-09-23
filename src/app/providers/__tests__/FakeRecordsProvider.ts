/**
 * An in-memory records provider (yourphr#610): what a manager is unit-tested over. It implements
 * the whole BaseRecordsProvider contract on Maps so a RecordsManager spec runs in milliseconds
 * with no SQLite — and it is the second implementation of the interface, which is the test the
 * architecture doc sets for a provider: someone could plausibly swap it.
 */
import type { Bundle, Resource } from '@medplum/fhirtypes';
import type { SearchRequest, WithId } from '@medplum/core';
import { textFor } from '../record-text.js';
import { BaseRecordsProvider, type IndexCondition, type RecordsWriter, type StoredRecord } from '../BaseRecordsProvider.js';

interface Row extends StoredRecord { userId: string; versions: number; firstSeen: string }

export class FakeRecordsProvider extends BaseRecordsProvider {
  readonly rows = new Map<string, Row>();
  initialized = false;
  closed = false;
  released: string[] = [];
  backups: { destination: string; key: string }[] = [];
  private clock = 0;

  private key(userId: string, type: string, id: string): string { return `${userId}|${type}|${id}`; }
  private tick(): string { this.clock++; return `2026-01-01T00:00:${String(this.clock).padStart(2, '0')}Z`; }
  private mine(userId: string): Row[] { return [...this.rows.values()].filter((r) => r.userId === userId); }

  /** Seed straight into the store — what a test does before asking the manager. */
  seed(userId: string, sourceId: string, resource: Resource): void {
    const at = this.tick();
    this.rows.set(this.key(userId, resource.resourceType, resource.id ?? ''), { userId, resourceType: resource.resourceType, id: resource.id ?? '', sourceId, lastUpdated: at, resource, versions: 1, firstSeen: at });
  }

  async initialize(): Promise<void> { this.initialized = true; }
  async close(): Promise<void> { this.closed = true; }

  async search<T extends Resource>(userId: string, request: SearchRequest<T>): Promise<Bundle<WithId<T>>> {
    const entry = this.mine(userId).filter((r) => r.resourceType === request.resourceType).slice(0, request.count ?? 20).map((r) => ({ resource: r.resource as WithId<T> }));
    return { resourceType: 'Bundle', type: 'searchset', total: entry.length, entry };
  }
  async read(userId: string, resourceType: string, id: string): Promise<StoredRecord | undefined> { return this.rows.get(this.key(userId, resourceType, id)); }
  async readById(userId: string, id: string): Promise<StoredRecord | undefined> { return this.mine(userId).find((r) => r.id === id); }
  async list(userId: string, filter: { resourceType?: string; sourceId?: string } = {}): Promise<StoredRecord[]> {
    return this.mine(userId).filter((r) => (filter.resourceType === undefined || r.resourceType === filter.resourceType) && (filter.sourceId === undefined || r.sourceId === filter.sourceId));
  }
  async countByType(userId: string, sourceId?: string): Promise<{ resourceType: string; count: number }[]> {
    const counts = new Map<string, number>();
    for (const r of await this.list(userId, sourceId === undefined ? {} : { sourceId })) counts.set(r.resourceType, (counts.get(r.resourceType) ?? 0) + 1);
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([resourceType, count]) => ({ resourceType, count }));
  }
  async typesHeld(userId: string): Promise<string[]> { return [...new Set(this.mine(userId).map((r) => r.resourceType))].sort(); }
  async sourceOf(userId: string, resourceType: string): Promise<Map<string, string>> { return new Map(this.mine(userId).filter((r) => r.resourceType === resourceType).map((r) => [r.id, r.sourceId])); }
  async history(userId: string, resourceType: string, id: string): Promise<{ firstReceivedAt: string | null; versions: number }> {
    const r = this.rows.get(this.key(userId, resourceType, id));
    return r ? { firstReceivedAt: r.firstSeen, versions: r.versions } : { firstReceivedAt: null, versions: 0 };
  }
  /** Token values as the real index holds them: "code" and "system|code" per coding; text lowercased. */
  private indexValues(resource: Resource, param: string): string[] {
    const value = (resource as unknown as Record<string, unknown>)[param];
    const out: string[] = [];
    const ccs = Array.isArray(value) ? value : value ? [value] : [];
    for (const cc of ccs as Record<string, unknown>[]) {
      for (const c of (cc['coding'] ?? []) as { system?: string; code?: string }[]) { if (c.code) { out.push(c.code); if (c.system) out.push(`${c.system}|${c.code}`); } }
      if (typeof cc['text'] === 'string') out.push(cc['text'].toLowerCase());
    }
    return out;
  }
  async indexedSearch(userId: string, resourceType: string, where: IndexCondition[]): Promise<StoredRecord[]> {
    return this.mine(userId).filter((r) => r.resourceType === resourceType && where.every((cond) => {
      const values = this.indexValues(r.resource, cond.param);
      return cond.alternatives.map((a) => a.trim()).filter(Boolean).some((a) => (a.endsWith('|') ? values.some((v) => v.startsWith(a)) : values.includes(a)));
    }));
  }
  async indexedValues(userId: string, resourceType: string, id: string, param: string): Promise<string[]> {
    const r = this.rows.get(this.key(userId, resourceType, id));
    return r ? this.indexValues(r.resource, param).filter((v) => v.includes('|')) : [];
  }
  async textSearch(userId: string, q: string, page: { limit: number; offset: number }): Promise<{ resourceType: string; id: string; snippet: string }[]> {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];
    return this.mine(userId)
      .map((r) => ({ r, text: textFor(r.resource).toLowerCase() }))
      .filter(({ text }) => terms.every((t) => text.includes(t)))
      .slice(page.offset, page.offset + page.limit)
      .map(({ r, text }) => ({ resourceType: r.resourceType, id: r.id, snippet: text.slice(0, 60) }));
  }

  /** References found anywhere in the stored JSON — what the search index holds for reference parameters. */
  private refsOf(resource: unknown, out = new Set<string>()): Set<string> {
    if (Array.isArray(resource)) resource.forEach((v) => this.refsOf(v, out));
    else if (resource && typeof resource === 'object') {
      const o = resource as Record<string, unknown>;
      if (typeof o['reference'] === 'string' && /^[A-Z][A-Za-z]+\/[A-Za-z0-9.-]+$/.test(o['reference'])) out.add(o['reference']);
      Object.values(o).forEach((v) => this.refsOf(v, out));
    }
    return out;
  }
  async referencesFrom(userId: string, resourceType: string, id: string): Promise<string[]> {
    const r = this.rows.get(this.key(userId, resourceType, id));
    return r ? [...this.refsOf(r.resource)] : [];
  }
  async referencedBy(userId: string, reference: string): Promise<{ resourceType: string; id: string }[]> {
    return this.mine(userId).filter((r) => this.refsOf(r.resource).has(reference)).map((r) => ({ resourceType: r.resourceType, id: r.id }));
  }

  writer(userId: string, sourceId: string): RecordsWriter {
    return {
      upsert: async (resource) => {
        const k = this.key(userId, resource.resourceType, resource.id ?? '');
        const existing = this.rows.get(k);
        if (existing && existing.sourceId !== sourceId) throw new Error(`cross-source id collision: ${resource.resourceType}/${resource.id} is held from source ${existing.sourceId}`);
        const at = this.tick();
        this.rows.set(k, { userId, resourceType: resource.resourceType, id: resource.id ?? '', sourceId, lastUpdated: at, resource, versions: (existing?.versions ?? 0) + 1, firstSeen: existing?.firstSeen ?? at });
        return existing ? 'updated' : 'created';
      },
      exists: async (resourceType, id) => this.rows.has(this.key(userId, resourceType, id)),
    };
  }
  async removeBySource(userId: string, sourceId: string): Promise<number> {
    let n = 0;
    for (const [k, r] of this.rows) if (r.userId === userId && r.sourceId === sourceId) { this.rows.delete(k); n++; }
    return n;
  }
  async removeRecord(userId: string, resourceType: string, id: string): Promise<boolean> {
    return this.rows.delete(this.key(userId, resourceType, id));
  }
  async removeAll(userId: string): Promise<number> {
    let n = 0;
    for (const [k, r] of this.rows) if (r.userId === userId) { this.rows.delete(k); n++; }
    return n;
  }
  async release(userId: string): Promise<void> { this.released.push(userId); }
  async integrityOk(): Promise<boolean> { return true; }
  storage(): { location: string; sizeBytes: number } { return { location: ':memory:', sizeBytes: 0 }; }
  async backup(options: { destination: string; key: string }): Promise<{ file: string; sizeBytes: number; pruned: string[] }> {
    this.backups.push({ destination: options.destination, key: options.key });
    return { file: `${options.destination}/fake.db`, sizeBytes: this.rows.size, pruned: [] };
  }
  staged: { backupFile: string; backupKey: string }[] = [];
  async stageRestore(backupFile: string, backupKey: string): Promise<{ tables: number }> {
    this.staged.push({ backupFile, backupKey });
    return { tables: 3 };
  }
}
