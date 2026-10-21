import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildAddonHost, openAddonTestDatabase, formatters } from '@jwilleke/ngdpbase-types/testing';
import type { Decision } from '@jwilleke/ngdpbase-types';
import { PHR_MIGRATIONS, PHR_LEDGER_TABLE } from '../managers/migrations.js';
import { PhrRecordStore, type Db } from '../managers/PhrRecordStore.js';
import { PhrManager } from '../managers/PhrManager.js';
import { createPhrRecordsPlugin } from '../plugins/PhrRecordsPlugin.js';
import { kindName, recordDate, recordName, recordValue } from '../display.js';
import { PHR_ENABLED, type UserManagerLike } from '../preferences.js';
import { SYNTHETIC_RECORDS } from '../dev/seedSynthetic.js';

const defaults = JSON.parse(readFileSync(new URL('../config/default-config.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const allowAll = async (): Promise<Decision> => ({ permit: true, applicable: true, reason: 'test-allow' });
const usersOn = (...names: string[]): UserManagerLike => ({
  async getUser(u) { return names.includes(u) ? { preferences: { [PHR_ENABLED]: true } } : { preferences: {} }; },
  async updateUser() { return undefined; }
});

describe('plain-language display, nothing guessed', () => {
  it('names kinds the way people do', () => {
    expect(kindName('Observation', 2)).toBe('lab results and measurements');
    expect(kindName('Condition', 1)).toBe('condition');
    expect(kindName('ServiceRequest', 3)).toBe('service request');
  });

  it('reads name, date and value only where the record states them', () => {
    const r = SYNTHETIC_RECORDS.find((x) => x.id === 'syn-glucose-2021')!;
    expect(recordName(r)).toBe('Glucose');
    expect(recordDate(r)).toBe('2021-05-20');
    expect(recordValue(r)).toBe('112 mg/dL');
    const blank = SYNTHETIC_RECORDS.find((x) => x.id === 'syn-unnamed')!;
    expect(recordName(blank)).toBeUndefined();
    expect(recordDate(blank)).toBeUndefined();
    expect(recordName({ resourceType: 'MedicationStatement', medicationCodeableConcept: { text: 'Metformin' } })).toBe('Metformin');
  });
});

describe('[{PhrRecords}]', () => {
  let db: Db & { close(): void };
  let phr: PhrManager;
  const page = (userContext: unknown, query: Record<string, string> = {}) => ({ pageName: 'My Health Records', linkGraph: {}, formatters, userContext, query });
  const alice = { username: 'alice', isAuthenticated: true, roles: ['reader'] };

  beforeEach(async () => {
    db = openAddonTestDatabase<Db & { close(): void }>('phr', { migrations: PHR_MIGRATIONS, ledgerTable: PHR_LEDGER_TABLE }, { slug: 'phr', defaults });
    const host = buildAddonHost('phr', defaults);
    const sink = { logAuditEvent: async () => 'id', flushAuditQueue: async () => {} };
    phr = new PhrManager({ store: new PhrRecordStore(db), decide: allowAll, recordAudit: (e) => host.recordAuditEvent(sink, e), host });
  });
  afterEach(() => db.close());

  it('says so when there are no records yet', async () => {
    const html = await createPhrRecordsPlugin(() => phr, () => usersOn('alice')).execute!(page(alice), {});
    expect(html).toContain("don't have any health records here yet");
  });

  it('shows what a person has by kind, their newest records, and "not stated" instead of guesses', async () => {
    for (const r of SYNTHETIC_RECORDS) await phr.write({ subject: alice as never, ipAddress: undefined, enforceDeny: async () => { throw new Error('no'); } }, r, 'synthetic');
    const html = await createPhrRecordsPlugin(() => phr, () => usersOn('alice')).execute!(page(alice), {});
    expect(html).toContain('lab results and measurements');
    expect(html).toContain('Hemoglobin A1c');
    expect(html).toContain('Name not stated');
    expect(html).not.toContain('Observation');
  });

  it('finds by words, and escapes what the person typed', async () => {
    for (const r of SYNTHETIC_RECORDS) await phr.write({ subject: alice as never, ipAddress: undefined, enforceDeny: async () => { throw new Error('no'); } }, r, 'synthetic');
    const plugin = createPhrRecordsPlugin(() => phr, () => usersOn('alice'));
    expect(await plugin.execute!(page(alice, { q: 'prediab' }), {})).toContain('Prediabetes');
    const evil = await plugin.execute!(page(alice, { q: '<script>alert(1)</script>' }), {});
    expect(evil).not.toContain('<script>');
    expect(evil).toContain('&lt;script&gt;');
  });

  it('shows nothing to someone signed out or with health records off', async () => {
    const plugin = createPhrRecordsPlugin(() => phr, () => usersOn('alice'));
    expect(await plugin.execute!(page(undefined), {})).toBe('');
    expect(await plugin.execute!(page({ username: 'bob', isAuthenticated: true }), {})).toBe('');
  });
});
