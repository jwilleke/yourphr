/**
 * Build the demo's baked-in baseline (yourphr#645): the two databases a public demo is reset to.
 *
 *   npx tsx scripts/build-demo-baseline.ts --out ./baseline
 *
 * Runs in the IMAGE BUILD, not on an operator's machine, so what ships is reproducible and nobody
 * hand-curates a database that strangers will read. Everything in it is SYNTHETIC — generated here
 * from the same fake provider the harnesses use. That is the never-commingle rule (yourphr test-data
 * policy) at its sharpest: this is the one instance the public can read.
 *
 * What it contains, and why each part is needed:
 *   - the demo account, so the one-click entrance has something to sign in to (yourphr#643);
 *   - NO admin (yourphr#886). The build runs assembleApp, which provisions `admin` with a password
 *     written into this throwaway directory; shipping that row would give every demo an admin whose
 *     password nobody has, restored at every reset. It is removed below. The instance provisions its
 *     own admin at first start (.admin_bootstrap_password), and the reset carries that one across;
 *   - a connected source and its records, so a visitor lands on a populated PHR rather than the
 *     empty one that made the Go demo useless to evaluate (yourphr#494).
 *
 * THE RECORDS COME FROM THE SYNTHETIC CORPUS, not from the harnesses' fake provider. That provider
 * answers three resources per type, which is right for a test and useless for a demo: a visitor
 * landing on three conditions and nothing else cannot tell whether the product works. The corpus is
 * the same deterministic, PHI-free generator CI already uses, asked for one patient over 30 months —
 * 114 resources across nine types, with two and a half years of vitals to plot.
 *
 * It is served over HTTP and pulled in through the ORDINARY SYNC PATH: connect a source, run the
 * worker. Writing records straight into the database would build a baseline no code path could
 * have produced, which is how a fixture drifts away from the product.
 *
 * NO credentials are baked in. Both passwords are provisioned at startup — the demo's by demo mode
 * (yourphr#515's rule, generated per instance), the admin's by bootstrap provisioning — so an image
 * that anyone can pull carries no password that works anywhere.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3-multiple-ciphers';
import { assembleApp } from '../src/app.js';
import { ApiContext } from '../src/framework/ApiContext.js';
import { BASELINE_APP, BASELINE_RECORDS, baselineIsPresent } from '../src/app/providers/demo-reset.js';


const argv = process.argv.slice(2);
const at = argv.indexOf('--out');
const outDir = resolve(at === -1 ? './baseline' : (argv[at + 1] ?? './baseline'));

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'yourphr-baseline-'));
  const corpus = join(dir, 'corpus.ndjson');
  const made = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/make-synthetic-corpus.ts', '--out', corpus, '--patients', '1', '--months', '30'], { encoding: 'utf8' });
  if (made.status !== 0) throw new Error(`baseline: could not generate the corpus: ${made.stderr}`);
  const fake = corpusProvider(corpus, 'tok');
  const fakeBase = await new Promise<string>((resolve_) => {
    fake.listen(0, '127.0.0.1', () => resolve_(`http://127.0.0.1:${(fake.address() as { port: number }).port}`));
  });

  // A baseline is PLAINTEXT by necessity: it ships in a public image, and the reset refuses to
  // install it over an encrypted instance precisely because there would be no key to write it with.
  const app = await assembleApp(dir, {
    version: 'baseline',
    env: { YOURPHR_DATABASE_ENCRYPTION_KEY: '', YOURPHR_BACKUP_ENCRYPTION_KEY: 'unused-by-this-build', SPIKE_TEST_ALLOW_INTERNAL: '1' },
  });

  const demoUser = 'demo';
  const sys = ApiContext.system('baseline-build', 'admin', app.engine);
  await app.users.createUser(sys, demoUser, 'replaced-at-startup-by-demo-provisioning');

  await app.sources.add(ApiContext.system('baseline-build', demoUser, app.engine), {
    userId: demoUser, display: 'Sample Regional Health', fhirBaseUrl: fakeBase, tokenUrl: `${fakeBase}/token`,
    clientId: 'baseline', patient: 'syn-patient-1',
    resourceTypes: ['Patient', 'Condition', 'Observation', 'Encounter', 'Immunization', 'AllergyIntolerance', 'DocumentReference'],
    accessToken: 'tok', refreshToken: '', expiresAt: 99_999_999, platformType: 'ehr', environment: 'sandbox',
  });
  await app.syncNow(1_000_000);

  const held = await app.engine.managers.records.typesHeld(ApiContext.system('baseline-build', demoUser, app.engine));
  await app.close();
  fake.close();

  if (held.length === 0) throw new Error('baseline: the sync produced no records — a demo with an empty account is the bug this exists to prevent');

  mkdirSync(outDir, { recursive: true });
  cpSync(join(dir, 'spike.db'), join(outDir, BASELINE_APP));
  cpSync(join(dir, 'records.db'), join(outDir, BASELINE_RECORDS));
  withoutAdmin(join(outDir, BASELINE_APP));
  rmSync(dir, { recursive: true, force: true });

  if (!baselineIsPresent(outDir)) throw new Error(`baseline: nothing usable was written to ${outDir}`);
  console.log(`baseline written to ${outDir}: ${BASELINE_APP} + ${BASELINE_RECORDS}, holding ${held.join(', ')} for ${demoUser}`);
}

/**
 * A FHIR server over the corpus: SMART discovery, a token endpoint, and one searchset per resource
 * type. Deliberately not the harnesses' fake provider — that one answers a fixed three resources per
 * type, and this needs to answer what a person's record actually looks like.
 */
function corpusProvider(corpusPath: string, token: string) {
  const byType = new Map<string, Record<string, unknown>[]>();
  for (const line of readFileSync(corpusPath, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    const resource = JSON.parse(line) as { resourceType: string };
    const bucket = byType.get(resource.resourceType) ?? [];
    bucket.push(resource as Record<string, unknown>);
    byType.set(resource.resourceType, bucket);
  }
  return createServer((req, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const send = (status: number, body: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/.well-known/smart-configuration') {
      const origin = `http://${req.headers.host}`;
      send(200, { authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token` });
      return;
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      send(200, { access_token: token, refresh_token: 'ref', token_type: 'bearer', expires_in: 3600, patient: 'syn-patient-1' });
      return;
    }
    if ((req.headers['authorization'] ?? '') !== `Bearer ${token}`) {
      send(401, { error: 'nope' });
      return;
    }
    const entry = (byType.get(url.pathname.replace('/', '')) ?? []).map((resource) => ({ resource }));
    send(200, { resourceType: 'Bundle', type: 'searchset', total: entry.length, entry });
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Remove the build's own `admin` from the baseline (yourphr#886): its password went with the build
 * directory, so shipping it would lock every demo's operator out after each reset. Its passkeys and
 * any other trace of it go too. Fails the build if anything named admin is left.
 */
function withoutAdmin(appDb: string): void {
  const db = new Database(appDb);
  try {
    db.prepare("DELETE FROM auth_users WHERE lower(username) = 'admin'").run();
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'auth_credentials'").get()) {
      db.prepare("DELETE FROM auth_credentials WHERE lower(username) = 'admin'").run();
    }
    db.exec('VACUUM');
    const left = db.prepare("SELECT count(*) AS n FROM auth_users WHERE lower(username) = 'admin'").get() as { n: number };
    if (left.n !== 0) throw new Error('baseline: the build admin is still in the baseline');
  } finally {
    db.close();
  }
}
