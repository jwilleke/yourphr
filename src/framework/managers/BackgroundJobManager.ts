/**
 * BackgroundJobManager — long-running operator work, ported from ngdpbase's manager of the same
 * name (yourphr#856). Managers register job types at startup; a caller enqueues one by id and gets
 * a run id back at once; the job runs in the background, reports progress, and posts a notification
 * when it ends.
 *
 * Kept from ngdpbase: registerJob / enqueue / getStatus / getActiveJobs / getRegisteredJobIds, one
 * active run per job id (a second enqueue returns the running one), the context is mandatory and
 * positional (ngdpbase#631), and nothing a job does can become an unhandled rejection (#1238).
 *
 * Where it differs, and why:
 *   - The context is yourPHR's ApiContext rather than ngdpbase's JobContext: it is this stack's one
 *     answer to "who is asking", and a job that changes something (the search index rebuild turns
 *     maintenance mode on) needs the caller's permissions, not only their name.
 *   - Notices go to the instance's ADMINS, not everyone. "Integrity check complete" means nothing to
 *     a patient. A run nobody asked for (the scheduler's) notifies only when it fails, so a nightly
 *     check does not fill the admin's screen with successes.
 *   - latestRun(jobId): the admin screens show how the last run ended, not only the active one.
 *   - No audit event yet: yourPHR's AuditManager is the patient's access log. The operator's
 *     system-wide log is yourphr#840; job events belong there when it lands. Until then, the log.
 */
import { randomUUID } from 'node:crypto';
import { BaseManager, type BackupData } from '../BaseManager.js';
import type { Engine } from '../Engine.js';
import { ApiContext } from '../ApiContext.js';

declare module '../Engine.js' {
  interface ManagerRegistry {
    backgroundJobs: BackgroundJobManager;
  }
}

/** Lets a job push a live progress message the admin screen shows while it polls. */
export type ReportProgress = (message: string) => void;

export interface JobResult {
  success: boolean;
  /** e.g. "Rebuilt 25,114 records across 2 accounts" */
  summary?: string;
  error?: string;
}

export interface JobDefinition {
  /** Unique job id, e.g. 'records.search-index.rebuild'. */
  id: string;
  /** Shown on the admin screens and in notices. */
  displayName: string;
  /** Where an admin deals with it — named in the notice ("See Admin -> Database"). */
  where?: string;
  /** The work. `ctx` is whoever asked; a job that acts does so as them. */
  run: (reportProgress: ReportProgress, ctx: ApiContext) => Promise<JobResult>;
}

export interface JobRun {
  runId: string;
  jobId: string;
  displayName: string;
  /** Who asked (ApiContext.actor) — the person, or 'scheduler'. */
  requestedBy: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress?: string;
  startedAt: Date;
  completedAt?: Date;
  result?: JobResult;
}

/** A run is "unattended" when no person asked for it — the scheduler or another system actor. */
function unattended(ctx: ApiContext): boolean {
  return ctx.system !== '';
}

export class BackgroundJobManager extends BaseManager {
  readonly name = 'backgroundJobs' as const;
  private readonly jobs = new Map<string, JobDefinition>();
  private readonly runs = new Map<string, JobRun>();
  /** jobId → runId of the pending/running run. */
  private readonly activeByJobId = new Map<string, string>();
  /** jobId → runId of the newest run, finished or not. */
  private readonly latestByJobId = new Map<string, string>();

  constructor(engine: Engine, private readonly log: (line: string) => void = () => undefined) {
    super(engine);
  }

  registerJob(def: JobDefinition): void {
    if (this.jobs.has(def.id)) this.log(`background jobs: '${def.id}' already registered — overwriting`);
    this.jobs.set(def.id, def);
  }

  /**
   * Start a job; the run id comes back at once. When the job is already pending or running, the
   * existing run id is returned rather than starting a second. Throws for an unknown job id.
   */
  enqueue(jobId: string, ctx: ApiContext): string {
    const def = this.jobs.get(jobId);
    if (!def) throw new Error(`background jobs: unknown job '${jobId}'`);
    const existing = this.activeByJobId.get(jobId);
    if (existing !== undefined) {
      this.log(`background jobs: '${jobId}' already running (${existing}) — also requested by ${ctx.actor}`);
      return existing;
    }
    const run: JobRun = { runId: randomUUID(), jobId, displayName: def.displayName, requestedBy: ctx.actor, status: 'pending', startedAt: new Date() };
    this.runs.set(run.runId, run);
    this.activeByJobId.set(jobId, run.runId);
    this.latestByJobId.set(jobId, run.runId);
    // Fire and forget, with a catch: nothing a job does may take the server down (ngdpbase#1238).
    this.execute(def, run, ctx).catch((err: unknown) => {
      run.status = 'failed';
      run.result = { success: false, error: (err as Error).message };
      run.completedAt = new Date();
      if (this.activeByJobId.get(jobId) === run.runId) this.activeByJobId.delete(jobId);
      this.log(`background jobs: '${jobId}' run ${run.runId} failed outside its own handler: ${(err as Error).message}`);
    });
    return run.runId;
  }

  getStatus(runId: string): JobRun | null {
    return this.runs.get(runId) ?? null;
  }

  /** The newest run of a job, finished or not; undefined when it has never run since the start. */
  latestRun(jobId: string): JobRun | undefined {
    const runId = this.latestByJobId.get(jobId);
    return runId === undefined ? undefined : this.runs.get(runId);
  }

  getActiveJobs(): JobRun[] {
    return [...this.activeByJobId.values()].map((id) => this.runs.get(id)).filter((r): r is JobRun => r !== undefined);
  }

  getRegisteredJobIds(): string[] {
    return [...this.jobs.keys()];
  }

  private async execute(def: JobDefinition, run: JobRun, ctx: ApiContext): Promise<void> {
    run.status = 'running';
    const started = Date.now();
    this.log(`background jobs: '${def.id}' started by ${run.requestedBy}`);
    try {
      let result: JobResult;
      try {
        result = await def.run((message) => { run.progress = message; }, ctx);
      } catch (err) {
        result = { success: false, error: (err as Error).message };
      }
      run.result = result;
      run.completedAt = new Date();
      run.progress = undefined;
      run.status = result.success ? 'completed' : 'failed';
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      this.log(`background jobs: '${def.id}' ${run.status} in ${seconds}s${result.success ? (result.summary ? ` — ${result.summary}` : '') : ` — ${result.error ?? 'no reason given'}`}`);
      if (!result.success || !unattended(ctx)) await this.notify(def, result);
    } finally {
      if (this.activeByJobId.get(def.id) === run.runId) this.activeByJobId.delete(def.id);
    }
  }

  /** To the instance's admins; a notice that cannot be sent never fails the job. */
  private async notify(def: JobDefinition, result: JobResult): Promise<void> {
    if (!this.engine.has('notifications') || !this.engine.has('users')) return;
    try {
      const system = ApiContext.system('background jobs: who holds admin', 'backgroundJobs', this.engine);
      const admins = await this.engine.managers.users.holders(system, 'admin');
      const where = def.where ? ` See ${def.where}.` : '';
      await this.engine.managers.notifications.createNotification(result.success
        ? { type: 'system', level: 'success', title: `${def.displayName} finished`, message: `${result.summary ?? 'It finished without a problem.'}${where}`, targetUsers: admins }
        : { type: 'system', level: 'error', title: `${def.displayName} failed`, message: `${result.error ?? 'It failed without saying why.'}${where}`, targetUsers: admins });
    } catch (err) {
      this.log(`background jobs: notice for '${def.id}' not sent: ${(err as Error).message}`);
    }
  }

  override async shutdown(): Promise<void> {
    const active = this.getActiveJobs();
    if (active.length > 0) this.log(`background jobs: shutting down with ${active.length} job(s) still running: ${active.map((r) => r.jobId).join(', ')}`);
    await super.shutdown();
  }

  async backup(): Promise<BackupData> {
    return { manager: this.name, takenAt: new Date().toISOString() };
  }

  async restore(): Promise<void> { /* run history is in memory; nothing to restore */ }
}
