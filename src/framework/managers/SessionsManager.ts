/**
 * Sessions — the door to "who is signed in" (yourphr#611), split from Users because token
 * generation and revocation have a lifecycle of their own ([#528] was precisely that lifecycle
 * failing silently while buried in the user row).
 *
 * Sign-in: throttled per ACCOUNT and per IP before any verification (yourphr#509), the per-IP key
 * trusting X-Forwarded-For only from a declared proxy (yourphr#529); then every configured FACTOR
 * must pass — `yourphr.auth.factors` is an ALL-OF list, never "try each until one succeeds" (the doc's
 * MFA-bypass warning, tested); one generic refusal for every failure (yourphr#104). The provider's
 * AuthResult carries the token generation into the session claims, so a password change or a
 * sign-out-everywhere ends the session mid-flight. Sliding TTL with an absolute cap (yourphr#445).
 *
 * Tokens are HMAC-signed claims under a per-process key; the counter is in the database, which
 * is what makes revocation real.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { BaseManager, type BackupData } from '../BaseManager.js';
import type { Engine } from '../Engine.js';
import { ApiError, type ApiContext, type Principal } from '../ApiContext.js';
import type { BaseAuthProvider } from '../providers/BaseAuthProvider.js';
import { boundedNumber } from '../ConfigurationManager.js';

declare module '../Engine.js' {
  interface ManagerRegistry {
    sessions: SessionsManager;
  }
}

/** The one message for every sign-in failure (yourphr#104). */
export const GENERIC_SIGNIN_ERROR = 'invalid username or password';

export interface SessionClaims { u: string; g: number; iat: number; exp: number; cap: number }
export interface SessionPolicy { slidingSeconds: number; absoluteSeconds: number }
export interface ThrottlePolicy { maxFailures: number; windowSeconds: number }
export const DefaultSessionPolicy: SessionPolicy = { slidingSeconds: 60 * 60, absoluteSeconds: 12 * 60 * 60 };
export const DefaultThrottlePolicy: ThrottlePolicy = { maxFailures: 5, windowSeconds: 15 * 60 };

const b64url = (data: Buffer | string): string => Buffer.from(data).toString('base64url');
const mac = (key: Buffer, payload: string): Buffer => createHmac('sha256', key).update(payload).digest();

export function issueToken(key: Buffer, claims: SessionClaims): string {
  const payload = b64url(JSON.stringify(claims));
  return `${payload}.${b64url(mac(key, payload))}`;
}

export function decodeToken(key: Buffer, token: string): SessionClaims | undefined {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return undefined;
  const payload = token.slice(0, dot);
  const signature = Buffer.from(token.slice(dot + 1), 'base64url');
  const expected = mac(key, payload);
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SessionClaims;
    if (typeof claims.u !== 'string' || typeof claims.g !== 'number' || typeof claims.exp !== 'number' || typeof claims.cap !== 'number') return undefined;
    return claims;
  } catch {
    return undefined;
  }
}

/** Fixed-size sliding windows per key, in memory (recorded limitation: not restart-durable). */
export class Throttle {
  private readonly failures = new Map<string, number[]>();
  constructor(private readonly policy: ThrottlePolicy = DefaultThrottlePolicy) {}
  isLimited(key: string, nowSeconds: number): boolean {
    const cutoff = nowSeconds - this.policy.windowSeconds;
    const recent = (this.failures.get(key) ?? []).filter((t) => t > cutoff);
    this.failures.set(key, recent);
    return recent.length >= this.policy.maxFailures;
  }
  recordFailure(key: string, nowSeconds: number): void {
    const list = this.failures.get(key) ?? [];
    list.push(nowSeconds);
    this.failures.set(key, list);
  }
  clear(key: string): void { this.failures.delete(key); }
}

/** Trusted proxy (yourphr#529): the per-IP throttle key. X-Forwarded-For is believed only from a declared peer. */
export function clientIp(remoteAddr: string, xffHeader: string | undefined, trustedProxies: string[]): string {
  if (!xffHeader || !trustedProxies.includes(remoteAddr)) return remoteAddr;
  const hops = xffHeader.split(',').map((h) => h.trim()).filter(Boolean);
  return hops.length > 0 ? (hops[hops.length - 1] as string) : remoteAddr;
}

export interface SessionsOptions {
  /** Per-process; a restart ends every session, which is the intended posture for a family box. */
  sessionKey?: Buffer;
  session?: SessionPolicy;
  throttle?: ThrottlePolicy;
  trustedProxies?: string[];
  /** The all-of factor list (`yourphr.auth.factors`); each names a registered provider. Default ['password']. */
  factors?: string[];
}

export class SessionsManager extends BaseManager {
  readonly name = 'sessions' as const;
  override readonly dependsOn = ['users'] as const;
  readonly throttle: Throttle;
  private readonly sessionKey: Buffer;
  private readonly policy: SessionPolicy;
  private readonly trustedProxies: string[];
  private readonly factors: string[];
  private readonly providers = new Map<string, BaseAuthProvider>();

  constructor(engine: Engine, providers: BaseAuthProvider[], options: SessionsOptions = {}) {
    super(engine);
    for (const p of providers) this.providers.set(p.name, p);
    this.sessionKey = options.sessionKey ?? randomBytes(32);
    /**
     * Every number is checked before it becomes policy (yourphr#698 item 2). These arrive straight
     * from configuration, and the two failures are not symmetrical:
     *
     * - `session.sliding-seconds: '60m'` is NaN, so `exp` is NaN, `JSON.stringify` writes it as
     *   null, and `decodeToken` refuses every token — nobody can sign in, and nothing says why.
     * - `throttle.max-failures: '5 tries'` is NaN, and `recent.length >= NaN` is FALSE, so the
     *   brute-force throttle silently stops limiting. That one fails OPEN, which is the reason
     *   this is validated here rather than trusted from the caller.
     *
     * All four are intervals or TTLs, so none has a meaningful zero — a zero window throttles
     * nothing and a zero TTL mints a session already expired. Counts with a real zero (the agent
     * token caps) pass `min: 0` instead; the shared helper carries that distinction.
     */
    const atLeastOne = (value: number | undefined, fallback: number, key: string): number =>
      value === undefined ? fallback : boundedNumber(value, fallback, key, 1);
    const session = options.session;
    const throttle = options.throttle;
    this.policy = {
      slidingSeconds: atLeastOne(session?.slidingSeconds, DefaultSessionPolicy.slidingSeconds, 'yourphr.auth.session.sliding-seconds'),
      absoluteSeconds: atLeastOne(session?.absoluteSeconds, DefaultSessionPolicy.absoluteSeconds, 'yourphr.auth.session.absolute-seconds'),
    };
    this.throttle = new Throttle({
      maxFailures: atLeastOne(throttle?.maxFailures, DefaultThrottlePolicy.maxFailures, 'yourphr.auth.throttle.max-failures'),
      windowSeconds: atLeastOne(throttle?.windowSeconds, DefaultThrottlePolicy.windowSeconds, 'yourphr.auth.throttle.window-seconds'),
    });
    this.trustedProxies = options.trustedProxies ?? [];
    this.factors = options.factors?.length ? options.factors : ['password'];
  }

  override async initialize(config: Record<string, unknown> = {}): Promise<void> {
    // A factor nobody provides cannot be satisfied — refuse to boot rather than sign nobody in at runtime.
    for (const f of this.factors) if (!this.providers.has(f)) throw new Error(`sessions: auth.factors names "${f}" but no such auth provider is registered (have: ${[...this.providers.keys()].join(', ') || 'none'})`);
    await super.initialize(config);
  }

  get factorList(): readonly string[] { return this.factors; }

  /**
   * Sign in. Credentials are keyed by factor name (`{ password: '…', totp: '…' }`); EVERY factor in
   * `yourphr.auth.factors` must pass. Unknown accounts still cost a real verification and get the same message.
   */
  async signIn(
    username: string,
    credentials: Record<string, string>,
    request: { remoteAddr: string; xff?: string },
    nowSeconds = Math.floor(Date.now() / 1000)
  ): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
    const ip = clientIp(request.remoteAddr, request.xff, this.trustedProxies);
    const accountKey = `acct:${username}`;
    const ipKey = `ip:${ip}`;
    if (this.throttle.isLimited(accountKey, nowSeconds) || this.throttle.isLimited(ipKey, nowSeconds)) {
      return { ok: false, error: GENERIC_SIGNIN_ERROR }; // "you are throttled" on a chosen username is enumeration by another door
    }
    const users = this.engine.managers.users;
    const stored = await users.record(username);
    let generation: number | undefined;
    for (const factor of this.factors) {
      const provider = this.providers.get(factor)!;
      const result = await provider.authenticate(username, credentials[factor] ?? '', stored, nowSeconds);
      if (!result.ok) {
        this.throttle.recordFailure(accountKey, nowSeconds);
        this.throttle.recordFailure(ipKey, nowSeconds);
        return { ok: false, error: GENERIC_SIGNIN_ERROR };
      }
      if (result.rehash) await users.rehash(username, result.rehash);
      generation = result.tokenGeneration;
    }
    if (!stored || generation === undefined) {
      this.throttle.recordFailure(accountKey, nowSeconds);
      this.throttle.recordFailure(ipKey, nowSeconds);
      return { ok: false, error: GENERIC_SIGNIN_ERROR };
    }
    this.throttle.clear(accountKey);
    users.onSignedIn(username);
    return { ok: true, token: this.mint(username, generation, nowSeconds) };
  }

  /**
   * "Confirm it is you" for an action that needs a fresh proof inside a live session — granting or
   * extending a connected device (yourphr#807, decision 3). Answers whether the SIGNED-IN person
   * just satisfied every configured primary factor (the password today; passkeys and others as
   * ngdpbase#1523 brings them), under the same per-account and per-IP throttle as sign-in, so it
   * is no side door for guessing. A delegated credential can never satisfy it.
   *
   * Interim by design: ngdpbase#1525's step-up replaces this when it lands.
   */
  async reauthenticate(
    ctx: { username: string; viaToken?: unknown; isAuthenticated: boolean },
    credentials: Record<string, string>,
    request: { remoteAddr: string; xff?: string },
    nowSeconds = Math.floor(Date.now() / 1000)
  ): Promise<boolean> {
    if (!ctx.isAuthenticated || ctx.viaToken) return false;
    const ip = clientIp(request.remoteAddr, request.xff, this.trustedProxies);
    const accountKey = `acct:${ctx.username}`;
    const ipKey = `ip:${ip}`;
    if (this.throttle.isLimited(accountKey, nowSeconds) || this.throttle.isLimited(ipKey, nowSeconds)) return false;
    const stored = await this.engine.managers.users.record(ctx.username);
    for (const factor of this.factors) {
      const result = await this.providers.get(factor)!.authenticate(ctx.username, credentials[factor] ?? '', stored, nowSeconds);
      if (!result.ok || !stored) {
        this.throttle.recordFailure(accountKey, nowSeconds);
        this.throttle.recordFailure(ipKey, nowSeconds);
        return false;
      }
    }
    return true;
  }

  private mint(username: string, generation: number, nowSeconds: number): string {
    return issueToken(this.sessionKey, { u: username, g: generation, iat: nowSeconds, exp: nowSeconds + this.policy.slidingSeconds, cap: nowSeconds + this.policy.absoluteSeconds });
  }

  /**
   * Verify a session. Refuses: bad signature, past sliding expiry, past absolute cap, and a
   * generation behind the account's (yourphr#508). Inside the renewal half of the window a fresh
   * token comes back (sliding TTL, capped — yourphr#445). Answers the principal the request context is built from.
   */
  async verify(token: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<{ ok: true; principal: Principal; renewed?: string } | { ok: false }> {
    const claims = decodeToken(this.sessionKey, token);
    if (!claims || nowSeconds >= claims.exp || nowSeconds >= claims.cap) return { ok: false };
    const stored = await this.engine.managers.users.record(claims.u);
    if (!stored || claims.g < stored.tokenGeneration) return { ok: false };
    let renewed: string | undefined;
    if (claims.exp - nowSeconds < this.policy.slidingSeconds / 2) {
      renewed = issueToken(this.sessionKey, { ...claims, exp: Math.min(nowSeconds + this.policy.slidingSeconds, claims.cap) });
    }
    // The role is resolved through the Users door, not read raw off the record (yourphr#648): a
    // stored name this instance no longer defines has to behave as the least-privileged role, the
    // same way it does everywhere else. Reading it raw would hand ApiContext a name the policy does
    // not know, and the caller would get NO permissions — not even to read their own records.
    const role = (await this.engine.managers.users.roleOf(claims.u)) ?? stored.role;
    return { ok: true, principal: { username: claims.u, role, tokenGeneration: claims.g }, ...(renewed ? { renewed } : {}) };
  }

  /** A fresh session for an account that just proved itself another way (after a password change). */
  async issueFor(username: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<string | undefined> {
    const stored = await this.engine.managers.users.record(username);
    return stored ? this.mint(username, stored.tokenGeneration, nowSeconds) : undefined;
  }

  /** Ends every session of the caller, everywhere (yourphr#508's sign-out-everywhere). */
  async revokeAll(ctx: ApiContext): Promise<void> {
    ctx.requireAuthenticated();
    await this.engine.managers.users.bumpGeneration(ctx.username);
  }

  async backup(): Promise<BackupData> {
    return { manager: this.name, takenAt: new Date().toISOString(), payload: { note: 'sessions are per-process; nothing to carry' } };
  }

  async restore(): Promise<void> {
    throw new ApiError(501, 'sessions are not restored; sign in again');
  }
}
