import { beforeEach, describe, expect, it } from 'vitest';
import type { Resource } from '@medplum/fhirtypes';
import { Engine } from '../../../framework/Engine.js';
import { ApiContext } from '../../../framework/ApiContext.js';
import { RecordsManager } from '../RecordsManager.js';
import { JobsManager } from '../../../framework/managers/JobsManager.js';
import { MANUAL_PLATFORM_TYPE, MANUAL_SOURCE_DISPLAY, SourcesManager, cleanFilename, isDisconnected, sourceShape, type NewSource } from '../SourcesManager.js';
import { BaseDocumentConverterProvider, type ConverterStatus } from '../../providers/BaseDocumentConverterProvider.js';
import { ApiError } from '../../../framework/ApiContext.js';
import { EventBus, type SourceEvent } from '../../../events/index.js';
import { FakeRecordsProvider } from '../../providers/__tests__/FakeRecordsProvider.js';
import { FakeJobsProvider } from '../../../framework/providers/__tests__/FakeJobsProvider.js';
import { FakeSourcesProvider } from '../../providers/__tests__/FakeSourcesProvider.js';
import { BaseSourceClientProvider, NullSourceClientProvider, type AuthorizationResult, type AuthorizationStart, type FetchReport, type RefreshedTokens } from '../../providers/BaseSourceClientProvider.js';
import type { ConnectedSource } from '../../providers/BaseSourcesProvider.js';
import type { SourceCapability } from '../../../sources/capability.js';
import type { RecordsWriter } from '../../providers/BaseRecordsProvider.js';
import { ConfigurationManager } from '../../../framework/ConfigurationManager.js';
import { FhirHttpError } from '../../../sync/index.js';
import { PolicyManager } from '../../../framework/managers/PolicyManager.js';
import { FakeConfigProvider } from '../../../framework/providers/__tests__/FakeConfigProvider.js';

/** A scripted source client: refresh rotates tokens (or fails), fetch writes N records (or fails). */
class ScriptedClient extends BaseSourceClientProvider {
  readonly name = 'scripted';
  refreshes = 0;
  fetches: string[] = [];
  failRefresh = false;
  failFetch = false;
  /** Per-type failures, as a real server gives them (yourphr#753). */
  failTypes = new Map<string, Error>();
  perType = 2;
  async beginAuthorization(): Promise<AuthorizationStart> { throw new Error('not in this spec'); }
  async completeAuthorization(): Promise<AuthorizationResult> { throw new Error('not in this spec'); }
  async refresh(source: ConnectedSource, now: number): Promise<RefreshedTokens> {
    this.refreshes++;
    if (this.failRefresh) throw new Error('token endpoint said no');
    return { accessToken: `fresh-${this.refreshes}`, refreshToken: `rotated-${this.refreshes}`, expiresAt: now + 3600, tokenUrl: source.tokenUrl || 'https://idp.example.org/token', scope: this.grantedScope };
  }
  /** What `/metadata` says, when a spec sets one; no statement at all by default. */
  capability?: SourceCapability;
  capabilityReads = 0;
  capabilityReason = 'no statement in this spec';
  /** What a refresh restates as granted (yourphr#757); '' is a server that says nothing. */
  grantedScope = '';
  /** Pages a type claims to have spent, and whether it hit its cap (yourphr#759). */
  pagesPerType = 1;
  truncate = false;
  budgets: number[] = [];
  async readCapability(): Promise<{ capability?: SourceCapability; reason: string }> {
    this.capabilityReads++;
    return this.capability ? { capability: this.capability, reason: '' } : { reason: this.capabilityReason };
  }
  async fetchPages(source: ConnectedSource, resourceType: string, accessToken: string, writer: RecordsWriter, maxPages: number): Promise<FetchReport> {
    this.fetches.push(`${source.id}:${resourceType}:${accessToken}`);
    this.budgets.push(maxPages);
    if (this.failFetch) throw new Error('FHIR HTTP 500');
    const refusal = this.failTypes.get(resourceType);
    if (refusal) throw refusal;
    let created = 0;
    let updated = 0;
    for (let i = 1; i <= this.perType; i++) {
      const r = await writer.upsert({ resourceType, id: `${resourceType.toLowerCase()}-${source.patient}-${i}`, code: { text: `synthetic ${resourceType}` } } as Resource);
      if (r === 'created') created++;
      else updated++;
    }
    return { received: this.perType, created, updated, pages: this.pagesPerType, truncated: this.truncate };
  }
}

/** A converter that claims anything starting "<CCD" and returns a fixed bundle — or fails, when told to. */
class ScriptedConverter extends BaseDocumentConverterProvider {
  readonly formatId = 'ccda';
  readonly formatName = 'C-CDA';
  converted: string[] = [];
  fail?: ApiError;
  canHandle(bytes: Buffer): boolean { return bytes.toString().startsWith('<CCD'); }
  status(): ConverterStatus { return { enabled: true, ready: true, setup_hint: 'none needed' }; }
  async convert(bytes: Buffer): Promise<Buffer> {
    this.converted.push(bytes.toString());
    if (this.fail) throw this.fail;
    return Buffer.from(JSON.stringify({ resourceType: 'Bundle', entry: [{ resource: { resourceType: 'Patient', id: 'cda-1' } }, { resource: { resourceType: 'AllergyIntolerance', id: 'al-1' } }] }));
  }
}

const NOW = 1_000_000;
const newSource = (userId: string, over: Partial<NewSource> = {}): NewSource => ({
  userId, display: `${userId}'s clinic`, fhirBaseUrl: 'https://fhir.example.org/r4', tokenUrl: 'https://fhir.example.org/token', clientId: 'cid',
  patient: `p-${userId}`, resourceTypes: ['Condition', 'Observation'], accessToken: 'tok', refreshToken: 'ref', expiresAt: NOW + 100_000,
  platformType: 'ehr', environment: 'sandbox', ...over,
});

let engine: Engine;
let sourcesProvider: FakeSourcesProvider;
let jobsProvider: FakeJobsProvider;
let recordsProvider: FakeRecordsProvider;
let client: ScriptedClient;
let events: EventBus;
let sources: SourcesManager;
let records: RecordsManager;
let jobs: JobsManager;
let lines: string[];
let alice: ApiContext;
let bob: ApiContext;
let admin: ApiContext;
let migration: ApiContext;
let converter: ScriptedConverter;

beforeEach(async () => {
  engine = new Engine();
  sourcesProvider = new FakeSourcesProvider();
  jobsProvider = new FakeJobsProvider((id) => sourcesProvider.rows.get(id)?.userId);
  recordsProvider = new FakeRecordsProvider();
  client = new ScriptedClient();
  events = new EventBus();
  lines = [];
  records = new RecordsManager(engine, recordsProvider);
  jobs = new JobsManager(engine, jobsProvider);
  converter = new ScriptedConverter();
  sources = new SourcesManager(engine, sourcesProvider, client, { maxPages: 5, events, log: (l) => lines.push(l), converters: [converter] });
  engine.register('configuration', new ConfigurationManager(engine, new FakeConfigProvider(), { env: {} }))
    .register('policy', new PolicyManager(engine));
  engine.register('records', records).register('jobs', jobs).register('sources', sources);
  await engine.initialize();
  records.sourceDisplay = (id) => sources.displayOf(id);
  alice = ApiContext.from({ username: 'alice', role: 'user' }, engine);
  bob = ApiContext.from({ username: 'bob', role: 'user' }, engine);
  admin = ApiContext.from({ username: 'root', role: 'admin' }, engine);
  migration = ApiContext.system('migration', 'migration', engine);
});

describe('SourcesManager — ownership is the seam', () => {
  it('boots after records and jobs, initialises its provider, and names the client it was bound to', () => {
    expect(engine.registered).toEqual(['configuration', 'policy', 'records', 'jobs', 'sources']);
    expect(sourcesProvider.initialized).toBe(true);
    expect(lines).toContain("sources: client provider 'scripted'");
  });

  it('a member connects a source for themselves only; a system principal acts for the account it is for', async () => {
    await expect(sources.add(alice, newSource('bob'))).rejects.toMatchObject({ status: 403 });
    const mine = await sources.add(alice, newSource('alice'));
    const seeded = await sources.add(ApiContext.system('seed', 'bob', engine), newSource('bob'));
    expect(mine.id).toBe(1);
    expect(seeded.userId).toBe('bob');
    await expect(sources.add(ApiContext.anonymous(engine), newSource('alice'))).rejects.toMatchObject({ status: 401 });
  });

  it('list and get answer only for the caller; a malformed or foreign id is simply not found', async () => {
    await sources.add(alice, newSource('alice'));
    await sources.add(bob, newSource('bob'));
    expect((await sources.list(alice)).map((s) => s.userId)).toEqual(['alice']);
    expect(await sources.get(alice, 'source-1')).toMatchObject({ userId: 'alice' });
    expect(await sources.get(bob, 'source-1')).toBeUndefined();
    expect(await sources.get(alice, 'nope')).toBeUndefined();
    expect(await sources.owned(alice, 2)).toBeUndefined();
    expect(await sources.displayOf('source-2')).toBe("bob's clinic");
    expect(await sources.displayOf('source-99')).toBe('');
    expect(await sources.count()).toBe(2);
  });

  it('shapes a source as Go\'s SourceCredential: public id, redacted secrets, absent unknowns, latest job when there is one', async () => {
    const s = await sources.add(alice, newSource('alice', { platformType: '', environment: '' }));
    const shaped = sourceShape(s, undefined);
    expect(shaped).toMatchObject({ id: 'source-1', access_token: '[REDACTED]', refresh_token: '[REDACTED]', api_endpoint_base_url: 'https://fhir.example.org/r4' });
    expect(shaped).not.toHaveProperty('platform_type');
    expect(shaped).not.toHaveProperty('updated_at');
    expect(shaped).not.toHaveProperty('latest_background_job');
    await sources.syncNow(alice, 'source-1', NOW);
    const [listed] = await sources.listShaped(alice);
    expect(listed).toMatchObject({ updated_at: new Date(NOW * 1000).toISOString(), latest_background_job: { job_status: 'STATUS_DONE' } });
    expect(await sources.getShaped(bob, 'source-1')).toBeUndefined();
    const summary = await sources.summary(alice, 'source-1');
    expect(summary).toMatchObject({ source: { id: 'source-1' }, resource_type_counts: expect.arrayContaining([expect.objectContaining({ resource_type: 'Condition', count: 2 })]) });
  });
});

describe('SourcesManager — the pass (what src/worker was)', () => {
  it('refreshes an expiring token BEFORE the sync, persists the rotation, and accounts for it exactly', async () => {
    const s = await sources.add(alice, newSource('alice', { accessToken: 'stale', expiresAt: NOW - 10 }));
    const report = await sources.pass(NOW);
    expect(report).toEqual({ refreshAttempted: 1, refreshed: 1, synced: 1, failed: 0 });
    expect(client.fetches).toEqual(['1:Condition:fresh-1', '1:Observation:fresh-1']);
    expect(await sources.owned(alice, s.id)).toMatchObject({ accessToken: 'fresh-1', refreshToken: 'rotated-1', expiresAt: NOW + 3600, lastSyncAt: NOW });
    expect(lines).toContain('token-refresh: attempted 1, refreshed 1');
    expect(await records.countsByType(alice)).toEqual(expect.arrayContaining([{ resource_type: 'Condition', count: 2 }, { resource_type: 'Observation', count: 2 }]));
  });

  it('persists a discovered token endpoint once (a migrated source arrives without one)', async () => {
    await sources.add(alice, newSource('alice', { tokenUrl: '', expiresAt: 0 }));
    await sources.pass(NOW);
    expect((await sources.owned(alice, 1))?.tokenUrl).toBe('https://idp.example.org/token');
  });

  it('leaves a fresh token alone and a resync creates nothing new', async () => {
    await sources.add(alice, newSource('alice'));
    await sources.pass(NOW);
    const second = await sources.pass(NOW + 10);
    expect(second).toEqual({ refreshAttempted: 0, refreshed: 0, synced: 1, failed: 0 });
    expect(client.refreshes).toBe(0);
    expect((await jobs.latest(1))).toMatchObject({ outcome: 'success', received: 4, created: 0, updated: 4 });
  });

  it('expired with no refresh token: says so ONCE, records one failure job, and pauses the sync instead of hammering the provider (yourphr#706)', async () => {
    const s = await sources.add(alice, newSource('alice', { refreshToken: '', expiresAt: NOW - 10 }));
    const first = await sources.pass(NOW);
    expect(first).toEqual({ refreshAttempted: 0, refreshed: 0, synced: 0, failed: 0 });
    expect(client.fetches).toEqual([]); // no doomed fetch with a token known to be dead
    expect(lines.filter((l) => l.includes('reconnect the source')).length).toBe(1);
    expect(await jobs.latest(s.id)).toMatchObject({ outcome: 'failure', error: expect.stringContaining('reconnect the source') });

    // Every later cycle is silent — no new log line, no new job.
    await sources.pass(NOW + 900);
    await sources.pass(NOW + 1800);
    expect(lines.filter((l) => l.includes('reconnect the source')).length).toBe(1);
    expect((await jobsProvider.all()).filter((j) => j.sourceId === s.id).length).toBe(1);

    // A reconnect (new tokens) lifts the pause and the source syncs again.
    await sourcesProvider.updateTokens(s.id, 'fresh', 'rotated', NOW + 7200);
    const after = await sources.pass(NOW + 2700);
    expect(after).toMatchObject({ synced: 1, failed: 0 });
    expect(client.fetches.length).toBeGreaterThan(0);
  });

  it('a user-triggered sync still attempts an expired unrefreshable source and reports honestly', async () => {
    await sources.add(alice, newSource('alice', { refreshToken: '', accessToken: 'dead', expiresAt: NOW - 10 }));
    await sources.pass(NOW); // paused for the worker
    const before = client.fetches.length;
    await sources.syncNow(alice, 'source-1', NOW);
    expect(client.fetches.length).toBeGreaterThan(before); // syncNow is not gated by the pause
  });

  it('a failed refresh is logged, not fatal: the sync runs on the old token', async () => {
    client.failRefresh = true;
    await sources.add(alice, newSource('alice', { accessToken: 'old', expiresAt: NOW - 10 }));
    const report = await sources.pass(NOW);
    expect(report).toMatchObject({ refreshAttempted: 1, refreshed: 0, synced: 1 });
    expect(client.fetches[0]).toBe('1:Condition:old');
    expect(lines.some((l) => l.includes('token endpoint said no'))).toBe(true);
  });

  it('skips a disconnected source entirely', async () => {
    const s = await sources.add(alice, newSource('alice', { accessToken: '', refreshToken: '' }));
    expect(isDisconnected(s)).toBe(true);
    expect(await sources.pass(NOW)).toEqual({ refreshAttempted: 0, refreshed: 0, synced: 0, failed: 0 });
    expect(client.fetches).toEqual([]);
  });

  it('one source failing never costs the other its sync, and the failure is recorded with its error', async () => {
    await sources.add(alice, newSource('alice'));
    await sources.add(bob, newSource('bob'));
    client.failFetch = true;
    expect(await sources.pass(NOW)).toMatchObject({ synced: 0, failed: 2 });
    client.failFetch = false;
    expect(await sources.pass(NOW + 1)).toMatchObject({ synced: 2, failed: 0 });
    expect((await jobs.history(2)).map((j) => [j.outcome, j.error.replace(/could not read[^;]*; asking for every granted type/, 'no statement')])).toEqual([
      // yourphr#756: the unreadable statement is said ONCE, on the first sync — not again on the second.
      ['failure', 'skipped 2 of 2 types: Condition: FHIR HTTP 500; Observation: FHIR HTTP 500; no statement'],
      ['success', ''],
    ]);
  });

  // yourphr#753: Epic refuses some types routinely (403 not granted, 400 needs a category). One
  // refusal used to abandon every later type and import nothing.
  it('a type the server refuses is skipped and named; the other types still import (Go parity)', async () => {
    const s = await sources.add(alice, newSource('alice', { resourceTypes: ['Patient', 'Condition', 'Observation', 'AdverseEvent'] }));
    client.failTypes.set('Observation', new FhirHttpError(400, 'HTTP 400 fetching …/Observation?patient=p-alice: this resource requires a category for searching'));
    client.failTypes.set('AdverseEvent', new FhirHttpError(403, 'HTTP 403 fetching …/AdverseEvent?patient=p-alice'));
    expect(await sources.pass(NOW)).toMatchObject({ synced: 1, failed: 0 });
    const job = await jobs.latest(s.id);
    expect(job).toMatchObject({ outcome: 'success', received: 4, created: 4 });
    expect(job?.error).toMatch(/^skipped 2 of 4 types: Observation: HTTP 400 .*category.*; AdverseEvent: HTTP 403/);
    expect(await records.countsByType(alice)).toEqual(expect.arrayContaining([{ resource_type: 'Patient', count: 2 }, { resource_type: 'Condition', count: 2 }]));
    expect((await sources.owned(alice, s.id))?.lastSyncAt).toBe(NOW);
    expect(lines.some((l) => l.startsWith(`sync: source ${s.id} (alice's clinic): success, 4 received (4 new, 0 updated) — skipped 2 of 4 types`))).toBe(true);
  });

  it('a 401 ends the sync: the token itself was refused, so every later type would be too', async () => {
    const s = await sources.add(alice, newSource('alice', { resourceTypes: ['Patient', 'Condition', 'Observation'] }));
    client.failTypes.set('Condition', new FhirHttpError(401, 'HTTP 401 fetching …/Condition?patient=p-alice'));
    expect(await sources.pass(NOW)).toMatchObject({ synced: 0, failed: 1 });
    expect(client.fetches).toEqual(['1:Patient:tok', '1:Condition:tok']); // Observation never attempted
    const job = await jobs.latest(s.id);
    expect(job).toMatchObject({ outcome: 'failure', received: 2 });
    expect(job?.error).toContain('reconnect the source');
    expect((await sources.owned(alice, s.id))?.lastSyncAt).toBe(0);
  });

  it('a connected source whose scopes name no type is a failure that says why, not a silent success with nothing', async () => {
    const s = await sources.add(alice, newSource('alice', { resourceTypes: [] }));
    expect(await sources.pass(NOW)).toMatchObject({ synced: 0, failed: 1 });
    expect(client.fetches).toEqual([]);
    expect((await jobs.latest(s.id))?.error).toContain('scopes name no patient/<Type> read scope');
    expect(lines.some((l) => l.startsWith(`sync: source ${s.id}`) && l.includes('failure'))).toBe(true);
  });

  it('every sync writes one log line, success included', async () => {
    client.capability = { readAt: NOW, types: { Condition: ['patient'], Observation: ['patient', 'category'] }, everything: false, fhirVersion: '4.0.1' };
    const s = await sources.add(alice, newSource('alice'));
    await sources.pass(NOW);
    expect(lines).toContain(`sync: source ${s.id} (alice's clinic): success, 4 received (4 new, 0 updated)`);
  });

  // yourphr#756: the server's own statement decides what is worth asking for.
  it('does not ask for a type the server does not serve, or serves but cannot search by patient', async () => {
    client.capability = { readAt: NOW, types: { Condition: ['patient'], Observation: ['code'] }, everything: false, fhirVersion: '4.0.1' };
    const s = await sources.add(alice, newSource('alice', { resourceTypes: ['Condition', 'Observation', 'CarePlan'] }));
    await sources.pass(NOW);
    expect(client.fetches).toEqual(['1:Condition:tok']); // Observation is not searchable by patient here; CarePlan is absent
    const job = await jobs.latest(s.id);
    expect(job?.outcome).toBe('success');
    expect(job?.error).toContain('not asking for Observation (the server serves it but not by patient), CarePlan (the server does not serve it)');
  });

  it('reads the statement once and keeps it — not once per sync', async () => {
    client.capability = { readAt: NOW, types: { Condition: ['patient'], Observation: ['patient'] }, everything: false, fhirVersion: '4.0.1' };
    await sources.add(alice, newSource('alice'));
    await sources.pass(NOW);
    await sources.pass(NOW + 60);
    await sources.pass(NOW + 120);
    expect(client.capabilityReads).toBe(1);
  });

  it('re-reads a statement older than a week', async () => {
    client.capability = { readAt: NOW, types: { Condition: ['patient'], Observation: ['patient'] }, everything: false, fhirVersion: '4.0.1' };
    await sources.add(alice, newSource('alice'));
    await sources.pass(NOW);
    await sources.pass(NOW + 8 * 24 * 60 * 60);
    expect(client.capabilityReads).toBe(2);
  });

  it('an unreadable statement changes nothing, and is said ONCE rather than every cycle', async () => {
    const s = await sources.add(alice, newSource('alice')); // the scripted client serves no statement
    await sources.pass(NOW);
    await sources.pass(NOW + 60);
    expect(client.fetches).toEqual(['1:Condition:tok', '1:Observation:tok', '1:Condition:tok', '1:Observation:tok']); // every granted type, as before
    const said = (await jobs.history(s.id)).filter((j) => j.error.includes('could not read the provider'));
    expect(said.length).toBe(1);
  });

  // yourphr#757: the grant is the truth about what may be read, and a refresh restates it.
  it('asks for what the grant covers, not what was stored at connect', async () => {
    await sources.add(alice, newSource('alice', { resourceTypes: ['Condition', 'Observation'], grantedScopes: 'patient/Condition.read' }));
    await sources.pass(NOW);
    expect(client.fetches).toEqual(['1:Condition:tok']);
  });

  it('a refresh that restates the grant changes what the next sync asks for, and says so once', async () => {
    const s = await sources.add(alice, newSource('alice', { expiresAt: NOW - 10, resourceTypes: ['Condition', 'Observation'], grantedScopes: 'patient/Condition.read patient/Observation.read' }));
    client.grantedScope = 'patient/Condition.read'; // the provider narrowed it at re-consent
    await sources.pass(NOW);
    expect(client.fetches).toEqual(['1:Condition:fresh-1']);
    expect((await sources.owned(alice, s.id))?.grantedScopes).toBe('patient/Condition.read');
    expect(lines.filter((l) => l.includes('the provider restated it as')).length).toBe(1);
  });

  it('a source whose server states no grant keeps asking for the types it was connected with', async () => {
    await sources.add(alice, newSource('alice', { grantedScopes: '' }));
    await sources.pass(NOW);
    expect(client.fetches).toEqual(['1:Condition:tok', '1:Observation:tok']);
  });

  // yourphr#759: one big type must not spend the whole run.
  it('spends the sync budget across types, and says which ones it never reached', async () => {
    // Its own engine: the shared one is already initialised, and this needs a tighter budget.
    const tight = new Engine();
    const sp = new FakeSourcesProvider();
    const jp = new FakeJobsProvider((id) => sp.rows.get(id)?.userId);
    const scripted = new ScriptedClient();
    scripted.pagesPerType = 2;
    const tightJobs = new JobsManager(tight, jp);
    tight.register('records', new RecordsManager(tight, new FakeRecordsProvider())).register('jobs', tightJobs)
      .register('sources', new SourcesManager(tight, sp, scripted, { maxPages: 5, maxPagesPerSync: 3 }));
    await tight.initialize();
    const who = ApiContext.from({ username: 'alice', role: 'user' }, tight);
    const s = await tight.managers.sources.add(who, newSource('alice', { resourceTypes: ['Condition', 'Observation', 'Procedure'] }));
    await tight.managers.sources.pass(NOW);
    expect(scripted.fetches).toEqual(['1:Condition:tok', '1:Observation:tok']); // the budget ran out before Procedure
    expect(scripted.budgets).toEqual([3, 1]); // each type gets the smaller of its own cap and what is left
    const job = await tightJobs.latest(s.id);
    expect(job?.error).toContain('the page budget ran out: Procedure not fetched this cycle');
    expect(job?.outcome).toBe('success'); // what did arrive is real
  });

  it('a type that hits its own cap keeps what it fetched and says it was truncated', async () => {
    client.truncate = true;
    const s = await sources.add(alice, newSource('alice', { resourceTypes: ['Condition'] }));
    await sources.pass(NOW);
    const job = await jobs.latest(s.id);
    expect(job).toMatchObject({ outcome: 'success', received: 2 });
    expect(job?.error).toContain('Condition: stopped at the page cap');
  });

  it('the worker acts for each owner: records land under the source\'s owner, never anyone else', async () => {
    await sources.add(alice, newSource('alice'));
    await sources.add(bob, newSource('bob', { resourceTypes: ['Condition'] }));
    await sources.pass(NOW);
    expect((await records.countsByType(alice)).reduce((n, c) => n + c.count, 0)).toBe(4);
    expect((await records.countsByType(bob)).reduce((n, c) => n + c.count, 0)).toBe(2);
  });
});

describe('SourcesManager — sync now, disconnect, remove, export', () => {
  const seen: SourceEvent[] = [];
  beforeEach(() => { seen.length = 0; events.subscribe('alice', (e) => seen.push(e)); });

  it('sync now answers as Go does — the source with its fresh job, and the rows touched — framed by the events the page follows', async () => {
    await sources.add(alice, newSource('alice'));
    const result = await sources.syncNow(alice, 'source-1', NOW);
    expect(result).toMatchObject({ data: 4, source: { id: 'source-1', latest_background_job: { job_status: 'STATUS_DONE' } } });
    expect(seen.map((e) => e.event_type)).toEqual(['source_sync', 'source_complete']);
    expect(await sources.syncNow(bob, 'source-1', NOW)).toBeUndefined();
  });

  it('a failed sync now is an error the route can say, and the completion event still fires', async () => {
    await sources.add(alice, newSource('alice'));
    client.failFetch = true;
    await expect(sources.syncNow(alice, 'source-1', NOW)).rejects.toMatchObject({ status: 502, message: expect.stringContaining('Condition: FHIR HTTP 500') });
    expect(seen.map((e) => e.event_type)).toEqual(['source_sync', 'source_complete']);
  });

  it('disconnect drops the tokens and keeps the records; the worker then skips it', async () => {
    await sources.add(alice, newSource('alice'));
    await sources.pass(NOW);
    expect(await sources.disconnect(bob, 'source-1')).toBe(false);
    expect(await sources.disconnect(alice, 'source-1')).toBe(true);
    expect(await sources.owned(alice, 1)).toMatchObject({ accessToken: '', refreshToken: '', expiresAt: 0 });
    expect((await records.countsByType(alice)).length).toBe(2);
    expect(await sources.pass(NOW + 1)).toMatchObject({ synced: 0, failed: 0 });
  });

  it('disconnectWhere applies a rule to the caller\'s sources only and counts what it touched', async () => {
    await sources.add(alice, newSource('alice', { display: 'Medicare' }));
    await sources.add(alice, newSource('alice', { display: 'Clinic' }));
    await sources.add(bob, newSource('bob', { display: 'Medicare' }));
    expect(await sources.disconnectWhere(alice, (s) => s.display === 'Medicare')).toBe(1);
    expect((await sources.owned(bob, 3))?.accessToken).toBe('tok');
  });

  it('disconnectConsentRequired disconnects the Medicare family and nothing else — Go\'s consent rule, at the sources door (yourphr#619)', async () => {
    await sources.add(alice, newSource('alice', { display: 'Medicare Blue Button', fhirBaseUrl: 'https://sandbox.bluebutton.cms.gov/v2/fhir' }));
    await sources.add(alice, newSource('alice', { display: 'County Clinic' }));
    await sources.add(bob, newSource('bob', { display: 'Medicare Blue Button', fhirBaseUrl: 'https://sandbox.bluebutton.cms.gov/v2/fhir' }));
    expect(await sources.disconnectConsentRequired(alice)).toBe(1);
    expect((await sources.owned(alice, 1))?.accessToken).toBe('');
    expect((await sources.owned(alice, 2))?.accessToken).toBe('tok');
    expect((await sources.owned(bob, 3))?.accessToken).toBe('tok'); // another account's consent is not this caller's to revoke
    expect(await sources.disconnectConsentRequired(alice)).toBe(0); // already disconnected: nothing left to touch
  });

  it('remove takes the records through the Records door, then the job history, then the source', async () => {
    await sources.add(alice, newSource('alice'));
    await sources.pass(NOW);
    expect(await sources.remove(bob, 'source-1')).toBeUndefined();
    expect(await sources.remove(alice, 'source-1')).toBe(4);
    expect(await sources.count()).toBe(0);
    expect(await jobs.history(1)).toEqual([]);
    expect(await records.countsByType(alice)).toEqual([]);
  });

  it('remove-data keeps the source; removeAll takes every source the caller owns and nobody else\'s', async () => {
    await sources.add(alice, newSource('alice'));
    await sources.add(alice, newSource('alice', { patient: 'p2' }));
    await sources.add(bob, newSource('bob'));
    await sources.pass(NOW);
    expect(await sources.removeData(alice, 'source-1')).toBe(4);
    expect(await sources.count()).toBe(3);
    expect(await sources.removeAll(alice)).toBe(2);
    expect((await sources.list(bob)).length).toBe(1);
  });

  it('exports the source\'s records as a bundle under a slugged, dated filename', async () => {
    await sources.add(alice, newSource('alice', { display: '  Fake Regional Health!! ' }));
    await sources.pass(NOW);
    const exported = await sources.exportBundle(alice, 'source-1');
    expect(exported?.filename).toMatch(/^yourphr-fake-regional-health-\d{8}\.json$/);
    expect(exported?.bundle).toMatchObject({ resourceType: 'Bundle', type: 'collection', total: 4 });
    expect(await sources.exportBundle(bob, 'source-1')).toBeUndefined();
  });

  it('a dynamic client rides with its source and is the owner\'s alone', async () => {
    await sources.add(alice, newSource('alice'));
    const dyn = { clientId: 'dyn-1', clientSecret: '', registrationAccessToken: 'rat', registrationClientUri: 'https://idp.example.org/reg/1' };
    await expect(sources.saveDynamicClient(bob, 1, dyn)).rejects.toMatchObject({ status: 404 });
    await sources.saveDynamicClient(alice, 1, dyn);
    expect(await sources.dynamicClientFor(alice, 1)).toEqual(dyn);
    expect(await sources.dynamicClientFor(bob, 1)).toBeUndefined();
  });
});

describe('SourcesManager — the operator and the migration tool', () => {
  it('admin metrics are for admins, keyed by outcome|platform|environment, newest jobs first', async () => {
    await sources.add(alice, newSource('alice'));
    await sources.add(bob, newSource('bob', { platformType: '', environment: '' }));
    await sources.pass(NOW);
    client.failFetch = true;
    await sources.pass(NOW + 5);
    await expect(sources.adminMetrics(alice)).rejects.toMatchObject({ status: 403 });
    const metrics = await sources.adminMetrics(admin);
    expect(metrics).toMatchObject({ scrape_enabled: false, process: { jobs_total: { 'success|ehr|sandbox': 1, 'success|unknown|unknown': 1, 'failed|ehr|sandbox': 1, 'failed|unknown|unknown': 1 }, duration_count: 4 } });
    const recent = metrics['recent_jobs'] as { id: string; job_status: string }[];
    expect(recent.map((j) => j.id)).toEqual(['4', '3', '2', '1']);
    expect(recent[0]).toMatchObject({ job_status: 'STATUS_FAILED', summary: { error_message: expect.stringContaining('FHIR HTTP 500') } });
  });

  it('legacy import is the migration principal\'s alone, one-way, keyed by the legacy id, reporting what needs a reconnect', async () => {
    const legacy = [
      { ...newSource('jim', { display: 'Epic', refreshToken: 'go-ref', expiresAt: 100 }), legacyId: 'src-1' },
      { ...newSource('jim', { display: 'No Refresh', patient: 'p-2', refreshToken: '' }), legacyId: 'src-4' },
    ];
    await expect(sources.importLegacy(alice, legacy)).rejects.toMatchObject({ status: 403 });
    const report = await sources.importLegacy(migration, legacy);
    expect(report).toEqual({ imported: ['jim:Epic', 'jim:No Refresh'], skippedExisting: [], needsReconnect: ['jim:No Refresh'], idMap: { 'src-1': 1, 'src-4': 2 } });
    const jim = ApiContext.from({ username: 'jim', role: 'user' }, engine);
    expect(await sources.owned(jim, 1)).toMatchObject({ tokenUrl: '', accessToken: 'tok', refreshToken: 'go-ref', expiresAt: 100, resourceTypes: ['Condition', 'Observation'] });
    const again = await sources.importLegacy(migration, legacy);
    expect(again).toMatchObject({ imported: [], skippedExisting: ['jim:Epic', 'jim:No Refresh'], idMap: { 'src-1': 1, 'src-4': 2 } });
    expect(await sources.count()).toBe(2);
  });

  it('the Null client is the inert default: nothing fetched, and the job says why', async () => {
    const quiet = new Engine();
    const sp = new FakeSourcesProvider();
    const jp = new FakeJobsProvider((id) => sp.rows.get(id)?.userId);
    quiet.register('records', new RecordsManager(quiet, new FakeRecordsProvider())).register('jobs', new JobsManager(quiet, jp))
      .register('sources', new SourcesManager(quiet, sp, new NullSourceClientProvider(), { maxPages: 1 }));
    await quiet.initialize();
    const who = ApiContext.from({ username: 'alice', role: 'user' }, quiet);
    await quiet.managers.sources.add(who, newSource('alice', { expiresAt: NOW - 1 }));
    expect(await quiet.managers.sources.pass(NOW)).toMatchObject({ refreshAttempted: 1, refreshed: 0, synced: 0, failed: 1 });
    expect((await quiet.managers.jobs.latest(1))?.error).toContain('no source client is configured');
  });

  it('backup and restore are no-ops that say so — the app database carries the rows', async () => {
    expect(await sources.backup()).toMatchObject({ manager: 'sources' });
    expect(await jobs.backup()).toMatchObject({ manager: 'jobs' });
    await expect(sources.restore()).resolves.toBeUndefined();
    await expect(jobs.restore()).resolves.toBeUndefined();
  });
});

describe('SourcesManager — upload (yourphr#736) and C-CDA (yourphr#735)', () => {
  const bundle = (patient: string, ...ids: string[]) => Buffer.from(JSON.stringify({
    resourceType: 'Bundle',
    entry: [{ resource: { resourceType: 'Patient', id: patient } }, ...ids.map((id) => ({ resource: { resourceType: 'Condition', id } }))],
  }));

  it('imports a FHIR file as a manual source that names its patient, framed by the events, with a job', async () => {
    const seen: SourceEvent[] = [];
    events.subscribe('alice', (e) => seen.push(e));
    const out = await sources.importUpload(alice, { filename: 'export.json', bytes: bundle('p-1', 'c-1', 'c-2') }, NOW);
    expect(out.data).toEqual({ format: 'fhir', received: 3, created: 3, updated: 0, collisions: 0, skipped: 0 });
    expect(out.source).toMatchObject({ platform_type: MANUAL_PLATFORM_TYPE, patient: 'p-1', display: 'Uploaded export.json', latest_background_job: { job_status: 'STATUS_DONE' } });
    const id = String(out.source['id']);
    expect([...recordsProvider.rows.values()].filter((r) => r.resourceType === 'Condition').map((r) => r.sourceId)).toEqual([id, id]);
    expect(seen.map((e) => e.event_type)).toEqual(['source_sync', 'source_complete']);
    expect(lines.some((l) => l.startsWith(`upload: source ${id.replace('source-', '')} (fhir): received 3, created 3`))).toBe(true);
  });

  it('a re-upload for the same patient lands in the same source and updates in place — no refusals, no second source', async () => {
    const first = await sources.importUpload(alice, { filename: 'a.json', bytes: bundle('p-1', 'c-1') }, NOW);
    const second = await sources.importUpload(alice, { filename: 'b.json', bytes: bundle('p-1', 'c-1', 'c-2') }, NOW + 60);
    expect(second.source['id']).toBe(first.source['id']);
    expect(second.data).toMatchObject({ created: 1, updated: 2, collisions: 0 });
    expect(await sources.list(alice)).toHaveLength(1);
  });

  it('a different patient, or a file that names none, gets a source of its own — never a guess at whose it is', async () => {
    await sources.importUpload(alice, { filename: 'a.json', bytes: bundle('p-1', 'c-1') }, NOW);
    await sources.importUpload(alice, { filename: 'b.json', bytes: bundle('p-2', 'c-9') }, NOW);
    const patientless = () => sources.importUpload(alice, { filename: '', bytes: Buffer.from('{"resourceType":"Observation","id":"o-1"}') }, NOW);
    const x = await patientless();
    const y = await patientless().catch((e: Error) => e);
    expect(x.source).toMatchObject({ patient: '', display: 'Uploaded 1970-01-12' });
    // The second patientless file gets its own source, and the store refuses its id that the first already holds.
    expect(y).not.toBeInstanceOf(Error);
    expect((y as Awaited<ReturnType<typeof patientless>>).data).toMatchObject({ created: 0, collisions: 1 });
    expect((await sources.list(alice)).map((s) => s.patient)).toEqual(['p-1', 'p-2', '', '']);
  });

  it('an id another source already holds is refused and counted — never merged', async () => {
    const synced = await sources.add(alice, newSource('alice'));
    await records.writer(alice, `source-${synced.id}`).upsert({ resourceType: 'Condition', id: 'c-1' } as Resource);
    const out = await sources.importUpload(alice, { filename: 'a.json', bytes: bundle('p-1', 'c-1', 'c-2') }, NOW);
    expect(out.data).toMatchObject({ created: 2, collisions: 1 });
    expect(recordsProvider.rows.get('alice|Condition|c-1')?.sourceId).toBe(`source-${synced.id}`);
  });

  it('a file that cannot be read is a 400 that leaves no source behind', async () => {
    for (const bytes of [Buffer.from('%PDF-1.7'), Buffer.from('{"resourceType":"Bundle","entry":[]}')]) {
      const err = await sources.importUpload(alice, { filename: 'x', bytes }, NOW).catch((e: ApiError) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(400);
    }
    expect(await sources.list(alice)).toEqual([]);
  });

  it('a C-CDA document is converted first, then imported like any FHIR file', async () => {
    const out = await sources.importUpload(alice, { filename: 'summary.xml', bytes: Buffer.from('<CCD/>') }, NOW);
    expect(converter.converted).toEqual(['<CCD/>']);
    expect(out.data).toMatchObject({ format: 'ccda', created: 2 });
    expect(out.source).toMatchObject({ patient: 'cda-1' });
  });

  it('a conversion that fails surfaces its own error and creates nothing', async () => {
    converter.fail = new ApiError(502, 'the converter did not answer', { error_code: 'cda_converter_unreachable' });
    const err = await sources.importUpload(alice, { filename: 'summary.xml', bytes: Buffer.from('<CCD/>') }, NOW).catch((e: ApiError) => e);
    expect(err).toBe(converter.fail);
    expect(await sources.list(alice)).toEqual([]);
  });

  it('converter status is per format; an unknown format says it is not part of this build', () => {
    expect(sources.converterStatus(alice, 'ccda')).toEqual({ enabled: true, ready: true, setup_hint: 'none needed' });
    expect(sources.converterStatus(alice, 'pdf')).toMatchObject({ enabled: false, ready: false });
  });

  it('manualSource is the patient\'s own source EXACTLY — never an upload that happens to be manual too', async () => {
    await sources.importUpload(alice, { filename: 'a.json', bytes: bundle('p-1', 'c-1') }, NOW);
    // A Go-migrated manual source: no display, no patient.
    await sources.add(alice, newSource('alice', { platformType: MANUAL_PLATFORM_TYPE, display: '', patient: '', fhirBaseUrl: '', accessToken: '', refreshToken: '' }));
    const own = await sources.manualSource(alice);
    expect(own.display).toBe(MANUAL_SOURCE_DISPLAY);
    expect(await sources.manualSource(alice)).toEqual(own); // found, not re-created
    expect(await sources.isManual(alice, `source-${own.id}`)).toBe(true);
    expect(await sources.isManual(alice, 'source-999')).toBe(false);
  });

  it('cleans a filename down to something fit to name a source', () => {
    expect(cleanFilename('C:\\Users\\me\\Downloads\\export.json')).toBe('export.json');
    expect(cleanFilename('../../etc/x\u0000\u001b.xml')).toBe('x.xml');
    expect(cleanFilename('a'.repeat(300))).toHaveLength(120);
  });
});
