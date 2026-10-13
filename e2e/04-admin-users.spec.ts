import { expect, test } from '@playwright/test';
import { BASE, adminPassword, login } from './helpers.js';
import { E2E_RESET_PASS, E2E_RESET_USER } from './constants.js';

test('the admin lists accounts and resets a member\'s password; the generated password signs in', async ({ page, request }) => {
  await login(page, 'admin', adminPassword());
  // The old path still lands on the page: admin-only UI moved under /admin (#904).
  await page.goto(`${BASE}/users`);
  await expect(page).toHaveURL(/\/admin\/users$/, { timeout: 15_000 });
  await expect(page.getByText(E2E_RESET_USER).first()).toBeVisible({ timeout: 20_000 });
  await page.getByTitle(`Reset the password for ${E2E_RESET_USER}`).click();
  const generated = page.getByLabel('Generated password');
  await expect(generated).toBeVisible({ timeout: 15_000 });
  const password = await generated.inputValue();
  expect(password.length).toBeGreaterThanOrEqual(12);
  const signin = await request.post(`${BASE}/api/auth/signin`, { data: { username: E2E_RESET_USER, password } });
  expect(signin.status()).toBe(200);
  const old = await request.post(`${BASE}/api/auth/signin`, { data: { username: E2E_RESET_USER, password: E2E_RESET_PASS } });
  expect(old.status()).toBe(401);
});
