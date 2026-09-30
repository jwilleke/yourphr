import { expect, test } from '@playwright/test';
import { BASE, login, trackPageErrors } from './helpers.js';
import { E2E_PASS, E2E_USER } from './constants.js';

// yourphr#808, #809, #810. A person allows a device from Settings — after confirming it is them —
// and is shown its one-time setup ONCE: a QR code, "Open in app" and the code. The device (played
// here by plain HTTP, as a mobile device app would be) claims its keys with the code, which then
// works for its one write and nothing else. Removing it stops the key at once. The journey leaves
// no live device behind.
test('a person connects a device, the device claims its key and may only add samples, and removing it stops the key', async ({ page, request }) => {
  const errors = trackPageErrors(page);
  await login(page, E2E_USER, E2E_PASS);
  await page.goto(`${BASE}/settings`);
  const section = page.getByTestId('connected-devices');
  await expect(section).toBeVisible({ timeout: 20_000 });

  // The wrong password grants nothing and says so.
  await page.fill('#deviceLabel', 'E2E scale');
  await page.fill('#devicePassword', 'not-the-password');
  await section.getByRole('button', { name: 'Allow this device' }).click();
  await expect(page.getByTestId('devices-error')).toContainText('confirm it is you');

  await page.fill('#deviceLabel', 'E2E scale');
  await page.fill('#devicePassword', E2E_PASS);
  await section.getByRole('button', { name: 'Allow this device' }).click();
  const setup = page.getByTestId('device-setup');
  await expect(setup).toContainText('Connect E2E scale now');
  await expect(setup.getByRole('img')).toBeVisible();
  await expect(setup.getByRole('link', { name: 'Open in app' })).toHaveAttribute('href', /^yourphr-device:\/\/claim\?/);
  const code = ((await page.getByTestId('device-setup-code').textContent()) ?? '').trim();
  expect(code).toMatch(/^yphr_setup_/);
  await expect(page.locator('#devicePassword')).toHaveValue(''); // never kept after use

  // The device claims its keys — once.
  const claim = await request.post(`${BASE}/api/device/claim`, { data: { code } });
  expect(claim.status()).toBe(200);
  const key = ((await claim.json()) as { data: { access_token: string } }).data.access_token;
  expect((await request.post(`${BASE}/api/device/claim`, { data: { code } })).status()).toBe(401);

  // Its one write passes the gate (the samples route is #314's: 404, not 403); a read of the record does not.
  const auth = { authorization: `Bearer ${key}` };
  expect((await request.post(`${BASE}/api/secure/health/samples`, { headers: auth, data: {} })).status()).toBe(404);
  expect((await request.get(`${BASE}/api/secure/medications/reconciled`, { headers: auth })).status()).toBe(403);

  await setup.getByRole('button', { name: 'Done' }).click();
  await page.reload();
  const row = page.getByTestId('connected-devices').getByRole('row').filter({ hasText: 'E2E scale' }).last();
  await expect(row).toContainText('Allowed until', { timeout: 20_000 });

  // Removing it stops the key on the very next request.
  await row.getByRole('button', { name: 'Remove' }).click();
  await expect(row).toContainText('Removed');
  expect((await request.post(`${BASE}/api/secure/health/samples`, { headers: auth, data: {} })).status()).toBe(401);

  expect(errors).toEqual([]);
});
