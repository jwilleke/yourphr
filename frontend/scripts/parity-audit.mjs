/**
 * Parity audit (yourphr#591): drive the real Angular app against a backend and record every
 * /api/ call each route makes, with its status. The gap list for the TypeScript stack is whatever
 * comes back 404 — measured from what the UI actually does, not from a feature list.
 *
 *   node frontend/scripts/parity-audit.mjs --base http://127.0.0.1:18090 --user <name> \
 *        --password-file <file> [--out report.json] [--routes a,b,c]
 *
 * Uses the frontend's Playwright (run from the repo root). Headless. No PHI is written: the
 * report holds routes, endpoints and statuses only.
 */
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const arg = (f, d) => { const i = argv.indexOf(f); return i === -1 ? d : argv[i + 1]; };
const base = (arg('--base') ?? '').replace(/\/$/, '');
const user = arg('--user');
const passwordFile = arg('--password-file');
const out = arg('--out', 'parity-report.json');
if (!base || !user || !passwordFile) {
  console.error('usage: --base <url> --user <name> --password-file <file> [--out report.json] [--routes a,b]');
  process.exit(2);
}
const password = readFileSync(passwordFile, 'utf8').trim();

// Every navigable route from app-routing.module.ts that needs no path parameter and is not an
// auth/callback/wizard/demo page. Parameterised routes are reached by clicking through from these.
const DEFAULT_ROUTES = [
  'dashboard', 'sources', 'explore', 'medical-history', 'medical-concerns', 'medications', 'allergies',
  'immunizations', 'labs', 'procedures', 'practitioners', 'patient-profile', 'account-profile',
  'settings', 'users', 'background-jobs', 'resource/add',
  'admin', 'admin/config', 'admin/database', 'admin/logs', 'admin/provider-catalog', 'sandbox',
  'privacy', 'terms', 'contact', 'attributions',
];
const routes = (arg('--routes') ? arg('--routes').split(',') : DEFAULT_ROUTES).map((r) => r.replace(/^\//, ''));

const normalise = (url) => {
  const u = new URL(url);
  return u.pathname.replace(base, '')
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/{uuid}')
    .replace(/\/\d+(?=\/|$)/g, '/{n}') + (u.search ? '?' + [...u.searchParams.keys()].sort().join('&') : '');
};

const browser = await chromium.launch();
const page = await browser.newPage();
let bucket = [];
const consoleErrors = [];
page.on('response', (res) => {
  const url = res.url();
  if (!url.startsWith(base + '/api/')) return;
  bucket.push({ method: res.request().method(), path: normalise(url), status: res.status() });
});
page.on('requestfailed', (req) => {
  if (req.url().startsWith(base + '/api/')) bucket.push({ method: req.method(), path: normalise(req.url()), status: 0, failure: req.failure()?.errorText });
});
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push({ route: currentRoute, text: m.text().slice(0, 200) }); });
page.on('pageerror', (e) => consoleErrors.push({ route: currentRoute, text: `pageerror: ${String(e).slice(0, 200)}` }));
let currentRoute = 'auth/signin';

// --- sign in through the real form ---
await page.goto(`${base}/auth/signin`, { waitUntil: 'networkidle' });
const preLogin = [...bucket]; bucket = [];
await page.getByPlaceholder('Enter your username').fill(user);
await page.getByPlaceholder('Enter your password').fill(password);
await Promise.all([
  page.waitForResponse((r) => r.url().includes('/api/auth/signin')).catch(() => null),
  page.getByRole('button', { name: /sign in/i }).click(),
]);
await page.waitForTimeout(2500);
const afterSignin = page.url().replace(base, '');
const signinCalls = [...bucket]; bucket = [];
const tokenPresent = await page.evaluate(() => Object.keys(localStorage).some((k) => /token|auth/i.test(k)) || Object.keys(sessionStorage).some((k) => /token|auth/i.test(k)));

// --- walk the routes ---
const report = { base, user, preLogin, signin: { landedOn: afterSignin, tokenPresent, calls: signinCalls }, routes: {}, consoleErrors };
const signInAgain = async () => {
  await page.goto(`${base}/auth/signin`, { waitUntil: 'networkidle' }).catch(() => null);
  await page.getByPlaceholder('Enter your username').fill(user);
  await page.getByPlaceholder('Enter your password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForTimeout(2000);
};
let reSignIns = 0;
for (const route of routes) {
  currentRoute = route;
  // One route bouncing the session must not measure the next thirteen as logged-out.
  if (page.url().includes('/auth/signin')) { reSignIns++; await signInAgain(); }
  bucket = [];
  let landed = '';
  try {
    await page.goto(`${base}/${route}`, { waitUntil: 'networkidle', timeout: 20000 });
  } catch {
    // networkidle can time out on a page that polls; what was captured still counts
  }
  await page.waitForTimeout(1200);
  landed = page.url().replace(base, '');
  const heading = (await page.locator('h1, h2, .page-title, .card-title').first().textContent().catch(() => ''))?.trim().slice(0, 80) ?? '';
  const dedup = new Map();
  for (const c of bucket) dedup.set(`${c.method} ${c.path} ${c.status}`, c);
  report.routes[route] = { landedOn: landed, heading, calls: [...dedup.values()] };
}
await browser.close();

// --- summary: endpoint -> statuses -> routes ---
const endpoints = new Map();
for (const [route, r] of Object.entries(report.routes)) {
  for (const c of r.calls) {
    const key = `${c.method} ${c.path}`;
    const e = endpoints.get(key) ?? { statuses: new Set(), routes: new Set() };
    e.statuses.add(c.status); e.routes.add(route); endpoints.set(key, e);
  }
}
report.endpoints = [...endpoints.entries()].map(([k, e]) => ({ endpoint: k, statuses: [...e.statuses].sort(), routes: [...e.routes] }))
  .sort((a, b) => a.endpoint.localeCompare(b.endpoint));
writeFileSync(out, JSON.stringify(report, null, 2));

const ok = report.endpoints.filter((e) => e.statuses.every((s) => s >= 200 && s < 300));
const missing = report.endpoints.filter((e) => e.statuses.includes(404));
const other = report.endpoints.filter((e) => !ok.includes(e) && !missing.includes(e));
report.reSignIns = reSignIns;
console.log(`signed in -> ${afterSignin}; ${routes.length} routes; ${report.endpoints.length} distinct endpoints; re-sign-ins needed: ${reSignIns}`);
console.log(`  served 2xx: ${ok.length}   missing 404: ${missing.length}   other: ${other.length}   console errors: ${consoleErrors.length}`);
console.log('\nMISSING (404) — endpoint  <- routes that call it');
for (const e of missing) console.log(`  ${e.endpoint.padEnd(58)} <- ${e.routes.join(', ')}`);
if (other.length) { console.log('\nOTHER statuses'); for (const e of other) console.log(`  ${e.endpoint.padEnd(58)} ${e.statuses.join(',')} <- ${e.routes.join(', ')}`); }
console.log('\nSERVED'); for (const e of ok) console.log(`  ${e.endpoint.padEnd(58)} <- ${e.routes.join(', ')}`);
console.log(`\nreport -> ${out}`);
