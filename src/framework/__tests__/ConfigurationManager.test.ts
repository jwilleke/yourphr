import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../Engine.js';
import { ConfigurationManager, deepMerge } from '../ConfigurationManager.js';
import { FakeConfigProvider } from '../providers/__tests__/FakeConfigProvider.js';
import { FileConfigProvider } from '../providers/FileConfigProvider.js';
import type { ConfigValue } from '../../config/index.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const tmp = (): string => { const d = mkdtempSync(join(tmpdir(), 'spike-cfg-')); dirs.push(d); return d; };

function boot(env: Record<string, string> = {}, custom: Record<string, ConfigValue> = {}) {
  const engine = new Engine();
  const provider = new FakeConfigProvider(custom);
  const cfg = new ConfigurationManager(engine, provider, { env });
  engine.register('configuration', cfg);
  return { engine, cfg, provider };
}

describe('ConfigurationManager — the door; the provider only stores (yourphr#621)', () => {
  it('merges the two layers and answers with the typed getters', async () => {
    const { engine, cfg } = boot();
    await engine.initialize();
    expect(cfg.getInt('yourphr.sync.max-pages')).toBe(500);
    expect(cfg.getBool('yourphr.backup.schedule.enabled')).toBe(false);
    expect(cfg.getStringList('yourphr.auth.trusted-proxies')).toEqual([]);
    cfg.set('yourphr.sync.max-pages', 42);
    expect(cfg.getInt('yourphr.sync.max-pages')).toBe(42);
  });

  it('writes ONLY the deltas — never the merged view (the ngdpbase #895 lesson)', async () => {
    const { engine, cfg, provider } = boot();
    await engine.initialize();
    cfg.set('yourphr.operator.name', 'Ops');
    // The whole point: one changed key on disk, not a frozen copy of the 29 shipped ones.
    expect(provider.written()).toEqual({ 'yourphr.operator.name': 'Ops' });
    expect(cfg.customValues()).toEqual({ 'yourphr.operator.name': 'Ops' });
    expect(cfg.getInt('yourphr.sync.max-pages')).toBe(500); // still following the product
  });

  it('a later release changing a shipped default reaches an instance that never overrode it', () => {
    const provider = new FakeConfigProvider({ 'yourphr.operator.name': 'Ops' }, { ...shipped(), 'yourphr.auth.throttle.max-failures': 8 });
    const cfg = new ConfigurationManager(new Engine(), provider, { env: {} });
    expect(cfg.getInt('yourphr.auth.throttle.max-failures')).toBe(8); // the new default applies
    expect(cfg.getString('yourphr.operator.name')).toBe('Ops');       // the override still wins
  });

  it('precedence is environment > instance override > shipped default', () => {
    const { cfg } = boot({ YOURPHR_AUTH_PASSWORD_MIN_LENGTH: '20' }, { 'yourphr.auth.password.min-length': 16 });
    expect(cfg.getInt('yourphr.auth.password.min-length')).toBe(20);
    expect(cfg.isSetByEnvironment('yourphr.auth.password.min-length')).toBe(true);
    expect(cfg.shippedValue('yourphr.auth.password.min-length')).toBe(12); // what the product says, regardless
  });

  it('refuses the writes that would store a value that never applies', () => {
    const { cfg } = boot({ YOURPHR_SYNC_MAX_PAGES: '9' });
    expect(() => cfg.set('nope.key', 1)).toThrow(/unknown configuration key/);
    expect(() => cfg.set('yourphr.sync.max-pages', 5)).toThrow(/set in the environment/); // env wins at read time
    // Declared env ownership, not "is the variable set" (yourphr#635): read-only either way.
    expect(() => cfg.set('yourphr.database.encryption.key', 'x')).toThrow(/owned by the environment variable YOURPHR_DATABASE_ENCRYPTION_KEY/);
  });

  it('clear() drops an override; resetToDefaults() drops them all', async () => {
    const { engine, cfg, provider } = boot();
    await engine.initialize();
    cfg.set('yourphr.operator.name', 'Ops');
    cfg.set('yourphr.backup.max-backups', 3);
    expect(cfg.clear('yourphr.operator.name')).toBe(true);
    expect(cfg.clear('yourphr.operator.name')).toBe(false);
    expect(cfg.getString('yourphr.operator.name')).toBe('');
    cfg.resetToDefaults();
    expect(provider.written()).toEqual({});
    expect(cfg.getInt('yourphr.backup.max-backups')).toBe(7);
  });

  it('unknown override keys are reported, never silently carried or dropped (yourphr#473)', () => {
    const { cfg } = boot({}, { 'yourphr.operator.name': 'Ops', 'typo.key': 'x' });
    expect(cfg.unknownKeys()).toEqual(['typo.key']);
  });

  it('a typo\'d key is reported WITH the key it was probably meant to be (yourphr#625)', () => {
    // The difference between an operator finding it in seconds and filing a bug saying the
    // setting does not work.
    const { cfg } = boot({}, { 'yourphr.operator.nme': 'Ops' });
    expect(cfg.unknownKeyReport()).toEqual(['yourphr.operator.nme (did you mean yourphr.operator.name?)']);
  });

  it('TOOTH: a genuinely unknown key gets NO neighbour rather than a misleading one', () => {
    // The threshold is the whole point of the feature. Suggesting the nearest key for something
    // that is not a typo sends an operator to change a setting that was never the one they wanted.
    const { cfg } = boot({}, { 'totally.made.up.setting': 'x' });
    expect(cfg.unknownKeyReport()).toEqual(['totally.made.up.setting']);
  });

  it('a key that differs by a whole word is too far to guess', () => {
    const { cfg } = boot({}, { 'yourphr.operator.telephone': 'x' });
    expect(cfg.unknownKeyReport()).toEqual(['yourphr.operator.telephone']);
  });

  it('the report is empty when every override is known — no noise at boot', () => {
    const { cfg } = boot({}, { 'yourphr.operator.name': 'Ops' });
    expect(cfg.unknownKeyReport()).toEqual([]);
  });

  it('an unreadable custom file reports as unreadable rather than being guessed at', () => {
    const provider = new FakeConfigProvider({}, undefined, '/data/config/app-custom-config.json: bad JSON');
    const cfg = new ConfigurationManager(new Engine(), provider, { env: {} });
    expect(cfg.unknownKeyReport()[0]).toContain('unreadable');
    expect(cfg.unknownKeyReport()[0]).not.toContain('did you mean');
  });

  it('unreadable overrides are reported and never overwritten', () => {
    const provider = new FakeConfigProvider({}, undefined, '/data/config/app-custom-config.json: bad JSON');
    const cfg = new ConfigurationManager(new Engine(), provider, { env: {} });
    expect(cfg.unknownKeys()[0]).toContain('unreadable');
    expect(() => cfg.set('yourphr.operator.name', 'Ops')).toThrow(/refusing to overwrite/);
    expect(provider.saves).toBe(0);
  });

  it('snapshot() names the layer each value came from and masks secrets', () => {
    const { cfg } = boot({ YOURPHR_BACKUP_ENCRYPTION_KEY: 'from-env' }, { 'yourphr.operator.name': 'Ops' });
    const rows = Object.fromEntries(cfg.snapshot().map((r) => [r.key, r]));
    expect(rows['yourphr.backup.encryption.key']).toMatchObject({ value: '••••', source: 'environment' });
    expect(rows['yourphr.operator.name']).toMatchObject({ value: 'Ops', source: 'custom' });
    expect(rows['yourphr.sync.max-pages']).toMatchObject({ value: 500, source: 'default' });
    // Descriptions left with the catalogue (yourphr#629) — Go's ConfigEntry has none either.
  });

  it('every key the shipped file defines is known, and nothing else is (yourphr#629)', () => {
    const { cfg } = boot();
    expect(cfg.keys()).toContain('yourphr.sync.max-pages');
    expect(cfg.keys()).not.toContain('yourphr.storage.data-dir');   // left with #630
    expect(() => cfg.getString('never.shipped')).toThrow(/unknown configuration key/);
    // No second list to disagree with: the shipped file IS the catalogue.
    expect(cfg.keys().length).toBe(Object.keys(shipped()).length);
  });

  it('the secret deny-list masks on the admin screen and is read as data, not compiled', () => {
    const { cfg } = boot({ YOURPHR_DATABASE_ENCRYPTION_KEY: 'at-rest' });
    expect(cfg.isSecret('yourphr.database.encryption.key')).toBe(true);
    expect(cfg.maskedValue('yourphr.database.encryption.key')).toBe('••••');
    expect(cfg.getString('yourphr.database.encryption.key')).toBe('at-rest'); // readable to code
    expect(cfg.isSecret('yourphr.web.listen.port')).toBe(false);
    // An instance can extend the list, because it is configuration.
    cfg.set('yourphr.config.secret-keys', ['yourphr.database.encryption.key', 'yourphr.operator.contact-email']);
    expect(cfg.isSecret('yourphr.operator.contact-email')).toBe(true);
  });

  it('backup() carries the overrides only — never the environment — and restore() puts them back', async () => {
    const { engine, cfg } = boot({ YOURPHR_BACKUP_ENCRYPTION_KEY: 'from-env' });
    await engine.initialize();
    cfg.set('yourphr.operator.name', 'Ops');
    const data = await cfg.backup();
    expect(data.payload).toEqual({ 'yourphr.operator.name': 'Ops' });
    const second = boot();
    await second.engine.initialize();
    await second.cfg.restore(data);
    expect(second.cfg.getString('yourphr.operator.name')).toBe('Ops');
  });
});

describe('environment-owned keys — declared, not detected (yourphr#635)', () => {
  it('a declared key is read-only whether or not the variable is set', () => {
    const withVar = new ConfigurationManager(new Engine(), new FakeConfigProvider(), { env: { YOURPHR_WEB_LISTEN_PORT: '9090' } });
    const without = new ConfigurationManager(new Engine(), new FakeConfigProvider(), { env: {} });
    // The ambiguity ngdpbase removed: conditional ownership makes the same key editable on one
    // instance and refused on another.
    expect(() => withVar.set('yourphr.web.listen.port', 1)).toThrow(/owned by the environment variable/);
    expect(() => without.set('yourphr.web.listen.port', 1)).toThrow(/owned by the environment variable/);
  });

  it('the shipped value is a boot fallback: still the effective value, still read-only', () => {
    const cfg = new ConfigurationManager(new Engine(), new FakeConfigProvider(), { env: {} });
    const d = cfg.describeProperty('yourphr.web.listen.port');
    expect(d).toMatchObject({ envControlled: true, envVar: 'YOURPHR_WEB_LISTEN_PORT', effective: 8080, source: 'config' });
    expect(cfg.getInt('yourphr.web.listen.port')).toBe(8080);
  });

  it('the variable wins when set, coerced to the shipped value\'s type', () => {
    const cfg = new ConfigurationManager(new Engine(), new FakeConfigProvider(), { env: { YOURPHR_WEB_LISTEN_PORT: '9090', YOURPHR_WEB_SECURE_COOKIES: 'true' } });
    expect(cfg.describeProperty('yourphr.web.listen.port')).toMatchObject({ effective: 9090, source: 'env' });
    expect(cfg.getInt('yourphr.web.listen.port')).toBe(9090);        // a number, not "9090"
    expect(cfg.getBool('yourphr.web.secure-cookies')).toBe(true);
  });

  it('an EMPTY variable is an operator clearing it, not blanking the setting', () => {
    const cfg = new ConfigurationManager(new Engine(), new FakeConfigProvider(), { env: { YOURPHR_WEB_LISTEN_PORT: '' } });
    expect(cfg.getInt('yourphr.web.listen.port')).toBe(8080);
    expect(cfg.describeProperty('yourphr.web.listen.port')).toMatchObject({ source: 'config', envControlled: true });
  });

  it('a value that cannot be coerced comes back raw rather than as a silent NaN', () => {
    const cfg = new ConfigurationManager(new Engine(), new FakeConfigProvider(), { env: { YOURPHR_WEB_LISTEN_PORT: 'not-a-port' } });
    expect(cfg.describeProperty('yourphr.web.listen.port').effective).toBe('not-a-port');
  });

  it('a key nobody declared is not env-owned, and stays writable', () => {
    const cfg = new ConfigurationManager(new Engine(), new FakeConfigProvider(), { env: {} });
    expect(cfg.describeProperty('yourphr.operator.name')).toMatchObject({ envControlled: false, envVar: null });
    cfg.set('yourphr.operator.name', 'Ops');
    expect(cfg.getString('yourphr.operator.name')).toBe('Ops');
  });

  it('an env-owned key still honours the pre-#627 SPIKE_ name — a live deployment sets it', () => {
    // The regression this exists for: yourphr#635 moved the encryption keys onto the env-owned
    // branch, which did not consult the legacy name. A deployment still setting
    // SPIKE_DATABASE_ENCRYPTION_KEY therefore opened an encrypted database with an EMPTY key and
    // died with SQLITE_NOTADB. Found by deploying v0.2.0; no test caught it because every test
    // sets the new names.
    const legacy = new ConfigurationManager(new Engine(), new FakeConfigProvider(), { env: { SPIKE_DATABASE_ENCRYPTION_KEY: 'from-old-manifest' } });
    expect(legacy.getString('yourphr.database.encryption.key')).toBe('from-old-manifest');
    expect(legacy.isSetByEnvironment('yourphr.database.encryption.key')).toBe(true);
    // The new name still wins when both are set.
    const both = new ConfigurationManager(new Engine(), new FakeConfigProvider(), { env: { SPIKE_DATABASE_ENCRYPTION_KEY: 'old', YOURPHR_DATABASE_ENCRYPTION_KEY: 'new' } });
    expect(both.getString('yourphr.database.encryption.key')).toBe('new');
  });

  it('the declared map is exposed so the admin screen can name the owning variable', () => {
    const cfg = new ConfigurationManager(new Engine(), new FakeConfigProvider(), { env: {} });
    expect(cfg.envControlledKeys()['yourphr.database.encryption.key']).toBe('YOURPHR_DATABASE_ENCRYPTION_KEY');
  });
});

describe('storage roots — plain environment variables, paths compose from them (yourphr#626, #630)', () => {
  it('one volume: the slow root defaults to the fast one and every path composes off it', () => {
    const dir = tmp();
    const cfg = new ConfigurationManager(new Engine(), new FileConfigProvider(dir), { env: {} });
    expect(cfg.getString('yourphr.database.location')).toBe(join(dir, 'spike.db'));
    expect(cfg.getString('yourphr.records.location')).toBe(join(dir, 'records.db'));
    expect(cfg.getString('yourphr.backup.destination')).toBe(join(dir, 'backups'));
  });

  it('two volumes: the archive follows the slow root, the databases stay on the fast one', () => {
    const dir = tmp();
    const cfg = new ConfigurationManager(new Engine(), new FileConfigProvider(dir), { env: { YOURPHR_SLOW_STORAGE: '/mnt/nas' } });
    expect(cfg.getString('yourphr.backup.destination')).toBe('/mnt/nas/backups');
    expect(cfg.getString('yourphr.database.location')).toBe(join(dir, 'spike.db'));
    expect(cfg.getString('yourphr.records.location')).toBe(join(dir, 'records.db'));
  });

  it('the roots are NOT configuration keys — they locate the configuration, so they cannot live in it', () => {
    const dir = tmp();
    const cfg = new ConfigurationManager(new Engine(), new FileConfigProvider(dir), { env: {} });
    expect(() => cfg.getString('yourphr.storage.data-dir')).toThrow(/unknown configuration key/);
    expect(() => cfg.getString('yourphr.storage.slow-dir')).toThrow(/unknown configuration key/);
    expect(() => cfg.set('yourphr.storage.slow-dir', '/mnt/nas')).toThrow(/unknown configuration key/);
  });

  it('an operator repoints one path in the config file without touching the roots', () => {
    const dir = tmp();
    const cfg = new ConfigurationManager(new Engine(), new FileConfigProvider(dir), { env: {} });
    cfg.set('yourphr.backup.destination', '/mnt/elsewhere/nightly');
    expect(cfg.getString('yourphr.backup.destination')).toBe('/mnt/elsewhere/nightly');
    expect(cfg.getString('yourphr.database.location')).toBe(join(dir, 'spike.db')); // unaffected
  });
});

describe('environment references — the config file names the variable (yourphr#622)', () => {
  it('a bare $VAR is the whole value and resolves from the environment', () => {
    const { cfg } = boot({ SMTP_PASSWORD: 'hunter2' }, { 'yourphr.operator.name': '$SMTP_PASSWORD' });
    expect(cfg.getString('yourphr.operator.name')).toBe('hunter2');
    expect(cfg.isEnvReference('yourphr.operator.name')).toBe(true);
  });

  it('an unset bare $VAR REFUSES, naming the variable and the key that wanted it', () => {
    const { cfg } = boot({}, { 'yourphr.operator.name': '$SMTP_PASSWORD' });
    expect(() => cfg.getString('yourphr.operator.name')).toThrow(/SMTP_PASSWORD/);
    expect(() => cfg.getString('yourphr.operator.name')).toThrow(/operator\.name/);
  });

  it('an embedded ${VAR} resolves, and is left INTACT on a miss so it fails at point of use', () => {
    const { cfg } = boot({ BACKUP_ROOT: '/mnt/nas' }, { 'yourphr.backup.destination': '${BACKUP_ROOT}/backups' });
    expect(cfg.getString('yourphr.backup.destination')).toBe('/mnt/nas/backups');
    const { cfg: missing } = boot({}, { 'yourphr.backup.destination': '${BACKUP_ROOT}/backups' });
    expect(missing.getString('yourphr.backup.destination')).toBe('${BACKUP_ROOT}/backups'); // silent, not fatal
  });

  it('$$literal escapes a value that genuinely starts with $', () => {
    const { cfg } = boot({}, { 'yourphr.operator.name': '$$NotAVariable' });
    expect(cfg.getString('yourphr.operator.name')).toBe('$NotAVariable');
    expect(cfg.isEnvReference('yourphr.operator.name')).toBe(false);
  });

  it('resolves at LOOKUP time, so a changed environment is seen on the next read', () => {
    const env: Record<string, string> = { TOKEN: 'first' };
    const { cfg } = boot(env, { 'yourphr.operator.name': '$TOKEN' });
    expect(cfg.getString('yourphr.operator.name')).toBe('first');
    env['TOKEN'] = 'second';
    expect(cfg.getString('yourphr.operator.name')).toBe('second');
  });

  it('masking is structural: a referenced value is masked without anyone flagging it secret', () => {
    const { cfg } = boot({ SMTP_PASSWORD: 'hunter2' }, { 'yourphr.operator.name': '$SMTP_PASSWORD' });
    expect(cfg.maskedValue('yourphr.operator.name')).toBe('••••');   // not marked `secret` in the catalogue
    expect(cfg.getString('yourphr.operator.name')).toBe('hunter2');  // still readable to code that asks
    expect(cfg.snapshot().find((r) => r.key === 'yourphr.operator.name')?.value).toBe('••••');
  });

  it('refuses to write a literal over a reference — that would copy a secret onto disk', () => {
    const { cfg, provider } = boot({ SMTP_PASSWORD: 'hunter2' }, { 'yourphr.operator.name': '$SMTP_PASSWORD' });
    expect(() => cfg.set('yourphr.operator.name', 'Ops')).toThrow(/copy a secret out of the deployment/);
    expect(provider.saves).toBe(0);
    cfg.set('yourphr.operator.name', '$OTHER_VAR'); // pointing it at a different variable is fine
    expect(provider.written()).toEqual({ 'yourphr.operator.name': '$OTHER_VAR' });
  });

  it('a missing required secret refuses at BOOT, not at the first request that reads it', async () => {
    const { engine } = boot({}, { 'yourphr.operator.contact-email': '$UNSET_SECRET' });
    await expect(engine.initialize()).rejects.toThrow(/UNSET_SECRET/);
  });
});

describe('FileConfigProvider — the two files (yourphr#621)', () => {
  it('reads the shipped defaults and the instance overrides, ignoring _ comment keys', () => {
    const dir = tmp();
    mkdirSync(join(dir, 'config'), { recursive: true });
    writeFileSync(join(dir, 'config', 'app-custom-config.json'), JSON.stringify({ _comment: 'notes', 'yourphr.operator.name': 'Ops' }));
    const loaded = new FileConfigProvider(dir).load();
    expect(loaded.custom).toEqual({ 'yourphr.operator.name': 'Ops' }); // the comment is not a setting
    expect(loaded.defaults['yourphr.sync.max-pages']).toBe(500);
    expect(loaded.defaults['_comment']).toBeUndefined();
  });

  it('missing overrides are normal; missing SHIPPED defaults refuse the boot', () => {
    const dir = tmp();
    expect(new FileConfigProvider(dir).load().custom).toEqual({});
    expect(() => new FileConfigProvider(dir, join(dir, 'nope.json')).load()).toThrow(/part of the product/);
  });

  it('unparseable overrides are reported, not clobbered', () => {
    const dir = tmp();
    mkdirSync(join(dir, 'config'), { recursive: true });
    writeFileSync(join(dir, 'config', 'app-custom-config.json'), '{ not json');
    const loaded = new FileConfigProvider(dir).load();
    expect(loaded.customUnreadable).toContain('app-custom-config.json');
    expect(loaded.custom).toEqual({});
  });

  it('saves the deltas with a header warning against pasting the defaults in', () => {
    const dir = tmp();
    const provider = new FileConfigProvider(dir);
    provider.saveCustom({ 'yourphr.operator.name': 'Ops' });
    const written = JSON.parse(readFileSync(provider.customLocation(), 'utf8')) as Record<string, unknown>;
    expect(written['yourphr.operator.name']).toBe('Ops');
    expect(String(written['_comment'])).toContain('ONLY what this instance changed');
    expect(Object.keys(written)).toHaveLength(2); // the header and the one delta; nothing else
  });
});

describe('deepMerge — ngdpbase\'s merge, carried as-is', () => {
  it('merges objects per entry so one override does not freeze the rest', () => {
    const merged = deepMerge(
      { roles: { admin: ['a'], user: [], anonymous: [] } },
      { roles: { user: ['b'] } }
    );
    expect(merged['roles']).toEqual({ admin: ['a'], user: ['b'], anonymous: [] });
  });

  it('merges arrays of {id, …} by id, and replaces any other array wholesale', () => {
    expect(deepMerge({ p: [{ id: 'a', v: 1 }, { id: 'b', v: 2 }] }, { p: [{ id: 'b', v: 9 }, { id: 'c', v: 3 }] })['p'])
      .toEqual([{ id: 'a', v: 1 }, { id: 'b', v: 9 }, { id: 'c', v: 3 }]);
    expect(deepMerge({ p: ['a', 'b'] }, { p: ['c'] })['p']).toEqual(['c']);
  });
});

function shipped(): Record<string, ConfigValue> {
  return new FakeConfigProvider().load().defaults;
}
