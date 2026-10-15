/**
 * What ngdpbase hands this add-on: the shared tools core offers
 * (ngdpbase#1813, approved 2026-10-15). Core passes them as the third
 * argument of register(engine, config, host). Until core ships that, a
 * development stand-in builds the same object from the running core.
 *
 * Rule: the add-on never imports ngdpbase. It uses what it is handed, and
 * anything core does not offer is a PR to ngdpbase.
 *
 * The names match ngdpbase's own exports (#1813 slice 1), so switching from
 * the stand-in to core's object changes nothing below this file.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** A request's caller, as core's ApiContext gives it. Only what phr uses. */
export interface ApiContextLike {
  readonly isAuthenticated: boolean;
  readonly username: string | null;
  readonly isTest?: boolean;
  requirePermission(permission: string): Promise<void>;
  hasPermission(permission: string): Promise<boolean>;
  actingUsername(): string;
}

export interface AddonLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface AddonHost {
  ApiContext: { from(req: unknown, engine: unknown): ApiContextLike };
  ApiError: new (status: number, message: string) => Error;
  sendApiError(res: unknown, err: unknown, mode?: 'json' | 'text' | 'page'): void;
  recordAuditEvent(sink: unknown, event: Record<string, unknown>, onError?: unknown): Promise<unknown>;
  addonAuditEventName(name: string): string;
  actorOf(ctx: unknown): Record<string, unknown>;
  jobContextFromRequest(userContext: unknown): unknown;
  jobContextFromSystem(reason: string): unknown;
  logger: AddonLogger;
  guardedFetch(url: string | URL, init?: Record<string, unknown>): Promise<Response>;
}

/**
 * Development stand-in for core's host object. Imports the running core's
 * own build (resolved from the server's working directory, which is the
 * ngdpbase checkout), so it is the same copy of core, never a second one.
 * Deleted once core passes `host` to register().
 */
export async function standInHost(): Promise<AddonHost> {
  const dist = (rel: string): Promise<Record<string, unknown>> =>
    import(pathToFileURL(path.join(process.cwd(), 'dist', 'src', rel)).href) as Promise<Record<string, unknown>>;
  const [api, audit, names, actor, jobs, log, http] = await Promise.all([
    dist('context/ApiContext.js'),
    dist('utils/auditEvents.js'),
    dist('utils/auditEventNames.js'),
    dist('context/ActorContext.js'),
    dist('context/JobContext.js'),
    dist('utils/logger.js'),
    dist('http/guardedFetch.js')
  ]);
  return Object.freeze({
    ApiContext: api.ApiContext,
    ApiError: api.ApiError,
    sendApiError: api.sendApiError,
    recordAuditEvent: audit.recordAuditEvent,
    addonAuditEventName: names.addonAuditEventName,
    actorOf: actor.actorOf,
    jobContextFromRequest: jobs.jobContextFromRequest,
    jobContextFromSystem: jobs.jobContextFromSystem,
    // Same as core's host (ngdpbase#1814): a child logger tagged with the slug.
    logger: (log.default as { child?(meta: Record<string, unknown>): AddonLogger }).child?.({ addon: 'phr' }) ?? (log.default as AddonLogger),
    guardedFetch: http.guardedFetch
  }) as unknown as AddonHost;
}
