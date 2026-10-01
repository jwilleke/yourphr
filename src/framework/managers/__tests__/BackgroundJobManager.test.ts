import { beforeEach, describe, expect, it } from 'vitest';
import { Engine } from '../../Engine.js';
import { ApiContext } from '../../ApiContext.js';
import { BackgroundJobManager, type JobResult } from '../BackgroundJobManager.js';

let engine: Engine;
let jobs: BackgroundJobManager;
let lines: string[];
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };

/** A job that waits until released, so a test can look while it runs. */
function gate(): { run: () => Promise<JobResult>; finish: (r: JobResult) => void; throwWith: (m: string) => void } {
  let resolve: (r: JobResult) => void = () => undefined;
  let reject: (e: Error) => void = () => undefined;
  return {
    run: () => new Promise<JobResult>((res, rej) => { resolve = res; reject = rej; }),
    finish: (r) => resolve(r),
    throwWith: (m) => reject(new Error(m)),
  };
}

beforeEach(async () => {
  engine = new Engine();
  lines = [];
  jobs = new BackgroundJobManager(engine, (l) => lines.push(l));
  engine.register('backgroundJobs', jobs);
  await engine.initialize();
});

describe('BackgroundJobManager — ngdpbase\'s job runner (yourphr#856)', () => {
  it('runs a registered job in the background, reports progress, and keeps the result', async () => {
    const g = gate();
    jobs.registerJob({ id: 'x', displayName: 'X', run: (progress) => { progress('step 1 of 2'); return g.run(); } });
    const admin = ApiContext.from({ username: 'ops', role: 'admin' }, engine);
    const runId = jobs.enqueue('x', admin);
    await settle();
    expect(jobs.getStatus(runId)).toMatchObject({ status: 'running', progress: 'step 1 of 2', requestedBy: 'ops' });
    expect(jobs.getActiveJobs()).toHaveLength(1);
    g.finish({ success: true, summary: 'done it' });
    await settle();
    expect(jobs.getStatus(runId)).toMatchObject({ status: 'completed', result: { success: true, summary: 'done it' } });
    expect(jobs.getStatus(runId)?.progress).toBeUndefined();
    expect(jobs.latestRun('x')?.runId).toBe(runId);
    expect(jobs.getActiveJobs()).toHaveLength(0);
  });

  it('one run per job: a second enqueue while it runs returns the same run', async () => {
    const g = gate();
    jobs.registerJob({ id: 'x', displayName: 'X', run: g.run });
    const ctx = ApiContext.system('scheduler', 'scheduler', engine);
    const first = jobs.enqueue('x', ctx);
    expect(jobs.enqueue('x', ctx)).toBe(first);
    g.finish({ success: true });
    await settle();
    expect(jobs.enqueue('x', ctx)).not.toBe(first); // finished, so a new run
  });

  it('a job that throws is a failed run with the reason, never an unhandled rejection', async () => {
    const g = gate();
    jobs.registerJob({ id: 'x', displayName: 'X', run: g.run });
    const runId = jobs.enqueue('x', ApiContext.system('scheduler', 'scheduler', engine));
    g.throwWith('disk full');
    await settle();
    expect(jobs.getStatus(runId)).toMatchObject({ status: 'failed', result: { success: false, error: 'disk full' } });
    expect(lines.some((l) => l.includes('disk full'))).toBe(true);
  });

  it('refuses a job id nobody registered', () => {
    expect(() => jobs.enqueue('nope', ApiContext.system('scheduler', 'scheduler', engine))).toThrow(/unknown job/);
    expect(jobs.latestRun('nope')).toBeUndefined();
  });
});
