/**
 * Jobs (yourphr#612): the history of background runs — the one door to sync_jobs. Framework, not
 * app: every application has jobs, and yourphr#441's lesson ("an invisible background job is
 * indistinguishable from a broken one") is not specific to health records. Records outcomes, never
 * a queue: a recorded job is DONE or FAILED, so Go's READY/LOCKED match nothing here.
 */
import { BaseManager, type BackupData } from '../BaseManager.js';
import type { Engine } from '../Engine.js';
import { ApiError, type ApiContext } from '../ApiContext.js';
import type { BaseJobsProvider, JobRecord } from '../providers/BaseJobsProvider.js';
import { redact } from '../../log/redact.js';

declare module '../Engine.js' {
  interface ManagerRegistry {
    jobs: JobsManager;
  }
}

export type { JobRecord };

export interface JobsQuery {
  limit: number;
  page: number;
  jobType?: string;
  status?: string;
}

/**
 * A recorded job in the shape of Go's BackgroundJob + BackgroundJobSyncData (yourphr#593), which is
 * what the Angular shell and /background-jobs read. Only what the row holds: the job id is the row
 * id, the user is the caller (the ownership join proved it), brand_id is empty (no brand here).
 */
export function backgroundJobShape(job: JobRecord, username: string): Record<string, unknown> {
  const iso = (seconds: number): string => new Date(seconds * 1000).toISOString();
  const done = job.outcome === 'success';
  return {
    id: String(job.id ?? ''),
    created_at: iso(job.startedAt),
    updated_at: iso(job.finishedAt),
    user_id: username,
    job_type: 'SYNC',
    job_status: done ? 'STATUS_DONE' : 'STATUS_FAILED',
    locked_time: iso(job.startedAt),
    done_time: iso(job.finishedAt),
    retries: 0,
    data: {
      source_id: `source-${job.sourceId}`,
      brand_id: '',
      ...(job.error ? { error_data: { error: job.error } } : {}),
      summary: {
        outcome: done ? 'success' : 'failed',
        duration_ms: Math.max(0, job.finishedAt - job.startedAt) * 1000,
        total_resources: job.received,
        ...(job.error ? { error_message: job.error } : {}),
      },
    },
  };
}

export class JobsManager extends BaseManager {
  readonly name = 'jobs';
  override readonly dependsOn = [] as const;

  constructor(engine: Engine, private readonly provider: BaseJobsProvider) {
    super(engine);
  }

  override async initialize(config: Record<string, unknown> = {}): Promise<void> {
    await super.initialize(config);
    await this.provider.initialize();
  }

  /** Records a finished run. The caller is whoever ran it — a member syncing now, or the worker for them. */
  async record(ctx: ApiContext, job: JobRecord): Promise<JobRecord> {
    ctx.requireAuthenticated();
    return this.provider.record(job);
  }

  /**
   * A failure only the BROWSER saw, written down (yourphr#685).
   *
   * Most connection failures are the server's own and it records them itself — it is the one making
   * the token exchange. What it cannot see is the half that happens in the person's browser: a
   * popup blocked, a provider's sign-in page returning an OAuth error to it, a window closed
   * mid-flow. Without this, the record of that failure is the thing that goes missing, and an empty
   * job history reads exactly like a healthy instance.
   *
   * What the client is trusted for, and what it is not:
   *
   *   - __Not trusted for identity.__ The job belongs to whoever is signed in, never to a user id in
   *     the payload. Where a source is named, it is resolved through the sources manager before this
   *     is called, which is what refuses another account's — a numeric id off the wire would not.
   *     A failed CONNECT names none, because the source does not exist until the connect succeeds.
   *   - __Not trusted to be safe to store.__ The message describes a failure, so it arrives holding
   *     provider names, URLs and — the reason this matters — whatever a token exchange put in an
   *     error string. It goes through the same redaction as a log line and is cut to a bounded
   *     length, so the error history cannot become a place credentials accumulate.
   */
  async recordClientError(ctx: ApiContext, input: { sourceId: number; message: string; at?: number }): Promise<JobRecord> {
    ctx.requireAuthenticated();
    const message = redact(String(input.message ?? '')).trim().slice(0, 512);
    if (message === '') throw new ApiError(400, 'an error needs a message');
    const at = Number.isFinite(input.at) && (input.at as number) > 0 ? Math.floor(input.at as number) : Math.floor(Date.now() / 1000);
    return this.provider.record({
      sourceId: Number.isFinite(input.sourceId) ? Math.floor(input.sourceId) : 0,
      // A connection that failed before a source existed has nothing to join to, so it carries its
      // owner directly. Without this it would be stored and never shown — the silence, again.
      userId: ctx.username,
      outcome: 'failure',
      received: 0,
      created: 0,
      updated: 0,
      error: message,
      startedAt: at,
      finishedAt: at,
    });
  }

  /** The newest run of one source — the `latest_background_job` a source carries. */
  latest(sourceId: number): Promise<JobRecord | undefined> {
    return this.provider.latest(sourceId);
  }

  /** Every run of one source, oldest first — what the harnesses and an operator read. */
  history(sourceId?: number): Promise<JobRecord[]> {
    return this.provider.all(sourceId);
  }

  /**
   * The caller's jobs, newest first, in Go's shape with Go's filters honestly mapped (yourphr#593):
   * SYNC is the only job type here; STATUS_DONE/STATUS_FAILED the only statuses a recorded job can
   * have, so any other filter matches nothing rather than something.
   */
  async forUser(ctx: ApiContext, query: JobsQuery): Promise<Record<string, unknown>[]> {
    ctx.requireAuthenticated();
    if (query.jobType && query.jobType !== 'SYNC') return [];
    let outcome: 'success' | 'failure' | undefined;
    if (query.status === 'STATUS_DONE') outcome = 'success';
    else if (query.status === 'STATUS_FAILED') outcome = 'failure';
    else if (query.status) return [];
    const jobs = await this.provider.forUser(ctx.username, { limit: query.limit, offset: query.page * query.limit, outcome });
    return jobs.map((job) => backgroundJobShape(job, ctx.username));
  }

  /** Every run, newest first — an operator's view (yourphr#593 metrics). */
  async all(ctx: ApiContext): Promise<JobRecord[]> {
    ctx.require('admin-read');
    return (await this.provider.all()).reverse();
  }

  /** A source's history goes with the source. */
  removeForSource(sourceId: number): Promise<void> {
    return this.provider.removeForSource(sourceId);
  }

  /** Job history lives in the app database, which the backup coordinator copies whole; nothing separate to take. */
  async backup(): Promise<BackupData> {
    return { manager: this.name, takenAt: new Date().toISOString() };
  }

  async restore(): Promise<void> { /* restored with the app database */ }
}
