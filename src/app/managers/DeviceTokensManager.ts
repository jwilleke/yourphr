/**
 * Companion device tokens: a credential a patient mints in Settings → Connected Devices and
 * hands to the iPhone (or another companion) as a QR code, so it can POST Apple Health samples
 * on their behalf.
 *
 * Distinct from agent tokens (yourphr#695). An agent token is read-only by construction — the
 * edge gate default-denies every POST. HealthKit ingest is a write, so a companion presents a
 * device token and the server builds a full user ApiContext, the same as a session Bearer.
 *
 * Opaque hashed tokens, not JWTs: the iOS app stores the Bearer string and never parses claims,
 * and a leaked credential must be revocable before it expires. The HTTP envelope is Go's
 * (`POST /api/secure/access/token` returns the cleartext once as `data`).
 *
 * Invariant carried from AgentTokensManager: an unreadable expiry date means expired, everywhere.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { BaseManager, type BackupData } from '../../framework/BaseManager.js';
import type { Engine } from '../../framework/Engine.js';
import { ApiError, type ApiContext } from '../../framework/ApiContext.js';
import type { DeviceTokenRecord, BaseDeviceTokensProvider } from '../providers/BaseDeviceTokensProvider.js';

declare module '../../framework/Engine.js' {
  interface ManagerRegistry {
    deviceTokens: DeviceTokensManager;
  }
}

/** Prefix — greppable if a leaked token reaches a repository; distinct from agent tokens (`yphr_at_`). */
export const DEVICE_TOKEN_PREFIX = 'yphr_dt_';
const TOKEN_BYTES = 32;
/** Go's "no expiration" was 2099-12-31; keep the same far-future so Settings' "0 days" still means forever. */
export const NO_EXPIRY = '2099-12-31T23:59:59.000Z';

export type DeviceTokenView = Omit<DeviceTokenRecord, 'hash'> & {
  live: boolean;
  status: 'active' | 'expired';
};

const sha256 = (value: string): string => `sha256:${createHash('sha256').update(value).digest('hex')}`;

function hashEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** Expiry in milliseconds, where unparseable means expired. */
function expiryMs(record: Pick<DeviceTokenRecord, 'expiresAt'>): number {
  const parsed = Date.parse(record.expiresAt);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function defaultName(now: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `Access Token - ${months[now.getUTCMonth()]} ${now.getUTCDate()}, ${now.getUTCFullYear()}`;
}

export class DeviceTokensManager extends BaseManager {
  readonly name = 'deviceTokens' as const;
  override readonly dependsOn = [] as const;

  constructor(engine: Engine, private readonly provider: BaseDeviceTokensProvider) {
    super(engine);
  }

  override async initialize(config: Record<string, unknown> = {}): Promise<void> {
    await super.initialize(config);
    await this.provider.initialize();
  }

  /**
   * Minting, listing and revoking need a HUMAN session — never an agent token and never another
   * companion token. A phone that can mint more phones is not a paired device any more.
   */
  private requireHuman(ctx: ApiContext): void {
    ctx.requireAuthenticated();
    if (ctx.viaToken || ctx.viaDevice) {
      throw new ApiError(403, 'a companion token cannot manage device tokens — sign in to do this');
    }
  }

  /**
   * Mint a token for the caller. `expirationDays` 0 (or omitted) is Go's "no expiration".
   * The cleartext is returned ONCE and never stored.
   */
  async mint(
    ctx: ApiContext,
    name: string,
    expirationDays: number,
    now: number = Date.now()
  ): Promise<{ token: string; record: DeviceTokenView }> {
    this.requireHuman(ctx);
    const label = String(name ?? '').trim() || defaultName(new Date(now));
    if (label.length > 80) throw new ApiError(400, 'a token name is at most 80 characters');
    const days = Number(expirationDays);
    if (!Number.isFinite(days) || days < 0) throw new ApiError(400, 'expiration must be a non-negative number of days');

    const secret = randomBytes(TOKEN_BYTES).toString('base64url');
    const token = `${DEVICE_TOKEN_PREFIX}${secret}`;
    const record: DeviceTokenRecord = {
      id: randomBytes(16).toString('hex'),
      owner: ctx.username,
      name: label,
      hash: sha256(token),
      prefix: token.slice(0, DEVICE_TOKEN_PREFIX.length + 4),
      createdAt: new Date(now).toISOString(),
      expiresAt: days > 0 ? new Date(now + days * 86_400_000).toISOString() : NO_EXPIRY,
      lastUsedAt: '',
      revokedAt: '',
      revokedBy: '',
    };
    await this.provider.create(record);
    return { token, record: this.toView(record, now) };
  }

  async verify(token: string, now: number = Date.now()): Promise<DeviceTokenRecord | undefined> {
    if (typeof token !== 'string' || !token.startsWith(DEVICE_TOKEN_PREFIX)) return undefined;
    const stored = await this.provider.findByHash(sha256(token));
    if (!stored) return undefined;
    if (!hashEquals(stored.hash, sha256(token))) return undefined;
    if (stored.revokedAt !== '') return undefined;
    if (expiryMs(stored) <= now) return undefined;
    await this.provider.touch(stored.id, new Date(now).toISOString());
    return { ...stored };
  }

  async listForOwner(ctx: ApiContext, now: number = Date.now()): Promise<DeviceTokenView[]> {
    this.requireHuman(ctx);
    return (await this.provider.listForOwner(ctx.username)).map((r) => this.toView(r, now));
  }

  async revoke(ctx: ApiContext, id: string, now: number = Date.now()): Promise<boolean> {
    this.requireHuman(ctx);
    const existing = await this.provider.get(id);
    if (!existing || existing.owner !== ctx.username) throw new ApiError(404, 'no such token');
    return this.provider.revoke(id, new Date(now).toISOString(), ctx.username);
  }

  async removeForUser(ctx: ApiContext): Promise<void> {
    ctx.requireAuthenticated();
    await this.provider.removeForOwner(ctx.username);
  }

  private toView(record: DeviceTokenRecord, now: number): DeviceTokenView {
    const { hash: _hash, ...rest } = record;
    const live = record.revokedAt === '' && expiryMs(record) > now;
    return { ...rest, live, status: live ? 'active' : 'expired' };
  }

  async backup(): Promise<BackupData> {
    return { manager: this.name, takenAt: new Date().toISOString() };
  }

  async restore(): Promise<void> { /* restored with the app database */ }
}
