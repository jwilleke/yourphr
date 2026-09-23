import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The boundary that makes `src/sources` extractable later (yourphr#760).
 *
 * Asserted rather than documented, because a boundary nobody checks is a comment. If one of these
 * fails, the fix is to pass the thing in — not to relax the test.
 */
const dir = new URL('..', import.meta.url).pathname;
const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
const sources = files.map((f) => [f, readFileSync(join(dir, f), 'utf8')] as const);

describe('src/sources holds no PHI and owns no storage', () => {
  it('imports no records provider, repository or manager — it yields resources, the caller stores them', () => {
    for (const [name, text] of sources) {
      expect(text, name).not.toMatch(/from '.*(RecordsProvider|SqliteFhirRepository|RecordsManager|SourcesManager)/);
    }
  });

  it('never reaches for the database', () => {
    for (const [name, text] of sources) {
      expect(text, name).not.toMatch(/better-sqlite3|\.prepare\(|CREATE TABLE/);
    }
  });
});

describe('src/sources makes no unguarded outbound call', () => {
  it('uses the guarded capability from src/http, never the global fetch or node:http directly', () => {
    // Assembled, not written out: check-http-boundary.sh scans for the literal call and would
    // refuse this very file for naming what it forbids.
    const forbidden = new RegExp(`\\b${['fet', 'ch'].join('')}\\(|from 'node:https?'|require\\('node:https?'\\)`);
    for (const [name, text] of sources) {
      expect(text, name).not.toMatch(forbidden);
    }
  });

  it('accepts a caller-supplied guarded client rather than always building one', () => {
    const fetchTs = sources.find(([n]) => n === 'fetch.ts')![1];
    expect(fetchTs).toContain('options.http ?? new OutboundHttp');
  });
});

describe('src/sources has one entry point', () => {
  it('exports the SMART flow, the fetch, the query plan and the capability read from index.ts', () => {
    const index = sources.find(([n]) => n === 'index.ts')![1];
    for (const symbol of ['SmartClient', 'syncFrom', 'syncResource', 'categorySearches', 'readCapability', 'FhirHttpError']) {
      expect(index, symbol).toContain(symbol);
    }
  });
});
