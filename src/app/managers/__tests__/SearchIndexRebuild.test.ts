import { beforeEach, describe, expect, it } from 'vitest';
import { Engine } from '../../../framework/Engine.js';
import { ApiContext, ApiError } from '../../../framework/ApiContext.js';
import { RecordsManager } from '../RecordsManager.js';
import { FakeRecordsProvider } from '../../providers/__tests__/FakeRecordsProvider.js';
import { ConfigurationManager } from '../../../framework/ConfigurationManager.js';
import { PolicyManager } from '../../../framework/managers/PolicyManager.js';
import { MAINTENANCE_ENABLED_KEY, SettingsManager } from '../../../framework/managers/SettingsManager.js';
import { FakeConfigProvider } from '../../../framework/providers/__tests__/FakeConfigProvider.js';
import { BackgroundJobManager } from '../../../framework/managers/BackgroundJobManager.js';

/** A provider whose rebuild waits until released, so the test can look while it runs. */
class SlowRebuild extends FakeRecordsProvider {
  finish: () => void = () => undefined;
  maintenanceSeen: boolean | undefined;
  failWith: string | undefined;
  constructor(private readonly engine: () => Engine) { super(); }
  override async rebuildSearchIndex(): Promise<{ accounts: number; records: number }> {
    this.maintenanceSeen = this.engine().managers.configuration.getBool(MAINTENANCE_ENABLED_KEY);
    await new Promise<void>((resolve) => { this.finish = resolve; });
    if (this.failWith) throw new Error(this.failWith);
    return { accounts: 2, records: 17 };
  }
}

let engine: Engine;
let provider: SlowRebuild;
let records: RecordsManager;
let admin: ApiContext;
let member: ApiContext;
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };

beforeEach(async () => {
  engine = new Engine();
  provider = new SlowRebuild(() => engine);
  records = new RecordsManager(engine, provider);
  engine.register('configuration', new ConfigurationManager(engine, new FakeConfigProvider(), { env: {} }))
    .register('policy', new PolicyManager(engine))
    .register('settings', new SettingsManager(engine, {}))
    .register('backgroundJobs', new BackgroundJobManager(engine))
    .register('records', records);
  await engine.initialize();
  admin = ApiContext.from({ username: 'ops', role: 'admin' }, engine);
  member = ApiContext.from({ username: 'alice', role: 'user' }, engine);
});

const status = (fn: () => unknown): number => { try { fn(); } catch (err) { return (err as ApiError).status; } return 0; };

describe('the search index rebuild (yourphr#713) — a background job (yourphr#856) wrapped in maintenance mode', () => {
  it('is the admin-system caller\'s alone; a member may not even look', () => {
    expect(status(() => records.startSearchIndexRebuild(member))).toBe(403);
    expect(status(() => records.searchIndex(member))).toBe(403);
  });

  it('turns maintenance on for the rebuild, refuses a second one meanwhile, and turns it back off', async () => {
    const started = records.startSearchIndexRebuild(admin);
    expect(started.state).toBe('running');
    await settle();
    expect(provider.maintenanceSeen).toBe(true);
    expect(status(() => records.startSearchIndexRebuild(admin))).toBe(409);
    provider.finish();
    await settle();
    const after = records.searchIndex(admin).rebuild;
    expect(after).toMatchObject({ state: 'done', by: 'ops', summary: 'Rebuilt 17 records across 2 account(s).' });
    expect(engine.managers.configuration.getBool(MAINTENANCE_ENABLED_KEY)).toBe(false);
  });

  it('leaves maintenance on when the operator had already turned it on', async () => {
    engine.managers.settings.configSet(admin, MAINTENANCE_ENABLED_KEY, true);
    records.startSearchIndexRebuild(admin);
    await settle();
    provider.finish();
    await settle();
    expect(records.searchIndex(admin).rebuild.state).toBe('done');
    expect(engine.managers.configuration.getBool(MAINTENANCE_ENABLED_KEY)).toBe(true);
  });

  it('a failed rebuild says why and still turns maintenance back off', async () => {
    provider.failWith = 'disk full';
    records.startSearchIndexRebuild(admin);
    await settle();
    provider.finish();
    await settle();
    expect(records.searchIndex(admin).rebuild).toMatchObject({ state: 'failed', error: 'disk full' });
    expect(engine.managers.configuration.getBool(MAINTENANCE_ENABLED_KEY)).toBe(false);
  });
});

describe('the integrity check (yourphr#856) — a background job', () => {
  it('reports nothing until a check has run, then the result and when', async () => {
    expect(records.integrityStatus(admin)).toEqual({ ok: null, detail: '', running: false });
    records.startIntegrityCheck(admin);
    await settle();
    const after = records.integrityStatus(admin);
    expect(after).toMatchObject({ ok: true, detail: 'ok', running: false });
    expect(after.checkedAt).toBeDefined();
    expect(records.lastIntegrityCheckAt()).toBeInstanceOf(Date);
  });

  it('a member may neither start one nor read the result; the scheduler may start one', () => {
    expect(status(() => records.startIntegrityCheck(member))).toBe(403);
    expect(status(() => records.integrityStatus(member))).toBe(403);
    expect(status(() => records.startIntegrityCheck(ApiContext.system('scheduler', 'scheduler', engine)))).toBe(0);
  });
});
