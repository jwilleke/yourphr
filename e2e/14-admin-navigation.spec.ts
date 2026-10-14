import { expect, test } from '@playwright/test';
import { BASE, adminPassword, login, trackPageErrors } from './helpers.js';
import { E2E_TEST_PASS, E2E_TEST_USER, E2E_PASS, E2E_USER } from './constants.js';

// Every card on the admin dashboard is a door to an admin page. On the live instance none of them
// opened (2026-09-26): the admin could reach /admin but not the provider catalog, so no provider
// could be added and no patient could connect. This walks each door and fails on the first one
// that does not open, or on any uncaught error along the way.
const DOORS: { name: RegExp; url: RegExp }[] = [
  { name: /manage providers/i, url: /\/admin\/provider-catalog$/ },
  { name: /view server logs/i, url: /\/admin\/logs$/ },
  { name: /open database/i, url: /\/admin\/database$/ },
  { name: /open configuration/i, url: /\/admin\/config$/ },
  { name: /manage users/i, url: /\/admin\/users$/ },
];

for (const door of DOORS) {
  test(`admin dashboard: "${door.name.source}" opens its page`, async ({ page }) => {
    const errors = trackPageErrors(page);
    await login(page, 'admin', adminPassword());
    await page.goto(`${BASE}/admin`);
    await page.getByRole('link', { name: door.name }).click();
    await expect(page).toHaveURL(door.url, { timeout: 15_000 });
    expect(errors).toEqual([]);
  });
}

// #904 (a rule): admin-only UI lives under /admin. The top navigation shows the same links to an
// admin as to anyone else; the admin's way in is the account menu.
test('the top navigation carries no admin-only link', async ({ page }) => {
  await login(page, 'admin', adminPassword());
  await page.goto(`${BASE}/dashboard`);
  const nav = page.locator('.az-header-menu');
  await expect(nav.getByRole('link', { name: /dashboard/i })).toBeVisible({ timeout: 15_000 });
  await expect(nav.getByRole('link', { name: /^\s*users\s*$/i })).toHaveCount(0);
});

// yourphr#919: sandbox testing is a test account's Sources page, so the admin page is gone and its
// old address lands there. A test account says so on every screen; a real one never does.
test('the old sandbox page leads to Sources; a test account carries its banner and a real account none', async ({ page }) => {
  const errors = trackPageErrors(page);
  await login(page, 'admin', adminPassword());
  await page.goto(`${BASE}/admin/sandbox`);
  await expect(page).toHaveURL(/\/sources$/, { timeout: 15_000 });
  await expect(page.locator('[data-test-account-banner]')).toHaveCount(0);

  await page.context().clearCookies();
  await login(page, E2E_TEST_USER, E2E_TEST_PASS);
  await page.goto(`${BASE}/dashboard`);
  await expect(page.locator('[data-test-account-banner]')).toBeVisible({ timeout: 15_000 });

  await page.context().clearCookies();
  await login(page, E2E_USER, E2E_PASS);
  await page.goto(`${BASE}/dashboard`);
  await expect(page.locator('.az-header-menu')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-test-account-banner]')).toHaveCount(0);
  expect(errors).toEqual([]);
});
