/**
 * Sync from a REAL FHIR server, through the guarded stack (yourphr#539).
 *
 * Everything before this ran against a fake on loopback. A fake answers exactly what it was written
 * to answer, so it cannot disagree with the code in the way a real server does — real servers page
 * differently, return resources the fixtures never imagined, and reject requests for reasons nobody
 * anticipated. This closes that gap for the FETCH-AND-STORE half of the sync gate.
 *
 * What this does NOT prove: the OAuth half. The SMART Health IT sandbox serves open FHIR with no
 * authorization, so no token is issued and none is refreshed. That still needs a registered client
 * and a browser redirect.
 *
 * Public synthetic data only — no PHI, and nothing here writes to phi/.
 *
 *   npm run live
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteFhirRepository } from '../src/SqliteFhirRepository.js';
import { syncFrom } from '../src/sources/index.js';

const BASE = process.argv.includes('--base')
  ? (process.argv[process.argv.indexOf('--base') + 1] as string)
  : 'https://launch.smarthealthit.org/v/r4/fhir';

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'spike-live-'));
  const repo = new SqliteFhirRepository({ file: join(dir, 'live.db'), userId: 'live-user' });

  console.log(`\nsyncing from ${BASE}\n`);

  // Paging first, against a server with far more data than the cap allows. Hitting the cap is the
  // expected outcome and proves the guard fires on a real provider, not just a fixture.
  // Since yourphr#759 the cap TRUNCATES rather than throwing: the pages already stored are real
  // records, and a provider with more history than the budget is not an error.
  const capped = await syncFrom(`${BASE}/Patient?_count=10`, {
    repo,
    accessToken: '',
    sourceId: 'smarthealthit',
    maxPages: 2,
  });
  check('follows real next links and stops at the page cap, keeping what it fetched',
    capped.truncated === true && capped.pages === 2, `${capped.pages} pages, truncated=${capped.truncated}`);

  const seeded = await repo.search({ resourceType: 'Patient', count: 100, total: 'accurate' });
  check('records from the capped run were stored, not discarded', (seeded.total ?? 0) > 0, `${seeded.total} Patients`);

  // Now a naturally bounded sync — one patient's conditions, which is the shape a real import takes.
  const anyPatient = (seeded.entry ?? [])[0]?.resource as { id?: string } | undefined;
  if (!anyPatient?.id) {
    throw new Error('no patient stored, cannot scope the bounded sync');
  }

  const first = await syncFrom(`${BASE}/Condition?patient=${anyPatient.id}&_count=50`, {
    repo,
    accessToken: '',
    sourceId: 'smarthealthit',
  });
  check('a scoped sync completes without hitting the cap', first.pages >= 1, `${first.pages} page(s)`);
  check('it stored what came back', first.received > 0, `${first.received} received, ${first.created} created`);
  check('nothing was skipped for want of an id', first.skipped.length === 0, JSON.stringify(first.skipped.slice(0, 2)));

  const stored = await repo.search({ resourceType: 'Condition', count: 500, total: 'accurate' });
  check('the records are searchable after storing', (stored.total ?? 0) > 0, `${stored.total} Conditions`);

  // The property that matters most, now against a server nobody wrote to agree with us.
  const second = await syncFrom(`${BASE}/Condition?patient=${anyPatient.id}&_count=50`, {
    repo,
    accessToken: '',
    sourceId: 'smarthealthit',
  });
  const after = await repo.search({ resourceType: 'Condition', count: 500, total: 'accurate' });

  check('a resync against a real server creates nothing new', second.created === 0, `${second.created} created`);
  check('and the record count is unchanged', after.total === stored.total, `${after.total} vs ${stored.total}`);
  check('no collisions from a single source', second.collisions.length === 0);

  repo.db.close();
  rmSync(dir, { recursive: true, force: true });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error(`\nlive sandbox unavailable or refused: ${(err as Error).message}`);
  console.error('This harness talks to a third-party server, so a failure here is not necessarily a defect.');
  process.exit(1);
});
