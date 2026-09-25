/**
 * Every path the Angular app calls is a path the server routes (yourphr#689).
 *
 *   npm run check:routes
 *
 * The frontend and the server are two halves of one contract and nothing compared them, so they
 * drifted apart through the entire TypeScript rewrite. Nine live endpoints were missing — a
 * practitioner could be listed but not edited, a sync failure could not be recorded — and it was
 * found by a grep months later rather than by CI.
 *
 * ## Why the parity audit did not cover this
 *
 * `frontend/scripts/parity-audit.mjs` walked 28 routes and recorded what each page requested ON
 * LOAD, across eight passes. It passed honestly. Every gap it missed is reached on INTERACTION —
 * pressing Edit, adding a related record, a provider connection actually failing — which a
 * load-time audit structurally cannot see, and which only happens when somebody runs it.
 *
 * This check has neither limitation. It is static, so it sees every call site whether or not a
 * user could reach it, and it runs on every commit.
 *
 * ## What it does NOT prove
 *
 * That a path is ROUTED, not that the flow WORKS. A route can exist and return the wrong shape, or
 * 500, or save to the wrong account. That is E2E's job (yourphr#690). The two are complementary:
 * this one is cheap and total, E2E is expensive and deep.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SERVER = 'src/server.ts';
const FRONTEND = 'frontend/src/app';

/**
 * Endpoints the frontend calls that the server does not route, each with the issue that owns it.
 *
 * This list exists so the check can land NOW, red on new drift rather than red on the backlog. It
 * is not a place to put things: an entry without an issue number is a bug nobody is tracking, and
 * every entry here is a feature a person can reach and cannot use. It should only ever shrink.
 */
const KNOWN_MISSING: Record<string, string> = {
  // Found by this check on its first run — none was in yourphr#680's original twelve, because that
  // list came from a grep of fasten-api.service.ts alone and these live in auth.service.ts.
  '/api/auth/callback/:p': 'yourphr#693',
};

/**
 * Literal paths that a parameter route swallows, each with the issue that owns it.
 *
 * Separate from KNOWN_MISSING because the failure is different and worse: the route ANSWERS,
 * treating the literal as an id. `/secure/source/authorize` reaches `/secure/source/:id` and is
 * handled as a lookup for a source called "authorize" — a wrong answer rather than an obvious one.
 */
const KNOWN_SWALLOWED: Record<string, string> = {
};

/** Every `.ts` under the Angular app, specs excluded. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) sourceFiles(full, out);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

/**
 * Every `/api/...` path the app builds, with `${...}` interpolation normalised to `:p`.
 *
 * Scans the WHOLE app, not just services/. Scoping this to the API service was the check's own
 * blind spot (yourphr#694): `settings.component.ts` calls `this.http` directly, so three unrouted
 * endpoints sat inside a guard that reported clean. A check with a scope narrower than the problem
 * is the same failure it exists to catch.
 */
function frontendPaths(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of sourceFiles(FRONTEND)) {
    // Strip line comments first. A comment NAMING an endpoint is not a call, and counting one as a
    // call is how a check comes to report a path the app never requests — which then gets
    // allow-listed, and the allow-list stops meaning anything. `:` guards `https://`.
    const text = readFileSync(file, 'utf8')
      .split('\n')
      .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
      .join('\n');
    // Scan the whole file, not line by line: a URL is routinely built ACROSS lines, so the line
    // holding the path often does not hold the http call. Filtering per line dropped
    // getPractitionerHistory() — a real gap — and the check reported clean. Look BEHIND each match
    // instead, far enough to see how it is being used.
    for (const m of text.matchAll(/\/(secure|auth|legal|glossary)\/([A-Za-z0-9/_\-.]+(?:\$\{[^}]*\}[A-Za-z0-9/_\-.]*)*)/g)) {
      const before = text.slice(Math.max(0, (m.index ?? 0) - 220), m.index ?? 0);
      // An Angular ROUTER path looks identical to an API path and is not one.
      if (/router\.navigate|routerLink|navigateByUrl|redirectTo|\bpath:\s*['"`]/.test(before.slice(-120))) continue;
      const path = `/api/${m[1]}/${(m[2] as string).replace(/\$\{[^}]*\}/g, ':p')}`.replace(/[,`'"?.]+$/, '').replace(/\/$/, '');
      const rel = file.replace(`${FRONTEND}/`, '');
      if (!found.has(path)) found.set(path, []);
      const at = found.get(path) as string[];
      if (!at.includes(rel)) at.push(rel);
    }
  }
  return found;
}

interface ServerRoutes {
  literals: Set<string>;
  patterns: RegExp[];
}

/** What the server actually routes: quoted literals, and the anchored regexes it matches on. */
function serverRoutes(): ServerRoutes {
  const text = readFileSync(SERVER, 'utf8');
  const literals = new Set(
    [...text.matchAll(/'(\/api\/[^']*)'/g)].map((m) => m[1] as string)
  );
  const patterns: RegExp[] = [];
  // Both spellings the server uses: `url.pathname.match(/^…/)` and `/^…/.exec(url.pathname)`. Only
  // the first was read, so an .exec route was invisible here — reported as unrouted when it is
  // served, and, worse, its KNOWN_MISSING entry could never go stale. A route the check cannot see
  // is a route it cannot vouch for, in either direction.
  for (const m of [...text.matchAll(/\.match\((\/\^[^;\n]+?\/)\)/g), ...text.matchAll(/(\/\^[^;\n]+?\/)\.exec\(/g)]) {
    const body = (m[1] as string).slice(1, -1);
    try {
      patterns.push(new RegExp(body.replace(/\\\//g, '/')));
    } catch {
      // A pattern this reader cannot compile is reported rather than silently skipped: a route the
      // check cannot see is a route it cannot vouch for.
      console.error(`  check-routes: could not compile a server pattern: ${body}`);
    }
  }
  return { literals, patterns };
}

function main(): void {
  const fe = frontendPaths();
  const { literals, patterns } = serverRoutes();
  console.log(`  frontend calls ${fe.size} paths; server declares ${literals.size} literals and ${patterns.length} patterns`);

  const missing: string[] = [];
  const swallowed: string[] = [];
  const staleAllow = new Set(Object.keys(KNOWN_MISSING));
  const staleSwallow = new Set(Object.keys(KNOWN_SWALLOWED));
  const nowRouted: string[] = [];

  for (const [path, files] of [...fe].sort()) {
    const probe = path.replace(/:p/g, 'X');
    const byLiteral = literals.has(path) || literals.has(probe);
    const byPattern = patterns.some((r) => r.test(probe));

    if (byLiteral || byPattern) {
      // Routed — so an allow-list entry for it is a FIXED bug still being reported as broken.
      // Deleting it from the stale set here (as this did) forgave exactly the case the list is
      // meant to resist: someone lands the fix and forgets to remove the entry, and the check goes
      // on quietly excusing a path it should now be enforcing. Found by trying to defeat it.
      if (KNOWN_MISSING[path]) nowRouted.push(`${path}  (${KNOWN_MISSING[path]})`);
      staleAllow.delete(path);
      // A literal segment that only matches through a PARAMETER is worse than a 404: the route
      // answers, treating the word as an id. `/secure/source/authorize` against `/source/:id`
      // returns a source lookup for the id "authorize" rather than an obvious failure.
      if (!byLiteral && !path.includes(':p') && byPattern && !KNOWN_SWALLOWED[path]) {
        swallowed.push(`${path}  (${files.join(', ')})`);
      }
      if (KNOWN_SWALLOWED[path]) staleSwallow.delete(path);
      continue;
    }

    if (KNOWN_MISSING[path]) {
      staleAllow.delete(path);
      continue;
    }
    missing.push(`${path}  (${files.join(', ')})`);
  }

  let status = 0;

  if (missing.length > 0) {
    console.error('\nThe frontend calls paths the server does not route:\n');
    for (const m of missing) console.error(`  ${m}`);
    console.error('\nEither add the route, remove the call, or — if it is a known gap with an issue —');
    console.error('add it to KNOWN_MISSING in scripts/check-routes.ts with that issue number.');
    status = 1;
  }

  if (swallowed.length > 0) {
    console.error('\nA literal path that only matches a PARAMETER route — it answers as the wrong thing:\n');
    for (const s of swallowed) console.error(`  ${s}`);
    status = 1;
  }

  for (const k of staleSwallow) {
    console.error(`\nKNOWN_SWALLOWED entry no longer swallowed — delete it: ${k} (${KNOWN_SWALLOWED[k]})`);
    status = 1;
  }

  if (nowRouted.length > 0) {
    console.error('\nKNOWN_MISSING entries the server now routes — the gap is fixed, delete them:\n');
    for (const n of nowRouted) console.error(`  ${n}`);
    status = 1;
  }

  if (staleAllow.size > 0) {
    // The other half: an entry for a path the frontend no longer calls at all.
    console.error('\nKNOWN_MISSING entries that are no longer missing — delete them:\n');
    for (const k of staleAllow) console.error(`  ${k}  (${KNOWN_MISSING[k]})`);
    status = 1;
  }

  if (status === 0) {
    const n = Object.keys(KNOWN_MISSING).length + Object.keys(KNOWN_SWALLOWED).length;
    console.log(`  routes: clean — every path the frontend calls is routed, or is one of the ${n} known gap(s), each with its own issue`);
  }
  process.exitCode = status;
}

main();
