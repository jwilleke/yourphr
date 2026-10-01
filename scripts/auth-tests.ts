/**
 * Authentication and sessions (yourphr#541, now the Users + Sessions managers of yourphr#611):
 * sign-in, revocation, sliding TTL, throttling, the trusted-proxy rule, the password policy, the
 * token internals, the wire, bootstrap and recovery, and the Go account migration — each
 * decision the Go stack paid to learn, checked by trying to break it.
 *
 *   npm run auth
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';
import bcryptjs from 'bcryptjs';
import { Engine } from '../src/framework/Engine.js';
import { ApiContext } from '../src/framework/ApiContext.js';
import { ConfigurationManager } from '../src/framework/ConfigurationManager.js';
import { FileConfigProvider } from '../src/framework/providers/FileConfigProvider.js';
import { PolicyManager } from '../src/framework/managers/PolicyManager.js';
import { UsersManager } from '../src/framework/managers/UsersManager.js';
import { SessionsManager, GENERIC_SIGNIN_ERROR, THROTTLED_SIGNIN_ERROR, decodeToken, issueToken, clientIp, Throttle } from '../src/framework/managers/SessionsManager.js';
import { SqliteUsersProvider } from '../src/framework/providers/SqliteUsersProvider.js';
import { PasswordAuthProvider, hashPassword, verifyPassword, isLegacyBcrypt } from '../src/framework/providers/PasswordAuthProvider.js';
import { BaseAuthProvider, type AuthResult } from '../src/framework/providers/BaseAuthProvider.js';
import type { UserRecord } from '../src/framework/providers/BaseUsersProvider.js';
import { readGoUsers } from '../src/migrate/index.js';
import { SqliteFhirRepository } from '../src/SqliteFhirRepository.js';
import { createYourPhrServer } from '../src/server.js';
import { RecordsManager } from '../src/app/managers/RecordsManager.js';
import { SqliteRecordsProvider } from '../src/app/providers/SqliteRecordsProvider.js';

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const PASSWORD = 'a-long-enough-password';
const REQ = { remoteAddr: '198.51.100.7' };

/** A users + sessions engine over a temp app database, with the policies a test asks for. */
async function boot(options: { session?: { slidingSeconds: number; absoluteSeconds: number }; throttle?: { maxFailures: number; windowSeconds: number }; trustedProxies?: string[]; minPassword?: number; sessionKey?: Buffer; factors?: string[] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'spike-auth-'));
  const db = new Database(join(dir, 'app.db'));
  const engine = new Engine();
  const configEnv = options.minPassword === undefined ? {} : { YOURPHR_AUTH_PASSWORD_MIN_LENGTH: String(options.minPassword) };
  const config = new ConfigurationManager(engine, new FileConfigProvider(dir), { env: configEnv });
  const users = new UsersManager(engine, new SqliteUsersProvider(db), new PasswordAuthProvider());
  const sessions = new SessionsManager(engine, [new PasswordAuthProvider()], { sessionKey: options.sessionKey ?? randomBytes(32), session: options.session, throttle: options.throttle, trustedProxies: options.trustedProxies, factors: options.factors });
  const recordsFile = join(dir, 'records.db');
  engine.register('configuration', config).register('policy', new PolicyManager(engine)).register('users', users).register('sessions', sessions)
    .register('records', new RecordsManager(engine, new SqliteRecordsProvider(recordsFile, undefined)));
  await engine.initialize();
  const sys = ApiContext.system('harness', 'admin', engine);
  const as = (username: string): ApiContext => ApiContext.from({ username, role: 'user' }, engine);
  return { dir, db, engine, users, sessions, sys, as, recordsFile, close: async () => { await engine.shutdown(); db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

async function main(): Promise<void> {
  // --- password hashing ---
  const stored = hashPassword(PASSWORD);
  check('scrypt hash is self-describing', stored.startsWith('scrypt$16384$8$1$'));
  check('a correct password verifies', verifyPassword(stored, PASSWORD));
  check('a wrong password does not', !verifyPassword(stored, 'wrong-but-long-enough'));
  check('two hashes of one password differ (per-user salt)', hashPassword(PASSWORD) !== stored);
  check('an empty stored hash matches nothing', !verifyPassword('', PASSWORD));

  // --- sign-in + sessions ---
  {
    const t = await boot();
    await t.users.createUser(t.sys, 'alice', PASSWORD);
    const ok = await t.sessions.signIn('alice', { password: PASSWORD }, REQ);
    check('a correct sign-in yields a session token', ok.ok);
    const bad = await t.sessions.signIn('alice', { password: 'wrong-but-long-enough' }, REQ);
    const ghost = await t.sessions.signIn('nobody', { password: PASSWORD }, REQ);
    check('a wrong password and an unknown user get the SAME generic error (yourphr#104)', !bad.ok && !ghost.ok && bad.error === GENERIC_SIGNIN_ERROR && ghost.error === GENERIC_SIGNIN_ERROR);
    const v = await t.sessions.verify((ok as { token: string }).token);
    check('the token verifies to its principal, role included', v.ok && v.principal.username === 'alice' && v.principal.role === 'user' && v.principal.tokenGeneration === 0);
    check('a tampered token is refused', !(await t.sessions.verify((ok as { token: string }).token.slice(0, -2) + 'xx')).ok);
    check('garbage is refused', !(await t.sessions.verify('not.a.token')).ok && !(await t.sessions.verify('')).ok);
    await t.close();
  }

  // --- revocation: the acceptance test (yourphr#508 / #528) ---
  {
    const t = await boot();
    await t.users.createUser(t.sys, 'alice', PASSWORD);
    const before = (await t.sessions.signIn('alice', { password: PASSWORD }, REQ)) as { token: string };
    await t.users.changePassword(t.as('alice'), PASSWORD, 'a-different-long-password');
    check('a password change ENDS the existing session (the generation moved)', !(await t.sessions.verify(before.token)).ok);
    const after = (await t.sessions.signIn('alice', { password: 'a-different-long-password' }, REQ)) as { token: string };
    check('the new password signs in and the new session verifies', (await t.sessions.verify(after.token)).ok);
    await t.sessions.revokeAll(t.as('alice'));
    check('sign-out-everywhere ends every session without a password change', !(await t.sessions.verify(after.token)).ok);
    const again = (await t.sessions.signIn('alice', { password: 'a-different-long-password' }, REQ)) as { token: string };
    check('and a fresh sign-in works afterwards, carrying the new generation', (await t.sessions.verify(again.token)).ok && ((await t.sessions.verify(again.token)) as { principal: { tokenGeneration: number } }).principal.tokenGeneration === 2);
    let refused = false;
    try { await t.users.changePassword(t.as('alice'), 'not-the-current-one-long', 'another-long-password-1'); } catch { refused = true; }
    check('a password change needs the CURRENT password', refused);
    await t.close();
  }

  // --- sliding TTL + absolute cap (yourphr#445) ---
  {
    const t = await boot({ session: { slidingSeconds: 100, absoluteSeconds: 250 } });
    await t.users.createUser(t.sys, 'alice', PASSWORD);
    const token = ((await t.sessions.signIn('alice', { password: PASSWORD }, REQ, 1000)) as { token: string }).token;
    check('inside the window: valid, not renewed', (await t.sessions.verify(token, 1040)).ok && !((await t.sessions.verify(token, 1040)) as { renewed?: string }).renewed);
    const late = await t.sessions.verify(token, 1060);
    check('past the renewal half: valid AND a fresh token is returned', late.ok && !!late.renewed);
    check('the original expires at its sliding deadline', !(await t.sessions.verify(token, 1100)).ok);
    const renewed = (late as { renewed: string }).renewed;
    check('the renewed token is valid past the old deadline', (await t.sessions.verify(renewed, 1120)).ok);
    const chain = await t.sessions.verify(renewed, 1140);
    const last = (chain as { renewed?: string }).renewed ?? renewed;
    check('renewal never extends past the absolute cap', !(await t.sessions.verify(last, 1250)).ok && decodeToken(t.sessions['sessionKey' as never] as Buffer, last)!.exp <= 1250);
    await t.close();
  }

  // --- throttling (yourphr#509) + trusted proxy (yourphr#529) ---
  {
    const t = await boot({ throttle: { maxFailures: 3, windowSeconds: 60 }, trustedProxies: ['10.0.0.1'] });
    await t.users.createUser(t.sys, 'alice', PASSWORD);
    await t.users.createUser(t.sys, 'bob', PASSWORD);
    for (let i = 0; i < 3; i++) await t.sessions.signIn('alice', { password: 'wrong-but-long-enough' }, { remoteAddr: '203.0.113.5' }, 100 + i);
    const locked = await t.sessions.signIn('alice', { password: PASSWORD }, { remoteAddr: '203.0.113.9' }, 110);
    // yourphr#507 (Jim, 2026-09-30): a locked account answers "Too many attempts…" — the same for
    // any username, real or not, so it still reveals nothing — instead of the generic wrong-password text.
    check('three failures lock the ACCOUNT — even the right password from another address is refused, with the throttled answer', !locked.ok && locked.error === THROTTLED_SIGNIN_ERROR);
    const bobFromSameIp = await t.sessions.signIn('bob', { password: PASSWORD }, { remoteAddr: '203.0.113.5' }, 111);
    check('the IP that failed three times is locked too: bob cannot sign in from it', !bobFromSameIp.ok);
    const bobElsewhere = await t.sessions.signIn('bob', { password: PASSWORD }, { remoteAddr: '203.0.113.77' }, 112);
    check('but bob signs in from a clean address', bobElsewhere.ok);
    check('the lock lifts when the window passes', (await t.sessions.signIn('alice', { password: PASSWORD }, { remoteAddr: '203.0.113.9' }, 200)).ok);
    check('X-Forwarded-For is ignored from an untrusted peer', clientIp('198.51.100.7', '1.2.3.4', ['10.0.0.1']) === '198.51.100.7');
    check('and believed from a declared proxy — the LAST hop', clientIp('10.0.0.1', '1.2.3.4, 5.6.7.8', ['10.0.0.1']) === '5.6.7.8');
    const th = new Throttle({ maxFailures: 2, windowSeconds: 10 });
    th.recordFailure('k', 1); th.recordFailure('k', 2);
    check('the throttle window slides', th.isLimited('k', 5) && !th.isLimited('k', 13));
    await t.close();
  }

  // --- password policy (yourphr#506) ---
  {
    const t = await boot({ minPassword: 12 });
    let short = '';
    try { await t.users.createUser(t.sys, 'bob', 'short'); } catch (err) { short = (err as Error).message; }
    check('a password under the minimum is refused at creation, with the rule stated', short.includes('at least 12'));
    await t.users.createUser(t.sys, 'bob', PASSWORD);
    let shortChange = '';
    try { await t.users.changePassword(t.as('bob'), PASSWORD, 'tiny'); } catch (err) { shortChange = (err as Error).message; }
    check('and at change', shortChange.includes('at least 12'));
    let badName = '';
    try { await t.users.createUser(t.sys, 'Bad Name!', PASSWORD); } catch (err) { badName = (err as Error).message; }
    check('usernames are constrained', badName.includes('username must be'));
    let dup = '';
    try { await t.users.createUser(t.sys, 'bob', PASSWORD); } catch (err) { dup = (err as Error).message; }
    check('a duplicate account is refused by name', dup === 'User already exists');
    await t.close();
  }

  // --- token internals: no algorithm agility to abuse ---
  {
    const key = randomBytes(32);
    const token = issueToken(key, { u: 'alice', g: 0, iat: 1, exp: 100, cap: 200 });
    check('a token is payload.signature, nothing else', token.split('.').length === 2);
    check('the signature is keyed: another key refuses it', decodeToken(randomBytes(32), token) === undefined);
    const [payload] = token.split('.');
    check('claims without the required fields are refused', decodeToken(key, `${Buffer.from('{"u":"x"}').toString('base64url')}.${token.split('.')[1]}`) === undefined && !!payload);
  }

  // --- all-of factors (the doc's MFA-bypass warning), proven against a fake second factor ---
  {
    class Totp extends BaseAuthProvider {
      readonly name = 'totp';
      hash(credential: string): string { return credential; }
      async authenticate(username: string, credential: string, stored: UserRecord | undefined, nowSeconds: number): Promise<AuthResult> {
        if (!stored || credential !== '123456') return { ok: false, reason: 'bad code' };
        return { ok: true, subject: username, provider: 'totp', factors: ['totp'], issuedAt: nowSeconds, tokenGeneration: stored.tokenGeneration };
      }
    }
    const dir = mkdtempSync(join(tmpdir(), 'spike-auth-mfa-'));
    const db = new Database(join(dir, 'app.db'));
    const engine = new Engine();
    const users = new UsersManager(engine, new SqliteUsersProvider(db), new PasswordAuthProvider());
    const sessions = new SessionsManager(engine, [new PasswordAuthProvider(), new Totp()], { factors: ['password', 'totp'] });
    engine.register('configuration', new ConfigurationManager(engine, new FileConfigProvider(dir))).register('policy', new PolicyManager(engine)).register('users', users).register('sessions', sessions);
    await engine.initialize();
    await users.createUser(ApiContext.system('harness', 'admin', engine), 'alice', PASSWORD);
    const passwordOnly = await sessions.signIn('alice', { password: PASSWORD }, REQ);
    const both = await sessions.signIn('alice', { password: PASSWORD, totp: '123456' }, REQ);
    const wrongCode = await sessions.signIn('alice', { password: PASSWORD, totp: '000000' }, REQ);
    check('ALL-OF: with two factors configured, the password alone does NOT sign in — never "try each until one succeeds"', !passwordOnly.ok && both.ok && !wrongCode.ok);
    let missing = '';
    try {
      const e2 = new Engine();
      e2.register('configuration', new ConfigurationManager(e2, new FileConfigProvider(dir))).register('policy', new PolicyManager(e2));
      e2.register('users', new UsersManager(e2, new SqliteUsersProvider(db), new PasswordAuthProvider()));
      e2.register('sessions', new SessionsManager(e2, [new PasswordAuthProvider()], { factors: ['password', 'totp'] }));
      await e2.initialize();
    } catch (err) { missing = (err as Error).message; }
    check('a factor nobody provides refuses to BOOT rather than sign nobody in', missing.includes('no such auth provider'));
    await engine.shutdown(); db.close(); rmSync(dir, { recursive: true, force: true });
  }

  // --- the wire (yourphr#541): auth enforced by the HTTP layer, not by configuration ---
  {
    const t = await boot({ session: { slidingSeconds: 20, absoluteSeconds: 3600 } });
    await t.users.createUser(t.sys, 'alice', PASSWORD);
    await t.users.createUser(t.sys, 'bob', PASSWORD);
    const aliceRepo = new SqliteFhirRepository({ file: t.recordsFile, userId: 'alice', sourceId: 'source-1' });
    const bobRepo = new SqliteFhirRepository({ file: t.recordsFile, userId: 'bob', sourceId: 'source-1' });
    await aliceRepo.updateResource({ resourceType: 'Condition', id: 'alice-cond', code: { text: 'alice only' } } as never);
    await bobRepo.updateResource({ resourceType: 'Condition', id: 'bob-cond', code: { text: 'bob only' } } as never);
    aliceRepo.db.close(); bobRepo.db.close();

    const server = createYourPhrServer({ engine: t.engine, auth: {} });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const port = (server.address() as { port: number }).port;
    const base = `http://127.0.0.1:${port}`;
    const LIST = '/api/secure/resource/fhir?sourceResourceType=Condition';
    check('the wire: no token is 401, not a record list', (await fetch(base + LIST)).status === 401);
    check('the wire: a garbage token is 401', (await fetch(base + LIST, { headers: { authorization: 'Bearer not-a-token' } })).status === 401);
    const signIn = async (u: string, p: string) => fetch(base + '/api/auth/signin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) });
    // --- self-service signup, OFF by default (yourphr#691) ---
    //
    // The Angular form always existed and the server half never did, so it rendered and 404'd on
    // submit. It is default-closed now, which means the FIRST thing to prove is the refusal.
    const signUp = (u: string, pw: string) => fetch(base + '/api/auth/signup', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u, password: pw }),
    });
    const closed = await signUp('interloper', 'a-long-enough-password');
    check('signup is CLOSED by default — 403, and no account is created',
      closed.status === 403 && (await t.engine.managers.users.roleOf('interloper')) === undefined, `status ${closed.status}`);
    check('the shipped default is closed, not merely unset',
      t.engine.managers.configuration.getBool('yourphr.auth.signup.enabled') === false);

    t.engine.managers.configuration.set('yourphr.auth.signup.enabled', true);
    const opened = await signUp('newcomer', 'a-long-enough-password');
    check('opened by configuration, it creates a plain user — not an admin',
      opened.status === 201 && (await t.engine.managers.users.roleOf('newcomer')) === 'user', `status ${opened.status}`);
    check('the new account can sign in', (await signIn('newcomer', 'a-long-enough-password')).status === 200);
    const dupe = await signUp('newcomer', 'a-long-enough-password');
    check('a taken username is refused rather than overwritten', dupe.status === 400, `status ${dupe.status}`);
    const weak = await signUp('shorty', 'short');
    check('the instance password policy applies to signup too',
      weak.status === 400 && (await t.engine.managers.users.roleOf('shorty')) === undefined, `status ${weak.status}`);
    const badName = await signUp('Not A Username!', 'a-long-enough-password');
    check('and the username rules apply', badName.status === 400, `status ${badName.status}`);
    t.engine.managers.configuration.set('yourphr.auth.signup.enabled', false);

    const aliceBad = await signIn('alice', 'wrong-but-long-enough');
    check('the wire: a wrong password is 401 with the generic error', aliceBad.status === 401 && ((await aliceBad.json()) as { error: string }).error === GENERIC_SIGNIN_ERROR);
    const aliceToken = ((await (await signIn('alice', PASSWORD)).json()) as { data: string }).data;
    const bobToken = ((await (await signIn('bob', PASSWORD)).json()) as { data: string }).data;
    const authed = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });
    const aliceList = (await (await fetch(base + LIST, authed(aliceToken))).json()) as { data: { source_resource_id: string }[] };
    const bobList = (await (await fetch(base + LIST, authed(bobToken))).json()) as { data: { source_resource_id: string }[] };
    check('the wire: each session sees ONLY its own records (isolation enforced by the session)',
      aliceList.data.length === 1 && aliceList.data[0]?.source_resource_id === 'alice-cond' && bobList.data.length === 1 && bobList.data[0]?.source_resource_id === 'bob-cond');
    await new Promise((r) => setTimeout(r, 11_000));
    const renewedResponse = await fetch(base + LIST, authed(aliceToken));
    check('the wire: past the renewal half, a fresh token rides back in X-Renewed-Token', renewedResponse.status === 200 && !!renewedResponse.headers.get('x-renewed-token'));
    await t.sessions.revokeAll(t.as('alice'));
    check('the wire: after sign-out-everywhere the token is 401 mid-flight', (await fetch(base + LIST, authed(aliceToken))).status === 401);
    server.close();
    await t.close();
  }

  // --- bootstrap provisioning (yourphr#504) + recovery (yourphr#510) ---
  {
    const t = await boot();
    const first = await t.users.bootstrapAdmin(t.dir);
    check('bootstrap on an empty table creates the admin and a 0600 password file',
      first.created && !!first.passwordFile && existsSync(first.passwordFile) && (statSync(first.passwordFile).mode & 0o777) === 0o600);
    const second = await t.users.bootstrapAdmin(t.dir);
    check('bootstrap is one-way: a second call on a populated table is a no-op', !second.created && !second.passwordFile);
    const bootPassword = readFileSync(first.passwordFile as string, 'utf8').trim();
    const signedIn = await t.sessions.signIn('admin', { password: bootPassword }, REQ);
    check('the bootstrap password signs in', signedIn.ok);
    check('the bootstrap account is created with the admin ROLE, not recognised by name (yourphr#597)', (await t.users.roleOf('admin')) === 'admin');
    check('and the password file is gone after that first sign-in (yourphr#466)', !existsSync(first.passwordFile as string));
    const minted = await t.sessions.issueFor('admin');
    check('a session can be minted for an existing account (after a password change) and verifies; never for a stranger',
      !!minted && (await t.sessions.verify(minted)).ok && (await t.sessions.issueFor('nobody')) === undefined);
    const attacker = (await t.sessions.signIn('admin', { password: bootPassword }, REQ)) as { token: string };
    const recovered = await t.users.recoverAccess(t.dir, 'admin');
    check('recovery writes a fresh 0600 password file', existsSync(recovered.passwordFile) && (statSync(recovered.passwordFile).mode & 0o777) === 0o600);
    const newPassword = readFileSync(recovered.passwordFile, 'utf8').trim();
    check('recovery ENDS the attacker\'s session (generation bump)', !(await t.sessions.verify(attacker.token)).ok);
    check('and the recovery password signs in', (await t.sessions.signIn('admin', { password: newPassword }, REQ)).ok);
    let nobody = '';
    try { await t.users.recoverAccess(t.dir, 'nobody'); } catch (err) { nobody = (err as Error).message; }
    check('recovery of an unknown account is refused by name', nobody.includes('no such account'));
    await t.users.createUser(t.sys, 'temp', 'a-temporary-long-password');
    check('deleting the account removes it; a second delete reports nothing to delete', (await t.users.deleteSelf(t.as('temp'))) && !(await t.users.deleteSelf(t.as('temp'))) && (await t.users.roleOf('temp')) === undefined);
    const listed = await t.users.listUsers(ApiContext.from({ username: 'admin', role: 'admin' }, t.engine));
    check('the admin lists accounts with roles and never a hash', listed.some((u) => u.username === 'admin' && u.role === 'admin') && listed.every((u) => !('passwordHash' in u)));
    let memberLists = '';
    try { await t.users.listUsers(t.as('alice')); } catch (err) { memberLists = String((err as { status?: number }).status); }
    check('a member cannot list accounts (403)', memberLists === '403');
    await t.close();
  }

  // --- Go account migration: bcrypt verify-then-rehash (yourphr#583) ---
  {
    const t = await boot();
    const goDb = new Database(join(t.dir, 'go.db'));
    goDb.exec(`CREATE TABLE users (username TEXT, password TEXT, token_generation INTEGER, role TEXT, deleted_at TEXT)`);
    const bcryptHash = bcryptjs.hashSync('go-era-password-long', 8);
    goDb.prepare("INSERT INTO users VALUES ('jim', ?, 3, 'admin', NULL)").run(bcryptHash);
    goDb.prepare("INSERT INTO users VALUES ('mary', ?, 0, 'user', NULL)").run(bcryptjs.hashSync('marys-password-long', 8));
    goDb.prepare("INSERT INTO users VALUES ('ghost', 'x', 0, 'user', '2026-01-01')").run();
    await t.users.createUser(t.sys, 'mary', 'already-here-password');
    const legacy = readGoUsers(goDb);
    check('the Go reader skips soft-deleted accounts', legacy.length === 2);
    const report = await t.users.importLegacy(ApiContext.system('migration', '', t.engine), legacy);
    check('import is one-way: the existing account is skipped and reported, never overwritten', report.imported.join(',') === 'jim' && report.skippedExisting.join(',') === 'mary');
    check('Go admins are reported for the role wiring', report.admins.join(',') === 'jim');
    check('the Go role is CARRIED: the operator there is the operator here (yourphr#597)', (await t.users.roleOf('jim')) === 'admin');
    check('a skipped account keeps its own role', (await t.users.roleOf('mary')) === 'user');
    const storedBefore = (await t.users.record('jim'))!.passwordHash;
    check('the imported hash is the bcrypt hash, verbatim', isLegacyBcrypt(storedBefore));
    const wrong = await t.sessions.signIn('jim', { password: 'not-the-password-long' }, REQ);
    check('a WRONG password neither signs in nor rehashes', !wrong.ok && isLegacyBcrypt((await t.users.record('jim'))!.passwordHash));
    const first = await t.sessions.signIn('jim', { password: 'go-era-password-long' }, REQ);
    check('THE GO PASSWORD SIGNS IN — nobody resets anything', first.ok);
    const storedAfter = (await t.users.record('jim'))!.passwordHash;
    check('and the hash is now scrypt (upgrade-on-login, one verification, in place)', storedAfter.startsWith('scrypt$') && !isLegacyBcrypt(storedAfter));
    check('the upgraded hash did NOT bump the generation — the migrated session survives', (await t.sessions.verify((first as { token: string }).token)).ok && (await t.users.record('jim'))!.tokenGeneration === 3);
    check('a later sign-in verifies against the scrypt hash', (await t.sessions.signIn('jim', { password: 'go-era-password-long' }, REQ)).ok);
    let notBcrypt = '';
    try { await t.users.importLegacy(ApiContext.system('migration', '', t.engine), [{ username: 'zed', passwordHash: 'scrypt$x', tokenGeneration: 0, role: 'user' }]); } catch (err) { notBcrypt = (err as Error).message; }
    check('an import refuses a hash that is not a Go bcrypt hash', notBcrypt.includes('not a Go bcrypt hash'));
    let notSystem = '';
    try { await t.users.importLegacy(t.as('alice'), []); } catch (err) { notSystem = String((err as { status?: number }).status); }
    check('the import is a system operation — a person cannot run it', notSystem === '403');
    goDb.close();
    await t.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
}

main().catch((err) => { console.error(`auth harness failed: ${(err as Error).stack ?? (err as Error).message}`); process.exit(1); });
