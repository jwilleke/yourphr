import { beforeEach, describe, expect, it } from 'vitest';
import { Engine } from '../../Engine.js';
import { ApiContext } from '../../ApiContext.js';
import { JobsManager, backgroundJobShape } from '../JobsManager.js';
import { FakeJobsProvider } from '../../providers/__tests__/FakeJobsProvider.js';
import { ConfigurationManager } from '../../ConfigurationManager.js';
import { PolicyManager } from '../PolicyManager.js';
import { FakeConfigProvider } from '../../providers/__tests__/FakeConfigProvider.js';

let provider: FakeJobsProvider;
let engine: Engine;
let jobs: JobsManager;
let alice: ApiContext;
let admin: ApiContext;

const job = (sourceId: number, outcome: 'success' | 'failure', received = 3, error = '') =>
  ({ sourceId, outcome, received, created: received, updated: 0, error, startedAt: 1_000, finishedAt: 1_002 });

beforeEach(async () => {
  provider = new FakeJobsProvider((sourceId) => (sourceId === 1 || sourceId === 2 ? 'alice' : sourceId === 9 ? 'bob' : undefined));
  engine = new Engine();
  jobs = new JobsManager(engine, provider);
  engine.register('configuration', new ConfigurationManager(engine, new FakeConfigProvider(), { env: {} }))
    .register('policy', new PolicyManager(engine));
  engine.register('jobs', jobs);
  await engine.initialize();
  alice = ApiContext.from({ username: 'alice', role: 'user' }, engine);
  admin = ApiContext.from({ username: 'root', role: 'admin' }, engine);
  await jobs.record(alice, job(1, 'success'));
  await jobs.record(alice, job(1, 'failure', 0, 'HTTP 500'));
  await jobs.record(alice, job(2, 'success', 5));
  await jobs.record(ApiContext.from({ username: 'bob', role: 'user' }, engine), job(9, 'success'));
});

describe('JobsManager — the history of background runs', () => {
  it('initialises its provider through the engine', () => {
    expect(provider.initialized).toBe(true);
  });

  it('refuses to record for nobody', async () => {
    await expect(jobs.record(ApiContext.anonymous(engine), job(1, 'success'))).rejects.toMatchObject({ status: 401 });
  });

  it('latest is the newest run of a source; history is oldest first', async () => {
    expect((await jobs.latest(1))?.outcome).toBe('failure');
    expect((await jobs.history(1)).map((j) => j.outcome)).toEqual(['success', 'failure']);
  });

  it('a member sees their own jobs, newest first, in Go\'s BackgroundJob shape', async () => {
    const mine = await jobs.forUser(alice, { limit: 20, page: 0 });
    expect(mine.map((j) => j['id'])).toEqual(['3', '2', '1']);
    expect(mine[1]).toMatchObject({ job_type: 'SYNC', job_status: 'STATUS_FAILED', user_id: 'alice', data: { source_id: 'source-1', error_data: { error: 'HTTP 500' } } });
  });

  it('maps Go\'s filters honestly: only SYNC and DONE/FAILED can match; anything else matches nothing', async () => {
    expect(await jobs.forUser(alice, { limit: 20, page: 0, jobType: 'OTHER' })).toEqual([]);
    expect(await jobs.forUser(alice, { limit: 20, page: 0, status: 'STATUS_READY' })).toEqual([]);
    expect((await jobs.forUser(alice, { limit: 20, page: 0, status: 'STATUS_FAILED' })).map((j) => j['id'])).toEqual(['2']);
    expect((await jobs.forUser(alice, { limit: 1, page: 1, status: 'STATUS_DONE' })).map((j) => j['id'])).toEqual(['1']);
  });

  it('the operator view is for admins only and newest first', async () => {
    await expect(jobs.all(alice)).rejects.toMatchObject({ status: 403 });
    expect((await jobs.all(admin)).map((j) => j.id)).toEqual([4, 3, 2, 1]);
  });

  it('a source\'s history goes with the source', async () => {
    await jobs.removeForSource(1);
    expect(await jobs.history()).toHaveLength(2);
  });

  it('shapes durations in ms and carries the error into the summary only when there is one', () => {
    const ok = backgroundJobShape({ ...job(1, 'success'), id: 7 }, 'alice');
    expect(ok).toMatchObject({ id: '7', created_at: '1970-01-01T00:16:40.000Z', data: { summary: { outcome: 'success', duration_ms: 2000, total_resources: 3 } } });
    expect((ok['data'] as { summary: Record<string, unknown> }).summary).not.toHaveProperty('error_message');
    expect((ok['data'] as Record<string, unknown>)).not.toHaveProperty('error_data');
  });
});

/**
 * A failure only the browser saw (yourphr#685). The gap this closes is not "an endpoint 404s" — it
 * is that the record of a failed connection was the thing going missing, and an empty job history
 * reads exactly like a healthy instance.
 */
describe('a connection failure the browser reports', () => {
  it('is stored as a failed job the Background Jobs page can show', async () => {
    const recorded = await jobs.recordClientError(alice, { sourceId: 1, message: 'the sign-in window was closed before the provider answered' });
    expect(recorded.outcome).toBe('failure');
    expect(recorded.error).toBe('the sign-in window was closed before the provider answered');

    const shown = await jobs.forUser(alice, { limit: 50, page: 0 });
    const mine = shown.find((j) => (j['data'] as { error_data?: { error?: string } })?.error_data?.error?.includes('closed before the provider answered'));
    expect(mine, 'the failure reaches the page a person actually reads').toBeDefined();
    expect(mine!['job_status']).toBe('STATUS_FAILED');
  });

  it('redacts the payload the way a log line is redacted, rather than storing it verbatim', async () => {
    const { refreshRedactedSecrets, clearRedactedSecrets } = await import('../../../log/redact.js');
    refreshRedactedSecrets({
      getStringList: (key: string) => (key === 'yourphr.config.secret-keys' ? ['yourphr.relay.secret'] : []),
      getString: (key: string) => (key === 'yourphr.relay.secret' ? 'super-secret-value' : ''),
    });
    try {
      const recorded = await jobs.recordClientError(alice, { sourceId: 1, message: 'token exchange failed: secret=super-secret-value' });
      expect(recorded.error).not.toContain('super-secret-value');
    } finally {
      clearRedactedSecrets();
    }
  });

  it('bounds what it stores, so an error history cannot be filled by one message', async () => {
    const recorded = await jobs.recordClientError(alice, { sourceId: 1, message: 'x'.repeat(5_000) });
    expect(recorded.error.length).toBe(512);
  });

  it('refuses an empty message and an anonymous caller — neither records anything', async () => {
    await expect(jobs.recordClientError(alice, { sourceId: 1, message: '   ' })).rejects.toMatchObject({ status: 400 });
    await expect(jobs.recordClientError(ApiContext.anonymous(engine), { sourceId: 1, message: 'boom' })).rejects.toMatchObject({ status: 401 });
  });
});
