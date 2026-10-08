/**
 * The demo reset (yourphr#645) — the one code path in this product that deliberately destroys a
 * live database, so the tests that matter are the REFUSALS.
 *
 *   npm run demo-reset
 *
 * Each case builds a real pair of databases on disk and calls the same function the boot calls, then
 * asserts what is left behind. Nothing is mocked: a refusal that leaves data intact is only worth
 * believing if the data is checked afterwards.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';
import { applyDemoReset, BASELINE_APP, BASELINE_RECORDS, baselineIsPresent } from '../src/app/providers/demo-reset.js';
import { assembleApp } from '../src/app.js';
import { ApiContext } from '../src/framework/ApiContext.js';
import { resetPassword } from '../src/cli/reset-password.js';

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const dirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'yourphr-demo-reset-'));
  dirs.push(dir);
  return dir;
}

/** A database holding the given accounts and one marker row, so "untouched" can be proven. */
function makeDb(path: string, accounts: string[], marker: string): void {
  const db = new Database(path);
  db.exec('CREATE TABLE auth_users (username TEXT PRIMARY KEY, password_hash TEXT NOT NULL, token_generation INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, role TEXT NOT NULL DEFAULT \'user\')');
  db.exec('CREATE TABLE marker (value TEXT)');
  const insert = db.prepare('INSERT INTO auth_users (username, password_hash, created_at) VALUES (?, ?, ?)');
  for (const account of accounts) insert.run(account, 'hash', '2026-01-01T00:00:00Z');
  db.prepare('INSERT INTO marker (value) VALUES (?)').run(marker);
  db.close();
}

function markerOf(path: string): string {
  const db = new Database(path, { readonly: true });
  try {
    return (db.prepare('SELECT value FROM marker').get() as { value: string } | undefined)?.value ?? '(none)';
  } finally {
    db.close();
  }
}

/** A baseline directory whose databases are recognisable by their marker. */
function makeBaseline(): string {
  const dir = scratch();
  makeDb(join(dir, BASELINE_APP), ['demo', 'admin'], 'BASELINE');
  makeDb(join(dir, BASELINE_RECORDS), [], 'BASELINE');
  return dir;
}

function request(overrides: Partial<Parameters<typeof applyDemoReset>[0]> & { appDbPath: string; recordsDbPath: string; baselineDir: string }) {
  return applyDemoReset({
    demoEnabled: true,
    resetOnRestart: true,
    databaseKey: '',
    allowedAccounts: ['demo', 'demoadmin', 'admin'],
    log: () => undefined,
    ...overrides,
  });
}

function main(): void {
  const baseline = makeBaseline();
  check('the builder writes a baseline the reset recognises', baselineIsPresent(baseline));

  // 1. The happy path: armed, proven, restored.
  {
    const live = scratch();
    const app = join(live, 'spike.db');
    const records = join(live, 'records.db');
    makeDb(app, ['demo', 'admin'], 'WHAT-A-VISITOR-LEFT');
    makeDb(records, [], 'WHAT-A-VISITOR-LEFT');
    const outcome = request({ appDbPath: app, recordsDbPath: records, baselineDir: baseline });
    check('an armed, proven instance is restored to the baseline — both databases',
      outcome.applied && markerOf(app) === 'BASELINE' && markerOf(records) === 'BASELINE',
      `app ${markerOf(app)}, records ${markerOf(records)}`);
  }

  // 2. The read-only admin tour's account belongs to the demo too. Left out of the allowed list at
  //    first, which refused the reset on every demo that enables the tour — found on the real
  //    instance rather than here, because the case only appears once both features are on.
  {
    const live = scratch();
    const app = join(live, 'spike.db');
    const records = join(live, 'records.db');
    makeDb(app, ['demo', 'demoadmin', 'admin'], 'WITH-THE-ADMIN-TOUR');
    makeDb(records, [], 'WITH-THE-ADMIN-TOUR');
    const outcome = request({ appDbPath: app, recordsDbPath: records, baselineDir: baseline });
    check('a demo running the read-only admin tour still resets — demoadmin is one of its accounts',
      outcome.applied && markerOf(app) === 'BASELINE', outcome.applied ? 'applied' : outcome.reason);
  }

  // 3. THE IMPORTANT ONE. A database holding any account this demo does not own is refused, and
  //    every byte of it is still there afterwards.
  {
    const live = scratch();
    const app = join(live, 'spike.db');
    const records = join(live, 'records.db');
    makeDb(app, ['demo', 'admin', 'jim'], 'SOMEBODY-REAL');
    makeDb(records, [], 'SOMEBODY-REAL');
    const outcome = request({ appDbPath: app, recordsDbPath: records, baselineDir: baseline });
    check('a database holding ANY non-demo account is refused and left untouched',
      !outcome.applied && outcome.reason === 'foreign-account' && markerOf(app) === 'SOMEBODY-REAL' && markerOf(records) === 'SOMEBODY-REAL',
      `${outcome.applied ? 'APPLIED' : outcome.reason}, app ${markerOf(app)}`);
  }

  // 3. Encryption refuses outright: the baseline is plaintext and could not be written under a key.
  {
    const live = scratch();
    const app = join(live, 'spike.db');
    const records = join(live, 'records.db');
    makeDb(app, ['demo'], 'ENCRYPTED-INSTANCE');
    makeDb(records, [], 'ENCRYPTED-INSTANCE');
    const outcome = request({ appDbPath: app, recordsDbPath: records, baselineDir: baseline, databaseKey: 'at-rest-key' });
    check('an encrypted instance is refused outright and left untouched',
      !outcome.applied && outcome.reason === 'encrypted' && markerOf(app) === 'ENCRYPTED-INSTANCE');
  }

  // 4. Each switch alone destroys nothing.
  {
    const live = scratch();
    const app = join(live, 'spike.db');
    const records = join(live, 'records.db');
    makeDb(app, ['demo'], 'NOT-ARMED');
    makeDb(records, [], 'NOT-ARMED');
    const offDemo = request({ appDbPath: app, recordsDbPath: records, baselineDir: baseline, demoEnabled: false });
    const offReset = request({ appDbPath: app, recordsDbPath: records, baselineDir: baseline, resetOnRestart: false });
    const noBaseline = request({ appDbPath: app, recordsDbPath: records, baselineDir: join(live, 'nothing-here') });
    check('demo mode off, reset off, or no baseline: each refuses on its own and destroys nothing',
      !offDemo.applied && !offReset.applied && !noBaseline.applied && markerOf(app) === 'NOT-ARMED',
      `${offDemo.applied ? 'x' : offDemo.reason} / ${offReset.applied ? 'x' : offReset.reason} / ${noBaseline.applied ? 'x' : noBaseline.reason}`);
  }

  // 5. An unreadable database is not a proven one.
  {
    const live = scratch();
    const app = join(live, 'spike.db');
    const records = join(live, 'records.db');
    copyFileSync(join(baseline, BASELINE_RECORDS), records);
    // A file that is not a database at all — the shape a truncated volume or a half-copied file has.
    const db = new Database(app);
    db.exec('CREATE TABLE something_else (x TEXT)');
    db.close();
    const outcome = request({ appDbPath: app, recordsDbPath: records, baselineDir: baseline });
    check('a database whose accounts cannot be read is refused rather than assumed safe',
      !outcome.applied && outcome.reason === 'unreadable' && existsSync(app));
  }

  // 6. A first boot has nothing to prove and nothing to lose.
  {
    const live = scratch();
    const outcome = request({ appDbPath: join(live, 'spike.db'), recordsDbPath: join(live, 'records.db'), baselineDir: baseline });
    check('a first boot installs the baseline without a database to prove',
      outcome.applied && markerOf(join(live, 'spike.db')) === 'BASELINE');
  }

  // 7. A stale write-ahead log is removed with the file it belonged to.
  {
    const live = scratch();
    const app = join(live, 'spike.db');
    const records = join(live, 'records.db');
    makeDb(app, ['demo'], 'OLD');
    makeDb(records, [], 'OLD');
    const wal = `${app}-wal`;
    copyFileSync(app, wal); // any leftover file by that name is enough to prove it is cleared
    const outcome = request({ appDbPath: app, recordsDbPath: records, baselineDir: baseline });
    check('the previous instance\'s -wal is cleared, so SQLite cannot replay it onto the baseline',
      outcome.applied && !existsSync(wal) && markerOf(app) === 'BASELINE');
  }

  // 8. The operator's account is carried across (yourphr#886): password, role, token generation and
  //    passkeys from the live database replace whatever the baseline holds under that name.
  {
    const live = scratch();
    const app = join(live, 'spike.db');
    const records = join(live, 'records.db');
    makeDb(app, ['demo', 'admin'], 'VISITORS');
    makeDb(records, [], 'VISITORS');
    const db = new Database(app);
    db.prepare("UPDATE auth_users SET password_hash = 'operators-own-hash', token_generation = 3, role = 'admin' WHERE username = 'admin'").run();
    db.exec('CREATE TABLE auth_credentials (id TEXT PRIMARY KEY, username TEXT NOT NULL, kind TEXT NOT NULL, subject TEXT NOT NULL, secret TEXT NOT NULL, label TEXT NOT NULL, created_at TEXT NOT NULL, last_used_at TEXT, sig TEXT NOT NULL DEFAULT \'\', UNIQUE (kind, subject))');
    db.prepare("INSERT INTO auth_credentials (id, username, kind, subject, secret, label, created_at, sig) VALUES ('pk1', 'admin', 'passkey', 'cred-1', '{}', 'Operator laptop', '2026-10-08T00:00:00Z', 'signed')").run();
    db.prepare("INSERT INTO auth_credentials (id, username, kind, subject, secret, label, created_at, sig) VALUES ('pk2', 'demo', 'passkey', 'cred-2', '{}', 'A visitor', '2026-10-08T00:00:00Z', 'signed')").run();
    db.close();
    const outcome = request({ appDbPath: app, recordsDbPath: records, baselineDir: baseline, keepAccounts: ['admin'] });
    const after = new Database(app, { readonly: true });
    const admin = after.prepare("SELECT password_hash, token_generation, role FROM auth_users WHERE username = 'admin'").get() as { password_hash: string; token_generation: number; role: string } | undefined;
    const keys = after.prepare('SELECT id, sig FROM auth_credentials ORDER BY id').all() as { id: string; sig: string }[];
    const marker = (after.prepare('SELECT value FROM marker').get() as { value: string }).value;
    after.close();
    check('the operator\'s password, role, generation and passkey survive the reset; visitors\' data and passkeys do not',
      outcome.applied && marker === 'BASELINE' && admin?.password_hash === 'operators-own-hash' && admin.token_generation === 3 && admin.role === 'admin'
        && keys.length === 1 && keys[0]!.id === 'pk1' && keys[0]!.sig === 'signed',
      `${outcome.applied ? 'applied' : outcome.reason}, marker ${marker}, admin ${JSON.stringify(admin)}, keys ${JSON.stringify(keys)}`);
  }

  // 9. Keeping an account never widens the proof: a foreign account still refuses the reset.
  {
    const live = scratch();
    const app = join(live, 'spike.db');
    const records = join(live, 'records.db');
    makeDb(app, ['admin', 'jim'], 'SOMEBODY-REAL');
    makeDb(records, [], 'SOMEBODY-REAL');
    const outcome = request({ appDbPath: app, recordsDbPath: records, baselineDir: baseline, keepAccounts: ['admin'] });
    check('with an account kept, a foreign account still refuses the reset and leaves everything',
      !outcome.applied && outcome.reason === 'foreign-account' && markerOf(app) === 'SOMEBODY-REAL');
  }

  void sessionsDieAcrossARestart().then(operatorKeepsTheirDemo).then(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed`);
    if (failed > 0) process.exit(1);
  });
}

/**
 * The requirement behind "a visitor who signs in after a reset gets a sign-in page, not a token
 * error": a token minted before the restart must not verify after it. Go maintains this by deleting
 * its JWT signing key during the reset; here it falls out of the session key being generated at
 * every boot, which is worth PROVING rather than assuming, because the day someone persists that
 * key to make sessions survive restarts, this is the property they would silently break.
 */
async function sessionsDieAcrossARestart(): Promise<void> {
  const dir = scratch();
  const env = { YOURPHR_DATABASE_ENCRYPTION_KEY: '', YOURPHR_BACKUP_ENCRYPTION_KEY: 'travelling-copy-key' };
  const first = await assembleApp(dir, { env });
  const token = await first.sessions.issueFor('admin');
  const goodBefore = token ? (await first.sessions.verify(token)).ok : false;
  await first.close();

  const second = await assembleApp(dir, { env });
  const goodAfter = token ? (await second.sessions.verify(token)).ok : false;
  await second.close();

  check('a session minted before a restart does not verify after one — the reset needs no key surgery',
    goodBefore && !goodAfter, `before ${goodBefore}, after ${goodAfter}`);
}

/**
 * The whole path end to end, on real databases (yourphr#886): a fresh demo volume whose settings
 * already arm the reset. First start installs a baseline holding no admin, so bootstrap must still
 * provision `admin` and write its password file. The operator signs in with it; after a restart that
 * resets the demo, the same password still signs in.
 */
async function operatorKeepsTheirDemo(): Promise<void> {
  const env = { YOURPHR_DATABASE_ENCRYPTION_KEY: '', YOURPHR_BACKUP_ENCRYPTION_KEY: 'travelling-copy-key' };
  // A real baseline: an instance holding only the demo account, the way the image build leaves it.
  const build = scratch();
  const builder = await assembleApp(build, { env });
  await builder.users.createUser(ApiContext.system('test', 'admin', builder.engine), 'demo', 'replaced-at-startup');
  await builder.close();
  const baselineDir = scratch();
  copyFileSync(join(build, 'spike.db'), join(baselineDir, BASELINE_APP));
  copyFileSync(join(build, 'records.db'), join(baselineDir, BASELINE_RECORDS));
  const stripped = new Database(join(baselineDir, BASELINE_APP));
  stripped.prepare("DELETE FROM auth_users WHERE username = 'admin'").run();
  stripped.close();

  const dir = scratch();
  mkdirSync(join(dir, 'config'), { recursive: true });
  writeFileSync(join(dir, 'config', 'app-custom-config.json'), JSON.stringify({
    'yourphr.demo.enabled': true, 'yourphr.demo.reset-on-restart': true, 'yourphr.demo.baseline.dir': baselineDir,
  }));
  const first = await assembleApp(dir, { env });
  const file = first.bootstrapPasswordFile;
  const password = file && existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
  const signedIn = password !== '' && (await first.sessions.signIn('admin', { password }, { remoteAddr: '127.0.0.1' })).ok;
  // A record left behind, so the second start can prove the reset really ran. The operator's: the
  // demo account cannot add one (its first hand-entered record would create a source, and
  // SourcesManager.add refuses it). The ACCOUNT is kept across a reset; its records are not.
  const visitor = ApiContext.system('test', 'admin', first.engine);
  await first.engine.managers.records.savePatientRecord(visitor, { resourceType: 'Condition', id: 'left-by-a-visitor', code: { text: 'Synthetic' } } as never);
  const leftBefore = (await first.engine.managers.records.typesHeld(visitor)).includes('Condition');
  await first.close();
  check('a first start with the reset already armed still provisions admin and writes its password file',
    password !== '' && signedIn, `file ${file ?? 'none'}, signed in ${signedIn}`);

  // yourphr#887: `reset-password` beside the RUNNING server. It must change the one password and
  // nothing else — no demo reset under the server's open files — and the server must see it at once.
  const running = await assembleApp(dir, { env });
  const marked = ApiContext.system('test', 'admin', running.engine);
  await running.engine.managers.records.savePatientRecord(marked, { resourceType: 'Condition', id: 'still-here', code: { text: 'Synthetic' } } as never);
  const code = await resetPassword(['--user', 'admin', '--data', dir]);
  const recovered = readFileSync(join(dir, '.recovery_password'), 'utf8').trim();
  const seesIt = (await running.sessions.signIn('admin', { password: recovered }, { remoteAddr: '127.0.0.1' })).ok;
  const recordKept = (await running.engine.managers.records.typesHeld(marked)).includes('Condition');
  const demoStillOpens = (await running.engine.managers.demo.signIn()).ok;
  await running.close();
  check('reset-password beside a running demo changes only the password: no reset underneath, the server sees it, the demo button still works (yourphr#887)',
    code === 0 && seesIt && recordKept && demoStillOpens, `exit ${code}, server sees it ${seesIt}, record kept ${recordKept}, demo opens ${demoStillOpens}`);
  rmSync(join(dir, '.recovery_password'), { force: true });

  const second = await assembleApp(dir, { env });
  const again = (await second.sessions.signIn('admin', { password: recovered }, { remoteAddr: '127.0.0.1' })).ok;
  const reset = leftBefore && !(await second.engine.managers.records.typesHeld(ApiContext.system('test', 'admin', second.engine))).includes('Condition');
  await second.close();
  check('after a restart that resets the demo (records are gone), the operator\'s password still signs in', again && reset, `signed in ${again}, reset ${reset}`);
}

main();
