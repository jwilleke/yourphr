/**
 * What ngdpbase hands this add-on: the shared tools core offers, passed as
 * the third argument of register(engine, config, host) (ngdpbase#1813,
 * shipped in ngdpbase v5.10.0). Only the shapes phr uses are declared here.
 *
 * Rule: the add-on never imports ngdpbase. It uses what it is handed, and
 * anything core does not offer is a PR to ngdpbase.
 */
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
