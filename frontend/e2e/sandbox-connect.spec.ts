import { test, expect, Page, Locator } from '@playwright/test';
import { login, trackPageHealth } from './helpers';

// Automated connect tests for every test sandbox in docs/test-sandboxes.md.
//
// TWO layers, by design:
//
//   1. CI-safe (default): the backend is MOCKED via page.route, so NO external network and NO real
//      credentials are touched. The contract under test is that the "Connect a SMART source" FORM
//      builds the correct /source/authorize + /source/connect requests for each sandbox (FHIR base
//      URL, scopes, and — critically — client_secret only for confidential clients like Blue Button),
//      opens the OAuth popup synchronously, and surfaces success. This catches the regressions that
//      actually bit us: a mangled base URL, wrong scopes, a missing client_secret field.
//
//   2. @live (opt-in, E2E_LIVE=1): drives a REAL sandbox end-to-end through the provider login. This
//      needs external network + a backend with the relay configured (NOT the default e2e backend) +
//      the provider's login UI, so it is skipped by default and is inherently provider-UI-specific.
//
// The values below are TEST values for the mocked layer — they are NOT real credentials.

interface Sandbox {
  key: string;
  base: string;
  clientId: string;
  secret: string;       // '' = public client (no secret)
  scopes: string;
  confidential: boolean;
}

// Mirrors docs/test-sandboxes.md. athenahealth is omitted: its base URL is site-specific and access
// is approval-gated, so there is no stable endpoint to encode here.
const SANDBOXES: Sandbox[] = [
  {
    key: 'smart-health-it',
    base: 'https://launch.smarthealthit.org/v/r4/sim/eyJsYXVuY2hfdHlwZSI6InBhdGllbnQtc3RhbmRhbG9uZSJ9/fhir',
    clientId: 'my-client-id',
    secret: '',
    scopes: 'launch/patient patient/*.read openid fhirUser offline_access',
    confidential: false,
  },
  {
    key: 'blue-button',
    base: 'https://sandbox.bluebutton.cms.gov/v2/fhir',
    clientId: 'bb-sandbox-client',
    secret: 'bb-sandbox-secret',          // confidential — must reach /connect
    scopes: 'openid profile launch/patient patient/Patient.read patient/Coverage.read patient/ExplanationOfBenefit.read',
    confidential: true,
  },
  {
    key: 'epic',
    base: 'https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4',
    clientId: 'epic-sandbox-client',
    secret: '',
    scopes: 'launch/patient patient/*.read openid fhirUser offline_access',
    confidential: false,
  },
  {
    key: 'oracle-cerner',
    base: 'https://fhir-myrecord.sandboxcerner.com/r4/ec2458f2-1e24-41c8-b71b-0e701af7583d',
    clientId: 'cerner-sandbox-client',
    secret: '',
    scopes: 'launch/patient patient/*.read openid fhirUser offline_access',
    confidential: false,
  },
  {
    key: 'veradigm',
    base: 'https://fhir.fhirpoint.open.allscripts.com/fhirroute/open/76308',
    clientId: 'veradigm-test-guid',
    secret: '',
    scopes: 'launch/patient openid fhiruser offline_access patient/Patient.read',
    confidential: false,
  },
];

// Open the BYO SMART connect modal from the admin-only Sandbox testing page and return its locator.
// (The e2e user is the first registered account, which the backend assigns the admin role, so the
// IsAdminAuthGuard on /sandbox passes.)
async function openConnectModal(page: Page): Promise<Locator> {
  await page.goto('sandbox');
  await page.getByRole('button', { name: 'Connect a SMART source' }).click();
  const modal = page.locator('.modal-content', { hasText: 'Connect a SMART source' });
  await expect(modal).toBeVisible();
  return modal;
}

test.describe('sandbox connect — form builds correct requests (backend mocked)', () => {
  for (const sb of SANDBOXES) {
    test(`${sb.key}: authorize + connect payloads + ${sb.confidential ? 'confidential' : 'public'} client`, async ({ page }) => {
      const health = trackPageHealth(page);
      await login(page);

      // Capture the two backend calls the connect flow makes, and short-circuit them so no external
      // provider / relay is needed. authorize_url is a harmless blank so the popup navigates nowhere.
      let authorizeBody: any = null;
      let connectBody: any = null;

      await page.route('**/api/secure/source/authorize', async (route) => {
        authorizeBody = route.request().postDataJSON();
        await route.fulfill({
          json: { success: true, authorize_url: 'about:blank', state: 'test-state', code_verifier: 'test-verifier', login_wait_seconds: 240 },
        });
      });
      await page.route('**/api/secure/source/connect', async (route) => {
        connectBody = route.request().postDataJSON();
        await route.fulfill({
          json: { success: true, source: { id: `sb-${sb.key}`, display: sb.key }, data: { status: 'import_started' } },
        });
      });

      const modal = await openConnectModal(page);
      await modal.locator('#smart-api-endpoint').fill(sb.base);
      await modal.locator('#smart-client-id').fill(sb.clientId);
      if (sb.secret) await modal.locator('#smart-client-secret').fill(sb.secret);
      await modal.locator('#smart-scopes').fill(sb.scopes);

      // The popup must open synchronously inside the click handler (the window.open-after-await bug).
      const [popup] = await Promise.all([
        page.waitForEvent('popup'),
        modal.getByRole('button', { name: 'Connect', exact: true }).click(),
      ]);
      expect(popup, 'connect should open the OAuth login popup').toBeTruthy();

      // On success the flow dismisses the modal (modalService.dismissAll) — that's the reliable
      // success signal (the success message is set in the same tick as the dismiss, so it may not render).
      await expect(modal).toBeHidden({ timeout: 30_000 });

      // /authorize carried this sandbox's base URL + scopes.
      expect(authorizeBody, 'authorize was called').toBeTruthy();
      expect(authorizeBody.api_endpoint_base_url).toBe(sb.base);
      expect(authorizeBody.scopes).toBe(sb.scopes);

      // /connect carried the client_id + scopes, and the client_secret ONLY for confidential clients.
      expect(connectBody, 'connect was called').toBeTruthy();
      expect(connectBody.client_id).toBe(sb.clientId);
      expect(connectBody.scopes).toBe(sb.scopes);
      if (sb.confidential) {
        expect(connectBody.client_secret, 'confidential client must send its secret').toBe(sb.secret);
      } else {
        expect(connectBody.client_secret, 'public client must not send a secret').toBeFalsy();
      }

      await popup.close().catch(() => { /* the flow may have closed it */ });
      expect(health.cspViolations, `CSP violations:\n${health.cspViolations.join('\n')}`).toEqual([]);
      expect(health.pageErrors, `uncaught page errors:\n${health.pageErrors.join('\n')}`).toEqual([]);
    });
  }

  // Guards: the form rejects an empty submission rather than firing a broken request.
  test('validation: required fields block the connect', async ({ page }) => {
    await login(page);
    let authorizeCalled = false;
    await page.route('**/api/secure/source/authorize', async (route) => { authorizeCalled = true; await route.abort(); });

    const modal = await openConnectModal(page);
    await modal.locator('#smart-api-endpoint').fill('');   // leave required fields empty
    await modal.locator('#smart-client-id').fill('');
    await modal.getByRole('button', { name: 'Connect', exact: true }).click();

    await expect(modal.locator('.alert-danger')).toBeVisible({ timeout: 10_000 });
    expect(authorizeCalled, 'authorize must not be called with empty required fields').toBeFalsy();
  });
});

// ---------------------------------------------------------------------------------------------------
// @live — real end-to-end against the SMART Health IT launcher. OPT-IN ONLY.
//
//   E2E_LIVE=1 yarn playwright test sandbox-connect --grep @live
//
// Run:  YOURPHR_RELAY_URL=https://relay.nerdsbythehour.com YOURPHR_RELAY_SECRET=<secret> \
//       E2E_SMARTHEALTHIT_BASE=<optional non-interactive sim base> E2E_LIVE=1 \
//       npx playwright test sandbox-connect --grep @live
//
// VERIFIED 2026-06-15: with the relay secret wired in, the YourPHR side works end-to-end — /authorize
// builds the live PKCE URL, the popup opens the real launcher, and the backend correctly polls the
// relay for the code. What is NOT solved is the HEADLESS click-through of SMART Health IT's interactive
// launcher (a "Practitioner Login" -> patient pick -> Authorize sequence); several approaches (click
// loop, password fill, sim skip_* flags) did not complete it, and it's brittle third-party UI. So this
// stays a SCAFFOLD: the loop below is a best-effort starting point. For a real end-to-end check, a
// 2-minute MANUAL connect (a human clicks through the launcher) is the reliable proof.
// ---------------------------------------------------------------------------------------------------
test.describe('@live sandbox connect (opt-in: E2E_LIVE=1)', () => {
  test.skip(!process.env.E2E_LIVE, 'set E2E_LIVE=1 and run against a relay-configured backend');

  test('@live SMART Health IT — full OAuth handshake imports records', async ({ page }) => {
    const sb = SANDBOXES[0]; // smart-health-it
    // Override with a non-interactive sim base URL (skip_login + skip_auth + a fixed patient) so the
    // launcher auto-redirects to the relay without a brittle UI click-through. See the launcher sim
    // flags at launch.smarthealthit.org. Falls back to the plain patient-standalone base.
    const baseUrl = process.env.E2E_SMARTHEALTHIT_BASE || sb.base;
    await login(page);
    const modal = await openConnectModal(page);
    await modal.locator('#smart-api-endpoint').fill(baseUrl);
    await modal.locator('#smart-client-id').fill(sb.clientId);
    await modal.locator('#smart-scopes').fill(sb.scopes);

    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      modal.getByRole('button', { name: 'Connect', exact: true }).click(),
    ]);

    // The SMART Health IT launcher is multi-step: a Login screen (dropdown + password pre-filled,
    // any password accepted) -> possibly a patient pick -> an Authorize/Allow consent. Forms are
    // pre-filled, so just click the primary action button at each step until the popup redirects to
    // the relay callback (which is when the backend's poll gets the code and completes the connect).
    await popup.waitForLoadState('domcontentloaded');
    for (let step = 0; step < 8 && !popup.isClosed(); step++) {
      const url = popup.url();
      if (url.includes('relay.nerdsbythehour.com') || url.includes('/callback')) break;
      // The launcher login needs a typed password (any value); fill it if present, then click the
      // primary action button (Login -> [patient pick] -> Authorize/Allow).
      await popup.locator('input[type=password]').first().fill('test').catch(() => {});
      const btn = popup.getByRole('button', { name: /login|authorize|allow|continue|sign in|approve|launch/i }).first();
      if (await btn.count().catch(() => 0)) {
        await btn.click({ timeout: 6_000 }).catch(() => {});
      }
      await popup.waitForTimeout(2500);
    }
    await popup.screenshot({ path: 'test-results/launcher-final.png', fullPage: true }).catch(() => {});

    // Back in the app, a successful connect dismisses the modal (import runs in the background).
    await expect(modal).toBeHidden({ timeout: 120_000 });
  });
});
