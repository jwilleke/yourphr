/**
 * One run of the move from yourPHR into phr (yourphr#969): every user who
 * holds records in yourPHR's old store, every source, then the
 * record-for-record check. The scheduled job phr.migrate-yourphr calls this
 * with its own context; PhrManager's migration door decides `phr-migrate`.
 *
 * Owners are identity @ids, never usernames (ngdpbase identity model).
 * yourPHR keyed records by username; core's account import keeps the
 * username, and `identityOf` (core's IdentityManager.getByUserIdentifier,
 * with the job's context) gives the user's @id, looked up once per user per
 * run. A username with no account is reported and skipped, never written
 * under the username.
 */
import type { PhrCaller, PhrManager } from '../managers/PhrManager.js';
import type { YourphrSourceStore } from './YourphrSourceStore.js';
import { expectedRefs, filesFrom } from './yourphrSource.js';

export interface MoveReport {
  /** Users moved, by their old username: their identity @id, records written, and any the check found missing. */
  moved: { username: string; id: string; written: number; missing: string[] }[];
  /** Old usernames that have no account here: nothing moved for them. */
  noAccount: string[];
}

export async function moveAll(
  source: YourphrSourceStore,
  phr: PhrManager,
  job: PhrCaller,
  identityOf: (username: string) => Promise<string | null>
): Promise<MoveReport> {
  const report: MoveReport = { moved: [], noAccount: [] };
  for (const username of source.owners()) {
    const id = await identityOf(username);
    if (!id) {
      report.noAccount.push(username);
      continue;
    }
    const files = filesFrom(source.rowsOf(username));
    let written = 0;
    for (const { sourceId, file } of files) {
      const r = await phr.migrateFile(job, id, file, sourceId);
      written += r.created + r.updated;
    }
    report.moved.push({ username, id, written, missing: await phr.migratedMissing(job, id, expectedRefs(files)) });
  }
  return report;
}
