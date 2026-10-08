/**
 * The framework skeleton (yourphr#608, #609): the typed registry, declared dependencies with a
 * validated boot order, reverse shutdown, and the request context's guards. Each rule the
 * architecture doc tightened is checked by trying to break it.
 *
 *   npm run framework
 */
import { Engine } from '../src/framework/Engine.js';
import { BaseManager, type BackupData } from '../src/framework/BaseManager.js';
import { ApiContext, ApiError } from '../src/framework/ApiContext.js';
import { ConfigurationManager } from '../src/framework/ConfigurationManager.js';
import { PolicyManager, PERMISSIONS_KEY, ROLES_KEY } from '../src/framework/managers/PolicyManager.js';
import { FileConfigProvider } from '../src/framework/providers/FileConfigProvider.js';
import { envNameFor, legacyEnvNameFor } from '../src/config/index.js';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

declare module '../src/framework/Engine.js' {
  interface ManagerRegistry {
    alpha: Probe;
    beta: Probe;
    gamma: Probe;
  }
}

const log: string[] = [];
class Probe extends BaseManager {
  constructor(engine: Engine, readonly name: 'alpha' | 'beta' | 'gamma', override readonly dependsOn: readonly ('alpha' | 'beta' | 'gamma')[] = []) {
    super(engine);
  }
  override async initialize(config: Record<string, unknown> = {}): Promise<void> { log.push(`init ${this.name}`); await super.initialize(config); }
  override async shutdown(): Promise<void> { log.push(`stop ${this.name}`); await super.shutdown(); }
  async backup(): Promise<BackupData> { return { manager: this.name, takenAt: 'now' }; }
  async restore(): Promise<void> { /* nothing to restore */ }
}

async function main(): Promise<void> {
  // --- boot order follows declared dependencies, not registration order ---
  const e = new Engine();
  e.register('gamma', new Probe(e, 'gamma', ['beta']));
  e.register('alpha', new Probe(e, 'alpha'));
  e.register('beta', new Probe(e, 'beta', ['alpha']));
  await e.initialize();
  check('initialize() orders managers by declared dependencies, whatever the registration order',
    log.join(',') === 'init alpha,init beta,init gamma' && e.registered.join(',') === 'alpha,beta,gamma');
  check('the registry is typed: engine.managers.beta is the instance, initialised', e.managers.beta.isInitialized() && e.managers.beta.name === 'beta');
  await e.shutdown();
  check('shutdown() runs in reverse boot order', log.slice(3).join(',') === 'stop gamma,stop beta,stop alpha');

  // --- refusals ---
  let missing = '';
  try {
    const m = new Engine();
    m.register('beta', new Probe(m, 'beta', ['alpha']));
    await m.initialize();
  } catch (err) { missing = (err as Error).message; }
  check('a dependency that is not registered refuses to boot, by name', missing.includes('beta depends on alpha'));
  let cycle = '';
  try {
    const c = new Engine();
    c.register('alpha', new Probe(c, 'alpha', ['beta']));
    c.register('beta', new Probe(c, 'beta', ['alpha']));
    await c.initialize();
  } catch (err) { cycle = (err as Error).message; }
  check('a dependency cycle refuses to boot, naming the cycle', cycle.includes('cycle') && cycle.includes('alpha -> beta -> alpha'));
  let twice = '';
  try {
    const t = new Engine();
    t.register('alpha', new Probe(t, 'alpha'));
    t.register('alpha', new Probe(t, 'alpha'));
  } catch (err) { twice = (err as Error).message; }
  check('registering a manager twice is refused', twice.includes('registered twice'));

  // --- the request context ---
  const engine = new Engine();
  const member = ApiContext.from({ username: 'alice', role: 'user', tokenGeneration: 3 }, engine);
  const admin = ApiContext.from({ username: 'ops', role: 'admin' }, engine);
  const nobody = ApiContext.anonymous(engine);
  const tool = ApiContext.system('migration', 'alice', engine);
  const status = (fn: () => void): number | 'ok' => { try { fn(); return 'ok'; } catch (err) { return err instanceof ApiError ? err.status : -1; } };
  check('guards: a member passes requireAuthenticated and fails a permission with 403; nobody fails with 401',
    status(() => member.requireAuthenticated()) === 'ok' && status(() => member.require('admin-read')) === 403 && status(() => nobody.requireAuthenticated()) === 401);
  check('the authorization facts are immutable and carried (token generation included)',
    Object.isFrozen(member) && member.tokenGeneration === 3 && (() => { try { (member as { role: string }).role = 'admin'; return false; } catch { return member.role === 'user'; } })());
  check('a system principal acts for an account and names itself as the actor', tool.username === 'alice' && tool.actor === 'migration' && member.actor === 'alice' && tool.isAuthenticated);
  check('ApiError carries the status and the extra envelope fields', (() => { const x = new ApiError(403, 'nope', { error_code: 'x' }); return x.status === 403 && x.extra['error_code'] === 'x'; })());

  // --- policy as data, and the drift check the doc asks for (yourphr#620, moved into configuration
  // by yourphr#623). Two lists that must agree and nothing else checks: what the SHIPPED
  // configuration defines, and what the code actually requires. An orphan permission protects
  // nothing; a required permission the registry does not define fails closed and also looks fine
  // from the outside. Both directions, or neither is worth having.
  //
  // It measures the SHIPPED defaults, not an instance's merged view: an operator's own additions
  // enforce nothing BY DESIGN, which is a documented property once the names live in configuration.
  const policyEngine = new Engine();
  policyEngine.register('configuration', new ConfigurationManager(policyEngine, new FileConfigProvider(process.cwd()), { env: {} }));
  const policy = new PolicyManager(policyEngine);
  policyEngine.register('policy', policy);
  const shippedPermissions = policy.registry().map((p) => p.permission).sort();

  const sourceFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? (e.name === '__tests__' ? [] : sourceFiles(join(dir, e.name))) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []);
  const required = new Set<string>();
  for (const file of sourceFiles('src')) {
    for (const m of readFileSync(file, 'utf8').matchAll(/\b(?:require|can)\('([a-z]+-[a-z]+)'/g)) required.add(m[1]!);
  }
  const orphans = shippedPermissions.filter((p) => !required.has(p));
  const unregistered = [...required].filter((p) => !policy.isPermission(p));
  check('every permission the shipped configuration defines is required somewhere in code — no entry that protects nothing',
    orphans.length === 0, orphans.join(', '));
  check('every permission the code requires is defined in the shipped configuration — no gate spelled wrong, failing closed and looking fine',
    unregistered.length === 0, unregistered.join(', '));
  check(`the registry and the roles are configuration, not code (${PERMISSIONS_KEY}, ${ROLES_KEY})`,
    shippedPermissions.length > 0 && policy.roleDefinitions().length > 0);
  check('admin holds every shipped permission; user and anonymous hold none — ownership is the other axis',
    [...policy.permissionsFor('admin')].sort().join() === shippedPermissions.join()
      && policy.permissionsFor('user').length === 0 && policy.permissionsFor('anonymous').length === 0);
  check('roles are flat, additive and system-flagged; an unknown role grants nothing',
    policy.roleDefinitions().every((r) => r.system && r.permissions.every((p) => policy.isPermission(p)))
      && policy.permissionsFor('nonexistent-role').length === 0);
  check('every permission reads {target}-{action} — scope never goes in a name',
    policy.registry().every((p) => `${p.target}-${p.action}` === p.permission));
  check('a context resolves its permissions through the policy manager, live per request',
    ApiContext.from({ username: 'ops', role: 'admin' }, policyEngine).can('admin-system')
      && !ApiContext.from({ username: 'alice', role: 'user' }, policyEngine).can('admin-read'));

  // --- the configuration key convention (yourphr#627) ---
  // One separator, everywhere, so a key survives a URL, an HTTP header, a shell variable and a log
  // line unchanged. Underscore is RFC 3986 unreserved, so this is not a standards argument — it is
  // that nginx drops headers containing underscores by DEFAULT and silently, and that `_` vanishes
  // under link underlining. ngdpbase holds the same rule across 472 keys with zero underscores.
  // The shipped file IS the list of keys now (yourphr#629) — there is no second structure.
  const catalogKeys = policyEngine.managers.configuration.keys();
  const badShape = catalogKeys.filter((k) => !/^yourphr(\.[a-z0-9]+(-[a-z0-9]+)*)+$/.test(k));
  check('every configuration key is yourphr-prefixed, lowercase, dot-separated, hyphens inside a segment, no underscores',
    badShape.length === 0, badShape.join(', '));

  // envNameFor collapses BOTH dots and hyphens to '_', so it is not injective on its own: `a.b-c`
  // and `a-b.c` produce the same variable. Banning underscores does not fix that — only this does.
  const byEnvName = new Map<string, string[]>();
  for (const key of catalogKeys) {
    const name = envNameFor(key);
    byEnvName.set(name, [...(byEnvName.get(name) ?? []), key]);
  }
  const collisions = [...byEnvName.entries()].filter(([, keys]) => keys.length > 1);
  check('no two configuration keys map to the same environment variable name',
    collisions.length === 0, collisions.map(([n, k]) => `${n} <- ${k.join(' + ')}`).join('; '));

  check('the environment name derives from the key itself, carrying its own prefix',
    envNameFor('yourphr.auth.password.min-length') === 'YOURPHR_AUTH_PASSWORD_MIN_LENGTH');
  // The deployed manifests still set SPIKE_* — including SOPS-encrypted secrets whose variable
  // names live inside the encrypted payload — so the old name must keep working until the cut-over.
  check('the pre-#627 SPIKE_ name is still accepted, so a running deployment does not crash-loop on rename',
    legacyEnvNameFor('yourphr.database.encryption.key') === 'SPIKE_DATABASE_ENCRYPTION_KEY');

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
}

main().catch((err) => { console.error(`framework harness failed: ${(err as Error).stack ?? (err as Error).message}`); process.exit(1); });
