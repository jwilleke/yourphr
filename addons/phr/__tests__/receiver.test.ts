import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildAddonHost, openAddonTestDatabase } from '@jwilleke/ngdpbase-types/testing';
import type { ActorContext, Decision, IceItem, OriginalKeep, ReceiveInfo } from '@jwilleke/ngdpbase-types';
import { PHR_MIGRATIONS, PHR_LEDGER_TABLE } from '../managers/migrations.js';
import { PhrRecordStore, type Db } from '../managers/PhrRecordStore.js';
import { PhrManager } from '../managers/PhrManager.js';
import { healthRecordsReceiver, type ReceiverDeps } from '../importers/receiver.js';
import { PHR_FILE_KIND } from '../importers/shims.js';
import { localId } from '../managers/localIds.js';
import { readFiles } from './importHelpers.js';

// Synthetic records only: no real person, no real provider.
const glucose = (value: number) => ({ resourceType: 'Observation', id: 'obs-glucose', status: 'final', code: { text: 'Glucose' }, valueQuantity: { value, unit: 'mg/dL' } });
const GLUCOSE = localId('urn:yourphr:source:folder', 'Observation', 'obs-glucose');
const defaults = JSON.parse(readFileSync(new URL('../config/default-config.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const info: ReceiveInfo = { runId: 'run-1', source: { name: 'glucose.json', sha256: 'x' }, chain: ['phr.fhir'] };

/** A person's own request context. */
const person = (username: string): ActorContext => ({ username, roles: ['reader'], isAuthenticated: true } as unknown as ActorContext);
/** A background import's context: who asked, from where, when. No isAuthenticated: core's PDP decides it. */
const job = (username: string): ActorContext => ({ username, origin: 'request', requestedAt: '2026-10-23T00:00:00Z' } as unknown as ActorContext);

describe('phr.health-records, the import engine\'s door to health records', () => {
  let db: Db & { close(): void };
  let phr: PhrManager;
  let decided: unknown[];
  let permit: boolean;
  let on: boolean;
  let pending: unknown[];
  let vault: { name: string; size: number; mediaType?: string; ctx: unknown; keep: unknown }[];
  let vaultRefuses: string | null;

  const item = async (value: number): Promise<IceItem> => {
    const [data] = await readFiles({ 'glucose.json': glucose(value) });
    return { kind: PHR_FILE_KIND, name: 'glucose.json', data };
  };

  beforeEach(() => {
    db = openAddonTestDatabase<Db & { close(): void }>('phr', { migrations: PHR_MIGRATIONS, ledgerTable: PHR_LEDGER_TABLE }, { slug: 'phr', defaults });
    decided = [];
    permit = true;
    on = true;
    pending = [];
    vault = [];
    vaultRefuses = null;
    const host = buildAddonHost('phr', defaults);
    const sink = { logAuditEvent: async () => 'id', flushAuditQueue: async () => {} };
    const decide = async (ctx: unknown): Promise<Decision> => {
      decided.push(ctx);
      return { permit, applicable: true, reason: permit ? 'test-allow' : 'test-deny' };
    };
    phr = new PhrManager({ store: new PhrRecordStore(db), decide, recordAudit: (e) => host.recordAuditEvent(sink, e), host, optedIn: async () => null, identityOf: async (c) => `urn:test:${c.username}` });
  });
  afterEach(() => db.close());

  const receiver = (over: Partial<ReceiverDeps> = {}) => healthRecordsReceiver({
    records: () => phr,
    healthRecordsOn: async () => on,
    decide: async (ctx) => { decided.push(ctx); return { permit, applicable: true, reason: permit ? 'test-allow' : 'test-deny' }; },
    pendingConsent: async () => pending,
    keepInVault: async (file, ctx, keep) => {
      if (vaultRefuses) throw new Error(vaultRefuses);
      vault.push({ name: file.name, size: file.bytes.length, mediaType: file.mediaType, ctx, keep });
      return `vault-file-${vault.length}`;
    },
    ...over
  });

  it('stores a file\'s records for the person the run is for, and says what it did', async () => {
    const out = await receiver().receive(await item(112), person('alice'), info);
    expect(out).toEqual({ status: 'stored', message: '1 new, 0 updated, 0 unchanged' });
    const caller = { subject: person('alice'), ipAddress: undefined, enforceDeny: async () => { throw new Error('refused'); } };
    expect((await phr.read(caller, 'Observation', GLUCOSE))?.resource.valueQuantity).toEqual({ value: 112, unit: 'mg/dL' });
  });

  it('a file whose records are all unchanged is a duplicate, not a new import', async () => {
    await receiver().receive(await item(112), person('alice'), info);
    expect((await receiver().receive(await item(112), person('alice'), info)).status).toBe('duplicate');
  });

  it('a background run\'s context goes to core\'s decision point as it is, never converted (ngdpbase#2022)', async () => {
    const ctx = job('alice');
    expect((await receiver().receive(await item(112), ctx, info)).status).toBe('stored');
    expect(decided.length).toBeGreaterThan(0);
    expect(decided.every((d) => d === ctx)).toBe(true);
  });

  it('refuses, storing nothing, when health records are off for the person', async () => {
    on = false;
    expect(await receiver().receive(await item(112), person('alice'), info)).toEqual({ status: 'refused', message: 'turn on health records in your profile first' });
    expect(await receiver().mayUse(person('alice'))).toBe(false);
  });

  it('refuses until the person has accepted phr\'s current terms and privacy policy', async () => {
    pending = [{ id: 'phr-terms-of-service' }];
    expect((await receiver().receive(await item(112), person('alice'), info)).message).toMatch(/terms and privacy policy/);
  });

  it('refuses when core says no to phr-write', async () => {
    permit = false;
    expect((await receiver().receive(await item(112), person('alice'), info)).status).toBe('refused');
    expect(await receiver().mayUse(person('alice'))).toBe(false);
  });

  it('may be used by a person with health records on, consent given and phr-write allowed', async () => {
    expect(await receiver().mayUse(person('alice'))).toBe(true);
  });

  it('takes only what phr\'s shims produce', () => {
    expect(receiver().accepts).toEqual([PHR_FILE_KIND]);
  });

  it('keeps originals by default, in the person\'s encrypted vault during the upload, and never offers core\'s shared files', () => {
    // ngdpbase#2061: core lets exactly these types into phr's own vault; the site-wide list is untouched.
    expect(receiver().originals).toEqual({ allowed: ['none', 'keep'], default: 'keep', types: ['application/json', 'application/x-ndjson', 'application/xml', 'text/xml'] });
    expect(receiver().keepsEncrypted).toBe(true);
    expect(typeof receiver().keepOriginal).toBe('function');
  });

  describe('keeping the original file', () => {
    const original = (name = 'Export/fhir/everything.json'): IceItem =>
      ({ kind: 'file', name, bytes: Buffer.from('{"resourceType":"Bundle"}'), mediaType: 'application/json' });

    it('puts it in the person\'s vault as the request\'s own context, under its file name, and returns the vault\'s id', async () => {
      const ctx = person('alice');
      const keep = { oneTime: 'allowance' };
      expect(await receiver().keepOriginal!(original(), ctx, keep as unknown as OriginalKeep)).toEqual({ status: 'stored', ref: 'vault-file-1' });
      expect(vault).toEqual([{ name: 'everything.json', size: 25, mediaType: 'application/json', ctx, keep }]);
    });

    it('is refused, keeping nothing, when the person may not import (health records off, consent pending, or phr-write denied)', async () => {
      on = false;
      expect((await receiver().keepOriginal!(original(), person('alice'))).status).toBe('refused');
      on = true;
      pending = [{ id: 'phr-terms-of-service' }];
      expect((await receiver().keepOriginal!(original(), person('alice'))).status).toBe('refused');
      pending = [];
      permit = false;
      expect((await receiver().keepOriginal!(original(), person('alice'))).status).toBe('refused');
      expect(vault).toEqual([]);
    });

    it('passes on core\'s refusal (a locked vault) as a refusal that names the vault', async () => {
      vaultRefuses = 'the store is sealed and its key is not unlocked';
      const out = await receiver().keepOriginal!(original(), person('alice'));
      expect(out.status).toBe('refused');
      expect(out.message).toMatch(/could not be kept in your PHR vault: the store is sealed/);
    });
  });
});
