import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { openAddonTestDatabase } from '@jwilleke/ngdpbase-types/testing';
import { PHR_MIGRATIONS, PHR_LEDGER_TABLE } from '../managers/migrations.js';
import { PhrRecordStore, StoreError, type Db } from '../managers/PhrRecordStore.js';

// Synthetic records only. phr keys records by identity @id, never username
// (ngdpbase identity model); rows written before are re-keyed once at start.
const defaults = JSON.parse(readFileSync(new URL('../config/default-config.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const glucose = { resourceType: 'Observation', id: 'o1', status: 'final', code: { text: 'Glucose' }, valueQuantity: { value: 99, unit: 'mg/dL' } };
const ALICE = 'urn:uuid:00000000-0000-4000-8000-00000000a11c';

describe('re-keying owners from username to identity @id', () => {
  let db: Db & { close(): void };
  let store: PhrRecordStore;
  beforeEach(() => {
    db = openAddonTestDatabase<Db & { close(): void }>('phr', { migrations: PHR_MIGRATIONS, ledgerTable: PHR_LEDGER_TABLE }, { slug: 'phr', defaults });
    store = new PhrRecordStore(db);
    const old = store.forOwner('alice');
    old.put(glucose, 'folder');
    old.put({ ...glucose, valueQuantity: { value: 101, unit: 'mg/dL' } }, 'folder');
  });
  afterEach(() => db.close());

  it('finds owners still keyed by username, and none once re-keyed', () => {
    expect(store.ownersNotKeyedById()).toEqual(['alice']);
    expect(store.rekeyOwner('alice', ALICE)).toBe(1);
    expect(store.ownersNotKeyedById()).toEqual([]);
  });

  it('moves records, history, the search index and the words to the @id, leaving nothing under the username', () => {
    store.rekeyOwner('alice', ALICE);
    const now = store.forOwner(ALICE);
    expect(now.read('Observation', 'o1')?.resource.valueQuantity).toEqual({ value: 101, unit: 'mg/dL' });
    expect(now.history('Observation', 'o1').length).toBe(2);
    expect(now.findText('glucose').map((r) => r.id)).toEqual(['o1']);
    const gone = store.forOwner('alice');
    expect(gone.read('Observation', 'o1')).toBeUndefined();
    expect(gone.findText('glucose')).toEqual([]);
  });

  it('re-keys only to an identity @id, and never merges into an @id that already holds records', () => {
    expect(() => store.rekeyOwner('alice', 'bob')).toThrow(StoreError);
    store.forOwner(ALICE).put({ ...glucose, id: 'o2' }, 'folder');
    expect(() => store.rekeyOwner('alice', ALICE)).toThrow(/not merged/);
    expect(store.forOwner('alice').read('Observation', 'o1')).toBeDefined();
  });
});
