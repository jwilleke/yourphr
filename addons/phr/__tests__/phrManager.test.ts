import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildAddonHost, openAddonTestDatabase } from '@jwilleke/ngdpbase-types/testing';
import type { Decision, PermissionSubject } from '@jwilleke/ngdpbase-types';
import { PHR_MIGRATIONS, PHR_LEDGER_TABLE } from '../managers/migrations.js';
import { PhrRecordStore, type Db } from '../managers/PhrRecordStore.js';
import { PhrManager, type PhrCaller } from '../managers/PhrManager.js';

const defaults = JSON.parse(readFileSync(new URL('../config/default-config.json', import.meta.url), 'utf8')) as Record<string, unknown>;

class Refused extends Error {
  constructor(public readonly permission: string, public readonly reason: string | undefined) { super(`refused ${permission}`); }
}

/** A signed-in caller. `actingFor` makes it a proxy: core sets the subject to the person represented. */
function caller(username: string | null, opts: { actingFor?: string } = {}): PhrCaller {
  const subject = username === null ? null : ({
    username: opts.actingFor ?? username,
    roles: ['reader'],
    isAuthenticated: true,
    ...(opts.actingFor ? { viaProxy: { actor: username, grantId: 'g1' } } : {})
  } as unknown as PermissionSubject);
  return {
    subject,
    ipAddress: '127.0.0.1',
    enforceDeny: async (permission: string, decision: Decision) => { throw new Refused(permission, decision.reason); }
  };
}

const allowAll = async (): Promise<Decision> => ({ permit: true, applicable: true, reason: 'test-allow' });
const denyAll = async (): Promise<Decision> => ({ permit: false, applicable: true, reason: 'test-deny' });

const observation = (id: string, text: string) => ({ resourceType: 'Observation', id, code: { text } });

describe('PhrManager', () => {
  let db: Db & { close(): void };
  let audit: Record<string, unknown>[];
  let make: (decide?: typeof allowAll) => PhrManager;

  beforeEach(() => {
    // declaredBy: the test database must match phr's own declaration, as a site would require.
    db = openAddonTestDatabase<Db & { close(): void }>('phr', { migrations: PHR_MIGRATIONS, ledgerTable: PHR_LEDGER_TABLE }, { slug: 'phr', defaults });
    audit = [];
    const host = buildAddonHost('phr', defaults);
    // A durable sink, as core's AuditManager is: phr's events are on-failure "refuse", so core
    // refuses the action outright when the sink can't promise the record is written.
    const sink = { logAuditEvent: async (e: Record<string, unknown>) => { audit.push(e); return 'id'; }, flushAuditQueue: async () => {} };
    make = (decide = allowAll, optedIn: (c: PhrCaller) => Promise<string | null> = async () => null) => new PhrManager({
      store: new PhrRecordStore(db),
      decide,
      recordAudit: (event) => host.recordAuditEvent(sink, event),
      host,
      optedIn,
      identityOf: async (c) => `urn:test:${c.username}`
    });
  });
  afterEach(() => db.close());

  it('lets a person write and read their own records', async () => {
    const phr = make();
    await phr.write(caller('alice'), observation('o1', 'Glucose'), 'folder');
    const got = await phr.read(caller('alice'), 'Observation', 'o1');
    expect(got?.resource.code).toEqual({ text: 'Glucose' });
    expect(got?.versionId).toBe('1');
  });

  it('never lets one person read another person\'s records, by any method', async () => {
    const phr = make();
    await phr.write(caller('alice'), observation('o1', 'Glucose'), 'folder');
    await expect(phr.read(caller('bob'), 'Observation', 'o1', 'alice')).rejects.toBeInstanceOf(Refused);
    await expect(phr.list(caller('bob'), 'Observation', 'alice')).rejects.toBeInstanceOf(Refused);
    await expect(phr.history(caller('bob'), 'Observation', 'o1', 'alice')).rejects.toBeInstanceOf(Refused);
    await expect(phr.write(caller('bob'), observation('o1', 'Changed'), 'folder', 'urn:test:alice')).rejects.toBeInstanceOf(Refused);
    await expect(phr.remove(caller('bob'), 'Observation', 'o1', 'alice')).rejects.toBeInstanceOf(Refused);
    // And bob's own space doesn't see alice's record either.
    expect(await phr.read(caller('bob'), 'Observation', 'o1')).toBeUndefined();
    expect(await phr.list(caller('bob'), 'Observation')).toEqual([]);
    expect((await phr.read(caller('alice'), 'Observation', 'o1'))?.resource.code).toEqual({ text: 'Glucose' });
  });

  it('keeps two people\'s records with the same id apart', async () => {
    const phr = make();
    await phr.write(caller('alice'), observation('same', 'Alice'), 'epic');
    await phr.write(caller('bob'), observation('same', 'Bob'), 'epic');
    expect((await phr.read(caller('alice'), 'Observation', 'same'))?.resource.code).toEqual({ text: 'Alice' });
    expect((await phr.read(caller('bob'), 'Observation', 'same'))?.resource.code).toEqual({ text: 'Bob' });
  });

  it('refuses a signed-out caller', async () => {
    await expect(make().list(caller(null), 'Observation')).rejects.toBeInstanceOf(Refused);
  });

  it('refuses when core\'s decision point says no, and a refused list is a refusal, not an empty list', async () => {
    const phr = make(denyAll);
    await expect(phr.list(caller('alice'), 'Observation')).rejects.toMatchObject({ permission: 'phr-read', reason: 'test-deny' });
  });

  it('lets a proxy act for the person represented, and names the proxy in the audit', async () => {
    const phr = make();
    await phr.write(caller('mom'), observation('o1', 'Blood pressure'), 'folder');
    const got = await phr.read(caller('jim', { actingFor: 'mom' }), 'Observation', 'o1');
    expect(got?.resource.code).toEqual({ text: 'Blood pressure' });
    const last = audit.at(-1)!;
    expect(last.user).toBe('mom');
    expect(last.actor).toBe('jim');
    expect((last.metadata as Record<string, unknown>).owner).toBe('urn:test:mom'); // the represented user's identity @id
  });

  it('a proxy for one person can\'t reach a third person', async () => {
    const phr = make();
    await phr.write(caller('carol'), observation('o1', 'Private'), 'folder');
    await expect(phr.read(caller('jim', { actingFor: 'mom' }), 'Observation', 'o1', 'urn:test:carol')).rejects.toBeInstanceOf(Refused);
  });

  it('audits every call, allowed and refused, with the owner and never the content', async () => {
    const phr = make();
    await phr.write(caller('alice'), observation('o1', 'Glucose 112 mg/dL'), 'folder');
    await phr.read(caller('alice'), 'Observation', 'o1');
    await phr.read(caller('bob'), 'Observation', 'o1', 'urn:test:alice').catch(() => undefined);
    expect(audit.map(e => [e.action, e.result, (e.metadata as Record<string, unknown>).owner])).toEqual([
      // Owners are identity @ids, never usernames (ngdpbase identity model).
      ['phr-write', 'allow', 'urn:test:alice'],
      ['phr-read', 'allow', 'urn:test:alice'],
      ['phr-read', 'deny', 'urn:test:alice']
    ]);
    expect(audit.every(e => String(e.eventType).includes('phr-'))).toBe(true);
    expect(JSON.stringify(audit)).not.toContain('Glucose');
  });

  it('keeps history and versions, and refuses a second source writing the same record', async () => {
    const phr = make();
    await phr.write(caller('alice'), observation('o1', 'v1'), 'folder');
    await phr.write(caller('alice'), observation('o1', 'v2'), 'folder');
    expect((await phr.history(caller('alice'), 'Observation', 'o1')).map(r => r.versionId)).toEqual(['2', '1']);
    await expect(phr.write(caller('alice'), observation('o1', 'other'), 'epic')).rejects.toMatchObject({ status: 409 });
  });

  it('removes a record for its owner only', async () => {
    const phr = make();
    await phr.write(caller('alice'), observation('o1', 'x'), 'folder');
    expect(await phr.remove(caller('alice'), 'Observation', 'o1')).toBe(true);
    expect(await phr.read(caller('alice'), 'Observation', 'o1')).toBeUndefined();
  });

  it('refuses the action when its audit record can\'t be written', async () => {
    const host = buildAddonHost('phr', defaults);
    const broken = { logAuditEvent: async () => { throw new Error('disk full'); }, flushAuditQueue: async () => {} };
    const phr = new PhrManager({ store: new PhrRecordStore(db), decide: allowAll, recordAudit: (e) => host.recordAuditEvent(broken, e), host, optedIn: async () => null, identityOf: async (c) => `urn:test:${c.username}` });
    await expect(phr.write(caller('alice'), observation('o1', 'x'), 'folder')).rejects.toThrow();
    expect(db.prepare('SELECT COUNT(*) AS n FROM phr_resources').get()).toEqual({ n: 0 });
  });

  it('the database refuses a row nobody owns', () => {
    expect(() => new PhrRecordStore(db).forOwner('')).toThrow();
    expect(() => db.prepare("INSERT INTO phr_resources (owner, resource_type, id, version_id, last_updated, content) VALUES ('', 'Observation', 'x', '1', 'now', '{}')").run()).toThrow();
  });
});
