import { test, expect } from '@playwright/test';
import { login, trackPageHealth } from './helpers';

// Phase 3 (#131): the BYO SMART-on-FHIR connect flow (EPIC #20 / #52). Playwright was chosen over
// Cypress specifically because it can drive the OAuth LOGIN POPUP (window.open) — so this spec is the
// regression guard for that mechanism, and it runs on BOTH chromium + firefox (the multi-browser
// popup matrix is the point).
//
// We can't complete a real OAuth handshake — there's no live provider and fasten-sources is stubbed
// in this fork — so we point the FHIR base URL at the local backend. The contract we verify:
//   1. the popup opens SYNCHRONOUSLY inside the click handler (the documented "window.open after an
//      await gets blocked" bug — see connectSmartSource), and
//   2. backend SMART discovery against the stub fails fast and the flow surfaces a HANDLED error in
//      the modal — never an uncaught exception / CSP violation.
test('SMART connect opens the login popup (window.open) and handles the result', async ({ page }) => {
  const health = trackPageHealth(page);
  await login(page);

  // BYO SMART connect moved off /sources to the admin-only /sandbox page (ab451100); the e2e user is
  // the first account, which the backend assigns the admin role.
  await page.goto('sandbox');
  await page.getByRole('button', { name: 'Connect a SMART source' }).click();

  const modal = page.locator('.modal-content', { hasText: 'Connect a SMART source' });
  await expect(modal).toBeVisible();

  // Synthetic config: a syntactically valid FHIR base URL that resolves locally (no external network
  // / DNS), so backend SMART discovery fails fast and deterministically.
  await modal.locator('#smart-api-endpoint').fill('http://localhost:9191/r4');
  await modal.locator('#smart-client-id').fill('e2e-test-client');
  // #smart-scopes is pre-filled with a sensible default; leave it.

  // The popup must open synchronously on click — Promise.all so we're listening before it fires.
  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    modal.getByRole('button', { name: 'Connect', exact: true }).click(),
  ]);
  expect(popup, 'SMART connect should open a login popup window').toBeTruthy();

  // Discovery against the local stub can't yield a valid authorize URL, so the flow surfaces a handled
  // error in the modal (success is impossible without a real provider). This proves the whole handler
  // ran to completion rather than throwing.
  await expect(modal.locator('.alert-danger')).toBeVisible({ timeout: 30_000 });

  await popup.close().catch(() => { /* popup may already be closed by the flow */ });

  expect(health.cspViolations, `CSP violations:\n${health.cspViolations.join('\n')}`).toEqual([]);
  expect(health.pageErrors, `uncaught page errors:\n${health.pageErrors.join('\n')}`).toEqual([]);
});
