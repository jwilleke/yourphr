/**
 * The store door (the lint, as a test so it runs everywhere the tests run):
 * only managers/PhrRecordStore.ts and managers/migrations.ts may hold SQL or
 * talk to the database driver. Everything else goes through PhrManager. The one
 * other: migrate/YourphrSourceStore.ts, read-only SELECTs on yourPHR's old
 * records.db for the move into phr (yourphr#969), never phr.db.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const allowed = new Set(['managers/PhrRecordStore.ts', 'managers/migrations.ts', 'migrate/YourphrSourceStore.ts']);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (['node_modules', '__tests__'].includes(name)) return [];
    if (statSync(full).isDirectory()) return sources(full);
    return name.endsWith('.ts') && !name.endsWith('.d.ts') ? [full] : [];
  });
}

const sqlPatterns = [/\.prepare\s*\(/, /\.exec\s*\(/, /better-sqlite3/, /\b(SELECT|INSERT|UPDATE|DELETE)\b[\s\S]{0,40}\b(FROM|INTO|SET)\b/, /openAddonDatabase/];

describe('the store door', () => {
  it('keeps SQL and the database driver inside the store', () => {
    const offenders = sources(root)
      .map((f) => relative(root, f))
      .filter((f) => !allowed.has(f))
      .filter((f) => sqlPatterns.some((p) => p.test(readFileSync(join(root, f), 'utf8'))));
    expect(offenders).toEqual([]);
  });
});
