import { test, expect } from '@playwright/test';
import { login, trackPageHealth } from './helpers';

// Phase 3 (#131): the one-click sandbox connect flow (EPIC #20 / #291). Playwright was chosen over
// Cypress specifically because it can drive the OAuth LOGIN POPUP (window.open) — so this spec is the
// regression guard for that mechanism, and it runs on BOTH chromium + firefox (the multi-browser
// popup matrix is the point).
//
// We can't complete a real OAuth handshake — there's no live provider and fasten-sources is stubbed in
// this fork — so we mock the catalog list and make /authorize fail. The contract we verify:
//   1. the popup opens SYNCHRONOUSLY inside the click handler (the documented "window.open after an
//      await gets blocked" bug — see connectSandboxProvider), and
//   2. a failed authorize surfaces a HANDLED error on the page — never an uncaught exception / CSP
//      violation.
test('one-click sandbox connect opens the login popup (window.open) and handles a failure', async ({ page }) => {
  const health = trackPageHealth(page);
  await login(page);

  // A configured sandbox provider, so the page renders a Connect button (no env-configured backend).
  await page.route('**/api/secure/provider-catalog/sandbox', async (route) => {
    await route.fulfill({
      json: { success: true, data: [{ id: 'sandbox-1', display: 'Test Sandbox', brand_logo_url: '' }] },
    });
  });
  // Authorize fails fast and deterministically (no external network), so the flow surfaces a handled error.
  await page.route('**/api/secure/provider-catalog/*/authorize', async (route) => {
    await route.fulfill({ status: 502, json: { success: false, error: 'SMART discovery failed' } });
  });

  await page.goto('sandbox');
  const card = page.locator('.card', { hasText: 'Test Sandbox' });
  await expect(card).toBeVisible();

  // The popup must open synchronously on click — Promise.all so we're listening before it fires.
  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    card.getByRole('button', { name: 'Connect', exact: true }).click(),
  ]);
  expect(popup, 'sandbox connect should open a login popup window').toBeTruthy();

  // The failed authorize surfaces a handled error on the page (success is impossible here). This proves
  // the whole handler ran to completion rather than throwing.
  await expect(page.locator('.alert-danger')).toBeVisible({ timeout: 30_000 });

  await popup.close().catch(() => { /* popup may already be closed by the flow */ });

  expect(health.cspViolations, `CSP violations:\n${health.cspViolations.join('\n')}`).toEqual([]);
  expect(health.pageErrors, `uncaught page errors:\n${health.pageErrors.join('\n')}`).toEqual([]);
});
