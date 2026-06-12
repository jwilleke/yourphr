// Display-triage helper (#262/#264): render a single fhir-card via Storybook and capture what it
// actually shows — the title, the full card text, and a screenshot. Used to verify patient-legibility
// of a resource's display and to confirm fixes.
//
// Usage:
//   npm run build-storybook
//   (cd storybook-static && python3 -m http.server 6007 &)
//   node scripts/observe-card.mjs \
//     "http://localhost:6007/iframe.html?id=<story-id>&viewMode=story" /tmp/card.png
//
// The story id comes from storybook-static/index.json (e.g.
// "fhir-card-medicationstatement--r-4-ccda-metriport").

import { chromium } from 'playwright';

const url = process.argv[2];
const out = process.argv[3] || '/tmp/card.png';

if (!url) {
  console.error('usage: node scripts/observe-card.mjs <story-iframe-url> [out.png]');
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 720, height: 900 } });
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForSelector('.card-fhir-resource', { timeout: 20000 });

const card = page.locator('.card-fhir-resource').first();
await card.screenshot({ path: out });

const title = await page.locator('.card-title').first().innerText().catch(() => '(none)');
const text = await card.innerText();
console.log('TITLE: ' + JSON.stringify(title));
console.log('--- RENDERED CARD TEXT ---');
console.log(text);
console.log('--- screenshot: ' + out + ' ---');
await browser.close();
