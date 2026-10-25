import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { buildAddonHost, openAddonTestDatabase } from '@jwilleke/ngdpbase-types/testing';
import type { ActorContext, Decision } from '@jwilleke/ngdpbase-types';
import { PHR_MIGRATIONS, PHR_LEDGER_TABLE } from '../managers/migrations.js';
import { PhrRecordStore, type Db } from '../managers/PhrRecordStore.js';
import { PhrManager, type PhrCaller } from '../managers/PhrManager.js';
import { YourphrSourceStore } from '../migrate/YourphrSourceStore.js';
import { expectedRefs, filesFrom, NO_SOURCE } from '../migrate/yourphrSource.js';

// Synthetic records only: no real person, no real provider.
const defaults = JSON.parse(readFileSync(new URL('../config/default-config.json', import.meta.url), 'utf8')) as Record<string, unknown>;

/** yourPHR's records store, as main's SqliteFhirRepository creates it (the columns the move reads). In memory, Node's own SQLite. */
function openSource(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE resources (
    resource_type TEXT NOT NULL, id TEXT NOT NULL, user_id TEXT NOT NULL DEFAULT '',
    source_id TEXT NOT NULL DEFAULT '', version_id TEXT NOT NULL, last_updated TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0, content TEXT NOT NULL, PRIMARY KEY (resource_type, id, user_id))`);
  return db;
}

const glucose = (value: number) => ({ resourceType: 'Observation', id: 'obs-1', status: 'final', code: { text: 'Glucose' }, valueQuantity: { value, unit: 'mg/dL' } });
const patient = { resourceType: 'Patient', id: 'p1', name: [{ family: 'Testperson', given: ['Synthetic'] }] };
const condition = { resourceType: 'Condition', id: 'c1', code: { text: 'Synthetic condition' }, subject: { reference: 'Patient/p1' } };

/** The migration job's scheduled run: the system principal, acting as the job. */
const JOB = { username: 'system', origin: 'scheduled', requestedAt: '2026-10-25T00:00:00Z', job: 'phr.migrate-yourphr' } as unknown as ActorContext;
const person = (username: string) => ({ username, roles: ['vault-owner'], isAuthenticated: true } as unknown as ActorContext);
const callerOf = (subject: ActorContext): PhrCaller => ({ subject, ipAddress: undefined, enforceDeny: async (p) => { throw new Error(`refused ${p}`); } });

describe('the move from yourPHR into phr (#969)', () => {
  let source: DatabaseSync;
  let db: Db & { close(): void };
  let phr: PhrManager;
  let audit: Record<string, unknown>[];
  let optedIn: Set<string>;
  let switchedOn: Set<string>;
  let termsPending: Set<string>;
  let gateAsked: string[];

  // Core's decision point, as phr's policies make it: phr-migrate to the job alone, the rest to people.
  const decide = async (ctx: unknown, { action }: { action: string }): Promise<Decision> => {
    const isJob = (ctx as { job?: string } | null)?.job === 'phr.migrate-yourphr';
    const permit = action === 'phr-migrate' ? isJob : !isJob;
    return { permit, applicable: true, reason: permit ? 'test-allow' : 'test-deny' };
  };

  const insert = (owner: string, sourceId: string, resource: Record<string, unknown>, deleted = 0) =>
    source.prepare('INSERT INTO resources (resource_type, id, user_id, source_id, version_id, last_updated, deleted, content) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(String(resource.resourceType), String(resource.id), owner, sourceId, '1', '2026-01-01T00:00:00Z', deleted, JSON.stringify(resource));

  /** One run of the job's work: every person, every source file, then the check. */
  const runMove = async (as: ActorContext = JOB) => {
    const store = new YourphrSourceStore(source);
    const missing: Record<string, string[]> = {};
    for (const owner of store.owners()) {
      const files = filesFrom(store.rowsOf(owner));
      for (const { sourceId, file } of files) await phr.migrateFile(callerOf(as), owner, file, sourceId);
      missing[owner] = await phr.migratedMissing(callerOf(as), owner, expectedRefs(files));
    }
    return missing;
  };

  beforeEach(() => {
    source = openSource();
    db = openAddonTestDatabase<Db & { close(): void }>('phr', { migrations: PHR_MIGRATIONS, ledgerTable: PHR_LEDGER_TABLE }, { slug: 'phr', defaults });
    audit = [];
    optedIn = new Set();
    switchedOn = new Set();
    termsPending = new Set();
    gateAsked = [];
    const host = buildAddonHost('phr', defaults);
    const sink = { logAuditEvent: async (e: Record<string, unknown>) => { audit.push(e); return 'id'; }, flushAuditQueue: async () => {} };
    phr = new PhrManager({
      store: new PhrRecordStore(db), decide, recordAudit: (e) => host.recordAuditEvent(sink, e), host,
      // As index.ts wires it: health records switched on, and no phr terms pending.
      optedIn: async (c) => {
        const who = String(c.subject?.username);
        gateAsked.push(who);
        if (optedIn.has(who)) return null;
        if (!switchedOn.has(who)) return 'health records are off';
        return termsPending.has(who) ? "phr's terms are not accepted" : null;
      }
    });
    insert('alice', 'epic-1', patient);
    insert('alice', 'epic-1', condition);
    insert('alice', '', glucose(101));
    insert('alice', 'epic-1', { resourceType: 'Observation', id: 'gone', code: { text: 'deleted' } }, 1);
    insert('bob', 'epic-1', patient);
  });
  afterEach(() => { source.close(); db.close(); });

  it('moves every live record into its own person\'s record, and the check finds them all', async () => {
    expect(await runMove()).toEqual({ alice: [], bob: [] });
    optedIn.add('alice');
    const mine = await phr.overview(callerOf(person('alice')), 50);
    expect(mine.counts.filter((c) => c.resourceType !== 'Provenance')).toEqual(expect.arrayContaining([
      { resourceType: 'Patient', count: 1 }, { resourceType: 'Condition', count: 1 }, { resourceType: 'Observation', count: 1 }
    ]));
  });

  it('leaves deleted records behind', async () => {
    await runMove();
    const rows = filesFrom(new YourphrSourceStore(source).rowsOf('alice'));
    expect(rows.flatMap((f) => f.file.resources).some((r) => r.id === 'gone')).toBe(false);
  });

  it('gives records with no source yourPHR\'s own name for one', () => {
    const files = filesFrom(new YourphrSourceStore(source).rowsOf('alice'));
    expect(files.map((f) => f.sourceId).sort()).toEqual([NO_SOURCE, 'epic-1'].sort());
  });

  it('a second run changes nothing', async () => {
    await runMove();
    const versions = (await Promise.all(['alice'].map(async () => { optedIn.add('alice'); return (await phr.overview(callerOf(person('alice')), 50)).counts; })))[0];
    expect(await runMove()).toEqual({ alice: [], bob: [] });
    expect((await phr.overview(callerOf(person('alice')), 50)).counts).toEqual(versions);
  });

  it('audits each record moved, with its owner, never its content', async () => {
    await runMove();
    const moved = audit.filter((e) => e.action === 'phr-migrate' && e.result === 'allow' && String(e.resource).includes('/'));
    expect(moved.length).toBe(4); // alice: patient, condition, glucose; bob: patient
    expect(new Set(moved.map((e) => (e.metadata as { owner: string }).owner))).toEqual(new Set(['alice', 'bob']));
    expect(JSON.stringify(audit)).not.toMatch(/Glucose|Testperson|Synthetic condition/);
  });

  it('nobody but the migration job may move records, a person not even into their own record', async () => {
    await expect(runMove(person('alice'))).rejects.toThrow(/refused phr-migrate/);
    expect(await phr.migratedMissing(callerOf(JOB), 'alice', ['Patient/x'])).toEqual(['Patient/x']);
  });

  it('the job cannot use the ordinary doors: no reads, no writes as anyone', async () => {
    await expect(phr.list(callerOf(JOB), 'Patient', 'alice')).rejects.toThrow(/refused phr-read/);
  });

  it('a person sees nothing moved in until they have opted in (health records on, terms accepted)', async () => {
    await runMove();
    await expect(phr.list(callerOf(person('alice')), 'Patient')).rejects.toThrow(/refused phr-read/);
    optedIn.add('alice');
    expect((await phr.list(callerOf(person('alice')), 'Patient')).length).toBe(1);
    await expect(phr.list(callerOf(person('bob')), 'Patient')).rejects.toThrow(/refused phr-read/);
  });

  it('records the refusal of a person who has not opted in', async () => {
    await runMove();
    await expect(phr.list(callerOf(person('bob')), 'Patient')).rejects.toThrow();
    expect(audit.some((e) => e.action === 'phr-read' && e.result === 'deny' && e.reason === 'not-opted-in')).toBe(true);
  });

  // Operator decision (i), 2026-10-25: the move writes before anyone opts in.
  it('moves the records of someone with health records off and terms pending; they can read them only after opting in', async () => {
    termsPending.add('alice');
    expect(await runMove()).toEqual({ alice: [], bob: [] });
    expect(gateAsked).toEqual([]); // the move never asks the opt-in gate
    await expect(phr.list(callerOf(person('alice')), 'Patient')).rejects.toThrow(/refused phr-read/); // off
    switchedOn.add('alice');
    await expect(phr.list(callerOf(person('alice')), 'Patient')).rejects.toThrow(/refused phr-read/); // on, terms pending
    termsPending.delete('alice');
    expect((await phr.list(callerOf(person('alice')), 'Patient')).length).toBe(1); // on and accepted
  });
});
