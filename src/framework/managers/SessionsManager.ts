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
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { BaseManager, type BackupData } from '../BaseManager.js';
import type { Engine } from '../Engine.js';
import { ApiContext, ApiError, type Principal } from '../ApiContext.js';
import { ACCOUNT_EVENT_CATEGORIES } from '../../account/index.js';
import type { BaseAuthProvider } from '../providers/BaseAuthProvider.js';
import type { BaseCredentialsProvider, CredentialRecord, RejectedCredential } from '../providers/BaseCredentialsProvider.js';
import { PasskeyAuthProvider, relyingPartyFrom } from '../providers/PasskeyAuthProvider.js';
import { boundedNumber } from '../ConfigurationManager.js';

declare module '../Engine.js' {
  interface ManagerRegistry {
    sessions: SessionsManager;
  }
}

/** The one message for every sign-in failure (yourphr#104). */
export const GENERIC_SIGNIN_ERROR = 'invalid username or password';
/**
 * The answer once the throttle trips (yourphr#507/#840, Jim 2026-09-30). The SAME for every username
 * that trips it, real or not — the throttle counts per typed name either way — so it says nothing
 * about which accounts exist, while telling the real person not to keep retrying a good password.
 */
export const THROTTLED_SIGNIN_ERROR = 'Too many attempts. Wait a few minutes and try again.';

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
  /** Operator log lines (an account event that could not be recorded). */
  log?: (line: string) => void;
  /** The credentials store (yourphr#876) — passkeys and, later, other factors. Absent: no passkeys. */
  credentials?: BaseCredentialsProvider;
  /** Passkey settings (yourphr#876): on only with an explicit https (or localhost) base URL. */
  passkey?: { enabled: boolean; baseUrl: string; rpName: string };
}

/** A credential as its owner sees it — never the secret. ngdpbase's CredentialView. */
export type CredentialView = Omit<CredentialRecord, 'secret'>;

/** What proves "it is you" before a passkey is added (yourphr#876, decision 2): the password, or an existing passkey. */
export interface IdentityProof { password?: string; passkey?: { handle: string; response: unknown } }

/** ngdpbase's name rules for a credential: whitespace collapsed, trimmed, at most 60, never empty. */
export const CREDENTIAL_LABEL_MAX = 60;
export function credentialLabel(label: unknown): string {
  const tidy = (typeof label === 'string' ? label : '').replace(/\s+/g, ' ').trim().slice(0, CREDENTIAL_LABEL_MAX).trim();
  if (tidy === '') throw new ApiError(400, 'Give it a name, so you can tell your passkeys apart.');
  return tidy;
}

/** A challenge is used once, within 5 minutes, for the one purpose it was issued for (ngdpbase's rule). */
const CHALLENGE_TTL_SECONDS = 5 * 60;
type ChallengePurpose = 'authenticate' | 'register' | 'confirm';
interface PendingChallenge { value: string; purpose: ChallengePurpose; username?: string; expires: number }
export const PASSKEY_SIGNIN_ERROR = 'That passkey could not sign you in.';

export class SessionsManager extends BaseManager {
  readonly name = 'sessions' as const;
  override readonly dependsOn = ['users'] as const;
  readonly throttle: Throttle;
  private readonly sessionKey: Buffer;
  private readonly policy: SessionPolicy;
  private readonly trustedProxies: string[];
  private readonly factors: string[];
  private readonly providers = new Map<string, BaseAuthProvider>();
  private readonly throttlePolicy: ThrottlePolicy;
  private readonly log: (line: string) => void;
  private readonly credentials: BaseCredentialsProvider | null;
  private readonly passkeySettings: SessionsOptions['passkey'];
  private passkeys: PasskeyAuthProvider | null = null;
  /**
   * Challenges between "options" and "verify" (yourphr#876). ngdpbase keeps one in the Express
   * session; yourPHR's sessions are stateless tokens, so they live here, keyed by an opaque handle
   * the browser carries back. In memory: a restart drops pending ones, which costs a retry.
   */
  private readonly challenges = new Map<string, PendingChallenge>();

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
    this.throttlePolicy = {
      maxFailures: atLeastOne(throttle?.maxFailures, DefaultThrottlePolicy.maxFailures, 'yourphr.auth.throttle.max-failures'),
      windowSeconds: atLeastOne(throttle?.windowSeconds, DefaultThrottlePolicy.windowSeconds, 'yourphr.auth.throttle.window-seconds'),
    };
    this.throttle = new Throttle(this.throttlePolicy);
    this.log = options.log ?? (() => undefined);
    this.trustedProxies = options.trustedProxies ?? [];
    this.factors = options.factors?.length ? options.factors : ['password'];
    this.credentials = options.credentials ?? null;
    this.passkeySettings = options.passkey;
  }

  override async initialize(config: Record<string, unknown> = {}): Promise<void> {
    // A factor nobody provides cannot be satisfied — refuse to boot rather than sign nobody in at runtime.
    for (const f of this.factors) if (!this.providers.has(f)) throw new Error(`sessions: auth.factors names "${f}" but no such auth provider is registered (have: ${[...this.providers.keys()].join(', ') || 'none'})`);
    if (this.credentials) await this.credentials.initialize((rejected) => this.raiseRejectedCredentials(rejected));
    this.registerPasskeys();
    await super.initialize(config);
  }

  /** ngdpbase's registerPasskeys: on only with the store, the setting, and an explicit secure base URL. */
  private registerPasskeys(): void {
    const settings = this.passkeySettings;
    if (!settings?.enabled) return;
    if (!this.credentials) { this.log('passkeys: off — the credentials store is not open (YOURPHR_CREDENTIALS_KEY)'); return; }
    if (settings.baseUrl.trim() === '') { this.log('passkeys: off — set yourphr.application.base-url (https) to turn them on'); return; }
    const rp = relyingPartyFrom(settings.baseUrl, settings.rpName);
    if (!rp) { this.log(`passkeys: off — yourphr.application.base-url (${settings.baseUrl}) is not https or localhost`); return; }
    const store = this.credentials;
    this.passkeys = new PasskeyAuthProvider(rp, {
      find: (id) => store.findBySubject('passkey', id),
      used: (id, at, secret) => store.touch(id, at, secret),
    }, this.log);
    this.log(`passkeys: on, tied to ${rp.rpID}`);
  }

  /**
   * A row the store could not trust (ngdpbase's raiseRejectedCredentials): kept, never used, and
   * every admin is told, because a row nobody signed is either damage or someone adding a way in.
   */
  private raiseRejectedCredentials(rejected: RejectedCredential[]): void {
    const summary = rejected.map((r) => `${r.reason}${r.row.username ? ` (${r.row.username})` : ''}`).join(', ');
    this.log(`credentials store: ${rejected.length} row(s) set aside — ${summary}`);
    if (!this.engine.has('notifications') || !this.engine.has('users')) return;
    const engine = this.engine;
    void (async () => {
      try {
        const admins = await engine.managers.users.holders(ApiContext.system('credentials store: who holds admin', 'sessions', engine), 'admin');
        await engine.managers.notifications.createNotification({
          type: 'system', level: 'error', targetUsers: admins, key: 'credentials.rejected',
          title: 'Sign-in credentials failed their check',
          message: `${rejected.length} stored sign-in credential(s) were not signed by this instance and are not being used. Either the database was changed outside yourPHR, or YOURPHR_CREDENTIALS_KEY changed.`,
        });
      } catch (err) {
        this.log(`credentials store: alert not sent: ${(err as Error).message}`);
      }
    })();
  }

  // --- passkeys (yourphr#876) ------------------------------------------------------------------

  /** The host passkeys are tied to, or null while they are off. */
  passkeyHost(): string | null {
    return this.passkeys ? this.passkeys.relyingParty().rpID : null;
  }

  private keepChallenge(value: string, purpose: ChallengePurpose, nowSeconds: number, username?: string): string {
    for (const [h, c] of this.challenges) if (c.expires <= nowSeconds) this.challenges.delete(h);
    const handle = randomUUID();
    this.challenges.set(handle, { value, purpose, expires: nowSeconds + CHALLENGE_TTL_SECONDS, ...(username !== undefined ? { username } : {}) });
    return handle;
  }

  /** Always spends the handle; answers the challenge only for the right purpose, person and time. */
  private takeChallenge(handle: unknown, purpose: ChallengePurpose, nowSeconds: number, username?: string): string | null {
    if (typeof handle !== 'string') return null;
    const c = this.challenges.get(handle);
    this.challenges.delete(handle);
    if (!c || c.purpose !== purpose || c.expires <= nowSeconds || c.username !== username) return null;
    return c.value;
  }

  private requirePasskeys(): PasskeyAuthProvider {
    if (!this.passkeys) throw new ApiError(404, 'passkeys are not available on this instance');
    return this.passkeys;
  }

  private requireOwnAccount(ctx: ApiContext): void {
    ctx.requireAuthenticated();
    // A delegated credential manages no sign-in methods — the outer lock is the agent gate.
    if (ctx.viaToken) throw new ApiError(403, 'an agent token cannot manage sign-in methods');
  }

  /** Options for a passkey sign-in: no username asked; any passkey for this host may answer. */
  async passkeySignInOptions(nowSeconds = Math.floor(Date.now() / 1000)): Promise<{ handle: string; options: unknown }> {
    const options = await this.requirePasskeys().authenticationOptions();
    return { handle: this.keepChallenge(options.challenge, 'authenticate', nowSeconds), options };
  }

  /**
   * Sign in with a passkey. A passkey alone signs a person in (ngdpbase#448). Throttled per client
   * IP like a password sign-in — ngdpbase leaves its passkey path unthrottled; this does not.
   */
  async signInWithPasskey(
    handle: unknown,
    response: unknown,
    request: { remoteAddr: string; xff?: string },
    nowSeconds = Math.floor(Date.now() / 1000)
  ): Promise<{ ok: true; token: string } | { ok: false; error: string; throttled?: { retryAfterSeconds: number } }> {
    const provider = this.requirePasskeys();
    const ipKey = `ip:${clientIp(request.remoteAddr, request.xff, this.trustedProxies)}`;
    if (this.throttle.isLimited(ipKey, nowSeconds)) {
      return { ok: false, error: THROTTLED_SIGNIN_ERROR, throttled: { retryAfterSeconds: this.throttlePolicy.windowSeconds } };
    }
    const challenge = this.takeChallenge(handle, 'authenticate', nowSeconds);
    const verified = challenge === null ? null : await provider.verify({ response, expectedChallenge: challenge });
    const stored = verified ? await this.engine.managers.users.record(verified.username) : undefined;
    if (!verified || !stored) {
      this.throttle.recordFailure(ipKey, nowSeconds);
      return { ok: false, error: PASSKEY_SIGNIN_ERROR };
    }
    this.throttle.clear(`acct:${stored.username}`);
    this.engine.managers.users.onSignedIn(stored.username);
    await this.recordAccountEvent(stored.username, ACCOUNT_EVENT_CATEGORIES.passkeySignIn, nowSeconds);
    return { ok: true, token: this.mint(stored.username, stored.tokenGeneration, nowSeconds) };
  }

  /** Options for confirming "it is you" with a passkey the signed-in person already has (decision 2). */
  async passkeyConfirmOptions(ctx: ApiContext, nowSeconds = Math.floor(Date.now() / 1000)): Promise<{ handle: string; options: unknown }> {
    this.requireOwnAccount(ctx);
    const options = await this.requirePasskeys().authenticationOptions();
    return { handle: this.keepChallenge(options.challenge, 'confirm', nowSeconds, ctx.username), options };
  }

  /** The password, or one of the person's own passkeys, proved just now. */
  private async confirmIdentity(ctx: ApiContext, proof: IdentityProof, request: { remoteAddr: string; xff?: string }, nowSeconds: number): Promise<boolean> {
    if (proof.passkey) {
      const challenge = this.takeChallenge(proof.passkey.handle, 'confirm', nowSeconds, ctx.username);
      if (challenge === null) return false;
      const verified = await this.requirePasskeys().verify({ response: proof.passkey.response, expectedChallenge: challenge });
      return verified?.username === ctx.username;
    }
    return this.reauthenticate(ctx, { password: proof.password ?? '' }, request, nowSeconds);
  }

  /** Options for adding a passkey, after the person confirms it is them. Existing passkeys are excluded. */
  async passkeyRegistrationOptions(
    ctx: ApiContext,
    proof: IdentityProof,
    request: { remoteAddr: string; xff?: string },
    nowSeconds = Math.floor(Date.now() / 1000)
  ): Promise<{ handle: string; options: unknown }> {
    this.requireOwnAccount(ctx);
    const provider = this.requirePasskeys();
    if (!(await this.confirmIdentity(ctx, proof, request, nowSeconds))) {
      throw new ApiError(403, 'That did not confirm it is you. Enter your password, or use a passkey you already have.');
    }
    const existing = (await this.credentials!.list(ctx.username)).filter((c) => c.kind === 'passkey');
    const options = await provider.registrationOptions(ctx.username, ctx.username, existing);
    return { handle: this.keepChallenge(options.challenge, 'register', nowSeconds, ctx.username), options };
  }

  /** Verify and keep a new passkey. The name is checked first, so a bad one does not spend the challenge. */
  async passkeyRegister(ctx: ApiContext, handle: unknown, response: unknown, label: unknown, nowSeconds = Math.floor(Date.now() / 1000)): Promise<{ id: string }> {
    this.requireOwnAccount(ctx);
    const provider = this.requirePasskeys();
    const name = credentialLabel(label);
    const challenge = this.takeChallenge(handle, 'register', nowSeconds, ctx.username);
    if (challenge === null) throw new ApiError(400, 'That took too long, or was already used. Start adding the passkey again.');
    const verified = await provider.verifyRegistration(response as never, challenge);
    if (!verified) throw new ApiError(400, 'The passkey could not be added. Try again.');
    if (this.credentials!.findBySubject('passkey', verified.subject)) throw new ApiError(409, 'That passkey is already added.');
    const record: CredentialRecord = { id: randomUUID(), username: ctx.username, kind: 'passkey', subject: verified.subject, secret: verified.secret, label: name, createdAt: new Date(nowSeconds * 1000).toISOString() };
    await this.credentials!.add(record);
    await this.recordAccountEvent(ctx.username, ACCOUNT_EVENT_CATEGORIES.passkeyAdded, nowSeconds);
    return { id: record.id };
  }

  /** The person's own sign-in methods: the password, and each credential without its secret. */
  async credentialsOf(ctx: ApiContext): Promise<{ hasPassword: boolean; passkeyHost: string | null; credentials: CredentialView[] }> {
    this.requireOwnAccount(ctx);
    const stored = await this.engine.managers.users.record(ctx.username);
    const rows = this.credentials ? await this.credentials.list(ctx.username) : [];
    return {
      hasPassword: (stored?.passwordHash ?? '') !== '',
      passkeyHost: this.passkeyHost(),
      credentials: rows.map(({ secret: _secret, ...view }) => view),
    };
  }

  private async ownCredential(ctx: ApiContext, id: string): Promise<CredentialRecord> {
    this.requireOwnAccount(ctx);
    const row = this.credentials ? await this.credentials.get(id) : null;
    if (!row || row.username !== ctx.username) throw new ApiError(404, 'no such sign-in method');
    return row;
  }

  async renameCredential(ctx: ApiContext, id: string, label: unknown, nowSeconds = Math.floor(Date.now() / 1000)): Promise<void> {
    const row = await this.ownCredential(ctx, id);
    await this.credentials!.relabel(row.id, credentialLabel(label));
    await this.recordAccountEvent(ctx.username, ACCOUNT_EVENT_CATEGORIES.passkeyRenamed, nowSeconds);
  }

  /**
   * Remove a credential — never the last way in (ngdpbase's rule): with no password and no other
   * passkey, removing it would lock the person out of their own records.
   */
  async removeCredential(ctx: ApiContext, id: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<void> {
    const row = await this.ownCredential(ctx, id);
    const stored = await this.engine.managers.users.record(ctx.username);
    const otherWaysIn = (await this.credentials!.list(ctx.username)).filter((c) => c.id !== row.id && c.kind === 'passkey').length;
    if (otherWaysIn === 0 && (stored?.passwordHash ?? '') === '') {
      throw new ApiError(409, 'This is your only way to sign in. Add another passkey or set a password before removing it.');
    }
    await this.credentials!.remove(row.id);
    await this.recordAccountEvent(ctx.username, ACCOUNT_EVENT_CATEGORIES.passkeyRemoved, nowSeconds);
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
  ): Promise<{ ok: true; token: string } | { ok: false; error: string; throttled?: { retryAfterSeconds: number } }> {
    const ip = clientIp(request.remoteAddr, request.xff, this.trustedProxies);
    const accountKey = `acct:${username}`;
    const ipKey = `ip:${ip}`;
    if (this.throttle.isLimited(accountKey, nowSeconds) || this.throttle.isLimited(ipKey, nowSeconds)) {
      return { ok: false, error: THROTTLED_SIGNIN_ERROR, throttled: { retryAfterSeconds: this.throttlePolicy.windowSeconds } };
    }
    const users = this.engine.managers.users;
    const stored = await users.record(username);
    const fail = async (): Promise<{ ok: false; error: string }> => {
      const wasPaused = this.throttle.isLimited(accountKey, nowSeconds);
      this.throttle.recordFailure(accountKey, nowSeconds);
      this.throttle.recordFailure(ipKey, nowSeconds);
      // The significant event reaches the account's owner (yourphr#507): the failure that pauses
      // sign-ins, once, into THEIR access log. Never for an account that does not exist — there is
      // nobody to tell, and the system audit log (#840) is where those attempts belong.
      if (stored && !wasPaused && this.throttle.isLimited(accountKey, nowSeconds)) {
        await this.recordAccountEvent(username, ACCOUNT_EVENT_CATEGORIES.signInsPaused, nowSeconds);
      }
      return { ok: false, error: GENERIC_SIGNIN_ERROR };
    };
    let generation: number | undefined;
    for (const factor of this.factors) {
      const provider = this.providers.get(factor)!;
      const result = await provider.authenticate(username, credentials[factor] ?? '', stored, nowSeconds);
      if (!result.ok) return fail();
      if (result.rehash) await users.rehash(username, result.rehash);
      generation = result.tokenGeneration;
    }
    if (!stored || generation === undefined) return fail();
    this.throttle.clear(accountKey);
    users.onSignedIn(username);
    await this.recordAccountEvent(username, ACCOUNT_EVENT_CATEGORIES.signedIn, nowSeconds);
    return { ok: true, token: this.mint(username, generation, nowSeconds) };
  }

  /**
   * An account event in the person's own access log (yourphr#507). Best effort, unlike a read of the
   * record: a sign-in that cannot be logged still signs in — refusing it would lock the operator out
   * of the very instance whose log needs fixing. A failure is logged for the operator.
   */
  private async recordAccountEvent(username: string, category: string, nowSeconds: number): Promise<void> {
    if (!this.engine.has('audit')) return;
    try {
      await this.engine.managers.audit.record(ApiContext.system(username, username, this.engine), category, new Date(nowSeconds * 1000));
    } catch (err) {
      this.log(`sessions: could not record "${category}" for an account: ${(err as Error).message}`);
    }
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
