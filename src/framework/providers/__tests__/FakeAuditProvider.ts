/** An in-memory audit provider for the manager specs; `healthy`/`failWrites` script the refusals. */
import { BaseAuditProvider, type AccessEvent } from '../BaseAuditProvider.js';

export class FakeAuditProvider extends BaseAuditProvider {
  rows = new Map<string, AccessEvent & { owner: string }>();
  initialized = false;
  healthy = true;
  failWrites = false;
  async initialize(): Promise<void> { this.initialized = true; }
  async healthCheck(): Promise<boolean> { return this.healthy; }
  private key(owner: string, actor: string, category: string, day: string): string { return `${owner}|${actor}|${category}|${day}`; }
  async record(owner: string, actor: string, category: string, at: Date): Promise<void> {
    if (this.failWrites) throw new Error('audit sink unavailable');
    const iso = at.toISOString();
    const day = iso.slice(0, 10);
    const k = this.key(owner, actor, category, day);
    const r = this.rows.get(k);
    if (r) { r.count++; r.last_at = iso; } else this.rows.set(k, { owner, actor_username: actor, category, day, count: 1, first_at: iso, last_at: iso });
  }
  async importEvent(owner: string, e: AccessEvent): Promise<boolean> {
    const k = this.key(owner, e.actor_username, e.category, e.day);
    if (this.rows.has(k)) return false;
    this.rows.set(k, { owner, ...e });
    return true;
  }
  async list(owner: string): Promise<AccessEvent[]> {
    return [...this.rows.values()].filter((r) => r.owner === owner).sort((a, b) => b.day.localeCompare(a.day) || b.last_at.localeCompare(a.last_at) || a.category.localeCompare(b.category))
      .map(({ owner: _o, ...e }) => e);
  }
  async removeForOwner(owner: string): Promise<void> { for (const [k, r] of this.rows) if (r.owner === owner) this.rows.delete(k); }
  async trim(owner: string, beforeDay: string, keepCategory: string): Promise<number> {
    let n = 0;
    for (const [k, r] of this.rows) if (r.owner === owner && r.day < beforeDay && r.category !== keepCategory) { this.rows.delete(k); n++; }
    return n;
  }
}
