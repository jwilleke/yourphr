import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { openAddonTestDatabase } from '@jwilleke/ngdpbase-types/testing';
import { PHR_MIGRATIONS, PHR_LEDGER_TABLE } from '../managers/migrations.js';
import { PhrRecordStore, type Db } from '../managers/PhrRecordStore.js';
import { ownerKey, ownTextQuery } from '../managers/fhirIndex.js';

// yourphr#912: a user's word search matches their own rows only.
const defaults = JSON.parse(readFileSync(new URL('../config/default-config.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const note = (id: string, text: string) => ({ resourceType: 'Observation', id, status: 'final', code: { text } });

describe('word search reads only the searcher\'s own text', () => {
  it('gives every owner one token that no other owner shares', () => {
    expect(ownerKey('al')).not.toBe(ownerKey('alice'));
    expect(ownerKey('alice')).toMatch(/^k[0-9a-f]{32}$/);
    expect(ownTextQuery('alice', 'glucose')).toBe(`owner_key : "${ownerKey('alice')}" AND body : ("glucose"*)`);
    expect(ownTextQuery('alice', '  ')).toBe('');
  });

  it('finds the same word for each user in their own records only', () => {
    const db = openAddonTestDatabase<Db & { close(): void }>('phr', { migrations: PHR_MIGRATIONS, ledgerTable: PHR_LEDGER_TABLE }, { slug: 'phr', defaults });
    const store = new PhrRecordStore(db);
    store.forOwner('alice').put(note('a1', 'Glucose fasting'), 'test');
    store.forOwner('al').put(note('x1', 'Glucose random'), 'test');
    store.forOwner('al').put(note('x2', 'Glucose tolerance'), 'test');
    expect(store.forOwner('alice').findText('glucose').map((r) => r.id)).toEqual(['a1']);
    expect(store.forOwner('al').findText('glucose').map((r) => r.id).sort()).toEqual(['x1', 'x2']);
    expect(store.forOwner('bob').findText('glucose')).toEqual([]);
    db.close();
  });

  it('the migration keeps existing text, each row under its owner\'s key', () => {
    const before = PHR_MIGRATIONS.filter((m) => m.id < '20261022000000');
    const db = openAddonTestDatabase<Db & { close(): void } & { exec(sql: string): void }>('phr', { migrations: before, ledgerTable: PHR_LEDGER_TABLE }, { slug: 'phr', defaults });
    db.prepare('INSERT INTO phr_search_text (rowid, owner, resource_type, resource_id, body) VALUES (7, ?, ?, ?, ?)').run('alice', 'Observation', 'a1', 'glucose fasting');
    db.prepare(`INSERT INTO phr_resources (owner, resource_type, id, source_id, version_id, last_updated, deleted, content)
                VALUES ('alice', 'Observation', 'a1', 'test', '1', '2026-10-22T00:00:00Z', 0, ?)`).run(JSON.stringify(note('a1', 'Glucose fasting')));
    db.prepare('INSERT INTO phr_text_rowids (owner, resource_type, resource_id, text_rowid) VALUES (?, ?, ?, 7)').run('alice', 'Observation', 'a1');
    const migration = PHR_MIGRATIONS.find((m) => m.id === '20261022000000');
    migration!.up(db as never);
    const row = db.prepare('SELECT rowid AS rowid, owner_key FROM phr_search_text').get() as { rowid: number; owner_key: string };
    expect(row).toEqual({ rowid: 7, owner_key: ownerKey('alice') });
    expect(new PhrRecordStore(db).forOwner('alice').findText('glucose').map((r) => r.id)).toEqual(['a1']);
    db.close();
  });
});
