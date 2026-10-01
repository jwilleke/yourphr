/**
 * `reindex` — rebuild the search index from stored records (yourphr#713).
 *
 *   yourphr reindex [--data <data dir>] [--user <username>]
 *
 * The admin's Database card is the ordinary way: it rebuilds on a running server, under maintenance
 * mode. This is the escape hatch for an instance whose server will not come up, or an operator who
 * would rather stop it. A fix to how records are indexed (SEARCH_INDEX_VERSION) is correct for new
 * writes and silently wrong for everything already stored until one of the two runs.
 *
 * STOP THE SERVER FIRST: this command cannot put a running server into maintenance mode, and a sync
 * pass writing while an account is being rebuilt would wait on, or be refused by, the rebuild's lock.
 *
 * --user  rebuild one account only. The store is marked current only by a rebuild of everyone, so
 *         the boot warning stays until a full run.
 *
 * Like `compact`, deliberately not a route: the authority is being able to run a process against
 * the data directory.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { openStores } from '../app.js';
import { flag, unknownFlags } from './args.js';

const VALUED = ['--data', '--user'] as const;

export const REINDEX_USAGE = 'usage: yourphr reindex [--data <data dir>] [--user <username>]   (stop the server first)';

const EX_USAGE = 2;

export async function reindex(argv: string[]): Promise<number> {
  const unknown = unknownFlags(argv, VALUED, []);
  if (unknown.length > 0) {
    console.error(`reindex: unknown ${unknown.length === 1 ? 'flag' : 'flags'} ${unknown.join(' ')}\n${REINDEX_USAGE}`);
    return EX_USAGE;
  }
  const user = flag(argv, '--user');
  if (argv.includes('--user') && (user === undefined || user.startsWith('--') || user === '')) {
    console.error(`reindex: --user needs a username\n${REINDEX_USAGE}`);
    return EX_USAGE;
  }

  // The same default and fallback the server resolves; only an instance that already exists.
  const dataDir = resolve(flag(argv, '--data') ?? process.env['YOURPHR_FAST_STORAGE'] ?? process.env['YOURPHR_STORAGE_DATA_DIR'] ?? './data');
  if (!existsSync(dataDir)) {
    console.error(`reindex: ${dataDir} does not exist — name the instance's data directory with --data`);
    return EX_USAGE;
  }

  console.log(`reindex: rebuilding the search index in ${dataDir}${user !== undefined ? ` for ${user}` : ''} — the server must be stopped`);
  const stores = await openStores(dataDir, process.env);
  try {
    const started = Date.now();
    const done = await stores.records.rebuildSearchIndexOffline({
      ...(user !== undefined ? { userId: user } : {}),
      onProgress: (accountsDone, accounts) => { if (accountsDone > 0) console.log(`  account ${accountsDone} of ${accounts}`); },
    });
    const status = stores.records.searchIndexStatus();
    console.log(`  records reindexed:  ${done.records} across ${done.accounts} account(s) in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    console.log(`  index version:      ${status.builtWith} (this build: ${status.current})${status.stale ? ' — still stale: rebuild every account to clear it' : ''}`);
    return 0;
  } finally {
    await stores.close();
  }
}
