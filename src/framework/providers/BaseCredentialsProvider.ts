/**
 * The credentials store (yourphr#876), ported from ngdpbase's `BaseCredentialsProvider` (its #1524):
 * more than one way to prove an account — passkeys now; TOTP, email and device rows when their
 * providers arrive. Owned by the Sessions manager (yourPHR's auth door), as ngdpbase's is owned by
 * its AuthManager: nothing else reads or writes it.
 *
 * Passwords are NOT here; they stay in `auth_users`. Every row is signed with an environment-only
 * key (`YOURPHR_CREDENTIALS_KEY`), so a row written or edited outside the app — straight into the
 * database file — fails its signature, is quarantined (kept, never used), and raises an alert.
 */

/** The environment variable whose value signs every row. No config key; generated into `.env`. */
export const CREDENTIALS_KEY_ENV = 'YOURPHR_CREDENTIALS_KEY';

export type CredentialKind = 'passkey' | 'totp' | 'email' | 'sms' | 'device';

export interface CredentialRecord {
  id: string;
  username: string;
  kind: CredentialKind;
  /** What identifies the credential to its provider — for a passkey, the WebAuthn credential id (base64url). */
  subject: string;
  /** What the provider needs to verify it — for a passkey, JSON of the public key, counter and transports. Never shown. */
  secret: string;
  /** The person's name for it ("Chrome on Mac"). */
  label: string;
  /** RFC 3339. */
  createdAt: string;
  lastUsedAt?: string;
}

/** A row that failed its check: kept on disk, never used, and reported. */
export interface RejectedCredential {
  row: Partial<CredentialRecord>;
  reason: 'bad-signature' | 'unsigned' | 'malformed';
}

export abstract class BaseCredentialsProvider {
  /** Open the store; every row that fails its check is reported once through `onRejected`. */
  abstract initialize(onRejected: (rejected: RejectedCredential[]) => void): Promise<void>;
  /** The rows set aside at open — for the operator's view. */
  abstract quarantined(): RejectedCredential[];
  /** One account's credentials, oldest first. */
  abstract list(username: string): Promise<CredentialRecord[]>;
  abstract get(id: string): Promise<CredentialRecord | null>;
  /** Refuses a duplicate id, or a second row with the same kind and subject. */
  abstract add(record: CredentialRecord): Promise<void>;
  abstract remove(id: string): Promise<boolean>;
  /** The row a provider asks for by what identifies it — a passkey by its credential id. */
  abstract findBySubject(kind: CredentialKind, subject: string): CredentialRecord | null;
  /** Record a use, and the provider's updated secret (a passkey's new counter). */
  abstract touch(id: string, at: string, secret?: string): Promise<void>;
  abstract relabel(id: string, label: string): Promise<boolean>;
}
