import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../../Engine.js';
import { ApiContext } from '../../ApiContext.js';
import { ConfigurationManager } from '../../ConfigurationManager.js';
import { PolicyManager } from '../PolicyManager.js';
import { FakeConfigProvider } from '../../providers/__tests__/FakeConfigProvider.js';
import { BackupManager, applyStagedConfig, applyStagedRestore, STAGED_CONFIG, type BackupExporter } from '../BackupManager.js';
import { FakeBackupProvider } from '../../providers/__tests__/FakeBackupProvider.js';
import { NullBackupProvider, type BaseBackupProvider } from '../../providers/BaseBackupProvider.js';
import type { BackupData } from '../../BaseManager.js';
import { UsersManager } from '../UsersManager.js';
import { NotificationManager } from '../NotificationManager.js';
import { FakeUsersProvider } from '../../providers/__tests__/FakeUsersProvider.js';
import { PasswordAuthProvider } from '../../providers/PasswordAuthProvider.js';

/** The PHI store's door, scripted: "writes" a file name the fake store then lists. */
class FakeExporter implements BackupExporter {
  backups: { destination: string; key: string }[] = [];
  restores: { file: string; key: string }[] = [];
  fail = false;
  constructor(private readonly store: FakeBackupProvider) {}
  /** What each written file carried for other managers (yourphr#631), by file. */
  carried = new Map<string, Record<string, BackupData>>();
  async backup(options: { destination: string; key: string; now?: Date; payloads?: BackupData[] }): Promise<BackupData & { file: string; sizeBytes: number; pruned: string[] }> {
    if (this.fail) throw new Error('disk full');
    this.backups.push({ destination: options.destination, key: options.key });
    const name = `${(options.now ?? new Date()).toISOString().replace(/:/g, '-')}-backup.db`;
    this.carried.set(`${options.destination}/${name}`, Object.fromEntries((options.payloads ?? []).map((p) => [p.manager, p])));
    this.store.add(options.destination, name, 42);
    return { manager: 'records', takenAt: 'now', file: `${options.destination}/${name}`, sizeBytes: 42, pruned: [] };
  }
  async restore(data: BackupData, options: { key: string }): Promise<void> {
    this.restores.push({ file: data.files![0]!, key: options.key });
  }
  async readPayloads(file: string): Promise<Record<string, BackupData>> {
    return this.carried.get(file) ?? {};
  }
}

let dir: string;
let engine: Engine;
let store: FakeBackupProvider;
let exporter: FakeExporter;
let backups: BackupManager;
let admin: ApiContext;
let alice: ApiContext;
let clock: Date;

async function boot(provider: BaseBackupProvider = store, env: Record<string, string> = { YOURPHR_BACKUP_ENCRYPTION_KEY: 'travel-key' }): Promise<void> {
  engine = new Engine();
  exporter = new FakeExporter(store);
  backups = new BackupManager(engine, provider, { dataDir: dir, exporter, alsoExport: ['app-db'], now: () => clock });
  engine.register('configuration', new ConfigurationManager(engine, new FakeConfigProvider({}, undefined, undefined, dir), { env: env })).register('policy', new PolicyManager(engine)).register('backups', backups);
  await engine.initialize();
  admin = ApiContext.from({ username: 'root', role: 'admin' }, engine);
  alice = ApiContext.from({ username: 'alice', role: 'user' }, engine);
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'spike-backups-spec-'));
  clock = new Date('2026-04-01T02:00:30Z');
  store = new FakeBackupProvider();
  await boot();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('BackupManager — the coordinator', () => {
  it('boots after configuration, initialises its store, and defaults the destination under the data directory', () => {
    expect(engine.registered).toEqual(['configuration', 'policy', 'backups']);
    expect(store.initialized).toBe(true);
    expect(backups.destination()).toBe(join(dir, 'backups'));
    expect(backups.unavailable()).toBe('');
  });

  it('a backup now goes through the exporter under the backup key, prunes by retention, and records a success', async () => {
    engine.managers.configuration.set('yourphr.backup.max-backups', 2);
    await expect(backups.backupNow(alice)).rejects.toMatchObject({ status: 403 });
    const first = await backups.backupNow(admin);
    expect(first).toMatchObject({ name: expect.stringMatching(/backup\.db$/), sizeBytes: 42, pruned: [] });
    expect(exporter.backups).toEqual([{ destination: join(dir, 'backups'), key: 'travel-key' }]);
    expect(store.prepared).toEqual([join(dir, 'backups')]);
    clock = new Date('2026-04-02T02:00:30Z');
    await backups.backupNow(ApiContext.system('scheduler', 'scheduler', engine));
    clock = new Date('2026-04-03T02:00:30Z');
    const third = await backups.backupNow(admin);
    expect(third.pruned).toHaveLength(1);
    expect(await backups.list(admin)).toHaveLength(2);
    expect(backups.health()).toMatchObject({ ok: true, consecutive_failures: 0, last_success_path: third.file, days_since_success: 0, summary: expect.stringContaining('Scheduled backups are off') });
    expect(JSON.parse(readFileSync(join(dir, '.backup_health.json'), 'utf8'))).toMatchObject({ lastSuccessPath: third.file, consecutiveFailures: 0 });
  });

  it('refuses loudly without a key, and a failed export is recorded as a failure the health reports', async () => {
    await boot(store, {});
    expect(backups.unavailable()).toContain('no backup encryption key');
    await expect(backups.backupNow(admin)).rejects.toMatchObject({ status: 400, message: expect.stringContaining('no backup encryption key') });
    expect(backups.health()).toMatchObject({ ok: false, consecutive_failures: 1 });
    await boot(); // the health file survives a restart: the refusal above still counts
    exporter.fail = true;
    await expect(backups.backupNow(admin)).rejects.toThrow('disk full');
    await expect(backups.backupNow(admin)).rejects.toThrow('disk full');
    expect(backups.health()).toMatchObject({ ok: false, consecutive_failures: 3, last_error: 'disk full', summary: 'No scheduled backups; none taken yet.' }); // Go's summary speaks of the schedule first; the failure count and error carry the rest
    expect(store.prepared).toHaveLength(2);
  });

  it('the Null store: the instance boots, every action refuses with the reason, nothing is listed', async () => {
    await boot(new NullBackupProvider());
    expect(backups.unavailable()).toContain('backup.storage.provider = null');
    await expect(backups.backupNow(admin)).rejects.toMatchObject({ status: 400 });
    expect(await backups.list(admin)).toEqual([]);
    expect(await backups.testDestination(admin, '/mnt/nas')).toMatchObject({ writable: false });
    await expect(backups.browse(admin, '/')).rejects.toMatchObject({ status: 400 });
    await expect(backups.stageRestore(admin, 'x-backup.db')).rejects.toMatchObject({ status: 404 });
  });

  it('validates the schedule as Go does and stores it; due() follows the minute, the weekday, and fires once per minute', async () => {
    expect(() => backups.setSchedule(alice, {})).toThrow('admin role required');
    expect(() => backups.setSchedule(admin, { time: '2:00', days: 'daily' })).toThrow('time must be HH:MM (24-hour)');
    expect(() => backups.setSchedule(admin, { time: '02:00', days: 'monthly' })).toThrow("days must be 'daily' or 'weekly'");
    expect(() => backups.setSchedule(admin, { time: '02:00', days: 'daily', max_backups: -1 })).toThrow('max_backups must be a non-negative integer');
    expect(() => backups.setSchedule(admin, { time: '02:00', days: 'daily', destination: 'relative' })).toThrow('destination must be an absolute folder, or empty for the default');
    expect(backups.setSchedule(admin, { enabled: true, time: '02:00', days: 'weekly', destination: '/mnt/nas', max_backups: 3 })).toEqual({ enabled: true, time: '02:00', days: 'weekly', destination: '/mnt/nas', max_backups: 3 });
    expect(backups.destination()).toBe('/mnt/nas');
    const sunday = new Date(2026, 3, 5, 2, 0, 10); // 2026-04-05 is a Sunday, server-local 02:00
    const monday = new Date(2026, 3, 6, 2, 0, 10);
    expect(backups.due(monday)).toBe(false);
    expect(backups.due(sunday)).toBe(true);
    expect(backups.due(sunday, sunday.toISOString().slice(0, 16))).toBe(false);
    expect(backups.due(new Date(2026, 3, 5, 2, 1, 0))).toBe(false);
    backups.setSchedule(admin, { enabled: false, time: '02:00', days: 'daily' });
    expect(backups.due(sunday)).toBe(false);
  });

  it('health says stale when a schedule is on and nothing has succeeded recently', async () => {
    backups.setSchedule(admin, { enabled: true, time: '02:00', days: 'daily' });
    expect(backups.health()).toMatchObject({ ok: false, failing_stale: true, summary: 'Scheduled backups are on but none has succeeded recently.' });
    await backups.backupNow(admin);
    expect(backups.health()).toMatchObject({ ok: true, failing_stale: false, summary: expect.stringContaining('Healthy') });
    clock = new Date('2026-04-05T02:00:30Z');
    expect(backups.health()).toMatchObject({ ok: false, failing_stale: true, days_since_success: 4 });
  });

  it('a restore backs the live instance up FIRST, then stages the named backup through the exporter under the backup key', async () => {
    await expect(backups.stageRestore(admin, '../etc/passwd')).rejects.toMatchObject({ status: 404 });
    const taken = await backups.backupNow(admin);
    clock = new Date('2026-04-01T03:00:00Z');
    const r = await backups.stageRestore(admin, taken.name);
    expect(r).toMatchObject({ staged: true });
    expect(exporter.backups).toHaveLength(2);
    expect(exporter.restores).toEqual([{ file: taken.file, key: 'travel-key' }]);
    expect(await backups.testDestination(admin, '')).toEqual({ destination: join(dir, 'backups'), writable: true });
    expect(await backups.browse(admin, '/')).toMatchObject({ dirs: ['a', 'b'] });
  });

  it('a backup carries the operator\'s settings; a restore stages them and says .env is not included (yourphr#631)', async () => {
    engine.managers.configuration.set('yourphr.operator.name', 'The Willekes');
    engine.managers.configuration.set('yourphr.backup.max-backups', 3);
    const taken = await backups.backupNow(admin);
    expect(exporter.carried.get(taken.file)!['configuration']!.payload).toMatchObject({ 'yourphr.operator.name': 'The Willekes', 'yourphr.backup.max-backups': 3 });
    engine.managers.configuration.set('yourphr.operator.name', 'Changed since');
    clock = new Date('2026-04-01T03:00:00Z');
    const r = await backups.stageRestore(admin, taken.name);
    expect(r.message).toContain('Its settings come back too.');
    expect(r.message).toContain('A backup never includes <data>/.env');
    const staged = JSON.parse(readFileSync(join(dir, STAGED_CONFIG), 'utf8')) as BackupData;
    expect(staged.payload).toMatchObject({ 'yourphr.operator.name': 'The Willekes' });
    // Staged, not applied: the running instance keeps its settings until the restart.
    expect(engine.managers.configuration.getString('yourphr.operator.name')).toBe('Changed since');
  });

  it('a backup from before settings were carried restores records and says the settings stay as they are', async () => {
    const taken = await backups.backupNow(admin);
    exporter.carried.set(taken.file, {});
    clock = new Date('2026-04-01T03:00:00Z');
    const r = await backups.stageRestore(admin, taken.name);
    expect(r.message).toContain('This backup predates settings in backups, so the current settings are kept.');
    expect(existsSync(join(dir, STAGED_CONFIG))).toBe(false);
  });

  it('applyStagedConfig: the backup\'s settings REPLACE the instance\'s at start; the old ones are kept aside', async () => {
    const config = engine.managers.configuration;
    config.set('yourphr.operator.name', 'Before');
    config.set('yourphr.operator.contact-email', 'set-after-the-backup@example.org');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(dir, STAGED_CONFIG), JSON.stringify({ manager: 'configuration', takenAt: '2026-04-01T02:00:00Z', payload: { 'yourphr.operator.name': 'From the backup', 'yourphr.not.a.key': 'dropped' } }));
    const lines: string[] = [];
    await applyStagedConfig(dir, config, (l) => lines.push(l));
    expect(config.getString('yourphr.operator.name')).toBe('From the backup');
    expect(config.getString('yourphr.operator.contact-email')).toBe(''); // replaced, not blended
    expect(config.customValues()).not.toHaveProperty('yourphr.not.a.key');
    expect(existsSync(join(dir, STAGED_CONFIG))).toBe(false);
    expect(lines[0]).toContain('restore applied: configuration from the backup taken 2026-04-01T02:00:00Z');
    await applyStagedConfig(dir, config, (l) => lines.push(l)); // nothing staged: nothing happens
    expect(lines).toHaveLength(1);
  });

  it('applyStagedRestore swaps staged files in by rename, keeping the previous live file', () => {
    const { writeFileSync } = require('node:fs') as typeof import('node:fs');
    writeFileSync(join(dir, 'records.db'), 'live');
    writeFileSync(join(dir, 'records.db.staged'), 'staged');
    const lines: string[] = [];
    applyStagedRestore(dir, [['records.db.staged', 'records.db'], ['spike.db.staged', 'spike.db']], (l) => lines.push(l));
    expect(readFileSync(join(dir, 'records.db'), 'utf8')).toBe('staged');
    expect(readFileSync(join(dir, 'records.db.pre-restore'), 'utf8')).toBe('live');
    expect(existsSync(join(dir, 'spike.db'))).toBe(false);
    expect(lines).toHaveLength(1);
  });

  it('the live file\'s -wal and -shm step aside with it, and a previous restore\'s kept WAL is cleared (yourphr#866)', () => {
    const { writeFileSync } = require('node:fs') as typeof import('node:fs');
    writeFileSync(join(dir, 'records.db'), 'live');
    writeFileSync(join(dir, 'records.db-wal'), 'live-wal');
    writeFileSync(join(dir, 'records.db-shm'), 'live-shm');
    writeFileSync(join(dir, 'spike.db'), 'live-app');
    writeFileSync(join(dir, 'spike.db.pre-restore-wal'), 'from-an-earlier-restore');
    writeFileSync(join(dir, 'records.db.staged'), 'staged');
    writeFileSync(join(dir, 'spike.db.staged'), 'staged-app');
    applyStagedRestore(dir, [['records.db.staged', 'records.db'], ['spike.db.staged', 'spike.db']], () => undefined, ['records.db.staged', 'spike.db.staged']);
    expect(readFileSync(join(dir, 'records.db'), 'utf8')).toBe('staged');
    expect(existsSync(join(dir, 'records.db-wal'))).toBe(false); // nothing left to replay onto the restore
    expect(existsSync(join(dir, 'records.db-shm'))).toBe(false);
    expect(readFileSync(join(dir, 'records.db.pre-restore-wal'), 'utf8')).toBe('live-wal'); // the kept copy keeps its own WAL
    expect(readFileSync(join(dir, 'spike.db'), 'utf8')).toBe('staged-app');
    expect(existsSync(join(dir, 'spike.db.pre-restore-wal'))).toBe(false); // the stale one is gone
  });

  it('a partial set is never applied: records without accounts are set aside as *.incomplete (yourphr#866)', () => {
    const { writeFileSync } = require('node:fs') as typeof import('node:fs');
    writeFileSync(join(dir, 'records.db'), 'live');
    writeFileSync(join(dir, 'spike.db'), 'live-app');
    writeFileSync(join(dir, 'records.db.staged'), 'staged');
    const lines: string[] = [];
    applyStagedRestore(dir, [['records.db.staged', 'records.db'], ['spike.db.staged', 'spike.db']], (l) => lines.push(l), ['records.db.staged', 'spike.db.staged']);
    expect(readFileSync(join(dir, 'records.db'), 'utf8')).toBe('live');
    expect(existsSync(join(dir, 'records.db.staged'))).toBe(false);
    expect(readFileSync(join(dir, 'records.db.staged.incomplete'), 'utf8')).toBe('staged');
    expect(lines.join('\n')).toContain('restore NOT applied');
  });

  it('a live database named by its absolute path is restored where it really lives (yourphr#866)', () => {
    const { writeFileSync, mkdirSync } = require('node:fs') as typeof import('node:fs');
    const elsewhere = join(dir, 'elsewhere');
    mkdirSync(elsewhere);
    writeFileSync(join(elsewhere, 'app.db'), 'live-app');
    writeFileSync(join(dir, 'spike.db.staged'), 'staged-app');
    applyStagedRestore(dir, [['spike.db.staged', join(elsewhere, 'app.db')]], () => undefined);
    expect(readFileSync(join(elsewhere, 'app.db'), 'utf8')).toBe('staged-app');
    expect(readFileSync(join(elsewhere, 'app.db.pre-restore'), 'utf8')).toBe('live-app');
    expect(existsSync(join(dir, 'app.db'))).toBe(false);
  });

  it('its own backup is the health state, and restoring it rewrites the file', async () => {
    await backups.backupNow(admin);
    const own = await backups.backup();
    expect(own).toMatchObject({ manager: 'backups', payload: { consecutiveFailures: 0 } });
    await boot();
    await backups.restore(own);
    expect(backups.health().last_success_at).toBe('2026-04-01T02:00:30.000Z');
  });
});

describe('BackupManager — stale-backup alerts (yourphr#789)', () => {
  let notes: NotificationManager;

  /** The coordinator with the doors an alert needs: accounts (who is an admin) and notifications. */
  async function bootWithAlerts(custom: Record<string, unknown> = {}): Promise<void> {
    engine = new Engine();
    exporter = new FakeExporter(store);
    backups = new BackupManager(engine, store, { dataDir: dir, exporter, now: () => clock });
    notes = new NotificationManager(engine);
    engine
      .register('configuration', new ConfigurationManager(engine, new FakeConfigProvider(custom as never, undefined, undefined, dir), { env: { YOURPHR_BACKUP_ENCRYPTION_KEY: 'travel-key' } }))
      .register('policy', new PolicyManager(engine))
      .register('notifications', notes)
      .register('users', new UsersManager(engine, new FakeUsersProvider(), new PasswordAuthProvider()))
      .register('backups', backups);
    await engine.initialize();
    const sys = ApiContext.system('test', 'test', engine);
    await engine.managers.users.createUser(sys, 'root', 'a-long-enough-password', 'admin');
    await engine.managers.users.createUser(sys, 'ops', 'a-long-enough-password', 'admin');
    await engine.managers.users.createUser(sys, 'alice', 'a-long-enough-password');
    admin = ApiContext.from({ username: 'root', role: 'admin' }, engine);
  }
  const hoursLater = (h: number) => { clock = new Date(clock.getTime() + h * 3_600_000); };
  // The notifications manager judges expiry by the real clock; these tests run the coordinator's
  // fake one, so they read every notice and judge "current" against the fake clock themselves.
  const currentFor = (username: string) => notes.getUserNotifications(username, true).filter((n) => !n.expiresAt || n.expiresAt > clock);

  beforeEach(async () => { await engine.shutdown(); await bootWithAlerts(); });

  it('health counts hours, not whole days: 71 hours is stale at the 49-hour threshold', async () => {
    backups.setSchedule(admin, { enabled: true, time: '02:00', days: 'daily' });
    await backups.backupNow(admin);
    hoursLater(48);
    expect(backups.health()).toMatchObject({ failing_stale: false, hours_since_success: 48, days_since_success: 2 });
    hoursLater(23);
    expect(backups.health()).toMatchObject({ failing_stale: true, hours_since_success: 71, days_since_success: 2 });
  });

  it('schedule on and nothing for 49 hours: one error notice, to the admins only, expiring after 25 hours', async () => {
    backups.setSchedule(admin, { enabled: true, time: '02:00', days: 'daily' });
    await backups.backupNow(admin);
    hoursLater(49);
    expect(await backups.checkAlerts()).toBeUndefined(); // 49 exactly is not "over 49"
    hoursLater(1);
    const alert = await backups.checkAlerts();
    expect(alert).toMatchObject({ kind: 'stale', level: 'error', title: 'No backup has succeeded in over 49 hours' });
    expect(alert!.message).toContain('Scheduled backups are on. The last successful backup was 2026-04-01T02:00:30.000Z.');
    const [n] = notes.getAllNotifications(true);
    expect(n).toMatchObject({ level: 'error', targetUsers: ['root', 'ops'] });
    expect(n!.expiresAt!.getTime() - clock.getTime()).toBe(25 * 3_600_000);
    expect(currentFor('alice')).toEqual([]);
  });

  it('while it holds: at most once a day; after a success it stops, and the notice expires by itself', async () => {
    backups.setSchedule(admin, { enabled: true, time: '02:00', days: 'daily' });
    await backups.backupNow(admin);
    hoursLater(50);
    expect((await backups.checkAlerts())!.notificationId).not.toBe('');
    hoursLater(1);
    expect((await backups.checkAlerts())!.notificationId).toBe(''); // already told today
    hoursLater(23);
    expect((await backups.checkAlerts())!.notificationId).not.toBe(''); // a day on, still stale: again
    expect(currentFor('root')).toHaveLength(2);
    await backups.backupNow(admin);
    expect(await backups.checkAlerts()).toBeUndefined();
    hoursLater(26);
    expect(currentFor('root')).toEqual([]); // both expired; nobody had to clear them
  });

  it('a weekly schedule uses its own threshold, so it is quiet between weekly runs', async () => {
    backups.setSchedule(admin, { enabled: true, time: '02:00', days: 'weekly' });
    await backups.backupNow(admin);
    hoursLater(150);
    expect(await backups.checkAlerts()).toBeUndefined();
    hoursLater(44);
    expect(await backups.checkAlerts()).toMatchObject({ kind: 'stale', title: 'No backup has succeeded in over 193 hours' });
  });

  it('schedule off: a warning after 15 days without a backup — and not before', async () => {
    await backups.backupNow(admin);
    hoursLater(15 * 24);
    expect(await backups.checkAlerts()).toBeUndefined();
    hoursLater(1);
    const alert = await backups.checkAlerts();
    expect(alert).toMatchObject({ kind: 'unscheduled', level: 'warning', title: 'No backup in over 15 days' });
    expect(alert!.message).toContain('Scheduled backups are off.');
    expect(notes.getAllNotifications(true)[0]!.level).toBe('warning');
  });

  it('with no success on record, time counts from when checking began — kept across a restart', async () => {
    const scheduled = { 'yourphr.backup.schedule.enabled': true };
    await engine.shutdown();
    await bootWithAlerts(scheduled);
    expect(await backups.checkAlerts()).toBeUndefined();
    hoursLater(30);
    await engine.shutdown();
    await bootWithAlerts(scheduled);
    hoursLater(20);
    const alert = await backups.checkAlerts();
    expect(alert).toMatchObject({ kind: 'stale' });
    expect(alert!.message).toContain('No backup has succeeded on this instance yet.');
  });

  it('the thresholds are configuration', async () => {
    await engine.shutdown();
    await bootWithAlerts({ 'yourphr.backup.alert.stale-hours': 10, 'yourphr.backup.alert.unscheduled-days': 1 });
    await backups.backupNow(admin);
    hoursLater(25);
    expect(await backups.checkAlerts()).toMatchObject({ kind: 'unscheduled', title: 'No backup in over 1 days' });
    backups.setSchedule(admin, { enabled: true, time: '02:00', days: 'daily' });
    expect(await backups.checkAlerts()).toMatchObject({ kind: 'stale', title: 'No backup has succeeded in over 10 hours' });
  });

  it('names the failure when the last attempt failed', async () => {
    backups.setSchedule(admin, { enabled: true, time: '02:00', days: 'daily' });
    await backups.backupNow(admin);
    exporter.fail = true;
    hoursLater(50);
    await expect(backups.backupNow(admin)).rejects.toThrow('disk full');
    expect((await backups.checkAlerts())!.message).toContain('The last attempt failed: disk full');
  });
});

