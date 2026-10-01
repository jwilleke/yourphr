/**
 * The process harness (yourphr#587): src/main.ts as the orchestrator will run it — environment
 * in, a listening port out — and the refusals that make a misconfiguration a crash instead of an
 * inert pod.
 *
 *   npm run process
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { envNameFor } from '../src/config/index.js';

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

// node itself, not an npx/npm wrapper: a signal sent to a wrapper is reported as the wrapper dying
// (exit null) while the real process is orphaned — the CI runner showed exactly that on Linux.
const ENTRY = ['--import', 'tsx', 'src/main.ts'];

function runOnce(env: Record<string, string>, args: string[] = []): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [...ENTRY, ...args], { env: { ...process.env, ...env }, encoding: 'utf8', timeout: 30_000 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function get(port: number, path: string): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function waitForListening(child: ChildProcess, timeoutMs = 20_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error(`did not listen within ${timeoutMs}ms; output so far:\n${out}`)), timeoutMs);
    child.stdout?.on('data', (c) => {
      out += String(c);
      if (out.includes('listening on')) { clearTimeout(timer); resolve(out); }
    });
    child.stderr?.on('data', (c) => { out += String(c); });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`exited ${code} before listening:\n${out}`)); });
  });
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'spike-process-'));
  const dataDir = join(dir, 'data');
  const webDir = join(dir, 'web');
  mkdirSync(webDir);
  writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>YourPHR</title><app-root></app-root>');
  const DATA = 'YOURPHR_FAST_STORAGE'; // a plain environment variable, not a config key (yourphr#630)
  const WEB = envNameFor('yourphr.web.static-dir');
  const PORT = envNameFor('yourphr.web.listen.port');

  // --- refusals: a misconfigured process must not boot inert (yourphr#546's principle) ---
  // NOT a refusal any more (yourphr#630): the fast storage root defaults to ./data, as ngdpbase
  // ships it, which is what lets an unpacked copy run without an operator setting anything. An
  // unset root is normal; an UNWRITABLE one is still fatal, which is the check below.
  // A path UNDER a regular file: mkdir fails with ENOTDIR on every platform and for every user,
  // including root in a CI container. A permission-based path is not portable — /proc behaves one
  // way on macOS and another for root on Linux, which is how the first version of this check
  // passed locally and hung in CI.
  const blocker = join(mkdtempSync(join(tmpdir(), 'yourphr-blocked-')), 'not-a-directory');
  writeFileSync(blocker, 'x');
  const unwritable = runOnce({ [DATA]: join(blocker, 'data'), [PORT]: '0' });
  check('refuses to start when the data directory cannot be created, naming the path',
    unwritable.status === 78 && unwritable.stderr.includes('not-a-directory'), `status ${unwritable.status}`);
  const noIndex = runOnce({ [DATA]: dataDir, [WEB]: join(dir, 'nowhere'), [PORT]: '0' });
  check('refuses a static dir with no index.html, naming it', noIndex.status === 78 && noIndex.stderr.includes('index.html'));

  // --- the subcommand layer (yourphr#654) ---
  //
  // The rule with teeth is the LAST one: an unrecognised word must not fall through to starting a
  // server. These run with a perfectly good environment, so a status of 2 can only be the command
  // being refused — and a process that started instead would hold the port until spawnSync's
  // timeout and report null, which is the failure this check is shaped to catch.
  const good = { [DATA]: join(dir, 'subcommand-data'), [PORT]: '0' };
  const nonsense = runOnce(good, ['migreat', '--go', '/dev/null']);
  check('an unknown subcommand exits 2 with the usage and never starts the server',
    nonsense.status === 2 && nonsense.stderr.includes('unknown command: migreat') && nonsense.stderr.includes('reset-password'), `status ${nonsense.status}`);
  const strayFlag = runOnce(good, ['start', '--port', '9999']);
  check('start refuses a flag rather than ignoring it — settings are not command-line arguments',
    strayFlag.status === 2 && strayFlag.stderr.includes('--port'), `status ${strayFlag.status}`);
  const help = runOnce(good, ['help']);
  check('help exits 0 and names every command the image accepts',
    help.status === 0 && ['start', 'migrate', 'reset-password', 'compact', 'reindex', 'version'].every((c) => help.stdout.includes(c)), `status ${help.status}`);
  const pkgVersion = (JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { version: string }).version;
  const versionOut = runOnce(good, ['version']);
  check('version prints package.json\'s version and exits 0',
    versionOut.status === 0 && versionOut.stdout.trim() === pkgVersion, `${versionOut.status}: ${versionOut.stdout.trim()}`);
  const recovery = runOnce(good, ['reset-password', '--user', 'admin', '--data', join(dir, 'nowhere')]);
  check('reset-password refuses a data directory that does not exist rather than creating an empty instance',
    recovery.status === 2 && recovery.stderr.includes('does not exist'), `status ${recovery.status}`);
  const compactNowhere = runOnce(good, ['compact', '--data', join(dir, 'nowhere')]);
  check('compact refuses a data directory that does not exist (yourphr#781)',
    compactNowhere.status === 2 && compactNowhere.stderr.includes('does not exist'), `status ${compactNowhere.status}`);
  const reindexTypo = runOnce(good, ['reindex', '--users', 'x']);
  const reindexNoUser = runOnce(good, ['reindex', '--user']);
  check('reindex refuses a flag it does not know, and --user without a name (yourphr#713)',
    reindexTypo.status === 2 && reindexTypo.stderr.includes('--users') && reindexNoUser.status === 2, `status ${reindexTypo.status} ${reindexNoUser.status}`);
  const compactTypo = runOnce(good, ['compact', '--dryrun']);
  check('compact refuses a flag it does not know rather than compacting for real',
    compactTypo.status === 2 && compactTypo.stderr.includes('--dryrun'), `status ${compactTypo.status}`);

  // --- the process ---
  const port = 18000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ENTRY, {
    env: { ...process.env, [DATA]: dataDir, [WEB]: webDir, [PORT]: String(port), [envNameFor('yourphr.web.listen.host')]: '127.0.0.1', [envNameFor('yourphr.sync.interval-seconds')]: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  try {
    output = await waitForListening(child);
    check('boots and says where it listens, where the data is, and that the worker is off', output.includes(`127.0.0.1:${port}`) && output.includes(dataDir) && output.includes('worker off'));
    check('first start names the bootstrap password file, never the password',
      output.includes('.admin_bootstrap_password') && !output.includes(readFileSync(join(dataDir, '.admin_bootstrap_password'), 'utf8').trim()));
    check('warns loudly when the database key is unset', output.includes(envNameFor('yourphr.database.encryption.key')) && output.includes('in the clear'));

    const health = await get(port, '/healthz');
    check('GET /healthz is 200 without a session', health.status === 200 && health.body === '{"ok":true}', `${health.status} ${health.body}`);
    const index = await get(port, '/');
    check('serves the Angular index at /', index.status === 200 && index.body.includes('<app-root>'));
    const secure = await get(port, '/api/secure/summary');
    check('the API still gates: /api/secure/* is 401 without a token', secure.status === 401);
    const spa = await get(port, '/patient-profile');
    check('SPA fallback holds in the process (extensionless route -> index)', spa.status === 200 && spa.body.includes('<app-root>'));
  } catch (err) {
    check('process boot', false, (err as Error).message);
  }

  // --- shutdown ---
  const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
  child.kill('SIGTERM');
  const code = await Promise.race([exited, new Promise<number | null>((r) => setTimeout(() => r(-1), 10_000))]);
  check('SIGTERM closes cleanly with exit 0', code === 0, `exit ${code}`);

  // --- reset-password, against the instance that just shut down (yourphr#654, #510) ---
  //
  // The behaviour is covered in the auth harness; what was unproven until here is that a COMMAND
  // reaches it. That is the whole shape of yourphr#654: recoverAccess was implemented, tested and
  // unreachable, which is not the same thing as shipped.
  const bootstrapPassword = readFileSync(join(dataDir, '.admin_bootstrap_password'), 'utf8').trim();
  const recoveryFile = join(dataDir, '.recovery_password');
  const reset = runOnce({}, ['reset-password', '--user', 'admin', '--data', dataDir]);
  const recovered = existsSync(recoveryFile) ? readFileSync(recoveryFile, 'utf8').trim() : '';
  check('reset-password sets a fresh password, writes it 0600, names the path and never prints it',
    reset.status === 0 && recovered !== '' && recovered !== bootstrapPassword && (statSync(recoveryFile).mode & 0o777) === 0o600
      && reset.stdout.includes('.recovery_password') && !reset.stdout.includes(recovered), `status ${reset.status} ${reset.stderr.slice(0, 200)}`);
  const missing = runOnce({}, ['reset-password', '--user', 'nobody', '--data', dataDir]);
  check('reset-password on an account that does not exist exits non-zero and says which name',
    missing.status !== 0 && missing.stderr.includes('nobody'), `status ${missing.status}`);

  // --- compact, against the same stopped instance (yourphr#781) — the command reaches the store ---
  const dry = runOnce({}, ['compact', '--data', dataDir, '--dry-run']);
  check('compact --dry-run reports and changes nothing, integrity ok',
    dry.status === 0 && dry.stdout.includes('dry run') && dry.stdout.includes('integrity:          ok'), `status ${dry.status} ${dry.stderr.slice(0, 200)}`);
  const reindexed = runOnce({}, ['reindex', '--data', dataDir]);
  check('reindex runs on a stopped instance and leaves the index current (yourphr#713)',
    reindexed.status === 0 && /records reindexed: +\d+/.test(reindexed.stdout) && reindexed.stdout.includes('index version:') && !reindexed.stdout.includes('still stale'),
    `status ${reindexed.status} ${reindexed.stderr.slice(0, 200)}`);
  const compacted = runOnce({}, ['compact', '--data', dataDir]);
  check('compact runs on a stopped instance and reports integrity ok',
    compacted.status === 0 && compacted.stdout.includes('integrity:          ok'), `status ${compacted.status} ${compacted.stderr.slice(0, 200)}`);

  rmSync(dir, { recursive: true, force: true });
  // The version the UI shows comes from package.json (main.ts reads it), and the image is built
  // from a git tag. Nothing kept them in step, so v0.2.0 and v0.2.1 both shipped reporting 0.1.0 —
  // visible on the production banner as `prod-0.1.0` after the cut-over (yourphr#642). A version
  // string that lies about what is running is the misrepresentation category, not cosmetics.
  {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { version: string };
    const described = spawnSync('git', ['describe', '--tags', '--abbrev=0'], { encoding: 'utf8' });
    const tag = described.status === 0 ? described.stdout.trim().replace(/^v/, '') : '';
    // AHEAD of the last tag is normal — that is an unreleased change. BEHIND is the defect: it
    // means a tag was cut without bumping, so the release reports an older version than it is.
    const parse = (v: string): number[] => v.split('.').map((n) => Number(n) || 0);
    const behind = (a: string, b: string): boolean => {
      const [x, y] = [parse(a), parse(b)];
      for (let i = 0; i < 3; i++) { if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0); }
      return false;
    };
    check('package.json version is not BEHIND the most recent tag — the UI reports what is actually running',
      tag === '' || !behind(pkg.version, tag), `package.json ${pkg.version}, tag ${tag || '(none)'}`);
  }

  // --- the BUILT entrypoint, not the source one ---
  //
  // Everything above runs src/main.ts through tsx, which is the source layout: main.ts sits beside
  // package.json. The IMAGE runs dist/server/main.js, one directory deeper, and that difference
  // crash-looped production on 3.0.0 — the version read resolved '../package.json' to a path that
  // exists in the source tree and not in the image, at import time, before anything served.
  //
  // So this boots what the image boots. A test that only ever exercises the source layout cannot
  // see a bug that only exists in the compiled one.
  {
    const built = join(process.cwd(), 'dist', 'server', 'main.js');
    if (!existsSync(built)) spawnSync('npm', ['run', 'build'], { encoding: 'utf8', timeout: 120_000 });
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { version: string };
    const dir2 = mkdtempSync(join(tmpdir(), 'spike-built-'));
    const port2 = 8100 + Math.floor(Number(process.pid) % 300);
    const child2 = spawn(process.execPath, [built], {
      env: { ...process.env, YOURPHR_FAST_STORAGE: dir2, YOURPHR_SLOW_STORAGE: dir2, YOURPHR_WEB_LISTEN_PORT: String(port2), YOURPHR_DATABASE_ENCRYPTION_KEY: '', YOURPHR_BACKUP_ENCRYPTION_KEY: 'travelling-copy-key' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child2.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    try {
      await waitForListening(child2);
      const version = await get(port2, '/api/version');
      check('the BUILT entrypoint boots and reports package.json\'s version — the layout the image runs',
        version.status === 200 && JSON.parse(version.body).data.version === pkg.version,
        `${version.status} ${version.body.slice(0, 80)}`);
    } catch (err) {
      check('the BUILT entrypoint boots and reports package.json\'s version — the layout the image runs', false, `${(err as Error).message} ${stderr.slice(0, 200)}`);
    }
    child2.kill('SIGTERM');
    rmSync(dir2, { recursive: true, force: true });

    // The subcommand layer on the layout the image runs. `docker run <image> migreat` reaches
    // ENTRYPOINT plus that word, and the answer must be a refusal — not a server started against
    // whatever data directory the environment happened to name (yourphr#654).
    const builtNonsense = spawnSync(process.execPath, [built, 'migreat'], { encoding: 'utf8', timeout: 30_000, env: { ...process.env, YOURPHR_FAST_STORAGE: join(tmpdir(), 'yourphr-never-created') } });
    check('the BUILT entrypoint refuses an unknown subcommand with exit 2 and starts nothing',
      builtNonsense.status === 2 && builtNonsense.stderr.includes('unknown command'), `status ${builtNonsense.status}`);
    const builtVersion = spawnSync(process.execPath, [built, 'version'], { encoding: 'utf8', timeout: 30_000 });
    check('the BUILT entrypoint answers `version` — how an operator confirms which image they pulled',
      builtVersion.status === 0 && builtVersion.stdout.trim() === pkg.version, `${builtVersion.status}: ${builtVersion.stdout.trim()}`);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error(`process harness failed: ${(err as Error).message}`);
  process.exit(1);
});
