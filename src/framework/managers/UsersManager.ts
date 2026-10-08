/**
 * Users — the door to accounts (yourphr#611): who exists, their role, their password and the
 * policy on it, bootstrap of the first admin (yourphr#504), recovery when nobody can sign in
 * (yourphr#510), an admin's reset of a member's password (yourphr#511), deletion, and the legal
 * consent that folds in here (the architecture doc's judgment call). Takes the context on every
 * call that acts for someone; the migration tool and the bootstrap act as named system principals.
 *
 * Passwords are the auth provider's to hash and verify; this manager only ever holds the hash on
 * its way to the users provider.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { BaseManager, type BackupData } from '../BaseManager.js';
import type { Engine } from '../Engine.js';
import { ApiError, type ApiContext } from '../ApiContext.js';
import { isEmailAddress } from '../email-address.js';
import { type BaseUsersProvider, normaliseRole, type Role, type UserRecord } from '../providers/BaseUsersProvider.js';
import type { BaseAuthProvider } from '../providers/BaseAuthProvider.js';
import { isLegacyBcrypt } from '../providers/PasswordAuthProvider.js';

declare module '../Engine.js' {
  interface ManagerRegistry {
    users: UsersManager;
  }
}

/**
 * The account an empty install provisions itself (yourphr#504). Exported because the demo reset's
 * proof has to name the accounts a demo is allowed to hold (yourphr#645), and a second literal
 * 'admin' somewhere else is how that proof would quietly stop matching reality.
 */
export const BOOTSTRAP_ADMIN_USERNAME = 'admin';

/**
 * The role the bootstrap admin is created with, and the one `isAdmin` asks about. A shipped role
 * name (yourphr#623's `yourphr.auth.roles.definitions`), named once here rather than spelled as a
 * literal wherever it is needed — the same reason the account's name is.
 */
export const ADMIN_ROLE = 'admin';

export interface LegacyUser {
  username: string;
  /** The bcrypt hash exactly as Go stored it. */
  passwordHash: string;
  tokenGeneration: number;
  role: string;
}

export interface ImportReport {
  imported: string[];
  skippedExisting: string[];
  admins: string[];
}

export class UsersManager extends BaseManager {
  readonly name = 'users' as const;
  override readonly dependsOn = ['configuration'] as const;
  private minPasswordLength = 12;
  private bootstrapFile?: string;
  private bootstrapUsername?: string;

  private readonly log: (line: string) => void;

  constructor(engine: Engine, private readonly provider: BaseUsersProvider, private readonly passwords: BaseAuthProvider, options: { log?: (line: string) => void } = {}) {
    super(engine);
    this.log = options.log ?? (() => undefined);
  }

  override async initialize(config: Record<string, unknown> = {}): Promise<void> {
    await this.provider.initialize();
    this.minPasswordLength = this.engine.managers.configuration.getInt('yourphr.auth.password.min-length');
    await super.initialize(config);
  }

  // --- what the Sessions manager needs, manager to manager ---

  /** The stored account, for the auth provider to verify against. */
  async record(username: string): Promise<UserRecord | undefined> {
    return this.provider.get(username);
  }

  /** Persist an upgraded hash after a successful legacy sign-in — no generation bump, the password did not change. */
  async rehash(username: string, hash: string): Promise<void> {
    await this.provider.setPasswordHash(username, hash, false);
  }

  /**
   * The role this account effectively holds — the STORED name resolved against the roles this
   * instance defines (yourphr#648). A name the configuration no longer defines resolves to the
   * least-privileged role rather than to whatever it used to mean, because the alternative is an
   * account whose powers are decided by a role definition somebody deleted.
   */
  async roleOf(username: string): Promise<Role | undefined> {
    const stored = (await this.provider.get(username))?.role;
    if (stored === undefined) return undefined;
    const resolved = normaliseRole(stored, this.knownRoles());
    if (resolved !== stored) this.log(`account ${JSON.stringify(username)} holds role ${JSON.stringify(stored)}, which this instance does not define — treating it as ${resolved}`);
    return resolved;
  }

  /** The roles the merged configuration defines; empty with no policy manager, which fails closed. */
  private knownRoles(): string[] {
    return this.engine.has('policy') ? this.engine.managers.policy.roleNames() : [];
  }

  /**
   * Refuse a role this instance does not define, naming the ones it does (yourphr#648). Assignment
   * is where an unknown name has to be caught: accepting it would store a name that resolves to
   * `user` on the next read, so the operator would see the role they asked for in the request and a
   * different one in the account.
   */
  private checkRole(role: Role): Role {
    const known = this.knownRoles();
    if (!known.includes(role)) {
      throw new ApiError(400, `unknown role ${JSON.stringify(role)} — this instance defines ${known.join(', ') || '(no roles: the policy manager is not wired)'}`);
    }
    return role;
  }

  async isAdmin(username: string): Promise<boolean> {
    return (await this.roleOf(username)) === ADMIN_ROLE;
  }

  /** Every session of the account ends (the Sessions manager's sign-out-everywhere). */
  async bumpGeneration(username: string): Promise<void> {
    await this.provider.bumpGeneration(username);
  }

  /** The bootstrap password file goes at the first successful sign-in (yourphr#466): a copy in the data dir rides in every backup. */
  onSignedIn(username: string): void {
    if (this.bootstrapFile && username === this.bootstrapUsername && existsSync(this.bootstrapFile)) {
      rmSync(this.bootstrapFile, { force: true });
      this.bootstrapFile = undefined;
    }
  }

  // --- the policy ---

  checkPolicy(password: string): void {
    if (password.length < this.minPasswordLength) throw new ApiError(400, `password must be at least ${this.minPasswordLength} characters`);
  }

  private checkUsername(username: string): void {
    if (!/^[a-z0-9][a-z0-9._-]{1,62}$/.test(username)) throw new ApiError(400, 'username must be 2-63 chars: lowercase letters, digits, . _ - (leading alphanumeric)');
  }

  // --- accounts ---

  /** An admin (or a system principal: bootstrap, tests) creates an account. */
  async createUser(ctx: ApiContext, username: string, password: string, role: Role = 'user'): Promise<void> {
    if (ctx.system === '') ctx.require('user-create');
    this.checkUsername(username);
    this.checkPolicy(password);
    if (await this.provider.get(username)) throw new ApiError(400, 'User already exists');
    await this.provider.create({ username, passwordHash: this.passwords.hash(password), tokenGeneration: 0, role: this.checkRole(role) });
  }

  /**
   * Every account, for the admin's Users page: names, roles, when created — never a hash. Whether an
   * account has an email address, not the address itself (yourphr#792): an admin needs to know an
   * alert can reach someone, not to read everyone's inbox name.
   */
  async listUsers(ctx: ApiContext): Promise<{ username: string; role: Role; created_at: string; has_email: boolean }[]> {
    ctx.require('user-read');
    return (await this.provider.list()).map((u) => ({ username: u.username, role: u.role, created_at: u.createdAt, has_email: u.email !== '' }));
  }

  /** The caller's own email address (yourphr#792), '' when they have not given one. */
  async email(ctx: ApiContext): Promise<string> {
    return (await this.provider.get(ctx.username))?.email ?? '';
  }

  /**
   * The caller sets or clears ('') their own email address (yourphr#792). One address, checked the
   * way the mail manager checks one; the relay has the last word on whether it exists. Only ever
   * used to reach this person through the mail manager — never exported, never shown to others.
   */
  async setEmail(ctx: ApiContext, email: string): Promise<string> {
    const address = String(email ?? '').trim();
    if (address !== '' && !isEmailAddress(address)) throw new ApiError(400, `'${address}' is not an email address`);
    if (!(await this.provider.setEmail(ctx.username, address))) throw new ApiError(404, 'no such account');
    return address;
  }

  /** The usernames holding a role, resolved — who a notification for that role is addressed to. The system or an admin. */
  async holders(ctx: ApiContext, role: Role): Promise<string[]> {
    if (ctx.system === '') ctx.require('user-read');
    const out: string[] = [];
    for (const u of await this.provider.list()) if ((await this.roleOf(u.username)) === role) out.push(u.username);
    return out;
  }

  /**
   * The accounts holding a role that have an email address — who an escalation can reach
   * (ngdpbase's searchUsers('', { role })). The system or an admin; resolved roles, so an account
   * whose stored role this instance no longer defines is not an admin here either.
   */
  async recipients(ctx: ApiContext, role: Role): Promise<{ username: string; email: string }[]> {
    if (ctx.system === '') ctx.require('user-read');
    const out: { username: string; email: string }[] = [];
    for (const u of await this.provider.list()) {
      if (u.email === '') continue;
      if ((await this.roleOf(u.username)) === role) out.push({ username: u.username, email: u.email });
    }
    return out;
  }

  /** The caller changes their own password: the current one must verify, the policy applies, every session ends. */
  async changePassword(ctx: ApiContext, currentPassword: string, newPassword: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<void> {
    ctx.requireAuthenticated();
    const stored = await this.provider.get(ctx.username);
    const verified = await this.passwords.authenticate(ctx.username, currentPassword, stored, nowSeconds);
    if (!verified.ok) throw new ApiError(401, 'current password is incorrect');
    this.checkPolicy(newPassword);
    if (!(await this.provider.setPasswordHash(ctx.username, this.passwords.hash(newPassword), true))) throw new ApiError(500, 'password change did not apply');
  }

  /**
   * An admin sets a member's password (yourphr#604; the product's #511 — the family case). A
   * generated, policy-compliant password, and a generation bump so whoever holds the old sessions
   * is signed out everywhere. Returned once — the caller shows it, nobody stores it.
   */
  async adminResetPassword(ctx: ApiContext, username: string): Promise<string> {
    ctx.require('user-edit');
    if (!(await this.provider.get(username))) throw new ApiError(404, 'no such user');
    const password = randomBytes(18).toString('base64url'); // 24 chars, always above the policy minimum
    if (!(await this.provider.setPasswordHash(username, this.passwords.hash(password), true))) throw new ApiError(500, 'could not set the password');
    this.log(`${ctx.actor} reset the password for ${username}; every session of that account ended`);
    return password;
  }

  /** How many accounts the instance holds — the admin's database page. */
  async count(ctx: ApiContext): Promise<number> {
    if (ctx.system === '') ctx.require('user-read');
    return this.provider.count();
  }

  /** The caller deletes their own account (the rest of what they own is the app's to remove first). */
  async deleteSelf(ctx: ApiContext): Promise<boolean> {
    ctx.requireAuthenticated();
    await this.provider.setConsentAcceptedAt(ctx.username, '');
    return this.provider.delete(ctx.username);
  }

  // --- legal consent (folded in: one small table, one owner) ---

  consentAcceptedAt(ctx: ApiContext): Promise<string> {
    ctx.requireAuthenticated();
    return this.provider.consentAcceptedAt(ctx.username);
  }

  setConsent(ctx: ApiContext, acceptedAt: string): Promise<void> {
    ctx.requireAuthenticated();
    return this.provider.setConsentAcceptedAt(ctx.username, acceptedAt);
  }

  // --- bootstrap and recovery: the proof is filesystem access, not a session ---

  /**
   * Provision the bootstrap admin without the first-run wizard (yourphr#504). The generated password
   * is written 0600 to <dataDir>/.admin_bootstrap_password; the caller logs the PATH only; the file
   * is deleted after the admin's first sign-in.
   *
   * Runs whenever no account is NAMED `admin` — ngdpbase's rule (UserManager.initialize), not "only
   * on an empty table". The empty-table rule left a trap: a store holding other accounts but no
   * admin never regains one. On a public demo that is every restart, because the baseline it resets
   * to holds the demo account and no admin (yourphr#886). Keyed on the name, not the role, so the
   * read-only `demoadmin` never counts. Recreating it is safe: the password is random and readable
   * only by whoever can read the data directory, which is the same proof `reset-password` asks for.
   */
  async bootstrapAdmin(dataDir: string, username = BOOTSTRAP_ADMIN_USERNAME): Promise<{ created: boolean; passwordFile?: string; others?: number }> {
    if (await this.provider.get(username)) return { created: false };
    const others = await this.provider.count();
    const password = randomBytes(24).toString('base64url');
    await this.provider.create({ username, passwordHash: this.passwords.hash(password), tokenGeneration: 0, role: ADMIN_ROLE });
    mkdirSync(dataDir, { recursive: true });
    const file = join(dataDir, '.admin_bootstrap_password');
    writeFileSync(file, password + '\n', { mode: 0o600 });
    this.bootstrapFile = file;
    this.bootstrapUsername = username;
    return { created: true, passwordFile: file, ...(others > 0 ? { others } : {}) };
  }

  /**
   * Does this password verify against the stored account? Asked by demo provisioning at boot
   * (yourphr#643), which must know whether the configured credential still matches before it
   * rotates one. Passwords are this manager's resource, so the question is answered here rather
   * than by a caller reaching for the hash — the manager-is-the-only-door rule from yourphr#608.
   *
   * Not a sign-in: no throttle entry, no generation check, no token. A boot-time check that spent
   * throttle budget would let a restart loop lock the account out of its own front door.
   */
  async passwordMatches(username: string, password: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<boolean> {
    const stored = await this.provider.get(username);
    if (!stored) return false;
    return (await this.passwords.authenticate(username, password, stored, nowSeconds)).ok;
  }

  /**
   * Set a generated password on an existing account at boot, ending every session of it
   * (yourphr#643). No ApiContext for the same reason bootstrapAdmin and recoverAccess have none:
   * this runs before anyone is asking, so there is no actor to check — the proof is that you are
   * the process, not that you hold a session.
   *
   * Deliberately NOT reachable from a route. The only caller is demo provisioning, which chooses
   * the password itself; a route that set a caller-supplied password with no permission check
   * would be an account-takeover primitive.
   */
  async provisionPassword(username: string, password: string): Promise<boolean> {
    return this.provider.setPasswordHash(username, this.passwords.hash(password), true);
  }

  /** Recovery when nobody can sign in (yourphr#510): a fresh password, 0600 in the data dir, every session ended. */
  async recoverAccess(dataDir: string, username: string): Promise<{ passwordFile: string }> {
    if (!(await this.provider.get(username))) throw new Error(`no such account: ${username}`);
    const password = randomBytes(24).toString('base64url');
    if (!(await this.provider.setPasswordHash(username, this.passwords.hash(password), true))) throw new Error('recovery did not apply');
    mkdirSync(dataDir, { recursive: true });
    const file = join(dataDir, '.recovery_password');
    writeFileSync(file, password + '\n', { mode: 0o600 });
    return { passwordFile: file };
  }

  // --- the migration (yourphr#583, #597): one-way, as a system principal ---

  async importLegacy(ctx: ApiContext, users: LegacyUser[]): Promise<ImportReport> {
    if (ctx.system === '') throw new ApiError(403, 'the legacy import is a system operation');
    const report: ImportReport = { imported: [], skippedExisting: [], admins: [] };
    for (const user of users) {
      if (await this.provider.get(user.username)) { report.skippedExisting.push(user.username); continue; }
      if (!isLegacyBcrypt(user.passwordHash)) throw new Error(`refusing to import ${user.username}: password hash is not a Go bcrypt hash`);
      // Go's role name, resolved against what THIS instance defines (yourphr#648). Go had two
      // roles and this stack may have more, so an unmapped name lands on the least-privileged one
      // rather than being invented — an import must never hand out powers the source did not.
      const role = normaliseRole(user.role, this.knownRoles());
      await this.provider.create({ username: user.username, passwordHash: user.passwordHash, tokenGeneration: user.tokenGeneration, role });
      report.imported.push(user.username);
      if (role === ADMIN_ROLE) report.admins.push(user.username);
    }
    return report;
  }

  // --- the base contract ---

  async backup(): Promise<BackupData> {
    // Accounts live in the app database, which the records backup already carries whole (#602).
    return { manager: this.name, takenAt: new Date().toISOString(), payload: { accounts: (await this.provider.list()).map((u) => u.username) } };
  }

  async restore(): Promise<void> {
    throw new ApiError(501, 'accounts are restored with the app database, not live');
  }
}
