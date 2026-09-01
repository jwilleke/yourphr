/**
 * Companion-device token storage: the table behind DeviceTokensManager.
 *
 * The provider stores; the manager decides. In particular the provider never sees a cleartext
 * token — only the hash the manager computed — and never judges whether a record is live.
 */

export interface DeviceTokenRecord {
  id: string;
  owner: string;
  name: string;
  /** `sha256:<hex>`. Never the cleartext. */
  hash: string;
  prefix: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string;
  revokedAt: string;
  revokedBy: string;
}

export abstract class BaseDeviceTokensProvider {
  abstract initialize(): Promise<void>;
  abstract create(record: DeviceTokenRecord): Promise<void>;
  abstract findByHash(hash: string): Promise<DeviceTokenRecord | undefined>;
  abstract get(id: string): Promise<DeviceTokenRecord | undefined>;
  abstract listForOwner(owner: string): Promise<DeviceTokenRecord[]>;
  abstract touch(id: string, lastUsedAt: string): Promise<void>;
  abstract revoke(id: string, revokedAt: string, revokedBy: string): Promise<boolean>;
  abstract removeForOwner(owner: string): Promise<void>;
}
