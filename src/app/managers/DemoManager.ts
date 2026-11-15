/**
 * Demo mode (yourphr#643): the shared account a public demo signs every visitor into, the one-click
 * entrance that does it, and the restriction that makes the arrangement safe.
 *
 * Three facts, one owner. Go spread them over `pkg/demo` (provisioning), an auth handler (the
 * entrance) and a middleware (the restriction), and the three had to agree about what "the demo
 * account" means. Here they are one manager, because they are one rule read three ways: THIS
 * instance is a demo, THIS account is the demo's, and that account may not bring outside data in.
 *
 * WHY THE CREDENTIAL IS GENERATED. `POST /api/auth/demo-signin` posts nothing — the server verifies
 * the configured password against the stored hash and mints the session — so no visitor ever needs
 * to know one. A human-chosen value bought only the ability to type it at the sign-in form, which
 * nobody does, and it cost twice in Go: the seeded `demo123` was shorter than the product's own
 * minimum (yourphr#505), and its replacement collided with the policy that forbids the username
 * inside the password (yourphr#506). A value shipped inside a public image is a published
 * credential identical on every deployment; generated per instance, it is neither.
 *
 * WHY THE VERIFY SURVIVES. Minting a token for whoever `yourphr.demo.username` names would be
 * simpler and would turn one mis-set flag into an auth bypass: demo mode switched on by an operator
 * exploring the Configuration screen, on an instance that happens to hold an account called `demo`,
 * would hand a stranger that account's records. The configured password must verify against the
 * stored hash, so a flag flipped without provisioning does nothing at all.
 *
 * NOT FATAL AT BOOT. A demo that cannot provision is a demo with no way in — worth a loud log line,
 * not worth refusing to start over. Contrast the bootstrap admin (yourphr#504), where failing to
 * provision leaves an instance reachable and unowned.
 */
import { randomBytes } from 'node:crypto';
import { BaseManager, type BackupData } from '../../framework/BaseManager.js';
import type { Engine } from '../../framework/Engine.js';
import { ApiContext, ApiError } from '../../framework/ApiContext.js';

declare module '../../framework/Engine.js' {
  interface ManagerRegistry {
    demo: DemoManager;
  }
}

/**
 * The frontend recognises a demo refusal by this code rather than by string-matching a sentence
 * (Go's `middleware.DemoErrorCode`), so it is wire format and keeps Go's spelling — including the
 * envelope field being `code` here where the consent refusal uses `error_code`.
 */
export const DEMO_ERROR_CODE = 'demo_account_restricted';

/** 24 random bytes — 192 bits, 32 printable characters. Nobody types it, so nothing argues for less. */
const CREDENTIAL_BYTES = 24;

export const ENABLED_KEY = 'yourphr.demo.enabled';
export const USERNAME_KEY = 'yourphr.demo.username';
export const PASSWORD_KEY = 'yourphr.demo.password';
export const ADMIN_ENABLED_KEY = 'yourphr.demo.admin.enabled';
export const ADMIN_USERNAME_KEY = 'yourphr.demo.admin.username';
export const ADMIN_PASSWORD_KEY = 'yourphr.demo.admin.password';

/** The role the read-only demo admin holds — defined in the shipped configuration (yourphr#644). */
export const DEMO_ADMIN_ROLE = 'demo-admin';

/**
 * The writes a read-only admin session may still make. Empty, and that is the point: the guard is
 * DEFAULT-DENY by method, so a route added next year is refused by inheritance rather than by
 * somebody remembering to add it to a deny-list. An entry here is a deliberate exception and needs
 * a reason beside it.
 */
const READ_ONLY_WRITES: string[] = [];

/**
 * GETs a read-only admin must NOT have, even though the role can see the operator screens: revealing
 * a configured secret, and anything that walks the server's filesystem. Read-only is not the same as
 * harmless.
 */
const DENIED_READS = ['/api/secure/admin/config/reveal/'];

export class DemoManager extends BaseManager {
  readonly name = 'demo';
  override readonly dependsOn = ['configuration', 'users', 'sessions'] as const;

  constructor(engine: Engine, private readonly log: (line: string) => void = () => undefined) {
    super(engine);
  }

  private get configuration() {
    return this.engine.managers.configuration;
  }

  /** Is this instance a public demo at all? False on every ordinary install, which is the shipped default. */
  get enabled(): boolean {
    return this.configuration.getBool(ENABLED_KEY);
  }

  /** The account visitors are signed into. Never published — the wire carries the flag, not the name. */
  get username(): string {
    return this.configuration.getString(USERNAME_KEY);
  }

  /**
   * Is this the shared demo account? Keyed on demo mode AND the name, not the flag alone, so the
   * operator's own account keeps full function on the same instance — which is how the demo's seed
   * data gets refreshed without switching demo mode off and on again.
   */
  isDemoAccount(username: string): boolean {
    return this.enabled && this.username !== '' && username === this.username;
  }

  /** Whether THIS caller is the shared account — what `demo_account` on `/account/me` reports. */
  isDemoSession(ctx: ApiContext): boolean {
    return ctx.isAuthenticated && this.isDemoAccount(ctx.username);
  }

  /**
   * The restriction (yourphr#496), and the reason demo mode is safe to run in public: the demo
   * account is SHARED, so a visitor who connects their own real Epic or Medicare account would put
   * their claims and conditions in front of the next visitor — real PHI, on a public login. Called
   * by the managers that own bringing outside data in, never by a route: a hidden button is not a
   * control, and the routes answer curl whatever the UI renders.
   */
  refuseConnect(ctx: ApiContext): void {
    if (!this.isDemoSession(ctx)) return;
    throw new ApiError(403,
      'connecting a provider is disabled in the public demo — the demo account is shared, so records imported here would be visible to everyone',
      { code: DEMO_ERROR_CODE });
  }

  /**
   * The other restriction (yourphr#514, the lesson Go learned by shipping without it): the three
   * account writes a visitor can use to take the demo away from everyone else.
   *
   * Changing the password leaves the configured value no longer matching the stored hash, so
   * `demo-signin` — the only advertised way in — refuses every visitor until an operator restarts
   * the instance. Deleting the account leaves the entrance with nothing to sign in to. Signing out
   * everywhere ends every other visitor's session mid-read. None of the three is self-healing.
   *
   * Contrast with wrecking the demo's RECORDS, which stays deliberately allowed: that heals at the
   * next reset and shows the product working.
   *
   * `what` names the action, because unlike the connect refusal these are three different doors and
   * a visitor deserves to know which one shut.
   */
  refuseWrite(ctx: ApiContext, what: string): void {
    if (!this.isDemoSession(ctx)) return;
    throw new ApiError(403, `${what} is disabled in the public demo — the account is shared with every other visitor`, { code: DEMO_ERROR_CODE });
  }

  /** Is the read-only admin tour offered? Requires demo mode as well — one flag must not open it. */
  get adminEnabled(): boolean {
    return this.enabled && this.configuration.getBool(ADMIN_ENABLED_KEY);
  }

  /** The account the admin tour signs in as. Never published, same as the demo account's name. */
  get adminUsername(): string {
    return this.configuration.getString(ADMIN_USERNAME_KEY);
  }

  /** Is THIS caller the read-only demo admin? What the banner and the write guard both ask. */
  isDemoAdminSession(ctx: ApiContext): boolean {
    return ctx.isAuthenticated && this.adminEnabled && this.adminUsername !== '' && ctx.username === this.adminUsername;
  }

  /**
   * The read-only rule, enforced on the wire (yourphr#644). Default-deny by METHOD: everything that
   * is not a GET is refused for this session unless it is on a short, reasoned allowlist — because
   * these routes answer curl whatever the UI renders, and a hidden button is not a control. A route
   * added next year is refused without anyone remembering to add it to a list.
   *
   * A handful of GETs are refused too: read-only is not the same as harmless, and a public entrance
   * must not be able to reveal a configured secret.
   */
  refuseUnlessRead(ctx: ApiContext, method: string, path: string): void {
    if (!this.isDemoAdminSession(ctx)) return;
    if (DENIED_READS.some((prefix) => path.startsWith(prefix))) {
      throw new ApiError(403, 'the demo admin is read-only, and this would reveal a configured secret', { code: DEMO_ERROR_CODE });
    }
    if (method === 'GET' || method === 'HEAD' || READ_ONLY_WRITES.includes(path)) return;
    throw new ApiError(403, 'the demo admin is read-only — nothing you change here is saved', { code: DEMO_ERROR_CODE });
  }

  /**
   * The one-click entrance. Verifies the CONFIGURED password against the stored hash and mints a
   * session for it; the caller supplies nothing. Every refusal says the same generic thing, because
   * the difference between "not enabled here", "no such account" and "the credential drifted" is an
   * operator's to read in the log, not a visitor's to probe from outside.
   */
  async signIn(): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
    if (!this.enabled) return { ok: false, error: 'demo mode is not enabled on this instance' };
    return this.enter(this.username, PASSWORD_KEY, USERNAME_KEY);
  }

  /**
   * The second entrance (yourphr#644): the READ-ONLY admin tour, so a reviewer can see how the
   * instance is configured without an operator handing out a real admin credential.
   *
   * Identical mechanics to the patient entrance — generated credential, verified server-side — and
   * gated on demo.admin.enabled ON TOP of demo mode, because an admin account a stranger can enter
   * is not something a single flag should be able to open.
   *
   * Nothing here makes the session read-only. That is refuseUnlessRead, on every request, because
   * these routes answer curl whatever the UI renders.
   */
  async signInAsAdmin(): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
    if (!this.enabled) return { ok: false, error: 'demo mode is not enabled on this instance' };
    if (!this.adminEnabled) return { ok: false, error: 'the demo admin is not enabled on this instance' };
    return this.enter(this.adminUsername, ADMIN_PASSWORD_KEY, ADMIN_USERNAME_KEY);
  }

  /**
   * The body both entrances share: look up the configured account, verify the configured password
   * against its stored hash, mint the session. Parameterised by config key rather than duplicated,
   * so the two cannot drift on the check that matters.
   */
  private async enter(username: string, passwordKey: string, usernameKey: string): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
    const refused = { ok: false, error: 'demo mode is not configured on this instance' } as const;
    const password = this.configuration.getString(passwordKey);
    if (username === '' || password === '') {
      // Since provisioning, an empty value here means the account did not exist when this instance
      // last started — so say what the fix is, on the server, where the operator looks.
      this.log(`demo sign-in refused: ${username === '' ? usernameKey : passwordKey} is empty (the credential is provisioned at startup — create the account and restart)`);
      return refused;
    }
    if (!(await this.engine.managers.users.passwordMatches(username, password))) {
      this.log(`demo sign-in refused: ${passwordKey} does not match the ${JSON.stringify(username)} account`);
      return refused;
    }
    const token = await this.engine.managers.sessions.issueFor(username);
    if (token === undefined) {
      this.log(`demo sign-in refused: no account named ${JSON.stringify(username)} exists`);
      return refused;
    }
    return { ok: true, token };
  }

  /**
   * Boot: make sure the demo account carries a password this process generated and nobody knows,
   * and that `yourphr.demo.password` holds it.
   *
   * IDEMPOTENT. The normal path on every restart is "the configured password already verifies", and
   * this touches nothing. It regenerates only when the two have drifted apart — which is exactly
   * what a freshly restored seed looks like, so a reset needs no operator step.
   *
   * ORDER. The account is updated first: if the config write then fails, the configured value no
   * longer verifies, so the next boot regenerates and the drift heals itself. What must never
   * happen is treating a mismatch as "no password required", which is why signIn() refuses rather
   * than falling back.
   */
  async provision(): Promise<{ markedTest: boolean }> {
    if (!this.enabled) return { markedTest: false };
    await this.provisionOne(this.username, PASSWORD_KEY, USERNAME_KEY, 'demo credential');
    const markedTest = await this.ensureTestAccount();
    // The read-only admin (yourphr#644), after the demo account and only if its own flag is on.
    // Its account is CREATED here when missing, unlike the demo account: the demo's records make it
    // something an operator seeds deliberately, while this one holds nothing and exists only to be
    // looked through.
    if (this.adminEnabled) {
      await this.ensureAdminAccount();
      await this.provisionOne(this.adminUsername, ADMIN_PASSWORD_KEY, ADMIN_USERNAME_KEY, 'demo admin');
    }
    return { markedTest };
  }

  /**
   * The demo account is a TEST account (yourphr#919): everything it holds is synthetic sandbox
   * data, and the instance keeps test data and real data in separate accounts. The baseline is
   * built that way; this makes sure of it at every start, for a baseline built before it was, or an
   * account seeded by hand. Only the patient account, and only while it holds the ordinary user
   * role — never the operator's admin or the read-only demo admin. Idempotent: true only when it
   * changed the flag, which the users manager logs.
   */
  private async ensureTestAccount(): Promise<boolean> {
    const username = this.username;
    const users = this.engine.managers.users;
    if (username === '' || (await users.isTest(username))) return false;
    const role = await users.roleOf(username);
    if (role === undefined) return false; // no such account: provisionOne has already said so
    if (role !== 'user') {
      this.log(`demo mode: ${JSON.stringify(username)} holds the ${role} role, so it was not marked as a test account`);
      return false;
    }
    await users.setTest(ApiContext.system('demo-provisioning', username, this.engine), username, true);
    return true;
  }

  /**
   * Whether the admin screens leave out the backup notice: on a demo that cannot back up. A demo
   * runs without keys by design (its baseline ships plaintext in a public image, and the reset is
   * its restore), so "backups are unavailable" there is the expected state, not a fault to raise.
   * A demo an operator did give a backup key keeps the ordinary notice and health.
   */
  quietsBackupNotice(backupsUnavailable: string): boolean {
    return this.enabled && backupsUnavailable !== '';
  }

  /** Create the read-only admin if this instance does not have it yet, with a throwaway password
   * that provisioning replaces a moment later. The role is what makes it read-only-capable; the
   * guard is what makes it read-only (yourphr#644, yourphr#648). */
  private async ensureAdminAccount(): Promise<void> {
    const username = this.adminUsername;
    if (username === '' || (await this.engine.managers.users.record(username))) return;
    try {
      await this.engine.managers.users.createUser(ApiContext.system('demo-provisioning', username, this.engine), username, randomBytes(CREDENTIAL_BYTES).toString('base64url'), DEMO_ADMIN_ROLE);
      this.log(`demo admin: created ${JSON.stringify(username)} with the ${DEMO_ADMIN_ROLE} role`);
    } catch (err) {
      this.log(`demo admin: could not create ${JSON.stringify(username)} (${(err as Error).message}); the admin tour will refuse every visitor`);
    }
  }

  /** One account's credential: generated, set, recorded. Shared so the two entrances cannot drift. */
  private async provisionOne(username: string, passwordKey: string, usernameKey: string, what: string): Promise<void> {
    if (username === '') {
      this.log(`demo mode is enabled but ${usernameKey} is empty; no ${what} was provisioned`);
      return;
    }
    const existing = this.configuration.getString(passwordKey);
    if (existing !== '' && (await this.engine.managers.users.passwordMatches(username, existing))) return;

    const password = randomBytes(CREDENTIAL_BYTES).toString('base64url');
    if (!(await this.engine.managers.users.provisionPassword(username, password))) {
      // Reachable and expected where demo mode was switched on before the account exists.
      this.log(`demo mode is enabled but no account named ${JSON.stringify(username)} exists; no ${what} was provisioned`);
      return;
    }
    try {
      this.configuration.set(passwordKey, password);
    } catch (err) {
      // The one unrecoverable case is an operator pinning the password in the environment: the
      // account now carries a password nothing knows, and this cannot record the new one. Say so
      // with the fix in it rather than leaving an entrance that refuses every visitor for no stated
      // reason. Never log the value itself.
      this.log(`${what}: set a new password on ${JSON.stringify(username)} but could not record it in ${passwordKey} (${(err as Error).message})`);
      return;
    }
    this.log(`${what}: generated a new password for ${JSON.stringify(username)} and stored it in ${passwordKey}`);
  }

  // --- the base contract ---

  async backup(): Promise<BackupData> {
    // Nothing of its own: the flag and the name are configuration, the credential is provisioned
    // at boot, and the account itself travels with the app database.
    return { manager: this.name, takenAt: new Date().toISOString(), payload: {} };
  }

  async restore(): Promise<void> {
    throw new ApiError(501, 'demo mode is configuration and a provisioned credential, not restorable state');
  }
}
