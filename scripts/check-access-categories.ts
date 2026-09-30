/**
 * Every GET under /api/secure/ either has an access category or says why not (yourphr#657).
 *
 *   npm run check:categories
 *
 * The access category is what makes a read visible: it is the line in the patient's own access log
 * ("who read my record, and when") and, since agent tokens (yourphr#695), the ONLY thing a token's
 * scope can name. A route that reads record content with no category is a read the patient is never
 * told about, and one an agent token can never be granted — both silently. #599's search box was
 * exactly that until someone read the code; this makes the next one fail CI instead.
 *
 * The check reads src/server.ts statically, the way scripts/check-routes.ts does, and asks
 * accessCategoryFor() (src/account/index.ts) about every path the server can answer to a GET:
 * literal paths directly, pattern routes through sample paths expanded from their regex. A path with
 * no category must be listed below with its reason:
 *
 *   EXEMPT          — not a read of anyone's record (the caller's own account, instance settings,
 *                     admin screens, job history). A category here would be noise in the log.
 *   KNOWN_UNLOGGED  — DOES read record content and has no category yet. Each names its issue, so
 *                     the gap is tracked rather than forgotten; the fix is a category, which is a
 *                     scope-vocabulary change and therefore the operator's decision.
 *
 * What it does NOT prove: a route whose method check sits several lines away from its path test is
 * counted as GET-capable (conservative — it can only add work, never hide a read). A route built some
 * other way than `url.pathname === '…'` or `url.pathname.match(/…/)` is not seen; the list of forms
 * is at the bottom, next to the parser.
 */
import { readFileSync } from 'node:fs';
import { accessCategoryFor } from '../src/account/index.js';

const SERVER = 'src/server.ts';

/** Not a read of record content. The reason is printed if the route ever gains one. */
const EXEMPT: Record<string, string> = {
  '/api/secure/account/me': 'who the caller is — their own account, not a record',
  '/api/secure/account/access-log': 'the access log itself; reading it is not an access (#563)',
  '/api/secure/account/agent-tokens': 'the caller\'s own credentials — the management surface tokens are barred from',
  '/api/secure/account/devices': 'the caller\'s own connected-device permissions (yourphr#808) — a management surface device keys are barred from',
  '/api/secure/account/legal-consent': 'the caller\'s own consent status',
  '/api/secure/notifications': 'the caller\'s own notices (#793)',
  '/api/secure/instance': 'the instance\'s name and operator contact',
  '/api/secure/users': 'admin: account names and roles, no record content',
  '/api/secure/provider-catalog': 'the list of providers a person may connect to',
  '/api/secure/provider-catalog/x': 'one catalog entry',
  '/api/secure/source': 'the caller\'s connected sources — connection metadata, not records',
  '/api/secure/source/x': 'one connected source\'s metadata',
  '/api/secure/source/x/summary': 'counts per resource type for one source, not content',
  '/api/secure/source/relay-config': 'whether a relay is configured',
  '/api/secure/jobs': 'sync job history — outcomes and counts, not records',
  '/api/secure/admin/database': 'admin: database size, integrity and backups',
  '/api/secure/admin/database/browse': 'admin: server folders for a backup destination',
  '/api/secure/admin/config': 'admin: configuration snapshot',
  '/api/secure/admin/config/reveal/x': 'admin: one configuration value',
  '/api/secure/admin/logs': 'admin: server log lines, which never carry record content',
  '/api/secure/admin/metrics': 'admin: sync metrics',
  '/api/secure/admin/instance': 'admin: instance settings',
  '/api/secure/admin/mail': 'admin: mail settings (#536)',
  '/api/secure/records/identities': 'which source identities the caller has confirmed as themselves — identity answers, not clinical content',
  '/api/secure/records/review': 'the caller\'s own records held for review before they join the chart',
  '/api/secure/admin/catalog': 'admin: the provider catalog',
  '/api/secure/provider-catalog/connectable': 'which providers the caller may connect to',
  '/api/secure/provider-catalog/sandbox': 'the sandbox providers offered for testing',
  '/api/secure/source/cda-converter/status': 'whether the C-CDA converter is reachable',
  '/api/secure/events/stream': 'sync progress events — outcomes and counts, not records',
  '/api/secure/glossary/code': 'a plain-language explanation of a code: a public dictionary, not the caller\'s record',
  '/api/secure/devices': 'the names the caller gave their own measuring devices — labels, not readings',
  '/api/secure/user/favorites': 'which records the caller starred — ids, not content',
};

/** Reads record content with no category yet — tracked, not forgiven. */
const KNOWN_UNLOGGED: Record<string, string> = {};

// --- the parser: which paths answer a GET ---

const lines = readFileSync(SERVER, 'utf8').split('\n');
const OTHER_METHOD = /req\.method\s*===\s*'(POST|PUT|DELETE|PATCH)'/;
const GET_METHOD = /req\.method\s*===\s*'GET'/;

const literals = new Set<string>();
for (const line of lines) {
  for (const m of line.matchAll(/url\.pathname\s*===\s*'(\/api\/secure\/[^']*)'/g)) {
    // A line that pins another method is not a GET. One that pins nothing may be answered for GET
    // further down — counted, which can only make the check stricter.
    if (OTHER_METHOD.test(line) && !GET_METHOD.test(line)) continue;
    literals.add(m[1]!);
  }
}

/** Pattern routes: `const name = url.pathname.match(/^\/api\/secure\/…$/)`, then `if (name && req.method === …)`. */
const patterns: { source: string; samples: string[] }[] = [];
lines.forEach((line, i) => {
  const m = /const (\w+) = url\.pathname\.match\(\/(\^\\\/api\\\/secure\\\/.*\$)\/\)/.exec(line);
  if (!m) return;
  const [, name, re] = m;
  const uses = lines.filter((l) => new RegExp(`\\b${name}\\b`).test(l) && l.includes('req.method'));
  const answersGet = uses.length === 0 || uses.some((l) => GET_METHOD.test(l) || !OTHER_METHOD.test(l));
  if (!answersGet) return;
  // The handler's own lines, up to the next route match: where each alternative pins its method, as
  // `action === 'sync' && req.method === 'POST'` does. An alternative whose every such line names
  // another method is not a GET path.
  const end = lines.findIndex((l, j) => j > i && /url\.pathname\.match\(/.test(l));
  const block = lines.slice(i + 1, end === -1 ? i + 150 : end);
  const samples = expand(re!).filter((sample) => {
    const last = sample.split('/').pop()!;
    const pinned = block.filter((l) => l.includes(`'${last}'`) && l.includes('req.method'));
    return pinned.length === 0 || pinned.some((l) => GET_METHOD.test(l));
  });
  patterns.push({ source: re!, samples });
});

/**
 * Sample paths for a route regex: `([^/]+)` becomes `x`, an alternation becomes each alternative, an
 * optional group becomes with-and-without. Enough for the forms server.ts uses; anything else is
 * reported as unparsed rather than skipped.
 */
function expand(re: string): string[] {
  let body = re.replace(/^\^/, '').replace(/\$$/, '').replace(/\\\//g, '/');
  body = body.replace(/\(\[\^\/\]\+\)/g, 'x');
  const results: string[] = [];
  const walk = (s: string): void => {
    const opt = /\(\?:([^()]*(?:\([^()]*\))?[^()]*)\)\?/.exec(s);
    if (opt) {
      walk(s.slice(0, opt.index) + s.slice(opt.index + opt[0].length));
      walk(s.slice(0, opt.index) + opt[1] + s.slice(opt.index + opt[0].length));
      return;
    }
    const alt = /\(([^()?]+\|[^()]+)\)/.exec(s);
    if (alt) {
      for (const choice of alt[1]!.split('|')) walk(s.slice(0, alt.index) + choice + s.slice(alt.index + alt[0].length));
      return;
    }
    results.push(s);
  };
  walk(body);
  return results;
}

// --- the verdict ---

const paths = [...new Set([...literals, ...patterns.flatMap((p) => p.samples)])].sort();
const unparsed = paths.filter((p) => /[()[\]\\|?*+]/.test(p));
const uncategorised = paths.filter((p) => !unparsed.includes(p) && accessCategoryFor(p) === undefined);
const unexplained = uncategorised.filter((p) => !(p in EXEMPT) && !(p in KNOWN_UNLOGGED));
const stale = [...Object.keys(EXEMPT), ...Object.keys(KNOWN_UNLOGGED)].filter((p) => !paths.includes(p) || accessCategoryFor(p) !== undefined);

const categorised = paths.length - uncategorised.length - unparsed.length;
console.log(`  server answers GET on ${paths.length} /api/secure/ paths: ${categorised} with an access category, ${uncategorised.length - unexplained.length} listed with a reason (${Object.keys(KNOWN_UNLOGGED).length} of them known unlogged reads)`);

let failed = false;
if (unexplained.length) {
  failed = true;
  console.log(`\n  ✗ ${unexplained.length} GET path(s) with no access category and no stated reason:\n`);
  for (const p of unexplained) console.log(`      ${p}`);
  console.log('\n    A read of record content needs a category in accessCategoryFor() (src/account/index.ts) — otherwise the');
  console.log('    patient\'s access log never shows it and no agent token can be scoped to it. Anything else goes in EXEMPT');
  console.log('    in scripts/check-access-categories.ts, with the reason.');
}
if (unparsed.length) {
  failed = true;
  console.log(`\n  ✗ route pattern(s) this check cannot expand into sample paths — teach expand() the form:\n`);
  for (const p of unparsed) console.log(`      ${p}`);
}
if (stale.length) {
  failed = true;
  console.log(`\n  ✗ listed path(s) the server no longer answers, or that now have a category — remove them from the list:\n`);
  for (const p of stale) console.log(`      ${p}`);
}
if (failed) process.exit(1);
console.log('  categories: clean — every GET under /api/secure/ is categorised, exempt with a reason, or a tracked gap');
