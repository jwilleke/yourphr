import { test, expect } from '@playwright/test';
import { login, trackPageHealth } from './helpers';
import { API_BASE } from './constants';

// Phase 3 (#131): with a synthetic Synthea bundle seeded in global-setup, verify the source is
// present and that the data-bearing pages render cleanly (no CSP violations / uncaught JS) — i.e.
// real FHIR content displays without errors, not just the empty-account state the smoke suite sees.
test('seeded FHIR data: source present + records pages render clean', async ({ page }) => {
  const health = trackPageHealth(page);
  await login(page);

  // The seeded manual source should be listed. page.request shares the browser's auth cookie.
  const resp = await page.request.get(`${API_BASE}/secure/source`);
  expect(resp.ok(), `GET /api/secure/source -> ${resp.status()}`).toBeTruthy();
  const body = await resp.json();
  const sources = Array.isArray(body) ? body : (body?.data ?? []);
  expect(sources.length, 'expected ≥1 seeded source (Synthea bundle)').toBeGreaterThan(0);

  // Data-bearing pages render without CSP violations or uncaught errors.
  for (const path of ['medical-history', 'labs']) {
    await page.goto(path);
    await expect(page.locator('app-root')).toBeVisible();
    await page.waitForTimeout(1500);
  }
  expect(health.cspViolations, `CSP violations:\n${health.cspViolations.join('\n')}`).toEqual([]);
  expect(health.pageErrors, `uncaught page errors:\n${health.pageErrors.join('\n')}`).toEqual([]);
});

// Phase 3 (#131): the "Export to PDF" path — GET /api/secure/summary/ips?format=pdf renders the
// International Patient Summary from the seeded data through the ips_pdf renderer.
//
// This test caught a REAL backend bug (#148): the seed manual-import 500'd intermittently under CI
// because gin.SaveUploadedFile chmod()s the temp dir, which the sandboxed runner forbids — so IPS
// then had no patient data to render. Fixed by streaming the upload with io.Copy (865bc72c); re-enabled.
test('IPS export renders a PDF (and HTML) from seeded data — #148', async ({ page }) => {
  await login(page); // page.request inherits the browser session cookie

  const pdf = await page.request.get(`${API_BASE}/secure/summary/ips?format=pdf`);
  expect(pdf.ok(), `IPS pdf export -> ${pdf.status()}`).toBeTruthy();
  expect(pdf.headers()['content-type']).toContain('application/pdf');
  const bytes = await pdf.body();
  expect(bytes.length, 'PDF should be non-trivial').toBeGreaterThan(1000);
  expect(bytes.subarray(0, 5).toString('latin1'), 'PDF magic bytes').toBe('%PDF-');

  const html = await page.request.get(`${API_BASE}/secure/summary/ips?format=html`);
  expect(html.ok(), `IPS html export -> ${html.status()}`).toBeTruthy();
  expect(html.headers()['content-type']).toContain('text/html');
});
