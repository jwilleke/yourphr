/**
 * Agent-token storage (yourphr#695): the table behind the AgentTokens manager.
 *
 * A capability an adopter could plausibly swap — ngdpbase keeps these in a JSON file at
 * `<FAST_STORAGE>/tokens/`; this stack has SQLite and a DatabaseManager, so they live there and
 * ride the existing encrypted backup rather than needing one of their own.
 *
 * The provider stores; the manager decides. In particular the provider never sees a cleartext
 * token — only the hash the manager computed — and never judges whether a record is live.
 */

export interface AgentTokenRecord {
  id: string;
  owner: string;
  /** What the patient called it — and what the access log names as the actor. */
  name: string;
  /** `sha256:<hex>`. Never the cleartext. */
  hash: string;
  /** Leading characters, for display in the token list. */
  prefix: string;
  /** Access categories this token may read (yourphr#695). Empty is never "everything". */
  scopes: string[];
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string;
  revokedAt: string;
  revokedBy: string;
  /** How many times this token has been rotated forward; 0 for a fresh mint. */
  renewals: number;
  /** The id this token replaced, when it was minted by a renewal; '' otherwise. */
  renewedFrom: string;
  /**
   * The connected-device grant this key belongs to (yourphr#808); '' for an ordinary agent token.
   * A key with a grant lives and dies with it: verification checks the grant, and it does not
   * count toward the per-person agent-token cap (the grant cap does).
   */
  grantId: string;
}

/** A connected device's grant: the patient's consent, which carries the term (yourphr#807). */
export type DeviceGrantStatus = 'active' | 'suspended' | 'revoked' | 'ended';

export interface DeviceGrantRecord {
  id: string;
  owner: string;
  /** The patient's own words: "Jim's iPhone — Apple Health". */
  label: string;
  /** Device scopes — write categories plus the device's own read (see DEVICE_SCOPES). */
  scopes: string[];
  /** The device source its records are credited to (yourphr#806). */
  sourceId: string;
  createdAt: string;
  /** RFC 3339. Never moved by a refresh; only the patient's extend moves it. */
  endsAt: string;
  /** The owner's token generation at grant time: a password change or sign-out-everywhere ends it. */
  ownerGeneration: number;
  lastUploadAt: string;
  status: DeviceGrantStatus;
  statusAt: string;
  statusBy: string;
  /** sha256 of the one-time setup code, '' once claimed. */
  setupHash: string;
  setupExpiresAt: string;
  /** sha256 of the current refresh token, '' before the device has claimed the grant. */
  refreshHash: string;
  /** The reminder days (from `yourphr.devices.notice-days`) already sent for the current end date. */
  noticedDays: number[];
}

/**
 * Empty string rather than null throughout, matching `legal_consent.accepted_at` and
 * `connected_sources.refresh_token` in this schema: SQLite's NULL handling is where yourphr#528
 * went wrong, and a column that is never NULL cannot repeat it.
 */
export abstract class BaseAgentTokensProvider {
  abstract initialize(): Promise<void>;
  abstract create(record: AgentTokenRecord): Promise<void>;
  /** By hash — the verification lookup. Returns whatever is stored, live or not; the manager judges. */
  abstract findByHash(hash: string): Promise<AgentTokenRecord | undefined>;
  abstract get(id: string): Promise<AgentTokenRecord | undefined>;
  /** Every record for an owner, newest first — including dead ones; the manager filters. */
  abstract listForOwner(owner: string): Promise<AgentTokenRecord[]>;
  abstract listAll(): Promise<AgentTokenRecord[]>;
  abstract countLiveForOwner(owner: string, nowIso: string): Promise<number>;
  abstract touch(id: string, lastUsedAt: string): Promise<void>;
  abstract revoke(id: string, revokedAt: string, revokedBy: string): Promise<boolean>;
  /** Drop dead records whose death is older than the cutoff. Returns how many went. */
  abstract purge(deadBeforeIso: string): Promise<number>;
  abstract removeForOwner(owner: string): Promise<void>;

  // --- connected-device grants (yourphr#807, #808) ---
  abstract createGrant(record: DeviceGrantRecord): Promise<void>;
  abstract getGrant(id: string): Promise<DeviceGrantRecord | undefined>;
  abstract findGrantBySetupHash(hash: string): Promise<DeviceGrantRecord | undefined>;
  abstract findGrantByRefreshHash(hash: string): Promise<DeviceGrantRecord | undefined>;
  /** Newest first, every status. */
  abstract listGrantsForOwner(owner: string): Promise<DeviceGrantRecord[]>;
  /** Every active grant on the instance — the hourly passes read these (yourphr#808, #809). */
  abstract listActiveGrants(): Promise<DeviceGrantRecord[]>;
  abstract updateGrant(record: DeviceGrantRecord): Promise<void>;
  /** Remember a refresh token that has been used, so presenting it again is recognised as a copy. */
  abstract spendRefresh(hash: string, grantId: string, at: string): Promise<void>;
  /** The grant a spent refresh token belonged to, if it is one. */
  abstract grantOfSpentRefresh(hash: string): Promise<string | undefined>;
  /** Revoke every live key of a grant. Returns how many. */
  abstract revokeKeysOfGrant(grantId: string, revokedAt: string, revokedBy: string): Promise<number>;
}
