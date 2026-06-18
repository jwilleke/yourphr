import { test, expect, Page } from '@playwright/test';
import { login, trackPageHealth } from './helpers';

// One-click sandbox connect (#291). The /sandbox admin page lists the server-CONFIGURED sandbox
// providers (credentials supplied from env on the server) and connects each with a single click — the
// admin never types or sees a client_id/secret, and the connect request carries ONLY the catalog id.
//
// CI-safe: the backend is MOCKED via page.route, so NO external network and NO real credentials are
// touched. The contracts under test:
//   1. the page renders the configured sandbox providers returned by /provider-catalog/sandbox,
//   2. clicking Connect opens the OAuth popup SYNCHRONOUSLY (the window.open-after-await bug),
//   3. the flow drives the catalog endpoints (/provider-catalog/:id/authorize + /connect) carrying
//      NO client_id / client_secret — credentials stay server-side.

// A fake configured sandbox provider (credential-free projection, exactly what the backend returns).
const FAKE_SANDBOX = { id: 'bb-sandbox-id', display: 'Medicare — Blue Button 2.0 (Sandbox)', brand_logo_url: '' };

// Mock the sandbox list so the page has a Connect button without any env-configured backend.
async function mockSandboxList(page: Page, providers: any[] = [FAKE_SANDBOX]): Promise<void> {
  await page.route('**/api/secure/provider-catalog/sandbox', async (route) => {
    await route.fulfill({ json: { success: true, data: providers } });
  });
}

test.describe('sandbox connect — one-click, credential-free (backend mocked)', () => {
  test('lists configured sandboxes and connects with one click — no creds in the request', async ({ page }) => {
    const health = trackPageHealth(page);
    await login(page);
    await mockSandboxList(page);

    // Capture the two catalog calls the connect flow makes; short-circuit so no provider/relay is hit.
    let authorizeUrlPath: string | null = null;
    let connectBody: any = null;

    await page.route('**/api/secure/provider-catalog/*/authorize', async (route) => {
      authorizeUrlPath = new URL(route.request().url()).pathname;
      await route.fulfill({
        json: { success: true, authorize_url: 'about:blank', state: 'test-state', code_verifier: 'test-verifier', login_wait_seconds: 240 },
      });
    });
    await page.route('**/api/secure/provider-catalog/*/connect', async (route) => {
      connectBody = route.request().postDataJSON();
      await route.fulfill({
        json: { success: true, source: { id: 'sb-bluebutton', display: 'Blue Button' }, data: { status: 'import_started' } },
      });
    });

    await page.goto('sandbox');
    const card = page.locator('.card', { hasText: 'Blue Button 2.0 (Sandbox)' });
    await expect(card).toBeVisible();

    // The popup must open synchronously inside the click handler (the window.open-after-await bug).
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      card.getByRole('button', { name: 'Connect', exact: true }).click(),
    ]);
    expect(popup, 'connect should open the OAuth login popup').toBeTruthy();

    // On success the page shows a success alert ("Connected to …").
    await expect(page.locator('.alert-success')).toBeVisible({ timeout: 30_000 });

    // The flow used the catalog endpoints addressed by the provider id …
    expect(authorizeUrlPath).toContain('/provider-catalog/bb-sandbox-id/authorize');
    // … and the connect request carried NO credentials — only the catalog-driven fields.
    expect(connectBody, 'connect was called').toBeTruthy();
    expect(connectBody.client_id, 'sandbox connect must not send a client_id').toBeUndefined();
    expect(connectBody.client_secret, 'sandbox connect must not send a client_secret').toBeUndefined();
    expect(connectBody.state).toBe('test-state');
    expect(connectBody.code_verifier).toBe('test-verifier');

    await popup.close().catch(() => { /* the flow may have closed it */ });
    expect(health.cspViolations, `CSP violations:\n${health.cspViolations.join('\n')}`).toEqual([]);
    expect(health.pageErrors, `uncaught page errors:\n${health.pageErrors.join('\n')}`).toEqual([]);
  });

  test('empty state: no Connect buttons when no sandboxes are configured', async ({ page }) => {
    await login(page);
    await mockSandboxList(page, []);

    await page.goto('sandbox');
    await expect(page.locator('.alert-info')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect', exact: true })).toHaveCount(0);
  });
});
