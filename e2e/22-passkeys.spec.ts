import { expect, test, type Page } from '@playwright/test';
import { trackPageErrors } from './helpers.js';
import { E2E_PASS, E2E_PORT, E2E_USER } from './constants.js';

// yourphr#876. Passkeys, ported from ngdpbase (its tests/e2e/auth.setup.ts drives the same virtual
// authenticator): a person adds one on their profile after confirming with their password, signs out,
// signs back in with the passkey alone, renames it and removes it. The instance's base URL is
// localhost (server.ts), so this journey runs there — a passkey is never offered on another host.
const LOCAL = `http://localhost:${E2E_PORT}`;

async function signInWithPassword(page: Page): Promise<void> {
  await page.goto(`${LOCAL}/auth/signin`);
  await page.getByPlaceholder('Enter your username').fill(E2E_USER);
  await page.getByPlaceholder('Enter your password').fill(E2E_PASS);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
}

async function signOut(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
}

test('a person adds a passkey, signs in with it alone, renames it and removes it', async ({ page }) => {
  const errors = trackPageErrors(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  try {
    // On another name for the same server the browser would refuse the passkey, so none is offered.
    await page.goto(`http://127.0.0.1:${E2E_PORT}/auth/signin`);
    await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('passkey-signin')).toHaveCount(0);

    await signInWithPassword(page);
    await page.goto(`${LOCAL}/account-profile`);
    const card = page.getByTestId('sign-in-methods');
    await expect(card).toContainText('works only on localhost', { timeout: 20_000 });

    // The wrong password confirms nothing.
    await page.fill('#passkey-label', 'E2E key');
    await page.fill('#passkey-password', 'not-the-password');
    await page.getByTestId('passkey-add').click();
    await expect(card.getByRole('alert')).toContainText('did not confirm it is you');

    await page.fill('#passkey-password', E2E_PASS);
    await page.getByTestId('passkey-add').click();
    await expect(card.getByRole('status')).toContainText('Passkey added');
    await expect(card.getByRole('row').filter({ hasText: 'E2E key' })).toContainText('Never');

    // A passkey alone signs in: no username, no password.
    await signOut(page);
    await page.goto(`${LOCAL}/auth/signin`);
    await page.getByTestId('passkey-signin').click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });

    await page.goto(`${LOCAL}/account-profile`);
    const row = card.getByRole('row').filter({ hasText: 'E2E key' });
    await expect(row).not.toContainText('Never', { timeout: 20_000 });

    await row.getByRole('button', { name: 'Rename' }).click();
    await card.getByLabel('New name for E2E key').fill('Work laptop');
    await card.getByRole('button', { name: 'Save' }).click();
    const renamed = card.getByRole('row').filter({ hasText: 'Work laptop' });
    await expect(renamed).toBeVisible();

    page.once('dialog', (d) => void d.accept());
    await renamed.getByRole('button', { name: 'Remove' }).click();
    await expect(card.getByRole('row').filter({ hasText: 'Work laptop' })).toHaveCount(0);
  } finally {
    await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId }).catch(() => undefined);
  }
  expect(errors).toEqual([]);
});
