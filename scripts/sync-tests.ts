/**
 * Does a resync duplicate? (yourphr#539, gate 5)
 *
 * The failure this exists to rule out is a record list that doubles every time somebody presses
 * refresh — worse than one that fails, because it looks like it worked.
 *
 * Driven by a fake FHIR server on loopback and a temporary SQLite file: no network, no credentials,
 * no patient data, so it runs in CI.
 *
 *   npm run sync
 */
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Bundle } from '@medplum/fhirtypes';
import { SqliteFhirRepository } from '../src/SqliteFhirRepository.js';
import { repositoryWriter } from '../src/sync/index.js';
import { FhirHttpError, syncFrom, nextPageUrl } from '../src/sources/index.js';
import { SmartSourceClientProvider } from '../src/app/providers/SmartSourceClientProvider.js';
import type { ConnectedSource } from '../src/app/providers/BaseSourcesProvider.js';
import { narrowTypes, readCapability } from '../src/sources/index.js';

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function condition(id: string, text: string) {
  return {
    resourceType: 'Condition' as const,
    id,
    subject: { reference: 'Patient/p1' },
    code: { text },
    recordedDate: '2026-01-01',
  };
}

/** Serves two pages of Conditions, linked by `next`, plus a Patient. */
function startFhirServer(pageTwoText = 'Asthma') {
  let requests = 0;
  const server = createServer((req, res: ServerResponse) => {
    requests++;
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const send = (bundle: Bundle) => {
      res.writeHead(200, { 'content-type': 'application/fhir+json' });
      res.end(JSON.stringify(bundle));
    };

    if (req.url?.startsWith('/Everything?page=2')) {
      send({
        resourceType: 'Bundle',
        type: 'searchset',
        entry: [{ resource: condition('c3', pageTwoText) }, { resource: { resourceType: 'Patient', id: 'p1' } }],
      });
      return;
    }
    if (req.url?.startsWith('/Everything')) {
      send({
        resourceType: 'Bundle',
        type: 'searchset',
        link: [{ relation: 'next', url: `${base}/Everything?page=2` }],
        entry: [{ resource: condition('c1', 'Hypertension') }, { resource: condition('c2', 'Diabetes') }],
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return { server, requestCount: () => requests };
}

function listen(server: ReturnType<typeof startFhirServer>['server']): Promise<string> {
  return new Promise((done) =>
    server.listen(0, '127.0.0.1', () => done(`http://127.0.0.1:${(server.address() as AddressInfo).port}`))
  );
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'spike-sync-'));
  const dbFile = join(dir, 'sync.db');
  const repo = new SqliteFhirRepository({ file: dbFile, userId: 'user-a' });

  console.log('\nnext-link handling\n');
  const sameOrigin: Bundle = {
    resourceType: 'Bundle',
    type: 'searchset',
    link: [{ relation: 'next', url: 'https://fhir.example.com/Everything?page=2' }],
  };
  check(
    'follows a next link on the same origin',
    nextPageUrl(sameOrigin, 'https://fhir.example.com/Everything') === 'https://fhir.example.com/Everything?page=2'
  );
  check('returns nothing when there is no next link', nextPageUrl({ resourceType: 'Bundle', type: 'searchset' }, 'https://fhir.example.com/x') === undefined);

  // A provider paging the client onto another host would be handed the Authorization header.
  const offOrigin: Bundle = {
    resourceType: 'Bundle',
    type: 'searchset',
    link: [{ relation: 'next', url: 'https://evil.example.net/steal' }],
  };
  let leftOrigin = '';
  try {
    nextPageUrl(offOrigin, 'https://fhir.example.com/Everything');
  } catch (err) {
    leftOrigin = (err as Error).message;
  }
  check('refuses a next link that leaves the origin', leftOrigin.includes('leaves the origin'), leftOrigin);

  const relative: Bundle = {
    resourceType: 'Bundle',
    type: 'searchset',
    link: [{ relation: 'next', url: '/Everything?page=2' }],
  };
  check(
    'resolves a relative next link against the current page',
    nextPageUrl(relative, 'https://fhir.example.com/Everything') === 'https://fhir.example.com/Everything?page=2'
  );

  console.log('\nfirst sync\n');
  const provider = startFhirServer();
  const base = await listen(provider.server);

  const first = await syncFrom(`${base}/Everything`, { repo, accessToken: 'at-1', allowInternal: true });
  check('follows the next link across pages', first.pages === 2, `${first.pages} pages`);
  check('receives every resource', first.received === 4, `${first.received}`);
  check('creates all four on a first run', first.created === 4 && first.updated === 0, `${first.created} created, ${first.updated} updated`);

  const afterFirst = await repo.search({ resourceType: 'Condition', count: 100, total: 'accurate' });
  check('three Conditions stored', afterFirst.total === 3, `${afterFirst.total}`);

  console.log('\nresync — the gate\n');
  const second = await syncFrom(`${base}/Everything`, { repo, accessToken: 'at-1', allowInternal: true });
  check('a resync creates nothing new', second.created === 0, `${second.created} created`);
  check('a resync updates what it already had', second.updated === 4, `${second.updated} updated`);

  const afterSecond = await repo.search({ resourceType: 'Condition', count: 100, total: 'accurate' });
  check('the record count is unchanged after a resync', afterSecond.total === 3, `${afterSecond.total} (was ${afterFirst.total})`);

  const third = await syncFrom(`${base}/Everything`, { repo, accessToken: 'at-1', allowInternal: true });
  const afterThird = await repo.search({ resourceType: 'Condition', count: 100, total: 'accurate' });
  check('and after a third', afterThird.total === 3, `${afterThird.total}`);
  check('a third sync still creates nothing', third.created === 0);

  console.log('\nchanged records update rather than duplicate\n');
  provider.server.close();
  const revised = startFhirServer('Asthma, resolved');
  const revisedBase = await listen(revised.server);
  await syncFrom(`${revisedBase}/Everything`, { repo, accessToken: 'at-1', allowInternal: true });

  const c3 = (await repo.readResource('Condition', 'c3')) as { code?: { text?: string } };
  check('the updated text replaced the old one', c3.code?.text === 'Asthma, resolved', c3.code?.text ?? 'missing');
  const afterUpdate = await repo.search({ resourceType: 'Condition', count: 100, total: 'accurate' });
  check('a changed record did not add a row', afterUpdate.total === 3, `${afterUpdate.total}`);
  revised.server.close();

  console.log('\nrecords that cannot be synced safely\n');
  const idless = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/fhir+json' });
    res.end(
      JSON.stringify({
        resourceType: 'Bundle',
        type: 'searchset',
        entry: [{ resource: { resourceType: 'Condition', code: { text: 'no id' } } }, { resource: null }],
      })
    );
  });
  const idlessBase = await listen(idless as never);
  const idlessReport = await syncFrom(`${idlessBase}/Everything`, { repo, accessToken: 'at-1', allowInternal: true });
  check('a resource with no id is skipped, not stored', idlessReport.created === 0, `${idlessReport.created} created`);
  check('and the skip is reported rather than silent', idlessReport.skipped.length === 2, `${idlessReport.skipped.length} skipped`);
  idless.close();

  console.log('\ntwo providers, one resource id\n');

  // The store keys on (resource_type, id, user_id) — there is no source in the key, and there
  // should not be: FHIR identity is (resourceType, id), Medplum's FhirRepository.readResource takes
  // no source, and references like "Patient/p1" resolve by that pair. Forking that contract would
  // fork the whole spike.
  //
  // But two providers CAN issue the same id to one person — the earlier shadow run measured 0
  // collisions across 8 real sources, which is a property of one person's data, not a guarantee.
  // Overwriting is the worst available answer: the record does not double, it DISAPPEARS, and the
  // row count never changes so nothing looks wrong. Writes are therefore attributed to a source and
  // a contested id is refused and reported.
  const providerA = startFhirServer();
  const aBase = await listen(providerA.server);
  const firstRun = await syncFrom(`${aBase}/Everything`, {
    repo,
    accessToken: 'at-a',
    allowInternal: true,
    sourceId: 'epic',
  });
  check('a first source stores normally', firstRun.collisions.length === 0);
  providerA.server.close();

  const collide = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/fhir+json' });
    res.end(
      JSON.stringify({
        resourceType: 'Bundle',
        type: 'searchset',
        entry: [
          { resource: { resourceType: 'Condition', id: 'c1', code: { text: 'A DIFFERENT PROVIDER' } } },
          { resource: { resourceType: 'Condition', id: 'zz9', code: { text: 'Uncontested' } } },
        ],
      })
    );
  });
  const collideBase = await listen(collide as never);
  const crossSource = await syncFrom(`${collideBase}/Everything`, {
    repo,
    accessToken: 'at-b',
    allowInternal: true,
    sourceId: 'cerner',
  });
  collide.close();

  check('the colliding record is refused', crossSource.collisions.length === 1, JSON.stringify(crossSource.collisions[0]?.resource));
  check('the refusal names both sources',
    (crossSource.collisions[0]?.detail ?? '').includes('epic') && (crossSource.collisions[0]?.detail ?? '').includes('cerner'),
    crossSource.collisions[0]?.detail ?? 'no detail');

  const c1 = (await repo.readResource('Condition', 'c1')) as { code?: { text?: string } };
  check('the first provider\'s record survives untouched', c1.code?.text === 'Hypertension', c1.code?.text ?? 'missing');

  // One contested id must not cost the patient the rest of the sync.
  check('uncontested records from the second source still store', crossSource.created === 1, `${crossSource.created} created`);
  const zz9 = (await repo.readResource('Condition', 'zz9')) as { code?: { text?: string } };
  check('and are readable', zz9.code?.text === 'Uncontested');

  // Attribution must not leak past the run that set it.
  check('the source is not left attributed after a sync', repo.sourceId === undefined, String(repo.sourceId));

  // --- an Epic-shaped server (yourphr#753) ---
  // Epic refuses `Patient?patient=` (Patient has no such search parameter) and an Observation
  // search without a category. The client must READ the patient by id, and a per-type refusal must
  // surface as a FhirHttpError carrying its status, so the manager can skip that type alone.
  const epicSeen: string[] = [];
  const epic = createServer((req, res) => {
    epicSeen.push(req.url ?? '');
    const json = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/fhir+json' }); res.end(JSON.stringify(body)); };
    // Shaped as Epic's own refusals are (captured live 2026-09-22): a missing REQUIRED parameter is
    // `severity: fatal, code: required` — which is the signal yourphr#754 keys on — while an
    // otherwise-bad request is `code: invalid`, which must NOT trigger a category retry.
    const outcome = (text: string, code = 'invalid', severity = 'error') => ({ resourceType: 'OperationOutcome', issue: [{ severity, code, diagnostics: text }] });
    const url = req.url ?? '';
    if (url === '/metadata') return json(200, {
      resourceType: 'CapabilityStatement', fhirVersion: '4.0.1',
      rest: [{ mode: 'server', resource: [
        { type: 'Patient', searchParam: [{ name: '_id' }, { name: 'identifier' }] },
        { type: 'Observation', searchParam: [{ name: 'patient' }, { name: 'category' }, { name: 'code' }] },
        { type: 'Condition', searchParam: [{ name: 'patient' }, { name: 'category' }] },
        { type: 'Binary', searchParam: [{ name: '_id' }] },
      ] }],
    });
    if (url.startsWith('/Patient?')) return json(400, outcome('patient is not a valid search parameter for Patient'));
    if (url === '/Patient/epic-pt%2B1') return json(200, { resourceType: 'Patient', id: 'epic-pt+1', name: [{ family: 'Lin' }] });
    if (url.startsWith('/Condition?patient=epic-pt%2B1&')) return json(200, { resourceType: 'Bundle', type: 'searchset', entry: [{ resource: { ...condition('epic-c1', 'Asthma'), subject: { reference: 'Patient/epic-pt+1' } } }] });
    if (url.startsWith('/Observation?')) {
      const category = new URL(url, 'http://x').searchParams.get('category');
      // Epic's rule (yourphr#754): no category, no answer. With one, it serves that slice only.
      if (!category) return json(400, outcome('This resource requires a category for searching', 'required', 'fatal'));
      if (category === 'laboratory') return json(200, { resourceType: 'Bundle', type: 'searchset', entry: [{ resource: { resourceType: 'Observation', id: 'epic-lab-1', status: 'final', code: { text: 'Haemoglobin' } } }] });
      if (category === 'vital-signs') return json(200, { resourceType: 'Bundle', type: 'searchset', entry: [{ resource: { resourceType: 'Observation', id: 'epic-vital-1', status: 'final', code: { text: 'Blood pressure' } } }] });
      if (category === 'social-history') return json(403, outcome('not granted'));
      return json(200, { resourceType: 'Bundle', type: 'searchset' });
    }
    json(404, outcome('not found'));
  });
  await new Promise<void>((resolve) => epic.listen(0, '127.0.0.1', resolve));
  const epicBase = `http://127.0.0.1:${(epic.address() as AddressInfo).port}`;
  const epicClient = new SmartSourceClientProvider({ allowInternal: true });
  const epicSource = { id: 9, userId: 'default', display: 'Epic sandbox', fhirBaseUrl: epicBase, tokenUrl: '', clientId: 'cid', patient: 'epic-pt+1', resourceTypes: ['Patient', 'Condition', 'Observation'], accessToken: 'tok', refreshToken: '', expiresAt: 0, lastSyncAt: 0, platformType: 'ehr', environment: 'sandbox' } as unknown as ConnectedSource;
  const epicWriter = repositoryWriter(repo, 'source-9');

  const epicPatient = await epicClient.fetchPages(epicSource, 'Patient', 'tok', epicWriter, 5);
  check('Epic: the patient is READ by id, never searched with ?patient=', epicPatient.created === 1 && epicSeen.includes('/Patient/epic-pt%2B1') && !epicSeen.some((u) => u.startsWith('/Patient?')), epicSeen.join(' '));
  const epicConditions = await epicClient.fetchPages(epicSource, 'Condition', 'tok', epicWriter, 5);
  check('Epic: the patient id is URL-encoded in a search', epicConditions.created === 1 && epicSeen.some((u) => u.startsWith('/Condition?patient=epic-pt%2B1&')));
  // yourphr#754: the plain search is refused, so the client asks once per US Core category. Labs and
  // vitals arrive; the refused category costs only itself; the type reports once, not nine times.
  const epicObs = await epicClient.fetchPages(epicSource, 'Observation', 'tok', epicWriter, 5);
  const asked = epicSeen.filter((u) => u.startsWith('/Observation?'));
  check('Epic: a refused Observation search is re-asked by category, and labs and vitals arrive',
    epicObs.created === 2 && asked.some((u) => u.includes('category=laboratory')) && asked.some((u) => u.includes('category=vital-signs')),
    `${epicObs.created} created from ${asked.length} searches`);
  check('Epic: the plain search is tried FIRST — a required combination is what a server supports, not what it demands',
    asked[0] === '/Observation?patient=epic-pt%2B1&_count=100', asked[0] ?? 'none');
  check('Epic: one refused category costs only itself, and the fetch says what it did',
    (epicObs.detail ?? '').includes('8 of 9 answered') && (epicObs.detail ?? '').includes('social-history'), epicObs.detail ?? 'no detail');

  // A type nobody has category codes for keeps its refusal: there is nothing better to try.
  let noPlan: unknown;
  try { await epicClient.fetchPages(epicSource, 'CarePlan', 'tok', epicWriter, 5); } catch (err) { noPlan = err; }
  check('a refusal with no category list to fall back on is still a FhirHttpError carrying its status',
    noPlan instanceof FhirHttpError && noPlan.status === 404, String(noPlan));
  // yourphr#756: the statement is read over HTTP and distilled — types, their search parameters,
  // and whether Patient/$everything is advertised.
  const { capability, reason } = await readCapability(epicBase, 'tok', { allowInternal: true, nowSeconds: 1_700_000_000 });
  check('a CapabilityStatement is read and distilled to what a sync needs',
    !!capability && capability.fhirVersion === '4.0.1' && capability.everything === false && Object.keys(capability.types).length === 4, reason || JSON.stringify(capability?.types));
  check('it narrows a type list to what the server serves AND can search by patient',
    JSON.stringify(narrowTypes(capability!, ['Patient', 'Observation', 'Condition', 'Binary', 'MedicationStatement'])) ===
      JSON.stringify({ keep: ['Patient', 'Observation', 'Condition'], dropped: [{ type: 'Binary', reason: 'the server serves it but not by patient' }, { type: 'MedicationStatement', reason: 'the server does not serve it' }] }));

  const notThere = await readCapability(`${epicBase}/nowhere`, 'tok', { allowInternal: true });
  check('a statement that cannot be read is a reason, never a throw', notThere.capability === undefined && notThere.reason !== '', notThere.reason);
  epic.close();

  // --- transient failures and the page budget (yourphr#759) ---
  let flakeHits = 0;
  const flaky = createServer((req, res) => {
    flakeHits++;
    // 502 once, then the real answer: a gateway blip must not cost the type its whole cycle.
    if (flakeHits === 1) { res.writeHead(502, { 'content-type': 'text/html' }); res.end('<html>bad gateway</html>'); return; }
    res.writeHead(200, { 'content-type': 'application/fhir+json' });
    res.end(JSON.stringify({ resourceType: 'Bundle', type: 'searchset', entry: [{ resource: condition('flaky-1', 'Retried') }] }));
  });
  const flakyBase = await listen(flaky as never);
  const retried = await syncFrom(`${flakyBase}/Condition?patient=p1`, { repo, accessToken: 'at', sourceId: 'flaky', allowInternal: true });
  check('a 502 is retried once, and the records arrive', retried.created === 1 && flakeHits === 2, `${flakeHits} requests, ${retried.created} created`);
  flaky.close();

  let refusalHits = 0;
  const refusing = createServer((_req, res) => {
    refusalHits++;
    res.writeHead(400, { 'content-type': 'application/fhir+json' });
    res.end(JSON.stringify({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'invalid', diagnostics: 'no' }] }));
  });
  const refusingBase = await listen(refusing as never);
  let refused: unknown;
  try { await syncFrom(`${refusingBase}/Condition?patient=p1`, { repo, accessToken: 'at', sourceId: 'refusing', allowInternal: true }); } catch (err) { refused = err; }
  check('a 4xx is NOT retried — it will say the same thing again', refusalHits === 1 && refused instanceof FhirHttpError, `${refusalHits} requests`);
  refusing.close();

  const endless = createServer((req, res) => {
    const base = `http://127.0.0.1:${(endless.address() as AddressInfo).port}`;
    res.writeHead(200, { 'content-type': 'application/fhir+json' });
    res.end(JSON.stringify({
      resourceType: 'Bundle', type: 'searchset',
      link: [{ relation: 'next', url: `${base}/Condition?page=${Number(new URL(req.url ?? '', base).searchParams.get('page') ?? '0') + 1}` }],
      entry: [{ resource: condition(`endless-${new URL(req.url ?? '', base).searchParams.get('page') ?? '0'}`, 'Forever') }],
    }));
  });
  const endlessBase = await listen(endless as never);
  const capped2 = await syncFrom(`${endlessBase}/Condition?page=0`, { repo, accessToken: 'at', sourceId: 'endless', maxPages: 3, allowInternal: true });
  check('a provider that always returns a next link is TRUNCATED, not thrown away',
    capped2.truncated === true && capped2.pages === 3 && capped2.created === 3, `${capped2.pages} pages, ${capped2.created} created, truncated=${capped2.truncated}`);
  endless.close();

  repo.db.close();
  rmSync(dir, { recursive: true, force: true });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
