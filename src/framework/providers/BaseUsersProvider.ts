/**
 * User storage (yourphr#611): the accounts table behind the Users manager. A capability an adopter
 * would plausibly swap (ngdpbase has FileUserProvider); the manager decides, the provider stores.
 * Password hashes live here and leave only to the auth provider that verifies them.
 */
/**
 * A role NAME, as the merged configuration defines it (yourphr#648). Not a union: roles have been
 * data since yourphr#623 — `yourphr.auth.roles.definitions` — and a compiled `'admin' | 'user'`
 * meant an operator could DEFINE a role and not ASSIGN one, which is where the read-only demo admin
 * (yourphr#644) hit the wall.
 *
 * The property the union was really carrying is kept, and it is the one that matters: a name this
 * instance does not define resolves to the LEAST-PRIVILEGED role, never to an elevated one. See
 * `normaliseRole` — a typo in a role is still never a privilege.
 */
export type Role = string;

/**
 * The role an unrecognised name falls back to. Shipped as `user`, which the configuration defines
 * with the ordinary member permissions.
 */
export const LEAST_PRIVILEGED_ROLE = 'user';

/**
 * Resolve a stored or supplied role against the roles this instance actually defines.
 *
 * `known` is the configured role names; pass none and the answer is the least-privileged role,
 * which is the safe reading for a caller that cannot see the policy. The direction is deliberate
 * and is the whole invariant: a misspelling, a role deleted from the configuration since the
 * account was created, or a value from an older release must all fail TOWARD `user` — never toward
 * `admin`, and never by silently inventing a role that grants nothing but reads as if it does.
 */
export function normaliseRole(role: unknown, known?: Iterable<string>): Role {
  if (typeof role !== 'string' || role.trim() === '') return LEAST_PRIVILEGED_ROLE;
  const name = role.trim();
  const names = known === undefined ? undefined : new Set(known);
  if (names === undefined) return LEAST_PRIVILEGED_ROLE;
  return names.has(name) ? name : LEAST_PRIVILEGED_ROLE;
}

export interface UserRecord {
  username: string;
  passwordHash: string;
  /** The revocation counter (yourphr#508): a session below it is dead. */
  tokenGeneration: number;
  role: Role;
  createdAt: string;
  /** The person's own email address (yourphr#792), '' when they have not given one. Optional to keep. */
  email: string;
  /**
   * A test account (yourphr#919, ngdpbase#1805): it holds test or sandbox data, never real data.
   * An attribute, not a role — it grants nothing. False for every account made before the flag.
   */
  isTest: boolean;
}

export abstract class BaseUsersProvider {
  abstract initialize(): Promise<void>;
  abstract create(record: Omit<UserRecord, 'createdAt' | 'email' | 'isTest'> & { createdAt?: string; email?: string; isTest?: boolean }): Promise<void>;
  abstract get(username: string): Promise<UserRecord | undefined>;
  abstract list(): Promise<UserRecord[]>;
  abstract count(): Promise<number>;
  /** A new hash; bumping the generation ends every session (a password CHANGE), not bumping keeps them (an upgrade-on-login). */
  abstract setPasswordHash(username: string, hash: string, bumpGeneration: boolean): Promise<boolean>;
  abstract bumpGeneration(username: string): Promise<void>;
  abstract delete(username: string): Promise<boolean>;
  /** Set or clear ('') the account's email address (yourphr#792). False when there is no such account. */
  abstract setEmail(username: string, email: string): Promise<boolean>;
  /** Mark or unmark a test account (yourphr#919). False when there is no such account. */
  abstract setTest(username: string, isTest: boolean): Promise<boolean>;
  /** The legal consent (yourphr#614): when the person accepted the Privacy Policy and Terms, RFC3339 UTC; '' = revoked or never. */
  abstract consentAcceptedAt(username: string): Promise<string>;
  abstract setConsentAcceptedAt(username: string, acceptedAt: string): Promise<void>;
}
