/**
 * Agent tokens (yourphr#695): a credential a patient mints for themselves and hands to an agent —
 * an AI client, a script — so it can read their records on their behalf.
 *
 * Adopted from ngdpbase's `AgentTokenManager` (its #946), and specifically from the version AFTER
 * its #1108 review: porting the original would have carried eight defects into a PHI store. The
 * three rules that review produced are invariants here, not style:
 *
 *  1. **An unreadable date means expired, everywhere.** `Date.parse` answers NaN for a malformed
 *     value, and `NaN <= now` and `NaN > now` are BOTH false — so a naive verify reads a broken
 *     expiry as valid while a naive listing reads the same row as not-live. That combination is a
 *     token that authenticates forever and appears in no list, not even an admin's. Every
 *     comparison goes through `expiryMs()`, which collapses unparseable to -Infinity.
 *  2. **Nothing hands out a live reference to a stored record**, and nothing hands out the hash.
 *     `AgentTokenView` has no `hash` field, so it cannot leak by being forgotten.
 *  3. **Limits cannot be disabled by a typo.** `Number('24h')` is NaN and `ttl > NaN` is false, so
 *     an unvalidated config value silently removes the ceiling. `positiveInt()` falls back.
 *
 * ## What this stack does differently from ngdpbase, and why
 *
 * **Scopes are ACCESS CATEGORIES, not permission names.** ngdpbase's scopes are action names
 * (`page-create`) because it has actions to name. Here the `user` role holds no permissions at all
 * — a person's reach into their own records is compartmentalised by `user_id`, not gated by a
 * permission — so there was nothing for a scope to narrow. The access log's categories already
 * enumerate every read surface in patient-legible words, so they are the vocabulary: one list
 * decides what an agent may read, what the log calls it, and what the minting screen shows.
 *
 * The consequence is the safety property: **a surface that cannot be logged cannot be scoped.** An
 * agent can never reach a read the patient would not see recorded, because the same map answers
 * both questions. It also makes the first cut read-only structurally rather than by a flag — only
 * listed GETs have a category, so no write has a scope to be granted.
 *
 * **Minting, renewing and revoking need the OWNER'S SESSION.** An agent token can do none of them,
 * including to itself. A delegation that can extend its own life is not delegated any more, and a
 * 24-hour cap a token can lift is a cap on paper only.
 *
 * **Renewal re-mints rather than moving a date.** A leaked secret then dies at its original expiry
 * whatever the owner does afterwards.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { BaseManager, type BackupData } from '../BaseManager.js';
import type { Engine } from '../Engine.js';
import { ApiContext, ApiError } from '../ApiContext.js';
import { ACCESS_CATEGORIES, CREDENTIAL_EVENT_CATEGORIES, DEVICE_SCOPES, isAccessCategory } from '../../account/index.js';
import { boundedNumber } from '../ConfigurationManager.js';
import type { AgentTokenRecord, BaseAgentTokensProvider, DeviceGrantRecord } from '../providers/BaseAgentTokensProvider.js';

declare module '../Engine.js' {
  interface ManagerRegistry {
    agentTokens: AgentTokensManager;
  }
}

/**
 * Prefix — makes a leaked token greppable, and scanner-matchable if one ever reaches a repository.
 * The host-bound value ngdpbase isolates for the same reason; theirs is `ngdp_at_`.
 */
export const TOKEN_PREFIX = 'yphr_at_';
/** A device's one-time setup code and its refresh token (yourphr#808) — greppable like the key. */
export const SETUP_CODE_PREFIX = 'yphr_setup_';
export const REFRESH_TOKEN_PREFIX = 'yphr_rt_';
const CONFIG_PREFIX = 'yourphr.auth.agent-token';
const DEVICES_PREFIX = 'yourphr.devices';

/** Connected-device grants (yourphr#807, #808). Read from `yourphr.devices.*`. */
export interface DeviceGrantPolicy {
  enabled: boolean;
  grantMaxDays: number;
  keyTtlHours: number;
  setupCodeMinutes: number;
  maxPerUser: number;
}
export const DefaultDeviceGrantPolicy: DeviceGrantPolicy = { enabled: false, grantMaxDays: 30, keyTtlHours: 24, setupCodeMinutes: 10, maxPerUser: 5 };

/** A grant as the patient sees it: never a hash. */
export type DeviceGrantView = Omit<DeviceGrantRecord, 'setupHash' | 'refreshHash' | 'noticedDays'> & { claimed: boolean; live: boolean };

/** What a device holds after claiming or refreshing: an OAuth-shaped token response. */
export interface DeviceTokens {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  /** The end of the patient's consent — the most any refresh can reach. */
  grant_ends_at: string;
  label: string;
}
const TOKEN_BYTES = 32;

/** What a caller may see: everything the record holds except the hash. */
export type AgentTokenView = Omit<AgentTokenRecord, 'hash'> & {
  /** Whole seconds until expiry; 0 once dead. What the account page shows beside revoke. */
  expiresInSeconds: number;
  live: boolean;
};

export interface AgentTokenPolicy {
  enabled: boolean;
  readOnly: boolean;
  defaultTtlHours: number;
  maxTtlHours: number;
  maxPerUser: number;
  retentionDays: number;
  renewable: boolean;
  /** 0 = unlimited. */
  maxRenewals: number;
  renewWindowHours: number;
}

export const DefaultAgentTokenPolicy: AgentTokenPolicy = {
  enabled: false,
  readOnly: true,
  defaultTtlHours: 24,
  maxTtlHours: 24,
  maxPerUser: 10,
  retentionDays: 30,
  renewable: true,
  maxRenewals: 0,
  renewWindowHours: 6,
};

const sha256 = (value: string): string => `sha256:${createHash('sha256').update(value).digest('hex')}`;

/** Constant-time compare of two equal-length hash strings. */
function hashEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Expiry in milliseconds, where **unparseable means expired**. See invariant 1 in the file header;
 * this single function is what keeps the verify path and the listing path agreeing about a broken
 * row instead of disagreeing in the one direction that hides a live credential.
 */
function expiryMs(record: Pick<AgentTokenRecord, 'expiresAt'>): number {
  const parsed = Date.parse(record.expiresAt);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/** A configured number, or the fallback when it is not a usable one. See invariant 3. */
function positiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export class AgentTokensManager extends BaseManager {
  readonly name = 'agentTokens' as const;
  // Configuration, not users: the policy is read at initialize, and an owner is a string this
  // manager stores rather than an account it resolves.
  override readonly dependsOn = ['configuration', 'audit'] as const;

  private policy: AgentTokenPolicy = { ...DefaultAgentTokenPolicy };
  private devices: DeviceGrantPolicy = { ...DefaultDeviceGrantPolicy };

  constructor(engine: Engine, private readonly provider: BaseAgentTokensProvider) {
    super(engine);
  }

  override async initialize(config: Record<string, unknown> = {}): Promise<void> {
    await super.initialize(config);
    await this.provider.initialize();

    const cfg = this.engine.managers.configuration;
    /**
     * Validated against what each setting MEANS, never a blanket positivity check — the shared
     * `boundedNumber` carries the reasoning and the warning (yourphr#698 item 2, ngdpbase#1110).
     */
    const positive = (key: string, fallback: number): number =>
      boundedNumber(cfg.getInt(`${CONFIG_PREFIX}.${key}`), fallback, `${CONFIG_PREFIX}.${key}`, 1);
    const count = (key: string, fallback: number): number =>
      boundedNumber(cfg.getInt(`${CONFIG_PREFIX}.${key}`), fallback, `${CONFIG_PREFIX}.${key}`, 0);
    this.policy = {
      enabled: cfg.getBool(`${CONFIG_PREFIX}.enabled`),
      readOnly: cfg.getBool(`${CONFIG_PREFIX}.read-only`),
      defaultTtlHours: positive('default-ttl-hours', DefaultAgentTokenPolicy.defaultTtlHours),
      maxTtlHours: positive('max-ttl-hours', DefaultAgentTokenPolicy.maxTtlHours),
      // Zero is an instruction here, not a typo: none allowed, and drop a dead record at once.
      maxPerUser: count('max-per-user', DefaultAgentTokenPolicy.maxPerUser),
      retentionDays: count('retention-days', DefaultAgentTokenPolicy.retentionDays),
      renewable: cfg.getBool(`${CONFIG_PREFIX}.renewable`),
      // 0 = unlimited, which is why it cannot be read as a positive-only setting.
      maxRenewals: count('max-renewals', DefaultAgentTokenPolicy.maxRenewals),
      renewWindowHours: positive('renew-window-hours', DefaultAgentTokenPolicy.renewWindowHours),
    };

    const dev = (key: string, fallback: number, min = 1): number =>
      boundedNumber(cfg.getInt(`${DEVICES_PREFIX}.${key}`), fallback, `${DEVICES_PREFIX}.${key}`, min);
    this.devices = {
      enabled: cfg.getBool(`${DEVICES_PREFIX}.enabled`),
      grantMaxDays: dev('grant-max-days', DefaultDeviceGrantPolicy.grantMaxDays),
      keyTtlHours: dev('key-ttl-hours', DefaultDeviceGrantPolicy.keyTtlHours),
      setupCodeMinutes: dev('setup-code-minutes', DefaultDeviceGrantPolicy.setupCodeMinutes),
      // Zero is an instruction: no devices at all.
      maxPerUser: dev('max-per-user', DefaultDeviceGrantPolicy.maxPerUser, 0),
    };

    // Dead records go on every boot, as ngdpbase does — but unlike ngdpbase (its #1108) this is
    // not the only time it happens: purge also runs on each mint, so a long-lived process still
    // applies its own retention policy.
    await this.purgeExpired();
  }

  get settings(): AgentTokenPolicy { return { ...this.policy }; }

  /** The scope vocabulary a minting screen offers. */
  get availableScopes(): readonly string[] { return ACCESS_CATEGORIES; }

  /**
   * The gate on every management call: a HUMAN session, never an agent token.
   *
   * This is the rule that keeps the TTL cap real. Without it a token could renew itself and a
   * 24-hour credential becomes permanent — which is precisely why ngdpbase shipped no renew at all
   * rather than shipping one that a token could reach.
   */
  private requireHuman(ctx: ApiContext): void {
    ctx.requireAuthenticated();
    if (ctx.viaToken) {
      throw new ApiError(403, 'an agent token cannot manage agent tokens — sign in to do this');
    }
  }

  private requireEnabled(): void {
    if (!this.policy.enabled) {
      throw new ApiError(404, 'agent tokens are not enabled on this instance');
    }
  }

  /**
   * Mint a token for the caller. The cleartext is returned ONCE and never stored.
   */
  async mint(
    ctx: ApiContext,
    name: string,
    scopes: string[],
    ttlHours?: number,
    now: number = Date.now()
  ): Promise<{ token: string; record: AgentTokenView }> {
    this.requireEnabled();
    this.requireHuman(ctx);
    const issued = await this.issue(ctx.username, name, scopes, ttlHours, now, { renewals: 0, renewedFrom: '' });
    await this.recordLifecycle(ctx, CREDENTIAL_EVENT_CATEGORIES.minted, new Date(now));
    return issued;
  }

  /**
   * A credential's life, written where the patient can see it (yourphr#698 item 4).
   *
   * The store cannot answer "what could this credential do, and when was it stopped?" — retention
   * drops the dead row, and a restore of the database would un-revoke it. The access log is the
   * one record that outlives both, so mint, renewal and revocation go there under categories that
   * are deliberately outside the scope vocabulary (see `CREDENTIAL_EVENT_CATEGORIES`).
   *
   * The order differs by event, each in the safe direction. A MINT is logged after the row exists
   * but its failure still fails the call, so nothing hands back a live credential the log missed.
   * A REVOKE is logged after the state change, because a line claiming a revocation that did not
   * happen would tell a patient a leaked token is dead when it is not.
   */
  private async recordLifecycle(ctx: ApiContext, category: string, at: Date): Promise<void> {
    await this.engine.managers.audit.record(ctx, category, at);
  }

  /** The shared minting path — a fresh mint and a renewal differ only in provenance. */
  private async issue(
    owner: string,
    name: string,
    scopes: string[],
    ttlHours: number | undefined,
    now: number,
    lineage: { renewals: number; renewedFrom: string }
  ): Promise<{ token: string; record: AgentTokenView }> {
    const label = String(name ?? '').trim();
    if (label === '') throw new ApiError(400, 'a token needs a name — it is what the access log will call the agent');
    if (label.length > 60) throw new ApiError(400, 'a token name is at most 60 characters');

    // An unscoped token is REFUSED, never treated as unrestricted (ngdpbase #946's decision, and
    // the difference between this and the Go token it replaces, which scoped to the whole account).
    if (!Array.isArray(scopes) || scopes.length === 0) {
      throw new ApiError(400, 'choose at least one thing this agent may read');
    }
    if (!scopes.every((s) => typeof s === 'string')) {
      throw new ApiError(400, 'every scope must be a string');
    }
    const wanted = [...new Set(scopes.map((s) => s.trim()))];
    const unknown = wanted.filter((s) => !isAccessCategory(s));
    if (unknown.length > 0) {
      // Named rather than dropped: silently ignoring an unknown scope mints a token that reads
      // less than the patient was told it would, which they discover as a broken agent.
      throw new ApiError(400, `not something this instance can share: ${unknown.join(', ')}`);
    }

    const ttl = positiveInt(ttlHours ?? this.policy.defaultTtlHours, 0);
    if (ttl === 0) throw new ApiError(400, 'ttlHours must be a positive number');
    if (ttl > this.policy.maxTtlHours) {
      throw new ApiError(400, `a token may last at most ${this.policy.maxTtlHours} hours`);
    }

    // Retention runs here as well as at boot, so a process that stays up for months still applies it.
    await this.purgeExpired(now);

    const live = await this.provider.countLiveForOwner(owner, new Date(now).toISOString());
    if (live >= this.policy.maxPerUser) {
      throw new ApiError(409, `you already have ${this.policy.maxPerUser} live tokens — revoke one first`);
    }

    const secret = randomBytes(TOKEN_BYTES).toString('base64url');
    const token = `${TOKEN_PREFIX}${secret}`;
    const record: AgentTokenRecord = {
      id: `tok_${randomBytes(8).toString('hex')}`,
      owner,
      name: label,
      hash: sha256(token),
      prefix: token.slice(0, TOKEN_PREFIX.length + 4),
      scopes: wanted,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttl * 3_600_000).toISOString(),
      lastUsedAt: '',
      revokedAt: '',
      revokedBy: '',
      renewals: lineage.renewals,
      renewedFrom: lineage.renewedFrom,
      grantId: '',
    };
    await this.provider.create(record);
    return { token, record: this.toView(record, now) };
  }

  /**
   * Verify a presented cleartext token. Answers the record when it is live, else undefined.
   *
   * Stamps `last_used_at`. Unlike ngdpbase this writes on the read path rather than buffering: the
   * defect its #1108 fixed was `persist()` taking a hash-bearing BACKUP COPY per request, not the
   * update itself, and there is no such copy here — the store is the app database, which the
   * backup coordinator handles whole. One indexed UPDATE also matches what this stack already does
   * per read, since the access log writes a row before serving.
   */
  async verify(token: string, now: number = Date.now()): Promise<AgentTokenRecord | undefined> {
    if (!this.policy.enabled && !this.devices.enabled) return undefined;
    if (typeof token !== 'string' || !token.startsWith(TOKEN_PREFIX)) return undefined;

    const stored = await this.provider.findByHash(sha256(token));
    if (!stored) return undefined;
    // Constant-time even though the lookup was by equality: the comparison is the assertion, and
    // it costs nothing to make the assertion the one that decides.
    if (!hashEquals(stored.hash, sha256(token))) return undefined;

    if (stored.revokedAt !== '') return undefined;
    if (expiryMs(stored) <= now) return undefined;
    if (stored.scopes.length === 0) return undefined; // a corrupt row reads nothing (see the provider)
    // Each kind of key answers to its own switch; a device key also lives and dies with its grant.
    if (stored.grantId === '' && !this.policy.enabled) return undefined;
    if (stored.grantId !== '') {
      if (!this.devices.enabled) return undefined;
      const grant = await this.provider.getGrant(stored.grantId);
      if (!grant || !(await this.grantAlive(grant, now))) return undefined;
    }

    await this.provider.touch(stored.id, new Date(now).toISOString());
    return { ...stored, scopes: [...stored.scopes] };
  }

  /** The caller's own tokens, newest first — live ones and recent dead ones alike. */
  async listForOwner(ctx: ApiContext, now: number = Date.now()): Promise<AgentTokenView[]> {
    this.requireEnabled();
    this.requireHuman(ctx);
    return (await this.provider.listForOwner(ctx.username)).map((r) => this.toView(r, now));
  }

  /** Every token on the instance, for the operator screen. */
  async listAll(ctx: ApiContext, now: number = Date.now()): Promise<AgentTokenView[]> {
    this.requireEnabled();
    ctx.require('admin-read');
    return (await this.provider.listAll()).map((r) => this.toView(r, now));
  }

  /**
   * Rotate a live token forward: a NEW secret, the same name and scopes, the old record revoked.
   *
   * Deliberately not "move expiresAt". A secret that has leaked dies at its original expiry
   * however many times the owner renews, and the access log keeps a continuous agent name across
   * the rotation because the name carries.
   */
  async renew(ctx: ApiContext, id: string, now: number = Date.now()): Promise<{ token: string; record: AgentTokenView }> {
    this.requireEnabled();
    this.requireHuman(ctx);
    if (!this.policy.renewable) throw new ApiError(403, 'tokens cannot be renewed on this instance');

    const existing = await this.provider.get(id);
    // Same answer for "not yours" as for "does not exist": a distinguishable 403 would let one
    // account probe for another's token ids.
    if (!existing || existing.owner !== ctx.username) throw new ApiError(404, 'no such token');
    if (existing.revokedAt !== '') throw new ApiError(409, 'that token has been revoked');
    const expiry = expiryMs(existing);
    if (expiry <= now) throw new ApiError(409, 'that token has expired — mint a new one');

    if (this.policy.maxRenewals > 0 && existing.renewals >= this.policy.maxRenewals) {
      throw new ApiError(409, `that token has been renewed ${existing.renewals} times — mint a new one`);
    }
    // Only near expiry. Without this, "renew" is a button pressed on day one and the life is
    // unbounded from the start; renewing late keeps each extension a recent, deliberate decision.
    const windowOpensAt = expiry - this.policy.renewWindowHours * 3_600_000;
    if (now < windowOpensAt) {
      throw new ApiError(409, `that token can be renewed within ${this.policy.renewWindowHours} hours of expiring`);
    }

    const issued = await this.issue(existing.owner, existing.name, existing.scopes, undefined, now, {
      renewals: existing.renewals + 1,
      renewedFrom: existing.id,
    });
    // The old record stays as revoked until retention drops it, so the rotation is visible.
    await this.provider.revoke(existing.id, new Date(now).toISOString(), ctx.username);
    // One event, not a mint plus a revoke: a rotation is a single decision, and reading it as two
    // would tell the patient a credential was created that they did not create.
    await this.recordLifecycle(ctx, CREDENTIAL_EVENT_CATEGORIES.renewed, new Date(now));
    return issued;
  }

  /** Withdraw a token now. Effective on the next request — verification reads the store. */
  async revoke(ctx: ApiContext, id: string, now: number = Date.now()): Promise<boolean> {
    this.requireEnabled();
    this.requireHuman(ctx);
    const existing = await this.provider.get(id);
    if (!existing || existing.owner !== ctx.username) throw new ApiError(404, 'no such token');
    const revoked = await this.provider.revoke(id, new Date(now).toISOString(), ctx.username);
    // Only when this call is what ended it — a second revoke of the same token is not a new event.
    if (revoked) await this.recordLifecycle(ctx, CREDENTIAL_EVENT_CATEGORIES.revoked, new Date(now));
    return revoked;
  }

  // --- connected-device grants (yourphr#807 design, #808) ------------------------------------
  //
  // The GRANT is the patient's consent and carries the term; the device's KEYS are agent tokens
  // tied to it. Setup: the patient creates a grant (after re-authenticating) and is shown a one-time
  // code; the device claims it once for an access key and a refresh token. The refresh token
  // rotates on every use, and presenting a spent one revokes the whole grant (RFC 9700 §4.14). A
  // refresh never moves the end; only the patient's extend does.

  get deviceSettings(): DeviceGrantPolicy { return { ...this.devices }; }

  private requireDevices(): void {
    if (!this.devices.enabled) throw new ApiError(404, 'connected devices are not enabled on this instance');
  }

  /** Is the grant usable now? Ends it (once, logged) when its term or the owner's generation has passed it. */
  private async grantAlive(grant: DeviceGrantRecord, now: number): Promise<boolean> {
    if (grant.status !== 'active') return false;
    const generation = (await this.engine.managers.users.record(grant.owner))?.tokenGeneration;
    const termOver = expiryMs({ expiresAt: grant.endsAt }) <= now;
    const generationMoved = generation === undefined || generation !== grant.ownerGeneration;
    if (!termOver && !generationMoved) return true;
    await this.endGrant(grant, 'ended', termOver ? 'term' : 'sign-out', now, CREDENTIAL_EVENT_CATEGORIES.deviceEnded);
    // The term running out is news to the patient; their own sign-out-everywhere is not.
    if (termOver) await this.notifyOwner(grant, `${grant.label} stopped syncing`, `The permission you gave ${grant.label} to add to your record ended on ${grant.endsAt.slice(0, 10)}. Connect it again in Settings → Connected devices to keep it syncing.`);
    return false;
  }

  private async endGrant(grant: DeviceGrantRecord, status: 'ended' | 'revoked', by: string, now: number, event: string): Promise<void> {
    const at = new Date(now).toISOString();
    await this.provider.updateGrant({ ...grant, status, statusAt: at, statusBy: by, setupHash: '', setupExpiresAt: '', refreshHash: '' });
    await this.provider.revokeKeysOfGrant(grant.id, at, by);
    await this.recordLifecycle(this.deviceActor(grant), event, new Date(now));
  }

  /** The access log names the device by the patient's own label, acting for its owner. */
  private deviceActor(grant: DeviceGrantRecord): ApiContext {
    return ApiContext.system(grant.label, grant.owner, this.engine);
  }

  private grantView(grant: DeviceGrantRecord, now: number): DeviceGrantView {
    const { setupHash: _s, refreshHash: _r, noticedDays: _n, ...rest } = grant;
    return { ...rest, scopes: [...grant.scopes], claimed: grant.refreshHash !== '' || grant.lastUploadAt !== '', live: grant.status === 'active' && expiryMs({ expiresAt: grant.endsAt }) > now };
  }

  private async confirmIsYou(ctx: ApiContext, credentials: Record<string, string>, request: { remoteAddr: string; xff?: string }): Promise<void> {
    const sessions = this.engine.has('sessions') ? this.engine.managers.sessions : undefined;
    if (!sessions || !(await sessions.reauthenticate(ctx, credentials, request))) {
      throw new ApiError(401, 'confirm it is you — sign-in details did not match');
    }
  }

  private days(requested: number | undefined): number {
    const days = requested === undefined ? this.devices.grantMaxDays : Number(requested);
    if (!Number.isInteger(days) || days < 1) throw new ApiError(400, 'days must be a whole number of at least 1');
    if (days > this.devices.grantMaxDays) throw new ApiError(400, `a device may be allowed for at most ${this.devices.grantMaxDays} days`);
    return days;
  }

  /**
   * The patient grants a device (after re-authenticating). Returns the grant and the ONE-TIME setup
   * code, which is shown once, as a QR code and an "Open in app" link, and never stored in clear.
   * The route creates the device source first (a framework manager does not reach into the app's).
   */
  async createDeviceGrant(
    ctx: ApiContext,
    input: { label: string; days?: number; sourceId: string; credentials: Record<string, string>; request: { remoteAddr: string; xff?: string } },
    now: number = Date.now()
  ): Promise<{ grant: DeviceGrantView; setupCode: string }> {
    this.requireDevices();
    this.requireHuman(ctx);
    await this.confirmIsYou(ctx, input.credentials, input.request);
    const label = String(input.label ?? '').trim();
    if (label === '' || label.length > 80) throw new ApiError(400, 'a connected device needs a name of 1 to 80 characters');
    const days = this.days(input.days);
    const held = (await this.provider.listGrantsForOwner(ctx.username)).filter((g) => g.status === 'active' || g.status === 'suspended');
    if (held.length >= this.devices.maxPerUser) {
      throw new ApiError(409, `you already have ${this.devices.maxPerUser} connected devices — remove one first`);
    }
    const generation = (await this.engine.managers.users.record(ctx.username))?.tokenGeneration;
    if (generation === undefined) throw new ApiError(404, 'no such account');

    const setupCode = `${SETUP_CODE_PREFIX}${randomBytes(18).toString('base64url')}`;
    const grant: DeviceGrantRecord = {
      id: `dev_${randomBytes(8).toString('hex')}`,
      owner: ctx.username,
      label,
      scopes: [...DEVICE_SCOPES],
      sourceId: input.sourceId,
      createdAt: new Date(now).toISOString(),
      endsAt: new Date(now + days * 86_400_000).toISOString(),
      ownerGeneration: generation,
      lastUploadAt: '',
      status: 'active',
      statusAt: '',
      statusBy: '',
      setupHash: sha256(setupCode),
      setupExpiresAt: new Date(now + this.devices.setupCodeMinutes * 60_000).toISOString(),
      refreshHash: '',
      noticedDays: [],
    };
    await this.provider.createGrant(grant);
    await this.recordLifecycle(ctx, CREDENTIAL_EVENT_CATEGORIES.deviceGranted, new Date(now));
    return { grant: this.grantView(grant, now), setupCode };
  }

  /** The device, unauthenticated, spends its setup code — once — for its first keys. */
  async claimDeviceGrant(setupCode: string, now: number = Date.now()): Promise<DeviceTokens> {
    this.requireDevices();
    const refused = new ApiError(401, 'that setup code is not valid — ask the patient to show a new one');
    if (typeof setupCode !== 'string' || !setupCode.startsWith(SETUP_CODE_PREFIX)) throw refused;
    const grant = await this.provider.findGrantBySetupHash(sha256(setupCode));
    if (!grant || !hashEquals(grant.setupHash, sha256(setupCode))) throw refused;
    if (expiryMs({ expiresAt: grant.setupExpiresAt }) <= now) throw refused;
    if (!(await this.grantAlive(grant, now))) throw refused;
    const tokens = await this.rotate(grant, now);
    await this.recordLifecycle(this.deviceActor(grant), CREDENTIAL_EVENT_CATEGORIES.deviceClaimed, new Date(now));
    return tokens;
  }

  /**
   * The device trades its refresh token for new keys. A refresh token works ONCE: presenting one
   * already spent means it was copied, so the whole grant is revoked and the patient is told.
   */
  async refreshDeviceGrant(refreshToken: string, now: number = Date.now()): Promise<DeviceTokens> {
    this.requireDevices();
    const refused = new ApiError(401, 'this device is no longer allowed to add to the record — the patient can connect it again');
    if (typeof refreshToken !== 'string' || !refreshToken.startsWith(REFRESH_TOKEN_PREFIX)) throw refused;
    const hash = sha256(refreshToken);
    const grant = await this.provider.findGrantByRefreshHash(hash);
    if (!grant) {
      const spentFor = await this.provider.grantOfSpentRefresh(hash);
      const copied = spentFor ? await this.provider.getGrant(spentFor) : undefined;
      if (copied && copied.status === 'active') {
        await this.endGrant(copied, 'revoked', 'copied-refresh-token', now, CREDENTIAL_EVENT_CATEGORIES.deviceCopied);
      }
      throw refused;
    }
    if (!hashEquals(grant.refreshHash, hash)) throw refused;
    if (grant.status === 'suspended') {
      throw new ApiError(403, `paused: yourPHR received nothing from this device for ${this.inactiveAfterDays()} days — the patient can resume it`);
    }
    if (!(await this.grantAlive(grant, now))) throw refused;
    await this.provider.spendRefresh(hash, grant.id, new Date(now).toISOString());
    return this.rotate(grant, now);
  }

  /** New access key and refresh token; every earlier key of the grant is revoked. Never moves the end. */
  private async rotate(grant: DeviceGrantRecord, now: number): Promise<DeviceTokens> {
    const at = new Date(now).toISOString();
    await this.provider.revokeKeysOfGrant(grant.id, at, 'rotated');
    const refreshToken = `${REFRESH_TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString('base64url')}`;
    await this.provider.updateGrant({ ...grant, setupHash: '', setupExpiresAt: '', refreshHash: sha256(refreshToken) });

    const ends = expiryMs({ expiresAt: grant.endsAt });
    const expires = Math.min(now + this.devices.keyTtlHours * 3_600_000, ends); // a key never outlives the consent
    const secret = randomBytes(TOKEN_BYTES).toString('base64url');
    const token = `${TOKEN_PREFIX}${secret}`;
    await this.provider.create({
      id: `tok_${randomBytes(8).toString('hex')}`,
      owner: grant.owner,
      name: grant.label,
      hash: sha256(token),
      prefix: token.slice(0, TOKEN_PREFIX.length + 4),
      scopes: [...grant.scopes],
      createdAt: at,
      expiresAt: new Date(expires).toISOString(),
      lastUsedAt: '',
      revokedAt: '',
      revokedBy: '',
      renewals: 0,
      renewedFrom: '',
      grantId: grant.id,
    });
    return {
      access_token: token,
      token_type: 'Bearer',
      expires_in: Math.max(0, Math.floor((expires - now) / 1000)),
      refresh_token: refreshToken,
      grant_ends_at: grant.endsAt,
      label: grant.label,
    };
  }

  /** Only the patient extends, after re-authenticating; at most the maximum from now. */
  async extendDeviceGrant(
    ctx: ApiContext, id: string, input: { days?: number; credentials: Record<string, string>; request: { remoteAddr: string; xff?: string } }, now: number = Date.now()
  ): Promise<DeviceGrantView> {
    this.requireDevices();
    this.requireHuman(ctx);
    const grant = await this.provider.getGrant(id);
    if (!grant || grant.owner !== ctx.username) throw new ApiError(404, 'no such device');
    await this.confirmIsYou(ctx, input.credentials, input.request);
    if (!(await this.grantAlive(grant, now))) throw new ApiError(409, 'that device permission has ended — connect the device again');
    // A new end date is a new term: its reminders start over.
    const updated = { ...grant, endsAt: new Date(now + this.days(input.days) * 86_400_000).toISOString(), noticedDays: [] };
    await this.provider.updateGrant(updated);
    await this.recordLifecycle(ctx, CREDENTIAL_EVENT_CATEGORIES.deviceExtended, new Date(now));
    return this.grantView(updated, now);
  }

  /** The patient withdraws a device now: the grant and every key it holds. */
  async revokeDeviceGrant(ctx: ApiContext, id: string, now: number = Date.now()): Promise<boolean> {
    this.requireDevices();
    this.requireHuman(ctx);
    const grant = await this.provider.getGrant(id);
    if (!grant || grant.owner !== ctx.username) throw new ApiError(404, 'no such device');
    if (grant.status !== 'active' && grant.status !== 'suspended') return false;
    const at = new Date(now).toISOString();
    await this.provider.updateGrant({ ...grant, status: 'revoked', statusAt: at, statusBy: ctx.username, setupHash: '', setupExpiresAt: '', refreshHash: '' });
    await this.provider.revokeKeysOfGrant(grant.id, at, ctx.username);
    await this.recordLifecycle(ctx, CREDENTIAL_EVENT_CATEGORIES.deviceRevoked, new Date(now));
    return true;
  }

  async listDeviceGrants(ctx: ApiContext, now: number = Date.now()): Promise<DeviceGrantView[]> {
    this.requireDevices();
    this.requireHuman(ctx);
    return (await this.provider.listGrantsForOwner(ctx.username)).map((g) => this.grantView(g, now));
  }

  /** A banner for the grant's owner — every channel they approved, once #833 gives them a choice. */
  private async notifyOwner(grant: DeviceGrantRecord, title: string, message: string): Promise<void> {
    if (!this.engine.has('notifications')) return;
    await this.engine.managers.notifications.createNotification({ type: 'system', level: 'warning', targetUsers: [grant.owner], title, message });
  }

  /**
   * End-of-term reminders (#807 decision 5): for each active grant, one notice at each of
   * `yourphr.devices.notice-days` (default 7 and 1) before it ends — read live, sent once per day
   * value per term. Returns how many it sent. The notice when a term has ended comes from the
   * grant ending itself.
   */
  async remindEndingDevices(now: number = Date.now()): Promise<number> {
    if (!this.devices.enabled) return 0;
    const configured = this.engine.managers.configuration.getStringList(`${DEVICES_PREFIX}.notice-days`).map(Number);
    const days = [...new Set(configured.filter((d) => Number.isInteger(d) && d > 0))].sort((a, b) => b - a);
    let sent = 0;
    for (const grant of await this.provider.listActiveGrants()) {
      if (!(await this.grantAlive(grant, now))) continue;
      const left = expiryMs({ expiresAt: grant.endsAt }) - now;
      // Every threshold already crossed is marked, but one notice goes out: two at once would repeat each other.
      const due = days.filter((d) => left <= d * 86_400_000 && !grant.noticedDays.includes(d));
      if (due.length === 0) continue;
      const when = grant.endsAt.slice(0, 10);
      await this.notifyOwner(grant, `${grant.label} can add to your record until ${when}`,
        `Extend it in Settings → Connected devices to keep it syncing. After ${when} it stops until you connect it again.`);
      await this.provider.updateGrant({ ...grant, noticedDays: [...new Set([...grant.noticedDays, ...due])] });
      sent += 1;
    }
    return sent;
  }

  /** `yourphr.devices.inactive-after-days`, read live so a change applies to the next pass (yourphr#809). */
  private inactiveAfterDays(): number {
    return boundedNumber(this.engine.managers.configuration.getInt(`${DEVICES_PREFIX}.inactive-after-days`), 14, `${DEVICES_PREFIX}.inactive-after-days`, 1);
  }

  /**
   * The inactivity pass (yourphr#809, Jim 2026-09-30): phones and scales get replaced or sold, and
   * the old credential should not live on. An active grant that has sent nothing for
   * `inactive-after-days` is SUSPENDED — not revoked: its keys stop working, the patient is told
   * and can resume or remove it. "Nothing sent" counts from the last upload, or from when the grant
   * was made or last resumed if that is later. Returns the grants it paused.
   */
  async suspendInactiveDevices(now: number = Date.now()): Promise<string[]> {
    if (!this.devices.enabled) return [];
    const days = this.inactiveAfterDays();
    const paused: string[] = [];
    for (const grant of await this.provider.listActiveGrants()) {
      const since = Math.max(...[grant.lastUploadAt, grant.createdAt, grant.statusAt].map((t) => (t ? Date.parse(t) : NaN)).filter((n) => !Number.isNaN(n)));
      if (!Number.isFinite(since) || now - since < days * 86_400_000) continue;
      const at = new Date(now).toISOString();
      await this.provider.updateGrant({ ...grant, status: 'suspended', statusAt: at, statusBy: 'inactivity' });
      await this.provider.revokeKeysOfGrant(grant.id, at, 'inactivity');
      await this.recordLifecycle(this.deviceActor(grant), CREDENTIAL_EVENT_CATEGORIES.deviceSuspended, new Date(now));
      if (this.engine.has('notifications')) {
        const last = grant.lastUploadAt ? `since ${grant.lastUploadAt.slice(0, 10)}` : 'since it was connected';
        await this.engine.managers.notifications.createNotification({
          type: 'system', level: 'warning', targetUsers: [grant.owner],
          title: `${grant.label} stopped sending data`,
          message: `yourPHR has received nothing from ${grant.label} ${last}, so its permission is paused. Resume it or remove it in Settings → Connected devices.`,
        });
      }
      paused.push(grant.id);
    }
    return paused;
  }

  /** The patient resumes a paused device, after re-authenticating (the same rule as extend). */
  async resumeDeviceGrant(
    ctx: ApiContext, id: string, input: { credentials: Record<string, string>; request: { remoteAddr: string; xff?: string } }, now: number = Date.now()
  ): Promise<DeviceGrantView> {
    this.requireDevices();
    this.requireHuman(ctx);
    const grant = await this.provider.getGrant(id);
    if (!grant || grant.owner !== ctx.username) throw new ApiError(404, 'no such device');
    if (grant.status !== 'suspended') throw new ApiError(409, 'that device is not paused');
    await this.confirmIsYou(ctx, input.credentials, input.request);
    // Resuming does not reopen a term that has ended; statusAt restarts the inactivity clock.
    const resumed: DeviceGrantRecord = { ...grant, status: 'active', statusAt: new Date(now).toISOString(), statusBy: ctx.username };
    if (!(await this.grantAlive(resumed, now))) throw new ApiError(409, 'that device permission has ended — connect the device again');
    await this.provider.updateGrant(resumed);
    await this.recordLifecycle(ctx, CREDENTIAL_EVENT_CATEGORIES.deviceResumed, new Date(now));
    return this.grantView(resumed, now);
  }

  /** A device key just wrote: when, for inactivity suspension (yourphr#809). */
  async recordDeviceUpload(grantId: string, now: number = Date.now()): Promise<void> {
    const grant = await this.provider.getGrant(grantId);
    if (grant) await this.provider.updateGrant({ ...grant, lastUploadAt: new Date(now).toISOString() });
  }

  /** Drop dead records past the retention window. */
  async purgeExpired(now: number = Date.now()): Promise<number> {
    const cutoff = new Date(now - this.policy.retentionDays * 86_400_000).toISOString();
    return this.provider.purge(cutoff);
  }

  /** Account deletion: an account's tokens go with everything else it owns. */
  async removeForUser(ctx: ApiContext): Promise<void> {
    ctx.requireAuthenticated();
    await this.provider.removeForOwner(ctx.username);
  }

  private toView(record: AgentTokenRecord, now: number): AgentTokenView {
    const { hash: _hash, ...rest } = record;
    const expiry = expiryMs(record);
    const live = record.revokedAt === '' && expiry > now;
    return {
      ...rest,
      scopes: [...record.scopes],
      live,
      expiresInSeconds: live ? Math.max(0, Math.floor((expiry - now) / 1000)) : 0,
    };
  }

  /** The tokens live in the app database, which the backup coordinator copies whole. */
  async backup(): Promise<BackupData> {
    return { manager: this.name, takenAt: new Date().toISOString() };
  }

  async restore(): Promise<void> { /* restored with the app database */ }
}
