/**
 * Demo mode (yourphr#643). The tests that matter are the refusals: a flag flipped without a
 * provisioned credential must do NOTHING, and the shared account must not be able to connect a
 * provider. Both are the difference between a harmless demo and a stranger's records on a public
 * login, so each is asserted from the outside rather than by reading the manager's mind.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { Engine } from '../../../framework/Engine.js';
import { ApiContext } from '../../../framework/ApiContext.js';
import { ConfigurationManager } from '../../../framework/ConfigurationManager.js';
import { PolicyManager } from '../../../framework/managers/PolicyManager.js';
import { FakeConfigProvider } from '../../../framework/providers/__tests__/FakeConfigProvider.js';
import { FakeUsersProvider } from '../../../framework/providers/__tests__/FakeUsersProvider.js';
import { UsersManager } from '../../../framework/managers/UsersManager.js';
import { SessionsManager } from '../../../framework/managers/SessionsManager.js';
import { PasswordAuthProvider } from '../../../framework/providers/PasswordAuthProvider.js';
import { DemoManager, DEMO_ERROR_CODE, ENABLED_KEY, PASSWORD_KEY, USERNAME_KEY } from '../DemoManager.js';
import type { ConfigValue } from '../../../config/index.js';

const PW = 'a-long-enough-password';

let engine: Engine;
let config: ConfigurationManager;
let provider: FakeConfigProvider;
let users: UsersManager;
let demo: DemoManager;
let lines: string[];

async function boot(custom: Record<string, ConfigValue> = {}): Promise<void> {
  engine = new Engine();
  provider = new FakeConfigProvider(custom);
  config = new ConfigurationManager(engine, provider);
  lines = [];
  users = new UsersManager(engine, new FakeUsersProvider(), new PasswordAuthProvider(), { log: (l) => lines.push(l) });
  demo = new DemoManager(engine, (l) => lines.push(l));
  engine
    .register('configuration', config)
    .register('policy', new PolicyManager(engine))
    .register('users', users)
    .register('sessions', new SessionsManager(engine, [new PasswordAuthProvider()]))
    .register('demo', demo);
  await engine.initialize();
}

/** The account a public demo signs visitors into, created the ordinary way. */
async function createDemoAccount(username = 'demo'): Promise<void> {
  await users.createUser(ApiContext.system('test', 'admin', engine), username, PW);
}

beforeEach(async () => { await boot(); });

describe('DemoManager — the shared demo account (yourphr#643)', () => {
  it('is inert on an ordinary install: nothing provisioned, nothing published, no sign-in', async () => {
    await createDemoAccount();
    await demo.provision();
    expect(provider.written()).toEqual({});      // not a single write on a non-demo instance
    expect(demo.enabled).toBe(false);
    expect(demo.isDemoAccount('demo')).toBe(false);
    expect(await demo.signIn()).toMatchObject({ ok: false });
  });

  it('provisions a generated password on the demo account and records it, then leaves it alone', async () => {
    await boot({ [ENABLED_KEY]: true });
    await createDemoAccount();

    await demo.provision();
    const generated = provider.written()[PASSWORD_KEY] as string;
    expect(typeof generated).toBe('string');
    expect(generated.length).toBeGreaterThanOrEqual(32);   // 24 random bytes, base64url
    expect(await users.passwordMatches('demo', generated)).toBe(true);
    expect(lines.join('\n')).not.toContain(generated);      // says that it happened, never what

    // The normal path on every restart: already matching, so nothing is written and the working
    // demo credential is not rotated out from under the visitors using it.
    const saves = provider.saves;
    await demo.provision();
    expect(provider.saves).toBe(saves);
    expect(provider.written()[PASSWORD_KEY]).toBe(generated);
  });

  it('regenerates when the stored hash and the configured value have drifted — a restored seed', async () => {
    await boot({ [ENABLED_KEY]: true, [PASSWORD_KEY]: 'what-the-seed-builder-used' });
    await createDemoAccount();

    await demo.provision();
    const fresh = provider.written()[PASSWORD_KEY] as string;
    expect(fresh).not.toBe('what-the-seed-builder-used');
    expect(await users.passwordMatches('demo', fresh)).toBe(true);
  });

  it('signs in with no credentials at all once provisioned, and the session is the demo account', async () => {
    await boot({ [ENABLED_KEY]: true });
    await createDemoAccount();
    await demo.provision();

    const result = await demo.signIn();
    expect(result.ok).toBe(true);
    const verified = await engine.managers.sessions.verify((result as { token: string }).token);
    expect(verified.ok).toBe(true);
    expect(verified.ok && verified.principal.username).toBe('demo');
  });

  // THE ONE THAT MATTERS. demo.enabled on an instance that happens to hold an account called
  // `demo` — the shipped default name — must not hand a stranger that account.
  it('refuses when the flag is on but no password was provisioned, even though the account exists', async () => {
    await boot({ [ENABLED_KEY]: true });
    await createDemoAccount();
    expect(await demo.signIn()).toMatchObject({ ok: false, error: 'demo mode is not configured on this instance' });
  });

  it('refuses when the configured password does not verify against the stored hash', async () => {
    await boot({ [ENABLED_KEY]: true, [PASSWORD_KEY]: 'not-the-stored-one' });
    await createDemoAccount();
    expect(await demo.signIn()).toMatchObject({ ok: false });
    expect(lines.join('\n')).toContain('does not match');
  });

  it('refuses when the configured account does not exist', async () => {
    await boot({ [ENABLED_KEY]: true, [USERNAME_KEY]: 'nobody', [PASSWORD_KEY]: 'anything' });
    expect(await demo.signIn()).toMatchObject({ ok: false });
  });

  it('provisions nothing when the demo account does not exist yet, and says so without failing', async () => {
    await boot({ [ENABLED_KEY]: true });
    await demo.provision();
    expect(provider.written()[PASSWORD_KEY]).toBeUndefined();
    expect(lines.join('\n')).toContain('no account named "demo" exists');
  });

  it('refuses connect for the demo account only — the operator keeps full function on the same instance', async () => {
    await boot({ [ENABLED_KEY]: true });
    const visitor = ApiContext.from({ username: 'demo', role: 'user' }, engine);
    const operator = ApiContext.from({ username: 'jim', role: 'admin' }, engine);

    expect(() => demo.refuseConnect(visitor)).toThrowError(/disabled in the public demo/);
    try {
      demo.refuseConnect(visitor);
    } catch (err) {
      expect(err).toMatchObject({ status: 403, extra: { code: DEMO_ERROR_CODE } });
    }
    expect(() => demo.refuseConnect(operator)).not.toThrow();
    expect(demo.isDemoSession(visitor)).toBe(true);
    expect(demo.isDemoSession(ApiContext.anonymous(engine))).toBe(false);
  });

  it('refuses the three account writes that would take the demo away from everyone (yourphr#514)', async () => {
    await boot({ [ENABLED_KEY]: true });
    const visitor = ApiContext.from({ username: 'demo', role: 'user' }, engine);
    const operator = ApiContext.from({ username: 'jim', role: 'admin' }, engine);
    for (const what of ['changing the password', 'deleting the account', 'signing out everywhere']) {
      expect(() => demo.refuseWrite(visitor, what)).toThrowError(new RegExp(what));
      expect(() => demo.refuseWrite(operator, what)).not.toThrow();
    }
    try {
      demo.refuseWrite(visitor, 'changing the password');
    } catch (err) {
      expect(err).toMatchObject({ status: 403, extra: { code: DEMO_ERROR_CODE } });
    }
  });

  it('the read-only admin tour: a second entrance, gated on its own flag as well (yourphr#644)', async () => {
    await boot({ [ENABLED_KEY]: true, 'yourphr.demo.admin.enabled': true });
    await createDemoAccount();
    // Provisioning creates the demo admin itself, unlike the demo account: it holds nothing, and
    // exists only to be looked through.
    await demo.provision();
    const result = await demo.signInAsAdmin();
    expect(result.ok).toBe(true);
    expect(await users.roleOf('demoadmin')).toBe('demo-admin');

    // The same instance with the admin flag off offers the patient tour and refuses this one.
    await boot({ [ENABLED_KEY]: true });
    await createDemoAccount();
    await demo.provision();
    expect((await demo.signIn()).ok).toBe(true);
    expect(await demo.signInAsAdmin()).toMatchObject({ ok: false, error: 'the demo admin is not enabled on this instance' });
  });

  it('read-only is DEFAULT-DENY by method, so a route added later is refused without being listed', async () => {
    await boot({ [ENABLED_KEY]: true, 'yourphr.demo.admin.enabled': true });
    const tour = ApiContext.from({ username: 'demoadmin', role: 'demo-admin' }, engine);
    const operator = ApiContext.from({ username: 'jim', role: 'admin' }, engine);

    expect(() => demo.refuseUnlessRead(tour, 'GET', '/api/secure/admin/config')).not.toThrow();
    for (const [method, path] of [['POST', '/api/secure/admin/users'], ['PUT', '/api/secure/admin/config'], ['DELETE', '/api/secure/account/me'], ['PATCH', '/api/secure/a/route/invented/next/year']]) {
      expect(() => demo.refuseUnlessRead(tour, method!, path!)).toThrowError(/read-only/);
    }
    // A GET that would expose a configured secret is refused as well.
    expect(() => demo.refuseUnlessRead(tour, 'GET', '/api/secure/admin/config/reveal/yourphr.demo.password')).toThrowError(/secret/);
    // And none of it touches the operator's own admin on the same instance.
    expect(() => demo.refuseUnlessRead(operator, 'DELETE', '/api/secure/account/me')).not.toThrow();
  });

  it('does not restrict an account named demo on an instance that never opted in', async () => {
    const namesake = ApiContext.from({ username: 'demo', role: 'user' }, engine);
    expect(() => demo.refuseConnect(namesake)).not.toThrow();
  });
});

describe('DemoManager — the demo account is a test account (yourphr#919)', () => {
  it('marks the demo account as a test account at provisioning, once, with one log line', async () => {
    await boot({ [ENABLED_KEY]: true });
    await createDemoAccount();
    expect(await users.isTest('demo')).toBe(false);

    expect(await demo.provision()).toEqual({ markedTest: true });
    expect(await users.isTest('demo')).toBe(true);
    expect(lines.filter((l) => l.includes('test account'))).toEqual(['demo-provisioning changed demo: test account false -> true']);

    // Idempotent: the next start changes nothing and says nothing more about it.
    const before = lines.length;
    expect(await demo.provision()).toEqual({ markedTest: false });
    expect(lines.slice(before).filter((l) => l.includes('test account'))).toEqual([]);
  });

  it('leaves an account alone on an instance that never opted in', async () => {
    await createDemoAccount();
    expect(await demo.provision()).toEqual({ markedTest: false });
    expect(await users.isTest('demo')).toBe(false);
  });

  it('never marks the read-only demo admin, nor an admin the demo username points at', async () => {
    await boot({ [ENABLED_KEY]: true, 'yourphr.demo.admin.enabled': true });
    await createDemoAccount();
    await demo.provision();
    expect(await users.isTest('demo')).toBe(true);
    expect(await users.isTest('demoadmin')).toBe(false);

    // A mis-set username naming the operator's own admin: refused, and said so.
    await boot({ [ENABLED_KEY]: true, [USERNAME_KEY]: 'ops' });
    await users.createUser(ApiContext.system('test', 'admin', engine), 'ops', PW, 'admin');
    expect(await demo.provision()).toEqual({ markedTest: false });
    expect(await users.isTest('ops')).toBe(false);
    expect(lines.join('\n')).toContain('"ops" holds the admin role, so it was not marked as a test account');
  });
});

describe('DemoManager — the backup notice on a keyless demo', () => {
  const reason = 'Backups are unavailable: no backup encryption key is set (YOURPHR_BACKUP_ENCRYPTION_KEY).';

  it('quiets it on a demo that cannot back up, and only there', async () => {
    expect(demo.quietsBackupNotice(reason)).toBe(false);   // an ordinary install keeps the warning
    await boot({ [ENABLED_KEY]: true });
    expect(demo.quietsBackupNotice(reason)).toBe(true);
    expect(demo.quietsBackupNotice('')).toBe(false);      // a demo that was given a key shows its ordinary health
  });
});
