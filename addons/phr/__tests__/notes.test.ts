import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildAddonHost, openAddonTestDatabase, formatters } from '@jwilleke/ngdpbase-types/testing';
import type { Decision, PermissionSubject } from '@jwilleke/ngdpbase-types';
import { PHR_MIGRATIONS, PHR_LEDGER_TABLE } from '../managers/migrations.js';
import { PhrRecordStore, type Db } from '../managers/PhrRecordStore.js';
import { PhrManager, type PhrCaller } from '../managers/PhrManager.js';
import { createPhrRecordsPlugin } from '../plugins/PhrRecordsPlugin.js';
import { healthRecordsOnFor } from '../preferences.js';
import { PGHD_TAG, isPatientNote, noteText } from '../managers/notes.js';

const defaults = JSON.parse(readFileSync(new URL('../config/default-config.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const allowAll = async (): Promise<Decision> => ({ permit: true, applicable: true, reason: 'test-allow' });
const caller = (username: string, actingFor?: string): PhrCaller => ({
  subject: { username: actingFor ?? username, roles: ['reader'], isAuthenticated: true, ...(actingFor ? { viaProxy: { actor: username } } : {}) } as unknown as PermissionSubject,
  ipAddress: undefined,
  enforceDeny: async (p: string) => { throw new Error(`refused ${p}`); }
});
const a1c = { resourceType: 'Observation', id: 'a1c', status: 'final', code: { text: 'Hemoglobin A1c' }, effectiveDateTime: '2024-09-03', valueQuantity: { value: 5.8, unit: '%' } };

describe('a person\'s notes about their records', () => {
  let db: Db & { close(): void };
  let audit: Record<string, unknown>[];
  let phr: PhrManager;

  beforeEach(async () => {
    db = openAddonTestDatabase<Db & { close(): void }>('phr', { migrations: PHR_MIGRATIONS, ledgerTable: PHR_LEDGER_TABLE }, { slug: 'phr', defaults });
    audit = [];
    const host = buildAddonHost('phr', defaults);
    const sink = { logAuditEvent: async (e: Record<string, unknown>) => { audit.push(e); return 'id'; }, flushAuditQueue: async () => {} };
    phr = new PhrManager({ store: new PhrRecordStore(db), decide: allowAll, recordAudit: (e) => host.recordAuditEvent(sink, e), host, optedIn: async () => null, identityOf: async (c) => `urn:test:${c.username}` });
    await phr.write(caller('alice'), a1c, 'epic');
  });
  afterEach(() => db.close());

  it('stores a note as its own patient-entered record, leaving the hospital\'s record untouched', async () => {
    const note = await phr.addNote(caller('alice'), { resourceType: 'Observation', id: 'a1c' }, '  Ask Dr. X about this  ');
    expect(note.resourceType).toBe('Communication');
    expect(isPatientNote(note.resource)).toBe(true);
    expect((note.resource.meta as { tag: unknown[] }).tag).toContainEqual(PGHD_TAG);
    expect(noteText(note.resource)).toBe('Ask Dr. X about this');
    expect(note.sourceId).toBe('patient');
    const original = await phr.read(caller('alice'), 'Observation', 'a1c');
    expect(original?.versionId).toBe('1');
    expect(original?.resource.note).toBeUndefined();
  });

  it('refuses a note on a record that isn\'t yours or doesn\'t exist, and empty or huge notes', async () => {
    await expect(phr.addNote(caller('bob'), { resourceType: 'Observation', id: 'a1c' }, 'hi', 'alice')).rejects.toThrow(/refused/);
    await expect(phr.addNote(caller('bob'), { resourceType: 'Observation', id: 'a1c' }, 'hi')).rejects.toMatchObject({ status: 404 });
    await expect(phr.addNote(caller('alice'), { resourceType: 'Observation', id: 'a1c' }, '   ')).rejects.toMatchObject({ status: 400 });
    await expect(phr.addNote(caller('alice'), { resourceType: 'Observation', id: 'a1c' }, 'x'.repeat(2001))).rejects.toMatchObject({ status: 400 });
  });

  it('a proxy\'s note says who wrote it, and belongs to the person represented', async () => {
    const note = await phr.addNote(caller('jim', 'alice'), { resourceType: 'Observation', id: 'a1c' }, 'Brought this up at the visit');
    expect((note.resource.sender as { display: string }).display).toBe('jim');
    expect(JSON.stringify(note.resource.note)).toContain('acting for alice');
    expect((await phr.notes(caller('alice'))).get('Observation/a1c')).toHaveLength(1);
  });

  it('never puts the note\'s words in the audit record', async () => {
    await phr.addNote(caller('alice'), { resourceType: 'Observation', id: 'a1c' }, 'very private words');
    expect(JSON.stringify(audit)).not.toContain('very private words');
  });

  it('shows notes under their record on the page, escaped, and not as records of their own', async () => {
    await phr.addNote(caller('alice'), { resourceType: 'Observation', id: 'a1c' }, '<b>ask</b> about this');
    const on = healthRecordsOnFor(() => ({ enabledAddonsFor: async () => ['phr'] }));
    const html = await createPhrRecordsPlugin(() => phr, on).execute!({ pageName: 'x', linkGraph: {}, formatters, userContext: { username: 'alice', isAuthenticated: true } } as never, {});
    expect(html).toContain('Your note');
    expect(html).toContain('&lt;b&gt;ask&lt;/b&gt; about this');
    expect(html).not.toMatch(/\d+ communications?/i);
    expect(html).toContain('1 lab result or measurement');
    expect(html).not.toContain('Comments tab');
  });
});

import { NOTE_FORM, noteFormHandler } from '../forms/noteForm.js';

describe('the "Add a note" form on the forms add-on', () => {
  let db: Db & { close(): void };
  let phr: PhrManager;
  beforeEach(async () => {
    db = openAddonTestDatabase<Db & { close(): void }>('phr', { migrations: PHR_MIGRATIONS, ledgerTable: PHR_LEDGER_TABLE }, { slug: 'phr', defaults });
    const host = buildAddonHost('phr', defaults);
    const sink = { logAuditEvent: async () => 'id', flushAuditQueue: async () => {} };
    phr = new PhrManager({ store: new PhrRecordStore(db), decide: allowAll, recordAudit: (e) => host.recordAuditEvent(sink, e), host, optedIn: async () => null, identityOf: async (c) => `urn:test:${c.username}` });
    await phr.write(caller('alice'), a1c, 'epic');
  });
  afterEach(() => db.close());

  it('keeps no copy in the forms add-on, notifies nobody, and has no email field', () => {
    expect(NOTE_FORM.store).toBe(false);
    expect(NOTE_FORM.notify).toBe(false);
    expect(NOTE_FORM.fields.some((f) => f.name === 'email' || f.type === 'email')).toBe(false);
  });

  it('offers each viewer only their own records, in plain words', async () => {
    const mine = await phr.toFormOptions({}, { username: 'alice', isAuthenticated: true, roles: ['reader'] });
    expect(mine).toEqual([{ value: 'Observation/a1c', label: 'Hemoglobin A1c — 5.8 % (lab result or measurement, 2024-09-03)' }]);
    expect(await phr.toFormOptions({}, { username: 'bob', isAuthenticated: true, roles: ['reader'] })).toEqual([]);
    expect(await phr.toFormOptions({}, null)).toEqual([]);
  });

  it('the handler stores the note through PhrManager, and refuses bad input with a field message', async () => {
    const handle = noteFormHandler(() => phr, () => caller('alice'));
    expect(await handle({ data: { record: 'Observation/a1c', note: 'Ask about this' } }, { req: {} })).toEqual({ ok: true });
    expect((await phr.notes(caller('alice'))).get('Observation/a1c')).toHaveLength(1);
    expect(await handle({ data: { record: 'Observation/a1c', note: '   ' } }, { req: {} })).toMatchObject({ ok: false, fields: { note: expect.any(String) } });
    expect(await handle({ data: { record: 'Observation/missing', note: 'x' } }, { req: {} })).toMatchObject({ ok: false, fields: { record: expect.any(String) } });
    expect(await handle({ data: { record: 'nonsense', note: 'x' } }, { req: {} })).toMatchObject({ ok: false });
  });
});
