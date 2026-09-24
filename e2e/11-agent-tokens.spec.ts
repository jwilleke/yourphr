import { expect, test } from '@playwright/test';
import { BASE, login, trackPageErrors } from './helpers.js';
import { E2E_PASS, E2E_USER } from './constants.js';

// yourphr#719. Settings used to be a device-pairing screen for a companion app that does not
// exist, over four endpoints the server never served — and it had no spec and no journey, which is
// how it survived a whole stack replacement. This drives what replaced it.
test('a person mints a key for their AI client, sees it once, and revokes it', async ({ page }) => {
  const errors = trackPageErrors(page);
  await login(page, E2E_USER, E2E_PASS);
  await page.goto(`${BASE}/settings`);

  await expect(page.getByText('Keys for your AI assistant')).toBeVisible({ timeout: 20_000 });
  // The screen that was here promised a QR code for an app nobody can install.
  await expect(page.getByText(/QR code|companion mobile app/i)).toHaveCount(0);

  await page.fill('#token-name', 'My AI assistant');
  await page.locator('#token-ttl').selectOption({ index: 0 });

  // A key with nothing ticked is refused rather than treated as "everything", so the button waits.
  await expect(page.getByRole('button', { name: 'Make this key' })).toBeDisabled();
  // By its checkbox, not its words: the left-hand nav has a "Medications" link too.
  await page.locator('#scope-Medications').check();
  await page.getByRole('button', { name: 'Make this key' }).click();

  // Shown once, and said to be shown once — there is no second chance to copy it.
  const secret = page.getByTestId('minted-secret');
  await expect(secret).toBeVisible({ timeout: 20_000 });
  expect((await secret.innerText()).trim().length, 'a real secret came back').toBeGreaterThan(20);
  await expect(page.getByText(/shown once/i)).toBeVisible();

  // And it is listed, with what it may read.
  await expect(page.getByRole('cell', { name: /My AI assistant/ })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Medications', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Revoke' }).first().click();
  await expect(page.getByText('revoked').first()).toBeVisible({ timeout: 20_000 });

  expect(errors).toEqual([]);
});
