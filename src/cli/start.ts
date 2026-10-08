/**
 * `start` — the server (yourphr#587), and what an argument-less invocation does.
 *
 * The environment carries BOOTSTRAP and secrets only — where the data lives, which port, the
 * at-rest keys — and the settings store owns everything else, per the rule ratified on
 * yourphr#472. Every key here is named by envNameFor(), the same mapping the settings screen
 * shows, so an operator reading the screen knows which variable to set.
 *
 * Refuses to start rather than degrade. A missing data directory, an unwritable one, or a static
 * directory with no index.html is a configuration error; a process that boots "inert" in that
 * state is the failure yourphr#546 names, and it is worse than a crash because nobody notices.
 *
 * This module has no top-level side effects: it is imported only when `start` is the command, so
 * `migrate` never opens a listening socket and never runs these refusals against a data directory
 * it was not given.
 */
import { accessSync, constants, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { assembleApp } from '../app.js';
import { envNameFor } from '../config/index.js';
import { Engine } from '../framework/Engine.js';
import { ConfigurationManager } from '../framework/ConfigurationManager.js';
import { FileConfigProvider } from '../framework/providers/FileConfigProvider.js';
import { appLog } from '../log/index.js';
import { readVersion } from './version.js';
import { SESSION_SECRET_ENV, ensureInstanceEnvSecret, nodeInstanceEnvFs } from '../config/instance-env-backfill.js';
import { CREDENTIALS_KEY_ENV } from '../framework/providers/BaseCredentialsProvider.js';

/** How long a SIGTERM may spend closing the databases before the process exits anyway (yourphr#865). Under Kubernetes' 30s default grace. */
const SHUTDOWN_GRACE_MS = 20_000;

const EX_CONFIG = 78;

function refuse(message: string): never {
  console.error(`refusing to start: ${message}`);
  process.exit(EX_CONFIG);
}

/** Boots the server and returns once it is listening; the process then lives until a signal. */
export async function start(): Promise<void> {
  const env = process.env;

  // The fast storage root is a plain environment variable, not a configuration key: it is what
  // LOCATES the configuration, so it cannot be set inside it (yourphr#630). `./data` is the
  // default, which is what lets an unpacked copy run without an operator setting anything —
  // ngdpbase ships the same default. The pre-#630 name is still honoured so an existing
  // deployment keeps booting.
  const dataDir = env['YOURPHR_FAST_STORAGE'] ?? env['YOURPHR_STORAGE_DATA_DIR'] ?? './data';
  try {
    mkdirSync(dataDir, { recursive: true });
    accessSync(dataDir, constants.W_OK);
  } catch (err) {
    refuse(`${dataDir} is not a writable directory (${(err as Error).message})`);
  }

  // The session signing key (yourphr#815), guaranteed as ngdpbase guarantees NGDPBASE_SESSION_SECRET:
  // from the environment when set, else the instance .env, else generated once into that .env and
  // kept. A key made fresh at every start signed everyone out on every restart. Only the server
  // does this — `help`, `version` and the other commands never write a .env.
  try {
    const { secret, origin } = ensureInstanceEnvSecret({
      name: SESSION_SECRET_ENV,
      comment: 'Signs yourPHR session tokens (yourphr#815). Generated on first start; rotating it signs everyone out.',
      refusal: (envPath, cause) => new Error(`${SESSION_SECRET_ENV} is unset and could not be written to ${envPath}: ${cause.message}`),
    }, env, dataDir, nodeInstanceEnvFs);
    env[SESSION_SECRET_ENV] = secret;
    if (origin.kind === 'generated') appLog.warn(`${SESSION_SECRET_ENV} was not set — generated one into ${origin.path}; sessions now survive restarts`);
    // yourphr#876: the credentials store's signing key, guaranteed the same way (ngdpbase's
    // NGDPBASE_CREDENTIALS_KEY). Without it the store stays closed and passkeys stay off.
    const creds = ensureInstanceEnvSecret({
      name: CREDENTIALS_KEY_ENV,
      comment: 'Signs yourPHR passkey rows (yourphr#876). Generated on first start; back it up with the encryption keys.',
      refusal: (envPath, cause) => new Error(`${CREDENTIALS_KEY_ENV} is unset and could not be written to ${envPath}: ${cause.message}`),
    }, env, dataDir, nodeInstanceEnvFs);
    env[CREDENTIALS_KEY_ENV] = creds.secret;
    if (creds.origin.kind === 'generated') appLog.warn(`${CREDENTIALS_KEY_ENV} was not set — generated one into ${creds.origin.path}; record it with the encryption keys`);
  } catch (err) {
    refuse((err as Error).message);
  }

  const webDir = env[envNameFor('yourphr.web.static-dir')] ?? '';
  if (webDir !== '' && !existsSync(join(webDir, 'index.html'))) {
    refuse(`${envNameFor('yourphr.web.static-dir')}=${webDir} holds no index.html — the built Angular app is expected there`);
  }

  // Bootstrap values are read once here; assembleApp() builds its own manager over the same files
  // for everything else. Two reads of one file, one truth. Configuration is the bootstrap layer
  // (yourphr#621), so its provider is chosen here rather than by configuration.
  const bootstrap = new ConfigurationManager(new Engine(), new FileConfigProvider(dataDir), { env });
  const port = bootstrap.getInt('yourphr.web.listen.port');
  const host = bootstrap.getString('yourphr.web.listen.host');
  const intervalSeconds = bootstrap.getInt('yourphr.sync.interval-seconds');
  if (bootstrap.getString('yourphr.database.encryption.key') === '') {
    appLog.warn(`${envNameFor('yourphr.database.encryption.key')} is not set — the database and the tokens in it are stored in the clear`);
  } else if (existsSync(join(dataDir, '.env'))) {
    // The keys came from a file on the data volume, which is the arrangement yourphr#630 moves to
    // and the one that loses them if the volume is lost. There is no way to check whether the
    // operator recorded them elsewhere, so say it every start rather than assume: the failure is
    // silent until a restore, and by then it is not recoverable.
    appLog.warn(`the encryption keys are on this volume only (${join(dataDir, '.env')}) — if it is lost, the database and every backup become permanently unreadable. Record ${envNameFor('yourphr.database.encryption.key')} and ${envNameFor('yourphr.backup.encryption.key')} somewhere that is not this instance.`);
  }

  const version = readVersion();

  const app = await assembleApp(dataDir, {
    env,
    webDir: webDir === '' ? undefined : webDir,
    workerIntervalMs: intervalSeconds > 0 ? intervalSeconds * 1000 : undefined,
    version,
  });

  if (app.bootstrapPasswordFile) {
    appLog.info(`first start: bootstrap admin created; its password is in ${app.bootstrapPasswordFile} (mode 0600) — sign in once and change it`);
  }

  app.server.listen(port, host, () => {
    appLog.info(`yourphr ${version} listening on ${host}:${port}; data in ${dataDir}; ${webDir === '' ? 'API only' : `serving ${webDir}`}; worker ${intervalSeconds > 0 ? `every ${intervalSeconds}s` : 'off'}`);
  });

  // yourphr#865: AWAIT the close, as ngdpbase awaits engine.shutdown() — exiting at app.close()'s
  // first await left every database open, its WAL un-checkpointed, on every pod stop and rollout.
  // Bounded, so a close that hangs cannot hold the pod past Kubernetes' grace period (30s by
  // default); a second signal while closing is ignored rather than starting a second close.
  let closing = false;
  const shutdown = (signal: string): void => {
    if (closing) return;
    closing = true;
    appLog.info(`${signal}: closing`);
    const deadline = setTimeout(() => {
      appLog.error(`${signal}: the databases did not close within ${SHUTDOWN_GRACE_MS / 1000}s — exiting anyway`);
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    app.close().then(
      () => {
        clearTimeout(deadline);
        appLog.info(`${signal}: closed — every database closed cleanly`);
        process.exit(0);
      },
      (err: unknown) => {
        clearTimeout(deadline);
        appLog.error(`${signal}: close failed: ${(err as Error).message}`);
        process.exit(1);
      },
    );
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
