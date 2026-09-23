import { beforeEach, describe, expect, it } from 'vitest';
import type { SourceCapability } from '../../../sources/capability.js';
import { Engine } from '../../../framework/Engine.js';
import { ApiContext } from '../../../framework/ApiContext.js';
import { ConfigurationManager } from '../../../framework/ConfigurationManager.js';
import { PolicyManager } from '../../../framework/managers/PolicyManager.js';
import { FakeConfigProvider } from '../../../framework/providers/__tests__/FakeConfigProvider.js';
import { UsersManager } from '../../../framework/managers/UsersManager.js';
import { PasswordAuthProvider } from '../../../framework/providers/PasswordAuthProvider.js';
import { FakeUsersProvider } from '../../../framework/providers/__tests__/FakeUsersProvider.js';
import { JobsManager } from '../../../framework/managers/JobsManager.js';
import { FakeJobsProvider } from '../../../framework/providers/__tests__/FakeJobsProvider.js';
import { RecordsManager } from '../RecordsManager.js';
import { FakeRecordsProvider } from '../../providers/__tests__/FakeRecordsProvider.js';
import { SourcesManager } from '../SourcesManager.js';
import { FakeSourcesProvider } from '../../providers/__tests__/FakeSourcesProvider.js';
import { CatalogManager, type CatalogWrite } from '../CatalogManager.js';
import { FakeCatalogProvider } from '../../providers/__tests__/FakeCatalogProvider.js';
import { BaseSourceClientProvider, NullSourceClientProvider, SourceClientError, type AuthorizationResult, type AuthorizationStart, type FetchReport, type RefreshedTokens, type SmartApp } from '../../providers/BaseSourceClientProvider.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A scripted SMART client: records what it was asked, answers what the spec set. */
class ScriptedClient extends BaseSourceClientProvider {
  readonly name = 'scripted';
  apps: SmartApp[] = [];
  redirects: string[] = [];
  exchanges: { code: string; verifier: string }[] = [];
  failDiscovery = false;
  failExchange = false;
  patient = 'p-123';
  async beginAuthorization(app: SmartApp, redirectUri: string): Promise<AuthorizationStart> {
    this.apps.push(app);
    this.redirects.push(redirectUri);
    if (this.failDiscovery) throw new SourceClientError('discovery', 'SMART discovery failed: no .well-known');
    return { authorizeUrl: `${app.authorizeUrlOverride || 'https://idp.example.org/authorize'}?client_id=${app.clientId}`, state: 'st', codeVerifier: 'ver' };
  }
  async completeAuthorization(app: SmartApp, redirectUri: string, code: string, codeVerifier: string): Promise<AuthorizationResult> {
    this.apps.push(app);
    this.redirects.push(redirectUri);
    this.exchanges.push({ code, verifier: codeVerifier });
    if (this.failDiscovery) throw new SourceClientError('discovery', 'SMART discovery failed: no .well-known');
    if (this.failExchange) throw new SourceClientError('exchange', 'token exchange failed: HTTP 400');
    return { tokenUrl: 'https://idp.example.org/token', accessToken: 'at', refreshToken: 'rt', expiresAt: 2_000, patient: this.patient, scope: this.grantedScope };
  }
  async refresh(): Promise<RefreshedTokens> { throw new Error('not in this spec'); }
  capability?: SourceCapability;
  /** What the token response states as GRANTED (yourphr#757); '' is a server that omits the field. */
  grantedScope = '';
  async readCapability(): Promise<{ capability?: SourceCapability; reason: string }> { return this.capability ? { capability: this.capability, reason: '' } : { reason: 'no statement in this spec' }; }
  async fetchEverything(): Promise<FetchReport> { return { received: 0, created: 0, updated: 0 }; }
  async fetchPages(): Promise<FetchReport> { return { received: 0, created: 0, updated: 0 }; }
}

const PROD: CatalogWrite = { display: 'Big Hospital', environment: 'production', fhirBaseUrl: 'https://fhir.example.org/r4', scopes: 'patient/Condition.read patient/Observation.read', clientId: 'cid', clientSecret: 'the-secret', enabled: true };
const SANDBOX: CatalogWrite = { display: 'Sandbox', environment: 'sandbox', fhirBaseUrl: 'https://sandbox.example.org/r4', scopes: 'patient/*.read', clientId: 'sb', enabled: true };

let dir: string;
let engine: Engine;
let provider: FakeCatalogProvider;
let client: ScriptedClient;
let users: UsersManager;
let catalog: CatalogManager;
let sourcesProvider: FakeSourcesProvider;
let lines: string[];
let admin: ApiContext;
let alice: ApiContext;
let seed: ApiContext;

async function boot(sourceClient: BaseSourceClientProvider): Promise<void> {
  engine = new Engine();
  provider = new FakeCatalogProvider();
  sourcesProvider = new FakeSourcesProvider();
  lines = [];
  users = new UsersManager(engine, new FakeUsersProvider(), new PasswordAuthProvider());
  engine.register('configuration', new ConfigurationManager(engine, new FakeConfigProvider())).register('policy', new PolicyManager(engine))
    .register('users', users)
    .register('records', new RecordsManager(engine, new FakeRecordsProvider()))
    .register('jobs', new JobsManager(engine, new FakeJobsProvider()))
    .register('sources', new SourcesManager(engine, sourcesProvider, sourceClient, { maxPages: 1 }));
  catalog = new CatalogManager(engine, provider, sourceClient, { log: (l) => lines.push(l) });
  engine.register('catalog', catalog);
  await engine.initialize();
  admin = ApiContext.from({ username: 'root', role: 'admin' }, engine);
  alice = ApiContext.from({ username: 'alice', role: 'user' }, engine);
  seed = ApiContext.system('seed', 'seed', engine);
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'spike-catalog-spec-'));
  client = new ScriptedClient();
  await boot(client);
});

describe('CatalogManager — the admin curates', () => {
  it('boots after users and sources and initialises its provider', () => {
    expect(engine.registered.slice(-2)).toEqual(['sources', 'catalog']);
    expect(provider.initialized).toBe(true);
  });

  it('management is the admin\'s (or a named system principal\'s); a member is refused with Go\'s message', async () => {
    await expect(catalog.list(alice)).rejects.toMatchObject({ status: 403, message: 'admin role required to manage the provider catalog' });
    await expect(catalog.create(alice, {})).rejects.toMatchObject({ status: 403 });
    await expect(catalog.sandbox(alice)).rejects.toMatchObject({ status: 403, message: 'admin role required' });
    expect((await catalog.createEntry(seed, SANDBOX)).id).toBe(1);
    expect(await catalog.entries(seed)).toHaveLength(1);
  });

  it('creates from Go\'s body, requires the three fields, and never serialises the secret', async () => {
    await expect(catalog.create(admin, { display: 'X' })).rejects.toMatchObject({ status: 400, message: 'display, api_endpoint_base_url, and client_id are required' });
    const created = await catalog.create(admin, { display: ' Big Hospital ', environment: 'production', api_endpoint_base_url: 'https://fhir.example.org/r4', scopes: 's', client_id: 'cid', client_secret: 'the-secret', enabled: true, consent_policy: 'SKIP', pre_connect_profile: 'Medicare' });
    expect(created).toMatchObject({ id: '1', display: 'Big Hospital', platform_type: 'ehr', has_client_secret: true, consent_policy: 'skip', pre_connect_profile: 'medicare' });
    expect(JSON.stringify(created)).not.toContain('the-secret');
    expect(await catalog.clientSecretFor(admin, 1)).toBe('the-secret');
    expect(await catalog.get(admin, '1')).toMatchObject({ display: 'Big Hospital' });
    expect(await catalog.get(admin, 'nope')).toBeUndefined();
  });

  it('an update omitting the secret PRESERVES the stored one, and keeps what the body does not say', async () => {
    await catalog.createEntry(admin, PROD);
    const updated = await catalog.update(admin, '1', { scopes: 'patient/*.read', enabled: false });
    expect(updated).toMatchObject({ scopes: 'patient/*.read', enabled: false, display: 'Big Hospital', has_client_secret: true, client_id: 'cid' });
    expect(await catalog.clientSecretFor(admin, 1)).toBe('the-secret');
    await catalog.update(admin, '1', { client_secret: 'rotated' });
    expect(await catalog.clientSecretFor(admin, 1)).toBe('rotated');
    expect(await catalog.update(admin, '9', {})).toBeUndefined();
  });

  it('refuses what would be refused at dial time: SSRF targets, and http for a production provider', async () => {
    await expect(catalog.createEntry(admin, { ...SANDBOX, fhirBaseUrl: 'http://169.254.169.254/fhir' })).rejects.toMatchObject({ status: 400, message: expect.stringContaining('fhirBaseUrl rejected') });
    await expect(catalog.createEntry(admin, { ...PROD, fhirBaseUrl: 'http://fhir.example.org/r4' })).rejects.toMatchObject({ status: 400, message: 'fhirBaseUrl must be https for a production provider' });
    await expect(catalog.createEntry(admin, { ...PROD, authorizeUrlOverride: 'http://fhir.example.org/authorize' })).rejects.toMatchObject({ status: 400, message: 'authorizeUrlOverride must be https for a production provider' });
    expect(await catalog.entries(admin)).toEqual([]);
  });

  it('removes by public id; sandboxes list for the admin only, connectable for members is enabled PRODUCTION only', async () => {
    await catalog.createEntry(admin, PROD);
    await catalog.createEntry(admin, SANDBOX);
    await catalog.createEntry(admin, { ...PROD, display: 'Off', enabled: false });
    expect((await catalog.sandbox(admin)).map((e) => e['display'])).toEqual(['Sandbox']);
    expect((await catalog.connectable(alice)).map((e) => e['display'])).toEqual(['Big Hospital']);
    expect((await catalog.connectable(alice))[0]).toMatchObject({ id: '1', requires_user_consent: true, pre_connect_profile: 'generic', medicare_class: false });
    expect(await catalog.remove(admin, '2')).toBe(true);
    expect(await catalog.remove(admin, '2')).toBe(false);
    expect((await catalog.list(admin)).map((e) => e['display'])).toEqual(['Big Hospital', 'Off']);
  });

  it('seeds provision-then-preserve: creates missing, fills empty credentials, never clobbers an edit, skips a bad seed with a log line', async () => {
    await catalog.seed([SANDBOX, { ...PROD, clientId: '', clientSecret: '' }, { ...SANDBOX, display: 'Evil', fhirBaseUrl: 'http://10.0.0.1/fhir' }]);
    expect((await catalog.entries(admin)).map((e) => [e.display, e.clientId])).toEqual([['Big Hospital', ''], ['Sandbox', 'sb']]);
    expect(lines.some((l) => l.startsWith('catalog seed "Evil" skipped'))).toBe(true);
    const idOf = async (display: string): Promise<number> => (await catalog.entries(admin)).find((e) => e.display === display)!.id;
    await catalog.updateEntry(admin, await idOf('Sandbox'), { ...SANDBOX, scopes: 'edited-by-admin' });
    await catalog.seed([{ ...SANDBOX, scopes: 'from-seed', clientId: 'new' }, { ...PROD, clientId: 'filled', clientSecret: 'filled-secret' }]);
    const after = await catalog.entries(admin);
    expect(after.find((e) => e.display === 'Sandbox')).toMatchObject({ scopes: 'edited-by-admin', clientId: 'sb' });
    expect(after.find((e) => e.display === 'Big Hospital')).toMatchObject({ clientId: 'filled', hasClientSecret: true, enabled: true });
    expect(await catalog.clientSecretFor(admin, await idOf('Big Hospital'))).toBe('filled-secret');
  });

  it('legacy import is the migration principal\'s alone, one-way, reporting rejections by reason', async () => {
    await catalog.createEntry(admin, PROD);
    const legacy: CatalogWrite[] = [PROD, SANDBOX, { ...SANDBOX, display: 'Weird', environment: 'staging' as 'sandbox' }, { ...SANDBOX, display: 'Loopback', fhirBaseUrl: 'http://127.0.0.1:9999/fhir' }];
    await expect(catalog.importLegacy(admin, legacy)).rejects.toMatchObject({ status: 403 });
    const migration = ApiContext.system('migration', 'migration', engine);
    const report = await catalog.importLegacy(migration, legacy);
    expect(report.imported).toEqual(['Sandbox']);
    expect(report.skippedExisting).toEqual(['Big Hospital']);
    expect(report.rejected.map((r) => r.display)).toEqual(['Weird', 'Loopback']);
    const allowed = await catalog.importLegacy(migration, [{ ...SANDBOX, display: 'Loopback', fhirBaseUrl: 'http://127.0.0.1:9999/fhir' }], { allowInternal: true });
    expect(allowed.imported).toEqual(['Loopback']);
  });
});

describe('CatalogManager — a member connects', () => {
  it('with a relay: authorize derives redirect_uri from it, connect polls the code home (yourphr#700)', async () => {
    const fetched: string[] = [];
    const relay = {
      callbackUrl: () => 'https://relay.example.org/callback',
      ready: () => true,
      fetchCode: async (state: string) => { fetched.push(state); return 'code-from-relay'; },
      resolved: () => ({}),
    } as unknown as import('../../providers/RelayProvider.js').RelayProvider;
    catalog = new CatalogManager(engine, provider, client, { log: (l) => lines.push(l), relay });
    await provider.initialize();
    await users.setConsent(alice, '2026-01-01T00:00:00Z');

    const started = await catalog.authorize(alice, '1', {});
    expect(started).toMatchObject({ redirect_uri: 'https://relay.example.org/callback', relay_poll_seconds: 55, login_wait_seconds: 240 });
    expect(client.redirects[0]).toBe('https://relay.example.org/callback');

    const r = await catalog.connect(alice, '1', { code_verifier: 'v', state: 'st-9' });
    expect(fetched).toEqual(['st-9']);
    expect(client.exchanges[0]).toEqual({ code: 'code-from-relay', verifier: 'v' });
    expect(client.redirects[1]).toBe('https://relay.example.org/callback'); // derived for the exchange too
    expect(r.source).toMatchObject({ user_id: 'alice' });
  });

  it('with a relay: a poll timeout surfaces retryably, and no source is created', async () => {
    const relay = {
      callbackUrl: () => 'https://relay.example.org/callback',
      ready: () => true,
      fetchCode: async () => { const { ApiError } = await import('../../../framework/ApiContext.js'); throw new ApiError(504, 'timed out waiting for the authorization code', { error_code: 'relay_poll_timeout' }); },
      resolved: () => ({}),
    } as unknown as import('../../providers/RelayProvider.js').RelayProvider;
    catalog = new CatalogManager(engine, provider, client, { log: (l) => lines.push(l), relay });
    await provider.initialize();
    await users.setConsent(alice, '2026-01-01T00:00:00Z');
    await expect(catalog.connect(alice, '1', { code_verifier: 'v', state: 'st' }))
      .rejects.toMatchObject({ status: 504, extra: { error_code: 'relay_poll_timeout' } });
    expect(await sourcesProvider.list()).toHaveLength(0);
  });

  beforeEach(async () => {
    await catalog.createEntry(admin, { ...PROD, authorizeUrlOverride: 'https://override.example.org/authorize' });
    await catalog.createEntry(admin, { ...PROD, display: 'Off', enabled: false });
  });

  it('authorize needs an enabled entry and a redirect_uri (no relay here), then answers Go\'s shape from the client', async () => {
    await expect(catalog.authorize(alice, '2', { redirect_uri: 'https://app/cb' })).rejects.toMatchObject({ status: 404, message: 'no such enabled catalog entry' });
    await expect(catalog.authorize(alice, '1', {})).rejects.toMatchObject({ status: 501 });
    const started = await catalog.authorize(alice, '1', { redirect_uri: ' https://app/cb ' });
    expect(started).toEqual({ authorize_url: 'https://override.example.org/authorize?client_id=cid', state: 'st', code_verifier: 'ver', redirect_uri: 'https://app/cb', relay_poll_seconds: 55, login_wait_seconds: 240 });
    expect(client.apps[0]).toMatchObject({ clientId: 'cid', clientSecret: 'the-secret', scopes: ['patient/Condition.read', 'patient/Observation.read'] });
    client.failDiscovery = true;
    await expect(catalog.authorize(alice, '1', { redirect_uri: 'https://app/cb' })).rejects.toMatchObject({ status: 502, message: 'SMART discovery failed: no .well-known' });
  });

  it('connect gates on the legal consent when the policy requires it, with Go\'s error code', async () => {
    await expect(catalog.connect(alice, '1', { code_verifier: 'v', code: 'c', redirect_uri: 'https://app/cb' }))
      .rejects.toMatchObject({ status: 403, extra: { error_code: 'legal_consent_required' } });
    await users.setConsent(alice, '2026-01-01T00:00:00Z');
    const r = await catalog.connect(alice, '1', { code_verifier: 'v', code: 'c', redirect_uri: 'https://app/cb' });
    expect(r.data).toEqual({ status: 'import_started' });
    expect(r.source).toMatchObject({ id: 'source-1', display: 'Big Hospital', user_id: 'alice', platform_type: 'ehr', environment: 'production', patient: 'p-123' });
    expect(sourcesProvider.rows.get(1)).toMatchObject({ accessToken: 'at', refreshToken: 'rt', expiresAt: 2_000, tokenUrl: 'https://idp.example.org/token', resourceTypes: ['Condition', 'Observation'] });
    expect(client.exchanges).toEqual([{ code: 'c', verifier: 'v' }]);
  });

  // yourphr#757: SMART requires the token response to state what was GRANTED, which can be
  // narrower than the request — Epic grants by app registration and ignores what was asked for.
  it('takes the source\'s types from the scopes the server GRANTED, not the ones requested', async () => {
    await catalog.updateEntry(admin, 1, { ...PROD, consentPolicy: 'skip' });
    client.grantedScope = 'launch/patient patient/Condition.read openid';
    await catalog.connect(alice, '1', { code_verifier: 'v', code: 'c', redirect_uri: 'https://app/cb' });
    expect(sourcesProvider.rows.get(1)).toMatchObject({ resourceTypes: ['Condition'], grantedScopes: 'launch/patient patient/Condition.read openid' });
    expect(lines.some((l) => l.includes('requested but not granted: Observation'))).toBe(true);
  });

  it('falls back to the requested types when the server states no scope, and says so — non-conformant, but not a reason to fail', async () => {
    await catalog.updateEntry(admin, 1, { ...PROD, consentPolicy: 'skip' });
    client.grantedScope = '';
    await catalog.connect(alice, '1', { code_verifier: 'v', code: 'c', redirect_uri: 'https://app/cb' });
    expect(sourcesProvider.rows.get(1)).toMatchObject({ resourceTypes: ['Condition', 'Observation'], grantedScopes: '' });
    expect(lines.some((l) => l.includes('stated no scope'))).toBe(true);
  });

  it('a skip-consent entry connects without the consent; the member\'s own display name wins when given', async () => {
    await catalog.updateEntry(admin, 1, { ...PROD, consentPolicy: 'skip' });
    const r = await catalog.connect(alice, '1', { code_verifier: 'v', code: 'c', redirect_uri: 'https://app/cb', display: 'My hospital' });
    expect(r.source).toMatchObject({ display: 'My hospital' });
  });

  it('validates the callback body in Go\'s order, and turns a client failure into a 502 the page can show', async () => {
    await users.setConsent(alice, '2026-01-01T00:00:00Z');
    await expect(catalog.connect(alice, '1', {})).rejects.toMatchObject({ status: 400, message: 'code_verifier is required' });
    await expect(catalog.connect(alice, '1', { code_verifier: 'v' })).rejects.toMatchObject({ status: 400, message: 'one of code or state is required' });
    await expect(catalog.connect(alice, '1', { code_verifier: 'v', state: 's' })).rejects.toMatchObject({ status: 501 });
    await expect(catalog.connect(alice, '1', { code_verifier: 'v', code: 'c' })).rejects.toMatchObject({ status: 400, message: 'redirect_uri is required (the one the authorization used)' });
    client.failExchange = true;
    await expect(catalog.connect(alice, '1', { code_verifier: 'v', code: 'bad', redirect_uri: 'https://app/cb' })).rejects.toMatchObject({ status: 502, message: 'token exchange failed: HTTP 400' });
    client.failExchange = false;
    client.patient = '';
    await expect(catalog.connect(alice, '1', { code_verifier: 'v', code: 'c', redirect_uri: 'https://app/cb' })).rejects.toMatchObject({ status: 502, message: expect.stringContaining('no patient id') });
    expect(sourcesProvider.rows.size).toBe(0);
  });

  it('with the Null client, authorize and connect are refused with the reason — one switch for the whole capability', async () => {
    await boot(new NullSourceClientProvider());
    await catalog.createEntry(admin, { ...PROD, consentPolicy: 'skip' });
    await expect(catalog.authorize(alice, '1', { redirect_uri: 'https://app/cb' })).rejects.toMatchObject({ status: 501, message: expect.stringContaining('sources.client.provider = null') });
    await expect(catalog.connect(alice, '1', { code_verifier: 'v', code: 'c', redirect_uri: 'https://app/cb' })).rejects.toMatchObject({ status: 501, message: expect.stringContaining('cannot be connected') });
  });

  it('backup and restore say what they are: the app database carries the rows', async () => {
    expect(await catalog.backup()).toMatchObject({ manager: 'catalog' });
    await expect(catalog.restore()).resolves.toBeUndefined();
    rmSync(dir, { recursive: true, force: true });
  });
});
