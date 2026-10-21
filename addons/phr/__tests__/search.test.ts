import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildAddonHost, openAddonTestDatabase } from '@jwilleke/ngdpbase-types/testing';
import type { Decision, PermissionSubject } from '@jwilleke/ngdpbase-types';
import { PHR_MIGRATIONS, PHR_LEDGER_TABLE } from '../managers/migrations.js';
import { PhrRecordStore, type Db } from '../managers/PhrRecordStore.js';
import { PhrManager, type PhrCaller } from '../managers/PhrManager.js';
import { indexEntries, stripResolveGuards, textFor, ftsQuery } from '../managers/fhirIndex.js';

// Synthetic records only.
const LOINC = 'http://loinc.org';
const glucose = (id: string, value: number, date: string) => ({
  resourceType: 'Observation', id, status: 'final',
  code: { coding: [{ system: LOINC, code: '2345-7', display: 'Glucose' }], text: 'Glucose' },
  subject: { reference: 'Patient/p1' }, effectiveDateTime: date,
  valueQuantity: { value, unit: 'mg/dL' }
});
const a1c = { resourceType: 'Observation', id: 'a1c-1', status: 'final', code: { coding: [{ system: LOINC, code: '4548-4' }], text: 'Hemoglobin A1c' }, subject: { reference: 'Patient/p1' }, effectiveDateTime: '2024-03-01' };
const condition = { resourceType: 'Condition', id: 'c1', code: { text: 'Prediabetes' }, subject: { reference: 'Patient/p1' } };

const defaults = JSON.parse(readFileSync(new URL('../config/default-config.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const allowAll = async (): Promise<Decision> => ({ permit: true, applicable: true, reason: 'test-allow' });
const caller = (username: string): PhrCaller => ({
  subject: { username, roles: ['reader'], isAuthenticated: true } as unknown as PermissionSubject,
  ipAddress: '127.0.0.1',
  enforceDeny: async (p: string) => { throw new Error(`refused ${p}`); }
});

describe('what phr indexes', () => {
  it('extracts FHIR search parameters: code (both forms), date, subject', () => {
    const entries = indexEntries(glucose('g1', 112, '2024-01-15'));
    const has = (code: string, value: string) => entries.some((e) => e.code === code && e.value === value);
    expect(has('code', '2345-7')).toBe(true);
    expect(has('code', `${LOINC}|2345-7`)).toBe(true);
    expect(has('date', '2024-01-15')).toBe(true);
    expect(has('subject', 'Patient/p1')).toBe(true);
  });

  it('indexes reference parameters guarded by resolve() (Condition.patient)', () => {
    expect(stripResolveGuards('Condition.subject.where(resolve() is Patient)')).toEqual({ expression: 'Condition.subject', allowedTypes: ['Patient'] });
    expect(indexEntries(condition).some((e) => e.code === 'patient' && e.value === 'Patient/p1')).toBe(true);
  });

  it('keeps a record\'s words, not its ids or codes', () => {
    const text = textFor(glucose('secret-id-123', 112, '2024-01-15'));
    expect(text).toContain('Glucose');
    expect(text).toContain('2024-01-15');
    expect(text).not.toContain('secret-id-123');
    expect(text).not.toContain('2345-7');
  });

  it('turns words into a safe full-text query', () => {
    expect(ftsQuery('Hemoglobin a1c')).toBe('"hemoglobin" AND "a1c"*');
    expect(ftsQuery('  ')).toBe('');
    expect(ftsQuery('a" OR 1=1 --')).toBe('"a" AND "or" AND "1" AND "1"*');
  });
});

describe('searching through PhrManager', () => {
  let db: Db & { close(): void };
  let phr: PhrManager;

  beforeEach(async () => {
    db = openAddonTestDatabase<Db & { close(): void }>('phr', { migrations: PHR_MIGRATIONS, ledgerTable: PHR_LEDGER_TABLE }, { slug: 'phr', defaults });
    const host = buildAddonHost('phr', defaults);
    const sink = { logAuditEvent: async () => 'id', flushAuditQueue: async () => {} };
    phr = new PhrManager({ store: new PhrRecordStore(db), decide: allowAll, recordAudit: (e) => host.recordAuditEvent(sink, e), host });
    for (const r of [glucose('g1', 112, '2024-01-15'), glucose('g2', 98, '2024-06-02'), a1c, condition]) await phr.write(caller('alice'), r, 'folder');
    await phr.write(caller('bob'), glucose('g9', 250, '2024-02-02'), 'folder');
  });
  afterEach(() => db.close());

  it('finds by code, either form', async () => {
    expect((await phr.search(caller('alice'), 'Observation', [{ code: 'code', operator: 'eq', value: '2345-7' }])).total).toBe(2);
    expect((await phr.search(caller('alice'), 'Observation', [{ code: 'code', operator: 'eq', value: `${LOINC}|4548-4` }])).records.map((r) => r.id)).toEqual(['a1c-1']);
  });

  it('filters by date range', async () => {
    const r = await phr.search(caller('alice'), 'Observation', [
      { code: 'code', operator: 'eq', value: '2345-7' },
      { code: 'date', operator: 'ge', value: '2024-03-01' }
    ]);
    expect(r.records.map((x) => x.id)).toEqual(['g2']);
  });

  it('never returns another person\'s records', async () => {
    const r = await phr.search(caller('alice'), 'Observation', [{ code: 'code', operator: 'eq', value: '2345-7' }]);
    expect(r.records.map((x) => x.id).sort()).toEqual(['g1', 'g2']);
    expect((await phr.search(caller('bob'), 'Observation', [{ code: 'code', operator: 'eq', value: '2345-7' }])).records.map((x) => x.id)).toEqual(['g9']);
    await expect(phr.search(caller('bob'), 'Observation', [], undefined, 'alice')).rejects.toThrow(/refused/);
  });

  it('finds records by words, only the owner\'s', async () => {
    expect((await phr.findText(caller('alice'), 'prediab')).map((r) => r.id)).toEqual(['c1']);
    expect((await phr.findText(caller('alice'), 'glucose')).map((r) => r.id).sort()).toEqual(['g1', 'g2']);
    expect((await phr.findText(caller('bob'), 'prediabetes'))).toEqual([]);
  });

  it('keeps the index in step with updates and removals', async () => {
    await phr.write(caller('alice'), { ...condition, code: { text: 'Hypertension' } }, 'folder');
    expect(await phr.findText(caller('alice'), 'prediabetes')).toEqual([]);
    expect((await phr.findText(caller('alice'), 'hypertension')).map((r) => r.id)).toEqual(['c1']);
    await phr.remove(caller('alice'), 'Observation', 'g1');
    expect((await phr.search(caller('alice'), 'Observation', [{ code: 'code', operator: 'eq', value: '2345-7' }])).records.map((r) => r.id)).toEqual(['g2']);
    expect((await phr.findText(caller('alice'), 'glucose')).map((r) => r.id)).toEqual(['g2']);
  });

  it('refuses an operator it doesn\'t support, rather than guessing', async () => {
    await expect(phr.search(caller('alice'), 'Observation', [{ code: 'code', operator: 'above' as never, value: 'x' }])).rejects.toMatchObject({ status: 400 });
  });
});
