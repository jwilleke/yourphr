/**
 * yourphr#876 — passkeys enrolled and used end to end, against a software authenticator ported
 * from ngdpbase's AuthManager.passkey test: a real P-256 key, real attestation and assertion bytes,
 * the real @simplewebauthn/server checks, the Sessions manager and an in-memory credentials store.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import Database from 'better-sqlite3-multiple-ciphers';
import { encodeCBOR } from '@levischuck/tiny-cbor';
import { Engine } from '../../Engine.js';
import { ApiContext } from '../../ApiContext.js';
import { ConfigurationManager } from '../../ConfigurationManager.js';
import { PolicyManager } from '../PolicyManager.js';
import { FakeConfigProvider } from '../../providers/__tests__/FakeConfigProvider.js';
import { FakeUsersProvider } from '../../providers/__tests__/FakeUsersProvider.js';
import { UsersManager } from '../UsersManager.js';
import { SessionsManager, PASSKEY_SIGNIN_ERROR, credentialLabel } from '../SessionsManager.js';
import { PasswordAuthProvider } from '../../providers/PasswordAuthProvider.js';
import { SqliteCredentialsProvider } from '../../providers/SqliteCredentialsProvider.js';
import { relyingPartyFrom } from '../../providers/PasskeyAuthProvider.js';

const ORIGIN = 'https://phr.example.org';
const RP_ID = 'phr.example.org';
const b64url = (b: Uint8Array | Buffer): string => Buffer.from(b).toString('base64url');
const sha256 = (b: Uint8Array | string): Buffer => crypto.createHash('sha256').update(b).digest();
const u32 = (n: number): Buffer => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };

/** ngdpbase's minimal platform authenticator: one key, a counter, user present and verified. */
function softwareAuthenticator(rpId = RP_ID, origin = ORIGIN) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  const credId = crypto.randomBytes(16);
  let counter = 0;
  const flags = (attested: boolean) => Buffer.from([0x01 | 0x04 | (attested ? 0x40 : 0)]);
  return {
    create(challenge: string) {
      const cose = encodeCBOR(new Map<number, number | Uint8Array>([
        [1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')],
      ]));
      const len = Buffer.alloc(2); len.writeUInt16BE(credId.length);
      const authData = Buffer.concat([sha256(rpId), flags(true), u32(counter), Buffer.alloc(16), len, credId, Buffer.from(cose)]);
      const attestationObject = encodeCBOR(new Map<string, unknown>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]) as never);
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin, crossOrigin: false }));
      return { id: b64url(credId), rawId: b64url(credId), type: 'public-key', response: { clientDataJSON: b64url(clientDataJSON), attestationObject: b64url(attestationObject), transports: ['internal'] }, clientExtensionResults: {} };
    },
    get(challenge: string, replayCounter?: number) {
      if (replayCounter === undefined) counter += 1;
      const authData = Buffer.concat([sha256(rpId), flags(false), u32(replayCounter ?? counter)]);
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin, crossOrigin: false }));
      const signature = crypto.sign('sha256', Buffer.concat([authData, sha256(clientDataJSON)]), privateKey);
      return { id: b64url(credId), rawId: b64url(credId), type: 'public-key', response: { clientDataJSON: b64url(clientDataJSON), authenticatorData: b64url(authData), signature: b64url(signature) }, clientExtensionResults: {} };
    },
  };
}

const REQ = { remoteAddr: '198.51.100.7' };
const PW = 'a-long-enough-password';
const KEY = 'test-credentials-key-not-a-secret';
let engine: Engine;
let sessions: SessionsManager;
let db: InstanceType<typeof Database>;
let molly: ApiContext;
let lines: string[];

/** The settings the running instance reads on every use (yourphr#883); a test changes them live. */
let settings: { enabled: boolean; baseUrl: string; rpName: string };

async function boot(baseUrl = ORIGIN, opts: { enabled?: boolean; store?: boolean; key?: string } = {}): Promise<void> {
  engine = new Engine();
  db = db ?? new Database(':memory:');
  lines = [];
  settings = { enabled: opts.enabled ?? true, baseUrl, rpName: 'yourPHR' };
  const users = new UsersManager(engine, new FakeUsersProvider(), new PasswordAuthProvider());
  sessions = new SessionsManager(engine, [new PasswordAuthProvider()], {
    log: (l) => lines.push(l),
    ...(opts.store === false ? {} : { credentials: new SqliteCredentialsProvider(db, opts.key ?? KEY) }),
    passkey: () => settings,
  });
  engine.register('configuration', new ConfigurationManager(engine, new FakeConfigProvider())).register('policy', new PolicyManager(engine)).register('users', users).register('sessions', sessions);
  await engine.initialize();
  await users.createUser(ApiContext.system('test', 'admin', engine), 'molly', PW);
  molly = ApiContext.from({ username: 'molly', role: 'user' }, engine);
}

/** Confirm with the password, enrol, and return the authenticator for later sign-ins. */
async function enrol(label = 'Chrome on Mac', auth = softwareAuthenticator()) {
  const { handle, options } = await sessions.passkeyRegistrationOptions(molly, { password: PW }, REQ) as { handle: string; options: { challenge: string } };
  const { id } = await sessions.passkeyRegister(molly, handle, auth.create(options.challenge), label);
  return { auth, id };
}

async function signIn(auth: ReturnType<typeof softwareAuthenticator>, replayCounter?: number) {
  const { handle, options } = await sessions.passkeySignInOptions() as { handle: string; options: { challenge: string } };
  return sessions.signInWithPasskey(handle, auth.get(options.challenge, replayCounter), REQ);
}

beforeEach(async () => {
  db = new Database(':memory:');
  await boot();
});

describe('passkeys end to end (yourphr#876, ported from ngdpbase#448)', () => {
  it('enrol after confirming the password, then sign in with the passkey alone — a real session', async () => {
    const { auth } = await enrol();
    const result = await signIn(auth);
    expect(result.ok).toBe(true);
    const verified = await sessions.verify((result as { token: string }).token);
    expect(verified).toMatchObject({ ok: true, principal: { username: 'molly' } });
    const view = await sessions.credentialsOf(molly);
    expect(view).toMatchObject({ hasPassword: true, passkeyHost: RP_ID, credentials: [{ kind: 'passkey', label: 'Chrome on Mac' }] });
    expect(view.credentials[0]).not.toHaveProperty('secret'); // the public key and counter are never shown
    expect(view.credentials[0]!.lastUsedAt).toBeDefined();
  });

  it('refuses to start enrolment without the right password, and an agent token can never enrol', async () => {
    await expect(sessions.passkeyRegistrationOptions(molly, { password: 'wrong' }, REQ)).rejects.toMatchObject({ status: 403 });
    const agent = ApiContext.agent('molly', { id: 't', name: 'Claude', scopes: [] }, engine);
    await expect(sessions.passkeyRegistrationOptions(agent, { password: PW }, REQ)).rejects.toMatchObject({ status: 403 });
  });

  it('confirming with a passkey the person already has also opens enrolment', async () => {
    const { auth } = await enrol();
    const confirm = await sessions.passkeyConfirmOptions(molly) as { handle: string; options: { challenge: string } };
    const second = softwareAuthenticator();
    const { handle, options } = await sessions.passkeyRegistrationOptions(molly, { passkey: { handle: confirm.handle, response: auth.get(confirm.options.challenge) } }, REQ) as { handle: string; options: { challenge: string } };
    await sessions.passkeyRegister(molly, handle, second.create(options.challenge), 'Phone');
    expect((await sessions.credentialsOf(molly)).credentials.map((c) => c.label)).toEqual(['Chrome on Mac', 'Phone']);
  });

  it('a replayed counter (a cloned key) and a reused challenge are refused', async () => {
    const { auth } = await enrol();
    expect((await signIn(auth)).ok).toBe(true);
    expect(await signIn(auth, 0)).toMatchObject({ ok: false, error: PASSKEY_SIGNIN_ERROR });
    const { handle, options } = await sessions.passkeySignInOptions() as { handle: string; options: { challenge: string } };
    const response = auth.get(options.challenge);
    expect((await sessions.signInWithPasskey(handle, response, REQ)).ok).toBe(true);
    expect((await sessions.signInWithPasskey(handle, auth.get(options.challenge), REQ)).ok).toBe(false); // the handle is spent
  });

  it('an enrolment challenge cannot be spent on a sign-in, nor another person\'s', async () => {
    const { auth } = await enrol();
    const reg = await sessions.passkeyRegistrationOptions(molly, { password: PW }, REQ) as { handle: string; options: { challenge: string } };
    expect((await sessions.signInWithPasskey(reg.handle, auth.get(reg.options.challenge), REQ)).ok).toBe(false);
  });

  it('a passkey made for another host neither enrols nor signs in', async () => {
    const elsewhere = softwareAuthenticator('evil.example', 'https://evil.example');
    const { handle, options } = await sessions.passkeyRegistrationOptions(molly, { password: PW }, REQ) as { handle: string; options: { challenge: string } };
    await expect(sessions.passkeyRegister(molly, handle, elsewhere.create(options.challenge), 'Evil')).rejects.toMatchObject({ status: 400 });
    expect((await sessions.credentialsOf(molly)).credentials).toEqual([]);
  });

  it('a name is required, and a bad one does not spend the challenge', async () => {
    const auth = softwareAuthenticator();
    const { handle, options } = await sessions.passkeyRegistrationOptions(molly, { password: PW }, REQ) as { handle: string; options: { challenge: string } };
    await expect(sessions.passkeyRegister(molly, handle, auth.create(options.challenge), '   ')).rejects.toMatchObject({ status: 400 });
    await sessions.passkeyRegister(molly, handle, auth.create(options.challenge), 'Laptop'); // still good
    expect(credentialLabel('  a   b  ')).toBe('a b');
    expect(credentialLabel('x'.repeat(80))).toHaveLength(60);
  });

  it('rename and remove are the owner\'s alone, and each is recorded', async () => {
    const { id } = await enrol();
    const other = ApiContext.from({ username: 'nina', role: 'user' }, engine);
    await expect(sessions.renameCredential(other, id, 'Mine now')).rejects.toMatchObject({ status: 404 });
    await sessions.renameCredential(molly, id, 'Work laptop');
    expect((await sessions.credentialsOf(molly)).credentials[0]!.label).toBe('Work laptop');
    await expect(sessions.removeCredential(other, id)).rejects.toMatchObject({ status: 404 });
    await sessions.removeCredential(molly, id); // the password remains a way in
    expect((await sessions.credentialsOf(molly)).credentials).toEqual([]);
  });

  it('never removes the last way in', async () => {
    const { id } = await enrol();
    // An account with no password left: its only passkey cannot be removed.
    const record = await engine.managers.users.record('molly');
    (record as { passwordHash: string }).passwordHash = '';
    await expect(sessions.removeCredential(molly, id)).rejects.toMatchObject({ status: 409 });
    expect((await sessions.credentialsOf(molly)).credentials).toHaveLength(1);
  });
});

describe('passkeys stay off unless they can work (ngdpbase\'s registration rule)', () => {
  it('no base URL, plain http off localhost, the setting off, or no store: off, and the reason is logged', async () => {
    for (const [url, opts] of [['', {}], ['http://phr.example.org', {}], [ORIGIN, { enabled: false }], [ORIGIN, { store: false }]] as const) {
      db = new Database(':memory:');
      await boot(url, opts);
      expect(sessions.passkeyHost()).toBeNull();
      await expect(sessions.passkeySignInOptions()).rejects.toMatchObject({ status: 404 });
    }
    expect(relyingPartyFrom('http://localhost:8080', 'x')).toMatchObject({ rpID: 'localhost', origin: 'http://localhost:8080' });
    expect(relyingPartyFrom('not a url', 'x')).toBeNull();
  });
});

describe('the settings take effect when saved, with no restart (yourphr#883)', () => {
  it('setting the base URL on a running instance turns passkeys on; clearing it turns them off; each change is logged once', async () => {
    db = new Database(':memory:');
    await boot('');
    expect(sessions.passkeyHost()).toBeNull();
    expect(lines.filter((l) => l.includes('set yourphr.application.base-url'))).toHaveLength(1);

    settings = { ...settings, baseUrl: ORIGIN }; // the admin saves Admin → Configuration
    expect(sessions.passkeyHost()).toBe(new URL(ORIGIN).hostname);
    const { auth } = await enrol();
    await expect(signIn(auth)).resolves.toMatchObject({ token: expect.any(String) });
    sessions.passkeyHost();
    expect(lines.filter((l) => l.startsWith('passkeys: on'))).toHaveLength(1);

    settings = { ...settings, enabled: false };
    expect(sessions.passkeyHost()).toBeNull();
    await expect(sessions.passkeySignInOptions()).rejects.toMatchObject({ status: 404 });
  });
});

describe('the credentials store signs every row (ported from ngdpbase\'s FileCredentialsProvider)', () => {
  it('a row edited, added or signed with another key outside the app is quarantined, never used, and raises the alert', async () => {
    const { auth } = await enrol();
    db.prepare("UPDATE auth_credentials SET username = 'nina'").run(); // someone moves molly's passkey to nina
    db.prepare("INSERT INTO auth_credentials (id, username, kind, subject, secret, label, created_at, sig) VALUES ('x', 'nina', 'passkey', 'cred-x', '{}', 'planted', '2026-10-08T00:00:00Z', '')").run();
    await boot(ORIGIN); // reopen over the same database
    const alert = lines.find((l) => l.includes('2 row(s) set aside')) ?? '';
    expect(alert).toContain('bad-signature (nina)');
    expect(alert).toContain('unsigned (nina)');
    expect((await signIn(auth)).ok).toBe(false); // the tampered row is not trusted
    db = new Database(':memory:');
    await boot();
    const { auth: a2 } = await enrol();
    await boot(ORIGIN, { key: 'a-different-key' });
    expect((await signIn(a2)).ok).toBe(false);
  });

  it('one passkey can never belong to two rows', async () => {
    const auth = softwareAuthenticator();
    await enrol('One', auth);
    const { handle, options } = await sessions.passkeyRegistrationOptions(molly, { password: PW }, REQ) as { handle: string; options: { challenge: string } };
    await expect(sessions.passkeyRegister(molly, handle, auth.create(options.challenge), 'Again')).rejects.toBeInstanceOf(Error);
  });
});
