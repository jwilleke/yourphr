/**
 * The assembly (yourphr#582; the last Phase-4 item of yourphr#542): every proven module behind one
 * HTTP layer, one process, in the only order that works —
 *
 *   config -> migrations -> auth (+ bootstrap) -> catalog (+ seed) -> sources/worker -> server
 *
 * Config first because everything reads it; migrations before any store opens for business (their
 * ledger is the schema's truth); bootstrap after auth exists so an empty install gets its admin;
 * seeding after the catalog exists and never clobbering operator edits; the worker last, because
 * it must find everything else standing.
 *
 * Roles (yourphr#597): the admin gate reads `auth_users.role`. The bootstrap account is created
 * 'admin', imported Go accounts carry Go's role, and the migration below translates the earlier
 * "the account named admin is the admin" simplification (yourphr#582) into data for installs that
 * predate the column — so the bootstrap admin keeps working and nobody is silently demoted.
 *
 * openStores() is the first half of that order, factored out so the migration tool (yourphr#586)
 * opens EXACTLY the stores the server opens — same files, same key, same per-user repository seam.
 * A tool with its own idea of where the data lives is how a migration lands in the wrong place and
 * reports success.
 */
import { basename, join } from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';
import { FileConfigProvider } from './framework/providers/FileConfigProvider.js';
import { addColumnWithDefault, type Migration } from './framework/providers/sqlite-migrations.js';
import { AgentTokensManager } from './framework/managers/AgentTokensManager.js';
import { SqliteAgentTokensProvider } from './framework/providers/SqliteAgentTokensProvider.js';
import { DatabaseManager } from './framework/managers/DatabaseManager.js';
import { SqliteDatabaseProvider } from './framework/providers/SqliteDatabaseProvider.js';
import { UsersManager, BOOTSTRAP_ADMIN_USERNAME } from './framework/managers/UsersManager.js';
import { SessionsManager } from './framework/managers/SessionsManager.js';
import { SqliteUsersProvider } from './framework/providers/SqliteUsersProvider.js';
import { PasswordAuthProvider } from './framework/providers/PasswordAuthProvider.js';
import { CatalogManager, type CatalogWrite } from './app/managers/CatalogManager.js';
import { SqliteCatalogProvider } from './app/providers/SqliteCatalogProvider.js';
import { Engine } from './framework/Engine.js';
import { ConfigurationManager } from './framework/ConfigurationManager.js';
import { SettingsManager, coerceToShippedType } from './framework/managers/SettingsManager.js';
import { PolicyManager } from './framework/managers/PolicyManager.js';
export { coerceToShippedType };
import { ApiContext } from './framework/ApiContext.js';
import { RecordsManager } from './app/managers/RecordsManager.js';
import { SqliteRecordsProvider } from './app/providers/SqliteRecordsProvider.js';
import { SourcesManager, sourceShape } from './app/managers/SourcesManager.js';
import { JobsManager, backgroundJobShape } from './framework/managers/JobsManager.js';
import { SqliteSourcesProvider } from './app/providers/SqliteSourcesProvider.js';
import { SqliteJobsProvider } from './framework/providers/SqliteJobsProvider.js';
import { NullSourceClientProvider, type BaseSourceClientProvider } from './app/providers/BaseSourceClientProvider.js';
import { NullGlossaryProvider, type BaseGlossaryProvider } from './app/providers/BaseGlossaryProvider.js';
import { GlossaryManager } from './app/managers/GlossaryManager.js';
import { DemoManager } from './app/managers/DemoManager.js';
import { SqliteGlossaryCache } from './app/providers/SqliteGlossaryCache.js';
export { sourceShape, backgroundJobShape };
import { EventBus } from './events/index.js';
import { SqliteFavoritesProvider } from './app/providers/SqliteFavoritesProvider.js';
import { AuditManager } from './framework/managers/AuditManager.js';
import { SqliteAuditProvider } from './framework/providers/SqliteAuditProvider.js';
import { BackupManager, applyStagedRestore } from './framework/managers/BackupManager.js';
import { applyDemoReset } from './app/providers/demo-reset.js';
import { FilesystemBackupProvider } from './framework/providers/FilesystemBackupProvider.js';
import { NullBackupProvider, type BaseBackupProvider } from './framework/providers/BaseBackupProvider.js';
import { BACKUP_SUFFIX, STAGED_APP, STAGED_RECORDS } from './app/providers/sqlite-backup.js';
import { appLog, VALID_LEVELS } from './log/index.js';
import { refreshRedactedSecrets } from './log/redact.js';
import { createYourPhrServer, toResourceFhir } from './server.js';
import { SqliteFhirRepository } from './SqliteFhirRepository.js';
import { randomBytes } from 'node:crypto';

/**
 * The app-level registry. Module constructors keep their CREATE IF NOT EXISTS as idempotent
 * double-safety; the ledger is still written here so the downgrade refusal has something to stand
 * on from the first boot.
 */
const APP_MIGRATIONS: Migration[] = [
  {
    id: '20260820200000',
    description: 'assembly baseline — module schemas owned by their constructors, ledger established',
    up: () => undefined,
  },
  {
    id: '20260822090000',
    description: 'auth_users.role (yourphr#597) — the admin gate reads a column; the account named admin, which WAS the admin until now, is recorded as one',
    up: (db) => {
      // Frozen pre-role shape: on a fresh database the table does not exist yet (the constructor
      // would create it, with the column, a step later) — create it here so ADD COLUMN has a table.
      db.exec(`CREATE TABLE IF NOT EXISTS auth_users (
        username TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        token_generation INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`);
      const columns = (db.pragma('table_info(auth_users)') as { name: string }[]).map((c) => c.name);
      if (!columns.includes('role')) {
        addColumnWithDefault(db, 'auth_users', 'role', 'TEXT', 'user');
      }
      db.exec(`UPDATE auth_users SET role = 'admin' WHERE username = 'admin'`);
    },
  },
  {
    id: '20260822120000',
    description: 'connected_sources.platform_type + environment (yourphr#594) — what the Sources page names and groups by; unknown for rows that predate the columns',
    up: (db) => {
      // Frozen pre-column shape, so ADD COLUMN has a table on a fresh database (the constructor
      // creates it, with the columns, a step later).
      db.exec(`CREATE TABLE IF NOT EXISTS connected_sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        display TEXT NOT NULL,
        fhir_base_url TEXT NOT NULL,
        token_url TEXT NOT NULL,
        client_id TEXT NOT NULL,
        patient TEXT NOT NULL,
        resource_types TEXT NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL DEFAULT '',
        expires_at INTEGER NOT NULL DEFAULT 0,
        last_sync_at INTEGER NOT NULL DEFAULT 0
      )`);
      const columns = (db.pragma('table_info(connected_sources)') as { name: string }[]).map((c) => c.name);
      if (!columns.includes('platform_type')) addColumnWithDefault(db, 'connected_sources', 'platform_type', 'TEXT', '');
      if (!columns.includes('environment')) addColumnWithDefault(db, 'connected_sources', 'environment', 'TEXT', '');
    },
  },
  {
    id: '20260822150000',
    description: 'provider_catalog.platform_type + brand_logo_url + consent_policy + pre_connect_profile (yourphr#603) — what the admin page writes and the connection policy reads',
    up: (db) => {
      db.exec(`CREATE TABLE IF NOT EXISTS provider_catalog (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        display TEXT NOT NULL UNIQUE,
        environment TEXT NOT NULL,
        fhir_base_url TEXT NOT NULL,
        scopes TEXT NOT NULL,
        client_id TEXT NOT NULL DEFAULT '',
        client_secret TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 0,
        authorize_url_override TEXT NOT NULL DEFAULT ''
      )`);
      const columns = (db.pragma('table_info(provider_catalog)') as { name: string }[]).map((c) => c.name);
      for (const column of ['platform_type', 'brand_logo_url', 'consent_policy', 'pre_connect_profile']) {
        if (!columns.includes(column)) addColumnWithDefault(db, 'provider_catalog', column, 'TEXT', '');
      }
    },
  },
  {
    id: '20260828140000',
    description: 'agent_tokens (yourphr#695) — the credentials a patient mints for an agent to read their records with',
    up: (db) => {
      // Frozen shape, as the convention requires: the provider's constructor creates the current
      // table a step later, and this copy must keep describing what it did the day it ran.
      db.exec(`CREATE TABLE IF NOT EXISTS agent_tokens (
        id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        name TEXT NOT NULL,
        hash TEXT NOT NULL UNIQUE,
        prefix TEXT NOT NULL,
        scopes TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        last_used_at TEXT NOT NULL DEFAULT '',
        revoked_at TEXT NOT NULL DEFAULT '',
        revoked_by TEXT NOT NULL DEFAULT '',
        renewals INTEGER NOT NULL DEFAULT 0,
        renewed_from TEXT NOT NULL DEFAULT ''
      )`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_tokens_hash ON agent_tokens(hash)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_tokens_owner ON agent_tokens(owner, created_at DESC)`);
    },
  },
  {
    id: '20260922200000',
    description: 'connected_sources.capability (yourphr#756) — the distilled CapabilityStatement a server published, so a sync asks only for what that server serves',
    up: (db) => {
      // Frozen pre-column shape, so ADD COLUMN has a table on a fresh database (the provider's
      // constructor creates it, with the column, a step later).
      db.exec(`CREATE TABLE IF NOT EXISTS connected_sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        display TEXT NOT NULL,
        fhir_base_url TEXT NOT NULL,
        token_url TEXT NOT NULL,
        client_id TEXT NOT NULL,
        patient TEXT NOT NULL,
        resource_types TEXT NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL DEFAULT '',
        expires_at INTEGER NOT NULL DEFAULT 0,
        platform_type TEXT NOT NULL DEFAULT '',
        environment TEXT NOT NULL DEFAULT '',
        last_sync_at INTEGER NOT NULL DEFAULT 0
      )`);
      const columns = (db.pragma('table_info(connected_sources)') as { name: string }[]).map((c) => c.name);
      // '' means never read: an existing source reads its server's statement on its next sync
      // rather than at some migration-time fetch nobody asked for.
      if (!columns.includes('capability')) addColumnWithDefault(db, 'connected_sources', 'capability', 'TEXT', '');
    },
  },
  {
    id: '20260922210000',
    description: 'connected_sources.granted_scopes (yourphr#757) — what the server said it GRANTED, which can be narrower than what the catalog entry requested',
    up: (db) => {
      const columns = (db.pragma('table_info(connected_sources)') as { name: string }[]).map((c) => c.name);
      // '' means the server never stated one; the catalog entry's request then stands, as before.
      if (!columns.includes('granted_scopes')) addColumnWithDefault(db, 'connected_sources', 'granted_scopes', 'TEXT', '');
    },
  },
];

/** Everything that owns data, opened the one way the server opens it. */
export interface Stores {
  config: ConfigurationManager;
  /** The app database's handle — the composition root's and the harnesses'; never a route's. */
  db: InstanceType<typeof Database>;
  /** '' when the database is unencrypted. */
  dbKey: string;
  users: UsersManager;
  sessions: SessionsManager;
  /** The one door to the provider catalog (yourphr#613). */
  catalog: CatalogManager;
  /** The one door to connected sources and their sync (yourphr#612). */
  sources: SourcesManager;
  /** The one door to the job history (yourphr#612). */
  jobs: JobsManager;
  /** The per-member event stream the Sources page follows. */
  events: EventBus;
  /** The access log (yourphr#614) — required; refuses to boot unhealthy. */
  audit: AuditManager;
  /** Backups (yourphr#615): schedule, health, staged restore over optional storage. */
  backups: BackupManager;
  /** The composition root (yourphr#608): managers, in validated boot order. */
  engine: Engine;
  /** The one door to records (yourphr#609). */
  records: RecordsManager;
  /** The PHI-storage provider — for the migration tool's verification gate, which reads below the manager on purpose. */
  recordsProvider: SqliteRecordsProvider;
  close: () => Promise<void>;
}

/** The backup-storage provider configuration names: 'filesystem' or 'null' (inert, said so); anything else refuses to boot. */
function backupProviderFor(name: string): BaseBackupProvider {
  if (name === 'filesystem') return new FilesystemBackupProvider(BACKUP_SUFFIX);
  if (name === 'null') { appLog.warn('backup.storage.provider = null: no backup storage — every backup action will refuse'); return new NullBackupProvider(); }
  throw new Error(`backup.storage.provider: unknown provider '${name}' (filesystem or null)`);
}

/** The audit provider configuration names: only 'sqlite' exists; anything else is a refusal, never a silent Null. */
function auditProviderFor(name: string, db: InstanceType<typeof Database>): SqliteAuditProvider {
  if (name === 'sqlite') return new SqliteAuditProvider(db);
  throw new Error(`audit.provider: unknown provider '${name}' (sqlite) — refusing to boot with auditing off`);
}

/**
 * The glossary lookup (yourphr#640): 'medlineplus' loads the MedlinePlus client; 'null' loads
 * nothing and serves only what is already cached. Optional capability with an inert default —
 * a dynamic import, so an instance bound to 'null' never loads the URL-fetching path at all.
 */
async function glossaryProviderFor(name: string, env: Record<string, string | undefined>): Promise<BaseGlossaryProvider> {
  if (name === 'null') return new NullGlossaryProvider();
  if (name === 'medlineplus') {
    const { MedlinePlusGlossaryProvider } = await import('./app/providers/MedlinePlusGlossaryProvider.js');
    return new MedlinePlusGlossaryProvider({ allowInternal: env['SPIKE_TEST_ALLOW_INTERNAL'] === '1' });
  }
  throw new Error(`glossary.provider: unknown provider '${name}' (medlineplus or null)`);
}

/** The source-client provider configuration names: 'smart' loads the SMART client; 'null' loads nothing; anything else refuses to boot. */
async function sourceClientFor(name: string, env: Record<string, string | undefined>): Promise<BaseSourceClientProvider> {
  if (name === 'null') return new NullSourceClientProvider();
  if (name === 'smart') {
    const { SmartSourceClientProvider } = await import('./app/providers/SmartSourceClientProvider.js');
    return new SmartSourceClientProvider({ allowInternal: env['SPIKE_TEST_ALLOW_INTERNAL'] === '1' });
  }
  throw new Error(`sources.client.provider: unknown provider '${name}' (smart or null)`);
}

export async function openStores(dataDir: string, env: Record<string, string | undefined> = process.env): Promise<Stores> {
  // 1. Config — everything below reads it, so the engine and its first manager come first.
  // The configuration capability is the BOOTSTRAP LAYER (yourphr#621): the one capability NOT
  // selected by configuration, because it is what reads configuration. The composition root picks
  // its provider here, alongside the data directory and the database key.
  const engine = new Engine();
  const config = new ConfigurationManager(engine, new FileConfigProvider(dataDir), { env, log: (line) => appLog.info(line) });
  engine.register('configuration', config);
  // yourphr#473 — reported, not dropped; yourphr#625 — and with a did-you-mean where one fits.
  const unknown = config.unknownKeyReport();
  if (unknown.length > 0) {
    appLog.warn(`config: keys with no effect: ${unknown.join(', ')}`);
  }

  // Now that configuration resolves, teach the logger which values must never appear in a line
  // (yourphr#638). This has to happen HERE and not in src/log: that module imports nothing, which
  // is what keeps it importable by ConfigurationManager itself. Skips are reported rather than
  // silent — a secret key that contributes no redaction is a key whose secret is still loggable,
  // and 'too-short' additionally means the value is weak enough to corrupt unrelated output.
  {
    const { active, skipped } = refreshRedactedSecrets(config);
    appLog.info(`log redaction: ${active} secret value(s) will be struck from log lines`);
    for (const s of skipped) {
      if (s.reason === 'unset' || s.reason === 'empty') continue; // not set on this instance; nothing to leak
      appLog.warn(`log redaction: ${s.key} is not redacted (${s.reason}) — a value that reaches a log line will be readable`);
    }
  }

  // 2. The app database + migrations before anything opens for business.
  const dbKey = config.getString('yourphr.database.encryption.key');
  const engineRef = (): Engine => engine;
  // Where the two databases live is decided in the configuration files, composed from a storage
  // root, not computed here (yourphr#626). Both belong on the FAST root: these run in WAL mode,
  // which needs shared memory and is unsupported on a network filesystem. That is NOT enforced
  // here — checking the declared root would catch a mistake nobody makes while staying silent on
  // a data directory pointed straight at a NAS, which is the likely one. The real check stats the
  // resolved path's filesystem and is yourphr#628.
  const appDbPath = config.getString('yourphr.database.location');
  const recordsDbPath = config.getString('yourphr.records.location');
  applyStagedRestore(dataDir, [[STAGED_RECORDS, basename(recordsDbPath)], [STAGED_APP, basename(appDbPath)]], (line) => appLog.info(line)); // yourphr#602: a staged restore lands before anything opens
  // The demo reset (yourphr#645), after an operator's explicit restore and before anything opens:
  // an operator asking for a specific database must beat the demo's automatic one. Refuses unless
  // armed AND proven — see src/demo/reset.ts for what it proves and why it refuses.
  applyDemoReset({
    appDbPath,
    recordsDbPath,
    baselineDir: config.getString('yourphr.demo.baseline.dir'),
    demoEnabled: config.getBool('yourphr.demo.enabled'),
    resetOnRestart: config.getBool('yourphr.demo.reset-on-restart'),
    databaseKey: dbKey,
    // Every account a demo is allowed to hold: the shared patient account, the read-only admin tour
    // (yourphr#644 — omitted at first, which refused the reset on every demo that enables it), and
    // the bootstrap admin. Anything else and the reset refuses, which is the point.
    allowedAccounts: [
      config.getString('yourphr.demo.username'),
      config.getString('yourphr.demo.admin.username'),
      BOOTSTRAP_ADMIN_USERNAME,
    ],
    log: (line) => appLog.warn(line),
  });
  // The app database's one connection is the engine's (yourphr#617): opened and migrated by its
  // provider before any sibling provider is built over it; closed last at shutdown.
  const database = new DatabaseManager(engine, new SqliteDatabaseProvider(appDbPath, dbKey, APP_MIGRATIONS));
  const db = database.handle;

  // 4. Catalog and 5. sources + per-user repositories — the same seam the HTTP layer and worker share.
  // 3. Accounts and sessions as managers over providers (yourphr#611): user storage in the app
  // database, passwords by the scrypt provider, the factor list from configuration.
  const users = new UsersManager(engineRef(), new SqliteUsersProvider(db), new PasswordAuthProvider(), { log: (line) => appLog.info(line) });
  const sessions = new SessionsManager(engineRef(), [new PasswordAuthProvider()], {
    sessionKey: randomBytes(32),
    session: { slidingSeconds: config.getInt('yourphr.auth.session.sliding-seconds'), absoluteSeconds: config.getInt('yourphr.auth.session.absolute-seconds') },
    throttle: { maxFailures: config.getInt('yourphr.auth.throttle.max-failures'), windowSeconds: config.getInt('yourphr.auth.throttle.window-seconds') },
    trustedProxies: config.getStringList('yourphr.auth.trusted-proxies'),
    factors: config.getStringList('yourphr.auth.factors'),
  });
  // 6. The engine: managers in validated dependency order (yourphr#608). Configuration first,
  // then Records over the PHI-storage provider. The other stores join as their own children land.
  const recordsProvider = new SqliteRecordsProvider(recordsDbPath, dbKey === '' ? undefined : dbKey);
  engine.register('policy', new PolicyManager(engine, (line) => appLog.info(line))); // yourphr#623: roles and permissions from the merged configuration
  engine.register('settings', new SettingsManager(engine, { log: (line) => appLog.info(line), dataDir })); // yourphr#618, #619
  engine.register('database', database);
  // Audit (yourphr#614) is REQUIRED: a provider this stack does not have, or one that is not healthy, refuses the boot.
  engine.register('audit', new AuditManager(engine, auditProviderFor(config.getString('yourphr.audit.provider'), db)));
  engine.register('users', users);
  engine.register('sessions', sessions);
  // yourphr#695: after sessions, because an agent token is an alternative to one rather than a
  // replacement for it — the bearer path tries a session first and falls through to here.
  engine.register('agentTokens', new AgentTokensManager(engine, new SqliteAgentTokensProvider(db)));
  const recordsManager = new RecordsManager(engine, recordsProvider, new SqliteFavoritesProvider(db));
  engine.register('records', recordsManager);
  // Backups (yourphr#615): the coordinator over OPTIONAL storage; the records door is the exporter.
  engine.register('backups', new BackupManager(engine, backupProviderFor(config.getString('yourphr.backup.storage.provider')), { dataDir, exporter: recordsManager, alsoExport: [db] }));
  // 7. Jobs and Sources (yourphr#612): the source client is an OPTIONAL capability — bound by
  // configuration, loaded only when configured, inert (and said so) when not.
  const events = new EventBus();
  engine.register('jobs', new JobsManager(engine, new SqliteJobsProvider(db)));
  const sourceClient = await sourceClientFor(config.getString('yourphr.sources.client.provider'), env);
  const allowInternal = env['SPIKE_TEST_ALLOW_INTERNAL'] === '1';
  // Upload converters (yourphr#735): C-CDA through the fhir-converter sidecar. Its settings are
  // read per call, so an operator setting the address on Admin -> Configuration needs no restart.
  const { CdaSidecarConverterProvider, CDA_SETTING_KEYS } = await import('./app/providers/CdaSidecarConverterProvider.js');
  const cdaConverter = new CdaSidecarConverterProvider(() => ({
    enabled: config.getBool(CDA_SETTING_KEYS.enabled),
    url: config.getString(CDA_SETTING_KEYS.url),
    timeoutSeconds: config.getInt(CDA_SETTING_KEYS.timeoutSeconds),
  }));
  engine.register('sources', new SourcesManager(engine, new SqliteSourcesProvider(db), sourceClient, {
    maxPages: config.getInt('yourphr.sync.max-pages'),
    events,
    log: (line) => appLog.info(line),
    converters: [cdaConverter],
    allowInternal,
  }));
  // 8. Catalog (yourphr#613): what the instance can connect to; connects through Sources and the same client.
  // The SMART OAuth relay (yourphr#700): derives redirect_uri and polls the authorization code
  // home, so provider connect completes without this instance being publicly reachable.
  const { RelayProvider } = await import('./app/providers/RelayProvider.js');
  const { OutboundHttp } = await import('./http/index.js');
  const relay = new RelayProvider(engine, new OutboundHttp({ allowInternal }));
  engine.register('catalog', new CatalogManager(engine, new SqliteCatalogProvider(db), sourceClient, { allowInternal, log: (line) => appLog.warn(line), relay }));
  // The glossary (yourphr#640): plain-language explanations of coded values, cached locally.
  engine.register('glossary', new GlossaryManager(engine, await glossaryProviderFor(config.getString('yourphr.glossary.provider'), env), new SqliteGlossaryCache(db), (line) => appLog.info(line)));
  // Demo mode (yourphr#643): inert unless this instance opted in. Registered always, so the
  // connect guard is a manager call rather than an `if` at every door that could forget one.
  engine.register('demo', new DemoManager(engine, (line) => appLog.info(line)));
  await engine.initialize();
  appLog.info(`engine: ${engine.registered.join(' -> ')}`);
  const { records, sources, jobs, catalog, audit, backups } = engine.managers;
  // The Records manager names a source for the records that carry its id — asked of the Sources door.
  records.sourceDisplay = (sourceId) => sources.displayOf(sourceId);

  return {
    config, db, dbKey, users, sessions, catalog, sources, jobs, events, audit, backups, engine, records, recordsProvider,
    close: async () => {
      await engine.shutdown(); // the database manager closes the connection, last
    },
  };
}

export interface App {
  server: ReturnType<typeof createYourPhrServer>;
  engine: Engine;
  config: ConfigurationManager;
  users: UsersManager;
  sessions: SessionsManager;
  catalog: CatalogManager;
  sources: SourcesManager;
  jobs: JobsManager;
  audit: AuditManager;
  backups: BackupManager;
  bootstrapPasswordFile?: string;
  syncNow: (now?: number) => Promise<unknown>;
  backupNow: () => Promise<unknown>;
  close: () => Promise<void>;
}

export async function assembleApp(dataDir: string, options: { seeds?: CatalogWrite[]; env?: Record<string, string | undefined>; workerIntervalMs?: number; webDir?: string; version?: string } = {}): Promise<App> {
  const stores = await openStores(dataDir, options.env ?? process.env);
  const { config, users, sessions, catalog, sources, audit, backups, engine, records, events } = stores;
  /** The worker and the migration tool act for an account as a named system principal. */
  const systemCtx = (name: string, username: string): ApiContext => ApiContext.system(name, username, engine);

  // Bootstrap the first admin on an empty install — after the managers exist, before anything serves.
  const bootstrap = await users.bootstrapAdmin(dataDir);

  // The demo credential (yourphr#643): generated here, so a public demo's one-click entrance works
  // on a fresh instance with nobody choosing a password. Idempotent, and does nothing at all when
  // demo mode is off. Never fatal — a demo with no way in is a log line, not a refused startup.
  await engine.managers.demo.provision();

  // Provision-then-preserve.
  if (options.seeds) {
    await catalog.seed(options.seeds);
  }

  // The worker: the Sources manager's pass, on the configured interval.
  const timer = options.workerIntervalMs
    ? setInterval(() => { void sources.pass(); }, options.workerIntervalMs)
    : undefined;
  timer?.unref?.();

  const scheduler = ApiContext.system('scheduler', 'scheduler', engine);
  const backupNow = () => backups.backupNow(scheduler);
  // The scheduler (yourphr#602): once a minute, is a backup due? Outcome recorded by backupNow.
  let lastScheduledMinute: string | undefined;
  const scheduleTimer = options.workerIntervalMs === undefined ? undefined : setInterval(() => {
    const now = new Date();
    if (!backups.due(now, lastScheduledMinute)) return;
    lastScheduledMinute = now.toISOString().slice(0, 16);
    backupNow().then(
      (r) => appLog.info(`scheduled backup written: ${r.file} (${r.sizeBytes} bytes)`),
      (err: Error) => appLog.error(`scheduled backup failed: ${err.message}`)
    );
  }, 60_000);
  scheduleTimer?.unref?.();

  const server = createYourPhrServer({
    engine,
    auth: { cookieMaxAgeSeconds: config.getInt('yourphr.auth.session.absolute-seconds'), secureCookies: config.getBool('yourphr.web.secure-cookies') },
    webDir: options.webDir,
    version: options.version,
  });

  return {
    server,
    engine,
    config,
    users,
    sessions,
    catalog,
    sources,
    jobs: stores.jobs,
    audit,
    backups,
    bootstrapPasswordFile: bootstrap.passwordFile,
    syncNow: (now?: number) => sources.pass(now),
    backupNow,
    close: async () => {
      if (timer) clearInterval(timer);
      if (scheduleTimer) clearInterval(scheduleTimer);
      server.close();
      await stores.close();
    },
  };
}
