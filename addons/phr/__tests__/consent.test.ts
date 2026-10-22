import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { PHR_CONSENT } from '../index.js';

// ngdpbase#1603: each document phr registers is one of its own pages, with
// the front matter ConsentManager reads (version, effective).
const frontMatter = (file: string): Record<string, string> => {
  const text = readFileSync(new URL(`../pages/${file}`, import.meta.url), 'utf8');
  const block = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
  return Object.fromEntries(block.split('\n').map((l) => l.match(/^([a-z-]+):\s*(.*)$/)).filter((m): m is RegExpMatchArray => m !== null).map((m) => [m[1], m[2]]));
};
const pages = readdirSync(new URL('../pages/', import.meta.url)).filter((f) => f.endsWith('.md'));

describe('phr\'s consent documents', () => {
  it('registers its own two documents, named phr-…', () => {
    expect(PHR_CONSENT.documents).toEqual(['phr-terms-of-service', 'phr-privacy-policy']);
    expect(PHR_CONSENT.paths).toContain('/api/phr');
  });

  for (const id of PHR_CONSENT.documents) {
    it(`${id} is a shipped page with a version and an effective date, edited by admins only`, () => {
      const file = pages.find((f) => frontMatter(f).slug === id);
      expect(file, id).toBeDefined();
      const fm = frontMatter(file!);
      expect(fm.version).toMatch(/^\d+$/);
      expect(fm.effective).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(fm['system-category']).toBe('addon');
      expect(readFileSync(new URL(`../pages/${file!}`, import.meta.url), 'utf8')).toMatch(/access:\n {2}edit: \[admin\]/);
    });
  }
});
