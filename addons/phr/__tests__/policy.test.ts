import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const defaults = JSON.parse(readFileSync(new URL('../config/default-config.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const policies = defaults['ngdpbase.access.policies'] as Array<{ id: string; effect: string; subjects: { type: string; value: string }[]; actions: string[] }>;

describe("phr's access policy", () => {
  // Operator decision 2026-10-24 (ngdpbase#1539): a permission over a person's own
  // records goes to every person through the role vault-owner, never to site roles
  // and never to an `authenticated` subject. PhrManager still checks the owner.
  it('grants phr-read, phr-write and phr-delete to vault-owner, and to nothing else', () => {
    const phr = policies.filter((p) => p.actions.some((a) => a.startsWith('phr-')));
    expect(phr.map((p) => p.id)).toEqual(['phr-access']);
    expect(phr[0].effect).toBe('allow');
    expect(phr[0].subjects).toEqual([{ type: 'role', value: 'vault-owner' }]);
    expect([...phr[0].actions].sort()).toEqual(['phr-delete', 'phr-read', 'phr-write']);
  });
});
