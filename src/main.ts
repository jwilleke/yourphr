/**
 * The entry point: one binary, several commands (yourphr#654).
 *
 * The image used to end `CMD ["node", "dist/server/main.js"]` and parse no arguments at all, so
 * `docker run … <image> migrate …` — which the upgrade guide has told self-hosters to run since it
 * was written — was not a command the image had. The migration itself was proven and shipped;
 * only a source checkout could reach it. Go had this right (`fasten start`, `fasten migrate`,
 * `fasten reset-password` are one binary), and this stack had regressed on it.
 *
 * `start` is the default, so an argument-less invocation and every existing deployment behave
 * exactly as before. Anything else must be a command this file knows: an unrecognised word exits
 * non-zero with the usage, and NEVER falls through to starting the server. A typo that quietly
 * boots an instance against the wrong data directory is the worst outcome available here, so the
 * only word that starts a server is one that asked for one.
 *
 * Each command is a dynamic import. A migration does not need the HTTP stack, the worker or the
 * static file server, and a boot does not need the Go database reader; loading only what was
 * asked for keeps a mistake in one path out of the other.
 */
// MUST be first: a side-effecting import that populates process.env from .env before any other
// module's top-level code runs (yourphr#630). Imports are hoisted, so ordering here is the
// mechanism, not a style choice.
import './bootstrap-env.js';
import { readVersion } from './cli/version.js';

const EX_USAGE = 2;

const USAGE = `yourphr — your medical records, immediately and in your hands.

usage: yourphr [command] [flags]

commands:
  start             run the server (the default when no command is given)
  migrate           import a Go (v1/v2) instance into this one, and verify it record for record
  reset-password    set a fresh password on an account when nobody can sign in
  compact           remove identical history copies and reclaim the space (server stopped)
  reindex           rebuild the search index from stored records (server stopped)
  version           print the version this build reports
  help              print this

Run a command with no flags for its own usage. Settings are not flags: bootstrap and secrets come
from the environment, everything else from Admin -> Configuration (yourphr#472).`;

async function run(command: string, argv: string[]): Promise<number | 'listening'> {
  switch (command) {
    case 'start': {
      if (argv.length > 0) {
        console.error(`start takes no flags (got ${argv.join(' ')}) — configuration comes from the environment and the settings store, not the command line`);
        return EX_USAGE;
      }
      const { start } = await import('./cli/start.js');
      await start();
      return 'listening';
    }
    case 'migrate': {
      const { migrate } = await import('./cli/migrate.js');
      return await migrate(argv);
    }
    case 'reset-password': {
      const { resetPassword } = await import('./cli/reset-password.js');
      return await resetPassword(argv);
    }
    case 'compact': {
      const { compact } = await import('./cli/compact.js');
      return await compact(argv);
    }
    case 'reindex': {
      const { reindex } = await import('./cli/reindex.js');
      return await reindex(argv);
    }
    case 'version':
    case '--version':
      console.log(readVersion());
      return 0;
    case 'help':
    case '--help':
    case '-h':
      console.log(USAGE);
      return 0;
    default:
      console.error(`unknown command: ${command}\n\n${USAGE}`);
      return EX_USAGE;
  }
}

const argv = process.argv.slice(2);
const command = argv[0] ?? 'start';

try {
  const code = await run(command, argv.slice(1));
  // `process.exitCode`, never `process.exit()`. A migration's last act is to print its verification
  // report, and when stdout is a PIPE — `docker run`, a CI step, anything reading the output —
  // that write is asynchronous. process.exit() tears the process down without draining it, so the
  // report an operator is told to read is exactly the thing that gets truncated. Setting the code
  // and letting the loop empty means the process exits when there is nothing left to say.
  //
  // 'listening' is not an exit code: the server is up and must stay alive until a signal.
  if (code !== 'listening') process.exitCode = code;
} catch (err) {
  console.error(`${command}: ${(err as Error).message}`);
  process.exitCode = 1;
}
