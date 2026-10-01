/**
 * Backups (yourphr#615): the coordinator — when a backup runs, where it goes, whether it worked,
 * and how a restore is staged. The encrypted export is the PHI store's own (the component holding
 * the key is the only one that can export correctly): this manager asks the exporter through its
 * door and records the outcome either way (yourphr#441 — an invisible backup is indistinguishable
 * from a broken one). Storage is OPTIONAL (decision Q6): with the Null provider the instance serves
 * and every backup action refuses with a reason; the boot never fails for a missing backup store.
 *
 * Known gap the doc names: one exporter today, so the snapshot is consistent; with several, the
 * per-manager backup() contract yields a torn snapshot and quiescing is engine-level work still to design.
 */
import { copyFileSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { BaseManager, type BackupData } from '../BaseManager.js';
import type { Engine } from '../Engine.js';
import { ApiContext, ApiError } from '../ApiContext.js';
import type { BackupArtifact, BaseBackupProvider } from '../providers/BaseBackupProvider.js';

declare module '../Engine.js' {
  interface ManagerRegistry {
    backups: BackupManager;
  }
}

export interface BackupSchedule {
  enabled: boolean;
  time: string;
  days: string;
  destination: string;
  max_backups: number;
}

export interface BackupHealth {
  ok: boolean;
  schedule_enabled: boolean;
  destination?: string;
  last_success_at?: string;
  last_success_path?: string;
  last_attempt_at?: string;
  last_error?: string;
  consecutive_failures: number;
  days_since_success?: number;
  /** Whole hours since the last success (yourphr#789), which is what the alert thresholds count. */
  hours_since_success?: number;
  failing_stale: boolean;
  summary: string;
}

/** What checkAlerts() raised, if anything (yourphr#789). */
export interface BackupAlert {
  kind: 'stale' | 'unscheduled';
  level: 'error' | 'warning';
  title: string;
  message: string;
  /** The notification it created, or '' when this condition was already notified today. */
  notificationId: string;
}

export interface BackupOutcome { file: string; name: string; sizeBytes: number; pruned: string[] }

/** The door that can write an encrypted copy of the instance and stage one back — the PHI store's manager. */
export interface BackupExporter {
  backup(options: { destination: string; key: string; maxBackups?: number; now?: Date; alsoExport?: unknown[]; payloads?: BackupData[] }): Promise<BackupData & { file: string; sizeBytes: number; pruned: string[] }>;
  restore(data: BackupData, options: { key: string }): Promise<void>;
  /** Other managers' payloads the backup file carries (yourphr#631), by manager; {} when none. */
  readPayloads(file: string, options: { key: string }): Promise<Record<string, BackupData>>;
}

/**
 * The configuration a restore brings back (yourphr#631), staged beside the databases and applied at
 * the next start, before anything reads a setting — the same moment the databases are swapped in.
 */
export const STAGED_CONFIG = 'config.staged.json';

/**
 * Applies a staged configuration restore at start (yourphr#631): the overrides in the backup replace
 * the instance's through ConfigurationManager.restore() — ngdpbase's ConfigurationManager.restore(),
 * which replaces its customConfig — and the previous overrides step aside as *.pre-restore, as the
 * databases do. The environment is untouched: a restore never brings back <data>/.env.
 */
export async function applyStagedConfig(dataDir: string, config: { restore(data: BackupData): Promise<void>; customConfigPath(): string }, log: (line: string) => void): Promise<void> {
  const staged = join(dataDir, STAGED_CONFIG);
  if (!existsSync(staged)) return;
  const data = JSON.parse(readFileSync(staged, 'utf8')) as BackupData;
  const current = config.customConfigPath();
  if (existsSync(current)) copyFileSync(current, `${current}.pre-restore`);
  await config.restore(data);
  unlinkSync(staged);
  log(`restore applied: configuration from the backup taken ${data.takenAt} (previous kept as ${current}.pre-restore)`);
}

export interface BackupOptions {
  dataDir: string;
  exporter: BackupExporter;
  /** Other databases that belong in the same backup — the app database with the accounts, sources, catalog. */
  alsoExport?: unknown[];
  now?: () => Date;
}

/**
 * Applies a staged restore at start, BEFORE anything opens: each staged file's live counterpart
 * steps aside as *.pre-restore and the staged file takes its name. A rename, never a write into a
 * live database. The application names the pairs — which files its stores stage.
 */
export function applyStagedRestore(dataDir: string, pairs: [staged: string, live: string][], log: (line: string) => void): void {
  for (const [staged, live] of pairs) {
    const stagedPath = join(dataDir, staged);
    if (!existsSync(stagedPath)) continue;
    const livePath = join(dataDir, live);
    if (existsSync(livePath)) renameSync(livePath, `${livePath}.pre-restore`);
    renameSync(stagedPath, livePath);
    log(`restore applied: ${staged} -> ${live} (previous kept as ${live}.pre-restore)`);
  }
}

interface HealthState {
  lastSuccessAt?: string;
  lastSuccessPath?: string;
  lastAttemptAt?: string;
  lastError?: string;
  consecutiveFailures: number;
  /** yourphr#789: when checking began, for an instance with no success on record — the clock the thresholds run from. */
  watchingSince?: string;
  /** yourphr#789: the last alert raised, and for which condition, so one condition notifies at most once a day. */
  alertedAt?: string;
  alertKind?: BackupAlert['kind'];
}

const HOUR_MS = 3_600_000;
/** A condition that holds is notified again after this long; each notice expires a little after, so there is one at a time. */
const REALERT_MS = 24 * HOUR_MS;
const NOTICE_TTL_MS = 25 * HOUR_MS;

export class BackupManager extends BaseManager {
  readonly name = 'backups';
  override readonly dependsOn = ['configuration'] as const;
  private readonly healthFile: string;
  private state: HealthState = { consecutiveFailures: 0 };

  constructor(engine: Engine, private readonly provider: BaseBackupProvider, private readonly options: BackupOptions) {
    super(engine);
    this.healthFile = join(options.dataDir, '.backup_health.json');
  }

  override async initialize(config: Record<string, unknown> = {}): Promise<void> {
    await super.initialize(config);
    await this.provider.initialize();
    if (existsSync(this.healthFile)) {
      try { this.state = JSON.parse(readFileSync(this.healthFile, 'utf8')) as HealthState; } catch { /* unreadable: start clean, the next outcome rewrites it */ }
    }
  }

  private now(): Date { return this.options.now?.() ?? new Date(); }
  private get cfg() { return this.engine.managers.configuration; }

  /** The admin's, or the scheduler acting as a system principal. */
  private manage(ctx: ApiContext): void {
    if (ctx.system === '') ctx.require('admin-system');
  }

  // --- where and when ----------------------------------------------------------------------

  destination(): string {
    // Composed from a storage root in the configuration file, not joined here (yourphr#626).
    return this.cfg.getString('yourphr.backup.destination') || join(this.options.dataDir, 'backups');
  }

  schedule(): BackupSchedule {
    const c = this.cfg;
    return { enabled: c.getBool('yourphr.backup.schedule.enabled'), time: c.getString('yourphr.backup.schedule.time'), days: c.getString('yourphr.backup.schedule.days'), destination: c.getString('yourphr.backup.destination'), max_backups: c.getInt('yourphr.backup.max-backups') };
  }

  /** Go's validation, then the settings store — refusals name the rule. */
  setSchedule(ctx: ApiContext, req: Partial<BackupSchedule>): BackupSchedule {
    this.manage(ctx);
    const time = String(req.time ?? '').trim();
    const days = String(req.days ?? '').trim().toLowerCase();
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new ApiError(400, 'time must be HH:MM (24-hour)');
    if (days !== 'daily' && days !== 'weekly') throw new ApiError(400, "days must be 'daily' or 'weekly'");
    const maxBackups = Number(req.max_backups ?? 0);
    if (!Number.isInteger(maxBackups) || maxBackups < 0) throw new ApiError(400, 'max_backups must be a non-negative integer');
    const destination = String(req.destination ?? '').trim();
    if (destination !== '' && !destination.startsWith('/')) throw new ApiError(400, 'destination must be an absolute folder, or empty for the default');
    const c = this.cfg;
    c.set('yourphr.backup.schedule.enabled', req.enabled === true);
    c.set('yourphr.backup.schedule.time', time);
    c.set('yourphr.backup.schedule.days', days);
    c.set('yourphr.backup.destination', destination);
    c.set('yourphr.backup.max-backups', maxBackups);
    return this.schedule();
  }

  /** Due now? Go's rule: the minute matches, weekly only on Sundays, at most once per minute. */
  due(now = this.now(), lastRun?: string): boolean {
    const s = this.schedule();
    if (!s.enabled) return false;
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    if (hhmm !== s.time) return false;
    if (s.days === 'weekly' && now.getDay() !== 0) return false;
    return lastRun !== now.toISOString().slice(0, 16);
  }

  /** Why backups cannot be taken, or '' — this stack always encrypts, so the key is one gate; the store is the other. */
  unavailable(): string {
    if (this.provider.name === 'null') return 'Backups are unavailable: no backup storage is configured (backup.storage.provider = null).';
    if (this.cfg.getString('yourphr.backup.encryption.key') === '') {
      return 'Backups are unavailable: no backup encryption key is set (YOURPHR_BACKUP_ENCRYPTION_KEY). Backups are always encrypted, so there is nothing safe to write.';
    }
    return '';
  }

  // --- the actions ----------------------------------------------------------------------------

  /** A backup now: the instance in one encrypted file through the exporter's door; the outcome recorded either way. */
  async backupNow(ctx: ApiContext, destination = this.destination()): Promise<BackupOutcome> {
    this.manage(ctx);
    const at = this.now().toISOString();
    try {
      const reason = this.unavailable();
      if (reason !== '') throw new ApiError(400, reason);
      await this.provider.ensure(destination);
      // The configuration's own backup travels in the same file (yourphr#631): a restore that forgot
      // the operator's settings is half a restore.
      const payloads = [await this.cfg.backup()];
      const result = await this.options.exporter.backup({ destination, key: this.cfg.getString('yourphr.backup.encryption.key'), now: this.now(), alsoExport: this.options.alsoExport, payloads });
      const pruned = await this.provider.prune(destination, this.cfg.getInt('yourphr.backup.max-backups'));
      this.state = { lastSuccessAt: at, lastSuccessPath: result.file, lastAttemptAt: at, consecutiveFailures: 0 };
      this.saveHealth();
      return { file: result.file, name: basename(result.file), sizeBytes: result.sizeBytes, pruned };
    } catch (err) {
      this.state = { ...this.state, lastAttemptAt: at, lastError: (err as Error).message, consecutiveFailures: this.state.consecutiveFailures + 1 };
      this.saveHealth();
      throw err;
    }
  }

  private saveHealth(): void {
    writeFileSync(this.healthFile, JSON.stringify(this.state, null, 2) + '\n', { mode: 0o600 });
  }

  /** The stale threshold for the schedule as it stands (yourphr#789): stale-hours, or stale-hours-weekly for a weekly one. */
  staleAfterHours(s: BackupSchedule = this.schedule()): number {
    return this.cfg.getInt(s.days === 'weekly' ? 'yourphr.backup.alert.stale-hours-weekly' : 'yourphr.backup.alert.stale-hours');
  }

  health(): BackupHealth {
    const s = this.schedule();
    const h = this.state;
    const since = h.lastSuccessAt ? this.now().getTime() - Date.parse(h.lastSuccessAt) : undefined;
    const days = since === undefined ? undefined : Math.floor(since / 86_400_000);
    const hours = since === undefined ? undefined : Math.floor(since / HOUR_MS);
    // Hours, not whole days (yourphr#789): counting days rounded 71 hours down to 2 and called it fresh.
    const failingStale = s.enabled && (since === undefined || since > this.staleAfterHours(s) * HOUR_MS);
    const ok = !failingStale && h.consecutiveFailures === 0;
    let summary: string;
    if (!s.enabled && !h.lastSuccessAt) summary = 'No scheduled backups; none taken yet.';
    else if (!s.enabled) summary = `Scheduled backups are off; last backup ${h.lastSuccessAt}.`;
    else if (h.consecutiveFailures > 0) summary = `The last ${h.consecutiveFailures} attempt(s) failed: ${h.lastError ?? ''}`;
    else if (failingStale) summary = 'Scheduled backups are on but none has succeeded recently.';
    else summary = `Healthy — last backup ${h.lastSuccessAt}.`;
    return {
      ok,
      schedule_enabled: s.enabled,
      destination: this.destination(),
      ...(h.lastSuccessAt ? { last_success_at: h.lastSuccessAt } : {}),
      ...(h.lastSuccessPath ? { last_success_path: h.lastSuccessPath } : {}),
      ...(h.lastAttemptAt ? { last_attempt_at: h.lastAttemptAt } : {}),
      ...(h.lastError && h.consecutiveFailures > 0 ? { last_error: h.lastError } : {}),
      consecutive_failures: h.consecutiveFailures,
      ...(days !== undefined ? { days_since_success: days } : {}),
      ...(hours !== undefined ? { hours_since_success: hours } : {}),
      failing_stale: failingStale,
      summary,
    };
  }

  /**
   * Tell the admins when backups have stopped (yourphr#789), without anyone having to look — the
   * failure #783 was a month of no backups that only the Database page knew about.
   *
   *   - Schedule on, no success in stale-hours (stale-hours-weekly when weekly): an ERROR notice,
   *     which escalation emails.
   *   - No success in unscheduled-days, even with the schedule off: a WARNING notice.
   *
   * To every admin (an empty target would mean everyone). Once a day at most while a condition holds;
   * each notice expires after 25 hours, so a recovered instance stops showing it without anybody
   * clearing anything. With no success on record, time counts from when checking began.
   */
  async checkAlerts(): Promise<BackupAlert | undefined> {
    const now = this.now();
    const h = this.state;
    if (!h.lastSuccessAt && !h.watchingSince) {
      this.state = { ...h, watchingSince: now.toISOString() };
      this.saveHealth();
    }
    const from = this.state.lastSuccessAt ?? this.state.watchingSince!;
    const hours = (now.getTime() - Date.parse(from)) / HOUR_MS;
    const s = this.schedule();
    const last = this.state.lastSuccessAt ? `The last successful backup was ${this.state.lastSuccessAt}.` : 'No backup has succeeded on this instance yet.';
    let alert: Omit<BackupAlert, 'notificationId'> | undefined;
    const staleHours = this.staleAfterHours(s);
    const unscheduledDays = this.cfg.getInt('yourphr.backup.alert.unscheduled-days');
    if (s.enabled && hours > staleHours) {
      const failed = this.state.consecutiveFailures > 0 && this.state.lastError ? ` The last attempt failed: ${this.state.lastError}` : '';
      alert = { kind: 'stale', level: 'error', title: `No backup has succeeded in over ${staleHours} hours`, message: `Scheduled backups are on. ${last}${failed} See Admin -> Database.` };
    } else if (hours > unscheduledDays * 24) {
      alert = s.enabled
        ? { kind: 'unscheduled', level: 'warning', title: `No backup in over ${unscheduledDays} days`, message: `${last} See Admin -> Database.` }
        : { kind: 'unscheduled', level: 'warning', title: `No backup in over ${unscheduledDays} days`, message: `Scheduled backups are off. ${last} Turn them on in Admin -> Database, or dismiss this if this instance is backed up another way.` };
    }
    if (!alert) {
      if (this.state.alertedAt) {
        this.state = { ...this.state, alertedAt: undefined, alertKind: undefined };
        this.saveHealth();
      }
      return undefined;
    }
    const recent = this.state.alertedAt && this.state.alertKind === alert.kind && now.getTime() - Date.parse(this.state.alertedAt) < REALERT_MS;
    if (recent || !this.engine.has('notifications') || !this.engine.has('users')) return { ...alert, notificationId: '' };
    const system = ApiContext.system('backup alert: who holds admin', 'backups', this.engine);
    const admins = await this.engine.managers.users.holders(system, 'admin');
    const notificationId = await this.engine.managers.notifications.createNotification({
      type: 'system', level: alert.level, title: alert.title, message: alert.message, targetUsers: admins, expiresAt: new Date(now.getTime() + NOTICE_TTL_MS),
      link: '/admin/database', // where backups are fixed (yourphr#854)
    });
    this.state = { ...this.state, alertedAt: now.toISOString(), alertKind: alert.kind };
    this.saveHealth();
    return { ...alert, notificationId };
  }

  list(ctx: ApiContext): Promise<BackupArtifact[]> {
    this.manage(ctx);
    return this.provider.list(this.destination());
  }

  testDestination(ctx: ApiContext, destination: string): Promise<{ destination: string; writable: boolean; error?: string }> {
    this.manage(ctx);
    return this.provider.testDestination(destination.trim() || this.destination());
  }

  async browse(ctx: ApiContext, path: string): Promise<{ path: string; parent: string; dirs: string[] }> {
    this.manage(ctx);
    try {
      return await this.provider.browse(path);
    } catch (err) {
      throw new ApiError(400, (err as Error).message);
    }
  }

  /**
   * Stage a restore from a backup in the destination: the live databases are backed up FIRST so the
   * swap is reversible, then both halves are exported under the live keys into <data>/*.staged for
   * the next start (applyStagedRestore). The live files are never touched here.
   */
  async stageRestore(ctx: ApiContext, backupName: string): Promise<{ staged: boolean; message: string }> {
    this.manage(ctx);
    const file = await this.provider.resolve(this.destination(), backupName);
    if (!file) throw new ApiError(404, 'no such backup in the destination folder');
    await this.backupNow(ctx);
    const key = this.cfg.getString('yourphr.backup.encryption.key');
    await this.options.exporter.restore({ manager: 'backups', takenAt: this.now().toISOString(), files: [file] }, { key });
    // The settings, staged for the same restart (yourphr#631). A backup taken before they were
    // carried has none — said plainly, rather than restoring records and silently keeping settings.
    const config = (await this.options.exporter.readPayloads(file, { key }))['configuration'];
    if (config) writeFileSync(join(this.options.dataDir, STAGED_CONFIG), JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
    const settings = config
      ? 'Its settings come back too.'
      : 'This backup predates settings in backups, so the current settings are kept.';
    return {
      staged: true,
      message: `Restore staged (current databases backed up first). ${settings} Restart the app to apply it. A backup never includes <data>/.env: re-add any lines it held besides the encryption keys (for example the mail relay password) by hand.`,
    };
  }

  /** The coordinator keeps no data of its own; the health file is derived and rewritten by the next outcome. */
  async backup(): Promise<BackupData> {
    return { manager: this.name, takenAt: this.now().toISOString(), payload: this.state };
  }

  async restore(data: BackupData): Promise<void> {
    if (data.payload) { this.state = data.payload as HealthState; this.saveHealth(); }
  }
}
