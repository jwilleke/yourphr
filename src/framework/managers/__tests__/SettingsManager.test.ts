import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Engine } from '../../Engine.js';
import { ApiContext, ApiError } from '../../ApiContext.js';
import { ConfigurationManager } from '../../ConfigurationManager.js';
import { FilterManager } from '../FilterManager.js';
import { MAINTENANCE_ENABLED_KEY, SettingsManager, coerceToShippedType } from '../SettingsManager.js';
import { PolicyManager } from '../PolicyManager.js';
import { FakeConfigProvider } from '../../providers/__tests__/FakeConfigProvider.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

async function boot(env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'spike-settings-')); dirs.push(dir);
  const engine = new Engine();
  const log: string[] = [];
  engine.register('configuration', new ConfigurationManager(engine, new FakeConfigProvider(), { env: env })).register('policy', new PolicyManager(engine));
  const settings = new SettingsManager(engine, { log: (line) => log.push(line), dataDir: dir });
  engine.register('filters', new FilterManager(engine));
  engine.register('settings', settings);
  await engine.initialize();
  const admin = ApiContext.from({ username: 'ops', role: 'admin' }, engine);
  const member = ApiContext.from({ username: 'alice', role: 'user' }, engine);
  const nobody = ApiContext.anonymous(engine);
  return { engine, settings, log, admin, member, nobody, dir };
}

describe('SettingsManager — what the instance says about itself, with the caller passed in', () => {
  it('boots after configuration and publishes only the public keys to an anonymous caller', async () => {
    const { engine, settings, nobody } = await boot();
    expect(engine.registered).toEqual(['configuration', 'policy', 'filters', 'settings']);
    const pub = settings.publicInstance(nobody);
    // Wire format, read by the Angular app — deliberately NOT the yourphr.* config key names (yourphr#627).
    expect(Object.keys(pub).sort()).toEqual(['agent_token.enabled', 'demo.admin.enabled', 'demo.enabled', 'maintenance.enabled', 'maintenance.message', 'operator.contact_url', 'operator.name', 'password.min_length', 'signup.enabled']);
    // Off unless an operator turns it on, which is the shipped default. The Settings screen hides
    // the whole section when it is false rather than offering a mint the server refuses (#719).
    expect(pub['agent_token.enabled']).toBe(false);
    // Closed unless an operator opens it (yourphr#691) — the sign-in page reads this to decide
    // whether to offer a "create an account" link at all.
    expect(pub['signup.enabled']).toBe(false);
    expect(pub).not.toHaveProperty('operator.contact_email'); // wire name: withheld from anonymous (yourphr#459)
    // The demo FLAG is public so the sign-in page can offer the one-click entrance (yourphr#643);
    // the account's NAME is not, and the password is a secret verified server-side.
    expect(pub['demo.enabled']).toBe(false);
    expect(pub['demo.admin.enabled']).toBe(false); // and never true on an instance that is not a demo
    expect(pub).not.toHaveProperty('demo.username');
  });

  it('maintenance mode holds members and agents back, lets admin-system through, and is announced once per change (yourphr#714)', async () => {
    const { engine, settings, admin, member, log } = await boot();
    const agent = ApiContext.agent('ops', { id: 't1', name: 'Claude Desktop', scopes: ['Medications'] }, engine);
    const tour = ApiContext.from({ username: 'demoadmin', role: 'demo-admin' }, engine);
    expect(settings.maintenanceHolds(member)).toBeUndefined(); // off by default
    expect(settings.publicInstance(ApiContext.anonymous(engine))['maintenance.enabled']).toBe(false);

    settings.configSet(admin, MAINTENANCE_ENABLED_KEY, true);
    expect(settings.maintenanceHolds(member)).toMatch(/maintenance/);
    expect(settings.maintenanceHolds(admin)).toBeUndefined(); // allow-admins is on by default
    expect(settings.maintenanceHolds(agent)).toMatch(/maintenance/); // an admin's own token is not an admin
    expect(settings.maintenanceHolds(tour)).toMatch(/maintenance/); // admin-read is not admin-system
    expect(settings.publicInstance(ApiContext.anonymous(engine))['maintenance.enabled']).toBe(true);
    expect(log).toContain('ops turned maintenance mode on');

    settings.configSet(admin, MAINTENANCE_ENABLED_KEY, true); // no change, no second announcement
    expect(log.filter((l) => l.includes('turned maintenance mode'))).toHaveLength(1);

    settings.configSet(admin, 'yourphr.features.maintenance.allow-admins', false);
    expect(settings.maintenanceHolds(admin)).toMatch(/maintenance/);

    settings.configSet(admin, MAINTENANCE_ENABLED_KEY, false);
    expect(settings.maintenanceHolds(member)).toBeUndefined();
    expect(log).toContain('ops turned maintenance mode off');
  });

  it('the signed-in view adds the operator contact; anonymous is refused', async () => {
    const { settings, member, nobody, admin } = await boot();
    settings.setInstanceSettings(admin, { name: 'Ops', contact_email: 'ops@example.org', contact_url: 'https://example.org/help' });
    const mine = settings.instanceForUser(member);
    expect(mine['operator.contact_email']).toBe('ops@example.org'); // wire name, not the config key
    expect(mine['demo.admin.session']).toBe(false);
    expect(() => settings.instanceForUser(nobody)).toThrow(ApiError);
  });

  it('the admin card is the admin\'s alone — a member gets 403 from the manager, not only the route', async () => {
    const { settings, member } = await boot();
    for (const call of [
      () => settings.configSnapshot(member),
      () => settings.configReveal(member, 'yourphr.operator.name'),
      () => settings.configSet(member, 'yourphr.operator.name', 'x'),
      () => settings.configReset(member, 'yourphr.operator.name'),
      () => settings.instanceSettings(member),
      () => settings.setInstanceSettings(member, { name: '', contact_email: '', contact_url: '' }),
    ]) {
      let status = 0;
      try { call(); } catch (err) { status = (err as ApiError).status; }
      expect(status).toBe(403);
    }
  });

  it('the snapshot needs admin-system to VIEW: a read-only admin (the demo tour) gets 403 (yourphr#751)', async () => {
    const { settings, engine, admin } = await boot();
    const tour = ApiContext.from({ username: 'demoadmin', role: 'demo-admin' }, engine);
    expect(tour.can('admin-read')).toBe(true); // the tour can see the operator screens…
    let status = 0;
    try { settings.configSnapshot(tour); } catch (err) { status = (err as ApiError).status; }
    expect(status).toBe(403); // …but not how the instance defends itself
    expect(settings.configSnapshot(admin).entries.length).toBeGreaterThan(0);
  });

  it('snapshot: Go\'s row shape — secrets masked, env-pinned marked, public keys named', async () => {
    const { settings, admin } = await boot({ YOURPHR_BACKUP_ENCRYPTION_KEY: 'from-env' });
    const snap = settings.configSnapshot(admin);
    const byKey = Object.fromEntries(snap.entries.map((e) => [e.key, e]));
    expect(byKey['yourphr.backup.encryption.key']).toMatchObject({ masked: true, value: '••••', from_env: true, env_var: 'YOURPHR_BACKUP_ENCRYPTION_KEY' });
    expect(byKey['yourphr.operator.name']).toMatchObject({ public: true, source: 'default', from_env: false });
    expect(byKey['yourphr.operator.contact-email']?.public).toBe(false);
    // Where the overrides live comes from the PROVIDER, not from the manager guessing a filename
    // (yourphr#621) — with the in-memory provider there is no file, and the screen says so.
    expect(snap.custom_config_path).toBe('<in-memory>');
  });

  it('reveal is logged by the actor, never a bare "admin"', async () => {
    const { settings, admin, log } = await boot({ YOURPHR_BACKUP_ENCRYPTION_KEY: 'from-env' });
    expect(settings.configReveal(admin, 'yourphr.backup.encryption.key')).toEqual({ key: 'yourphr.backup.encryption.key', value: 'from-env', default: '' });
    expect(settings.configReveal(admin, 'nope.key')).toBeUndefined();
    expect(log).toEqual(['ops revealed configuration value for yourphr.backup.encryption.key']);
  });

  it('set: unknown key 400, env-pinned 409, wrong shape 400, otherwise coerced to the shipped type and logged', async () => {
    const { settings, admin, engine, log } = await boot({ YOURPHR_SYNC_MAX_PAGES: '9', YOURPHR_BACKUP_ENCRYPTION_KEY: 'from-deployment' });
    const status = (fn: () => void): number => { try { fn(); return 200; } catch (err) { return (err as ApiError).status; } };
    expect(status(() => settings.configSet(admin, 'nope.key', 1))).toBe(400);
    expect(status(() => settings.configSet(admin, 'yourphr.sync.max-pages', 5))).toBe(409);
    expect(status(() => settings.configSet(admin, 'yourphr.backup.max-backups', 'many'))).toBe(400);
    // A secret is masked, not unwritable (yourphr#629, Go's rule). Here it is env-set, and an
    // env-pinned key is refused 409 — which is what actually protects it in a real deployment.
    expect(status(() => settings.configSet(admin, 'yourphr.backup.encryption.key', 'x'))).toBe(409);
    settings.configSet(admin, 'yourphr.backup.max-backups', '3');
    expect(engine.managers.configuration.getInt('yourphr.backup.max-backups')).toBe(3);
    settings.configSet(admin, 'yourphr.backup.schedule.enabled', 'true');
    expect(engine.managers.configuration.getBool('yourphr.backup.schedule.enabled')).toBe(true);
    expect(log).toEqual(['ops set configuration yourphr.backup.max-backups', 'ops set configuration yourphr.backup.schedule.enabled']);
  });

  it('reset: clears an override (true), says when there was none (false), refuses an unknown key', async () => {
    const { settings, admin, engine } = await boot();
    settings.configSet(admin, 'yourphr.backup.max-backups', 3);
    expect(settings.configReset(admin, 'yourphr.backup.max-backups')).toBe(true);
    expect(engine.managers.configuration.getInt('yourphr.backup.max-backups')).toBe(7);
    expect(settings.configReset(admin, 'yourphr.backup.max-backups')).toBe(false);
    expect(() => settings.configReset(admin, 'nope.key')).toThrow(ApiError);
  });

  it('instance settings: trimmed and stored; a malformed address or URL is refused before anything is written', async () => {
    const { settings, admin } = await boot();
    expect(() => settings.setInstanceSettings(admin, { name: 'Ops', contact_email: 'not-an-email', contact_url: '' })).toThrow('contact_email is not an email address');
    expect(() => settings.setInstanceSettings(admin, { name: 'Ops', contact_email: '', contact_url: 'ftp://x' })).toThrow('contact_url must start with http:// or https://');
    expect(settings.instanceSettings(admin)).toEqual({ name: '', contact_email: '', contact_url: '' });
    const saved = settings.setInstanceSettings(admin, { name: ' Ops Team ', contact_email: 'ops@example.org', contact_url: 'https://example.org/help' });
    expect(saved.name).toBe('Ops Team');
    expect(settings.instanceSettings(admin)).toEqual(saved);
  });

  it('the legal text is public, shipped unless the operator overrides it, and an unusable override is an error rather than a silent fallback (yourphr#619)', async () => {
    const { settings, nobody, dir } = await boot();
    const shipped = await settings.legalDocument(nobody, 'privacy');
    expect(shipped).toMatchObject({ kind: 'privacy', source: 'shipped' });
    expect(shipped?.html).toContain('<');
    expect(await settings.legalDocument(nobody, 'PRIVACY')).toMatchObject({ kind: 'privacy' }); // Go accepts either case
    expect(await settings.legalDocument(nobody, 'nonsense')).toBeUndefined();
    mkdirSync(join(dir, 'config'), { recursive: true });
    writeFileSync(join(dir, 'config', 'terms-of-service.md'), '# Our terms\n');
    const overridden = await settings.legalDocument(nobody, 'terms');
    expect(overridden).toMatchObject({ kind: 'terms', source: 'operator' });
    expect(overridden?.markdown).toBe('# Our terms\n');
    // yourphr#775: `marked` passed an override's raw HTML straight to the page; one pipeline now shows it as text.
    writeFileSync(join(dir, 'config', 'terms-of-service.md'), '# Terms\n\n<img src=x onerror=alert(1)>\n\n| a | b |\n|---|---|\n| 1 | 2 |\n');
    const hostile = await settings.legalDocument(nobody, 'terms');
    expect(hostile?.html).not.toContain('<img');
    expect(hostile?.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(hostile?.html).toContain('<table>');
    writeFileSync(join(dir, 'config', 'terms-of-service.md'), '   \n');
    await expect(settings.legalDocument(nobody, 'terms')).rejects.toThrow(/empty/);
  });

  it('backup() carries nothing of its own — the configuration manager\'s overlay is what travels', async () => {
    const { settings } = await boot();
    const data = await settings.backup();
    expect(data.manager).toBe('settings');
    expect(data.payload).toBeUndefined();
  });
});

describe('coerceToShippedType — the stored value keeps the shipped default\'s type', () => {
  it('booleans, numbers, lists and text', () => {
    expect(coerceToShippedType('true', false)).toBe(true);
    expect(() => coerceToShippedType('yes', false)).toThrow('expected true or false');
    expect(coerceToShippedType('42', 0)).toBe(42);
    expect(() => coerceToShippedType('', 0)).toThrow('expected a number');
    expect(() => coerceToShippedType(true, 0)).toThrow('expected a number');
    expect(coerceToShippedType('a, b,,c', [])).toEqual(['a', 'b', 'c']);
    expect(coerceToShippedType([1, 2], [])).toEqual(['1', '2']);
    expect(() => coerceToShippedType(1, [])).toThrow('expected a list');
    expect(coerceToShippedType(7, '')).toBe('7');
    expect(() => coerceToShippedType({}, '')).toThrow('expected text');
  });
});
