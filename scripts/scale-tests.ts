/**
 * Scale (yourphr#906): a synthetic account the size of a real one, run through the operations that
 * froze production on 2026-10-13 — removing a source (#905), the dashboard's reads (#908) and the
 * Medical History graph (#910). Each of those was a cost that grew with the whole table, invisible
 * at the handful of records every other test uses.
 *
 * Three kinds of check, chosen to be decided by the code rather than by how fast the CI machine is:
 *   - BLOCKING: the longest the event loop is held. Kubernetes kills the pod when /healthz goes
 *     unanswered for ~90 s; anything a person starts must never come near that.
 *   - OTHER PEOPLE'S DATA: a small account's reads are timed before and after a big account exists.
 *     An indexed read does not care how many rows belong to someone else; a full scan does (#908).
 *   - WRITES: the last thousand upserts must not be much slower than the first thousand — a per-write
 *     scan (#905's FTS delete) shows up as a write that gets slower as the table grows.
 *
 * What this does NOT catch, by design: a full scan of ONE person's own large record (#908's dashboard
 * summary). On fast hardware it costs a few hundred ms — far under any sane blocking limit here — and
 * only froze production on one throttled core. That class is pinned deterministically instead, by the
 * query-plan tests in src/app/providers/__tests__/SqliteRecordsProvider.test.ts (#908, #910).
 *
 * Validated against v3.19.0 (before #905/#910 were fixed): writes slowed 40x as the table grew, the
 * removal blocked 55.7 s and the Medical History graph 131 s — all FAIL here.
 *
 * Fully synthetic and deterministic: no randomness, invented names, so a CI failure reproduces locally.
 *
 *   npx tsx scripts/scale-tests.ts [--scale 1]
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Resource } from '@medplum/fhirtypes';
import { assembleApp } from '../src/app.js';
import { ApiContext } from '../src/framework/ApiContext.js';

const argv = process.argv.slice(2);
const scaleAt = argv.indexOf('--scale');
const SCALE = scaleAt === -1 ? 1 : Number(argv[scaleAt + 1]);
if (!(SCALE > 0)) throw new Error('--scale must be a positive number');

/** The event loop may be held at most this long by any one operation — far inside the probe's ~90 s. */
const BLOCK_LIMIT_MS = 2_000;
/** A small account's read may cost at most this many times what it did before the big account existed… */
const GROWTH_FACTOR = 5;
/** …once it is above this floor (below it, timer noise dominates). */
const GROWTH_FLOOR_MS = 25;
/** The last thousand upserts may be at most this many times slower than the first thousand. */
const WRITE_GROWTH = 3;

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

/** Times an operation and the longest stretch it held the event loop. */
async function measure<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number; blockedMs: number }> {
  let worst = 0;
  let last = performance.now();
  const probe = setInterval(() => { const now = performance.now(); worst = Math.max(worst, now - last - 20); last = now; }, 20);
  const started = performance.now();
  const value = await fn();
  const ms = performance.now() - started;
  await new Promise((r) => setTimeout(r, 40)); // let the probe see the tail of the work
  clearInterval(probe);
  return { value, ms, blockedMs: Math.max(0, worst) };
}
const fmt = (ms: number): string => `${Math.round(ms)} ms`;

// ---------------------------------------------------------------------------------------------
// The synthetic account, shaped like a real one (a production copy, 2026-10-13): one Patient per
// source referenced by everything, visits, a long tail of documents with real-sized text (~4 KB:
// a full scan over small rows costs nothing and looks like an index — the blind spot that hid #908), results
// that point at visits, reports that point at results.
// ---------------------------------------------------------------------------------------------

const WORDS = 'patient seen today for routine follow up blood pressure reviewed medication adherence discussed plan continue current regimen return in three months labs ordered results pending counselled on diet exercise sleep'.split(' ');
const text = (seed: number, words: number): string => Array.from({ length: words }, (_, i) => WORDS[(seed * 7 + i * 13) % WORDS.length]).join(' ');
const day = (n: number): string => new Date(Date.UTC(2015, 0, 1) + (n % 3650) * 86_400_000).toISOString().slice(0, 10);

interface Shape { encounters: number; documents: number; observations: number; conditions: number; medications: number; procedures: number; allergies: number; reports: number }
const scaled = (shape: Shape): Shape => Object.fromEntries(Object.entries(shape).map(([k, v]) => [k, Math.max(1, Math.round(v * SCALE))])) as unknown as Shape;

function* account(prefix: string, shape: Shape): Generator<Resource> {
  const patient = `Patient/${prefix}-patient`;
  yield { resourceType: 'Patient', id: `${prefix}-patient`, name: [{ family: 'Synthetic', given: [prefix] }], birthDate: '1950-06-02' } as Resource;
  const enc = (i: number): string => `Encounter/${prefix}-enc-${i % shape.encounters}`;
  for (let i = 0; i < shape.encounters; i++) yield { resourceType: 'Encounter', id: `${prefix}-enc-${i}`, status: 'finished', class: { code: 'AMB' }, subject: { reference: patient }, period: { start: day(i) }, type: [{ text: `Visit ${i}` }] } as Resource;
  for (let i = 0; i < shape.documents; i++) yield { resourceType: 'DocumentReference', id: `${prefix}-doc-${i}`, status: 'current', subject: { reference: patient }, date: day(i), type: { text: `Note ${i}` }, description: text(i, 650), context: { encounter: [{ reference: enc(i) }] }, content: [{ attachment: { title: `Note ${i}` } }] } as Resource;
  for (let i = 0; i < shape.observations; i++) yield { resourceType: 'Observation', id: `${prefix}-obs-${i}`, status: 'final', category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }], code: { coding: [{ system: 'http://loinc.org', code: `${1000 + (i % 200)}-${i % 10}` }], text: `Lab ${i % 200}` }, subject: { reference: patient }, encounter: { reference: enc(i) }, effectiveDateTime: day(i), valueQuantity: { value: i % 140, unit: 'mg/dL' } } as Resource;
  for (let i = 0; i < shape.conditions; i++) yield { resourceType: 'Condition', id: `${prefix}-cond-${i}`, clinicalStatus: { coding: [{ code: i % 3 ? 'active' : 'resolved' }] }, code: { text: `Condition ${i % 400}` }, subject: { reference: patient }, encounter: { reference: enc(i) }, recordedDate: day(i) } as Resource;
  for (let i = 0; i < shape.medications; i++) yield { resourceType: 'MedicationRequest', id: `${prefix}-med-${i}`, status: i % 4 ? 'active' : 'stopped', intent: 'order', medicationCodeableConcept: { text: `Medication ${i % 60}` }, subject: { reference: patient }, encounter: { reference: enc(i) }, authoredOn: day(i) } as Resource;
  for (let i = 0; i < shape.procedures; i++) yield { resourceType: 'Procedure', id: `${prefix}-proc-${i}`, status: 'completed', code: { text: `Procedure ${i % 90}` }, subject: { reference: patient }, encounter: { reference: enc(i) }, performedDateTime: day(i) } as Resource;
  for (let i = 0; i < shape.allergies; i++) yield { resourceType: 'AllergyIntolerance', id: `${prefix}-alg-${i}`, code: { text: `Allergen ${i % 30}` }, patient: { reference: patient }, recordedDate: day(i) } as Resource;
  for (let i = 0; i < shape.reports; i++) yield { resourceType: 'DiagnosticReport', id: `${prefix}-rep-${i}`, status: 'final', code: { text: `Panel ${i}` }, subject: { reference: patient }, encounter: { reference: enc(i) }, effectiveDateTime: day(i), result: [0, 1, 2].map((k) => ({ reference: `Observation/${prefix}-obs-${(i * 3 + k) % shape.observations}` })) } as Resource;
}

const MAIN = scaled({ encounters: 80, documents: 5500, observations: 130, conditions: 35, medications: 15, procedures: 60, allergies: 4, reports: 20 });
const BIG = scaled({ encounters: 2700, documents: 9900, observations: 3450, conditions: 3400, medications: 740, procedures: 560, allergies: 140, reports: 15 });
const SMALL: Shape = { encounters: 10, documents: 200, observations: 40, conditions: 10, medications: 5, procedures: 5, allergies: 2, reports: 3 };
const total = (s: Shape): number => 1 + Object.values(s).reduce((a, b) => a + b, 0);

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'yourphr-scale-'));
  try {
    mkdirSync(join(dir, 'backups'));
    const app = await assembleApp(dir, { env: { YOURPHR_DATABASE_ENCRYPTION_KEY: 'scale-key', YOURPHR_BACKUP_ENCRYPTION_KEY: 'scale-backup-key', YOURPHR_SYNC_INTERVAL_SECONDS: '0', YOURPHR_BACKUP_DESTINATION: join(dir, 'backups') }, version: 'scale' });
    const system = ApiContext.system('scale', 'admin', app.engine);
    for (const name of ['jim', 'mary']) await app.users.createUser(system, name, `${name}-scale-password`);
    const jim = ApiContext.system('scale', 'jim', app.engine);
    const mary = ApiContext.system('scale', 'mary', app.engine);
    const records = app.engine.managers.records;
    const sources = app.engine.managers.sources;

    console.log(`scale ${SCALE}: jim main ${total(MAIN)} + big ${total(BIG)} records, mary ${total(SMALL)}`);

    // --- mary, small, alone: the "before" for every per-person read ---
    const marySource = `source-${(await sources.addDeviceSource(mary, 'Scale small')).id}`;
    const maryWriter = records.writer(mary, marySource);
    for (const r of account('mary', SMALL)) await maryWriter.upsert(r);
    const maryEncounters = (await records.list(mary, 'Encounter')).map((e) => ({ source_id: String(e['source_id']), source_resource_type: 'Encounter', source_resource_id: String(e['source_resource_id']) }));
    const reads: [string, () => Promise<unknown>][] = [
      ['summary counts', () => records.countsByType(mary)],
      ['recent items', () => records.recent(mary, 5)],
      ['conditions', () => records.conditions(mary)],
      ['medications', () => records.medications(mary)],
      ['allergies', () => records.allergies(mary)],
      ['identities', () => records.sourceIdentities(mary)],
      ['search "routine"', () => records.searchText(mary, 'routine')],
      ['Save Report (IPS)', () => records.ips(mary)],
      ['Medical History graph', () => records.graph(mary, 'MedicalHistory', maryEncounters)],
    ];
    const before = new Map<string, number>();
    for (const [name, fn] of reads) { await fn(); before.set(name, (await measure(fn)).ms); } // warm, then time

    // --- jim, real-sized: writes must not slow down as the table grows ---
    const mainSource = `source-${(await sources.addDeviceSource(jim, 'Scale main')).id}`;
    const bigSource = `source-${(await sources.addDeviceSource(jim, 'Scale big')).id}`;
    const chunkTimes: number[] = [];
    let written = 0;
    let chunkStart = performance.now();
    const seed = async (sourceId: string, shape: Shape, prefix: string): Promise<void> => {
      const writer = records.writer(jim, sourceId);
      for (const r of account(prefix, shape)) {
        await writer.upsert(r);
        if (++written % 1000 === 0) { chunkTimes.push(performance.now() - chunkStart); chunkStart = performance.now(); await new Promise((res) => setImmediate(res)); }
      }
    };
    const seeding = await measure(async () => { await seed(mainSource, MAIN, 'main'); await seed(bigSource, BIG, 'big'); });
    const first = chunkTimes[0] ?? 0;
    const lastChunk = chunkTimes[chunkTimes.length - 1] ?? 0;
    check(`writes do not slow down as the table grows (${written} upserts, the sync path)`, chunkTimes.length >= 2 && lastChunk <= WRITE_GROWTH * first,
      `first 1000 ${fmt(first)}, last 1000 ${fmt(lastChunk)}, all ${fmt(seeding.ms)}`);

    // --- mary's reads, now that the table holds jim's ~26k records ---
    for (const [name, fn] of reads) {
      await fn();
      const after = await measure(fn);
      const was = before.get(name) ?? 0;
      // Known limit, tracked in yourphr#912: FTS matches every account and then filters by user, so
      // search grows with OTHER people's records (6 ms → ~350 ms at real document sizes). Held to the
      // blocking limit rather than exempted, so it cannot become a freeze; it joins the common bound when #912 is fixed.
      const limit = name.startsWith('search') ? BLOCK_LIMIT_MS : Math.max(GROWTH_FLOOR_MS, GROWTH_FACTOR * was);
      check(`${name}: one person's read ignores other people's records${name.startsWith('search') ? ` (known limit, #912)` : ''}`, after.ms <= limit,
        `${fmt(was)} alone → ${fmt(after.ms)} beside ${written} other records`);
    }

    // --- jim's own heavy operations: never hold the server ---
    const jimEncounters = (await records.list(jim, 'Encounter', { sourceId: mainSource })).map((e) => ({ source_id: String(e['source_id']), source_resource_type: 'Encounter', source_resource_id: String(e['source_resource_id']) }));
    const graph = await measure(() => records.graph(jim, 'MedicalHistory', jimEncounters));
    check(`Medical History graph for ${jimEncounters.length} visits never holds the server (#910)`, graph.blockedMs <= BLOCK_LIMIT_MS, `${fmt(graph.ms)} total, blocked ≤ ${fmt(graph.blockedMs)}`);

    // Upload (#913): the main source exported as one FHIR bundle and imported into a fresh account,
    // through the same import the Sources page starts in the background.
    const exported = await sources.exportBundle(jim, mainSource);
    const bundleBytes = Buffer.from(JSON.stringify(exported?.bundle ?? {}));
    await app.users.createUser(system, 'una', 'una-scale-password');
    const una = ApiContext.system('scale', 'una', app.engine);
    const imported = await measure(() => sources.importUpload(una, { filename: 'records.json', bytes: bundleBytes }));
    check(`uploading a ${(bundleBytes.length / 1e6).toFixed(1)} MB file of ${total(MAIN)} records never holds the server (#913)`,
      imported.blockedMs <= BLOCK_LIMIT_MS && imported.value.data.created === total(MAIN),
      `${imported.value.data.created} imported in ${fmt(imported.ms)}, blocked ≤ ${fmt(imported.blockedMs)}`);

    const report = await measure(() => records.ips(jim));
    check('Save Report (IPS) for a real-sized account never holds the server (#915)', report.blockedMs <= BLOCK_LIMIT_MS, `${fmt(report.ms)}, blocked ≤ ${fmt(report.blockedMs)}`);

    const summary = await measure(() => records.countsByType(jim));
    check('the dashboard summary of a real-sized account never holds the server (#908)', summary.blockedMs <= BLOCK_LIMIT_MS, `${fmt(summary.ms)}, blocked ≤ ${fmt(summary.blockedMs)}`);

    const removal = await measure(() => sources.remove(jim, bigSource));
    check(`removing a ${total(BIG)}-record source never holds the server (#905)`, removal.blockedMs <= BLOCK_LIMIT_MS && removal.value === total(BIG),
      `${removal.value} removed in ${fmt(removal.ms)}, blocked ≤ ${fmt(removal.blockedMs)}`);
    check('the removal leaves nothing behind in the search text', (await records.searchText(jim, 'big')).length === 0);

    const rebuild = await measure(async () => {
      records.startSearchIndexRebuild(ApiContext.from({ username: 'admin', role: 'admin' }, app.engine));
      for (;;) {
        const run = app.engine.managers.backgroundJobs.latestRun('records.search-index.rebuild');
        if (run && (run.status === 'completed' || run.status === 'failed')) return run;
        await new Promise((r) => setTimeout(r, 50));
      }
    });
    check('a full search index rebuild never holds the server (#713)', rebuild.value.status === 'completed' && rebuild.blockedMs <= BLOCK_LIMIT_MS,
      `${rebuild.value.status} in ${fmt(rebuild.ms)}, blocked ≤ ${fmt(rebuild.blockedMs)}`);

    // Backup (#787) and restore staging (#914): both decrypt and copy every database — off the
    // request thread, or the server answers nothing for the whole copy.
    const admin = ApiContext.from({ username: 'admin', role: 'admin' }, app.engine);
    const backup = await measure(() => app.backups.backupNow(admin));
    check('a backup never holds the server (#787)', backup.blockedMs <= BLOCK_LIMIT_MS, `${fmt(backup.ms)}, blocked ≤ ${fmt(backup.blockedMs)}`);
    const name = (backup.value as { name: string }).name;
    const staging = await measure(() => app.backups.stageRestore(admin, name));
    check('staging a restore never holds the server (#914)', staging.blockedMs <= BLOCK_LIMIT_MS && staging.value.staged === true, `${fmt(staging.ms)}, blocked ≤ ${fmt(staging.blockedMs)}`);

    await app.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
}

main().catch((err: unknown) => { console.error(err); process.exit(1); });
