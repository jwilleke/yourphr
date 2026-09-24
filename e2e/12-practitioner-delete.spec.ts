import { expect, test } from '@playwright/test';
import { BASE, login, trackPageErrors } from './helpers.js';
import { E2E_PASS, E2E_USER } from './constants.js';

// yourphr#771. Deleting a practitioner issued a DELETE that no route answered, so the button did
// nothing and said nothing — and the route check could not see it, because the path IS served, for
// GET (yourphr#772). This drives the button a person actually presses.
test('a practitioner the person entered is deleted, and stays deleted', async ({ page }) => {
  const errors = trackPageErrors(page);
  // The page asks with confirm() and reports with alert(); accept both, as a person would.
  page.on('dialog', (dialog) => dialog.accept());

  await login(page, E2E_USER, E2E_PASS);
  await page.goto(`${BASE}/practitioners`);

  const row = page.locator('tr', { hasText: 'Dr Ada Handentered' });
  await expect(row).toBeVisible({ timeout: 20_000 });
  // The list loads practitioners, then favourites, and re-renders through applyFilters() after
  // each — so a row can be replaced under the cursor between hover and click. Let it settle first.
  await page.waitForLoadState('networkidle');

  // The row's actions appear on hover and the menu button is icon-only. Press it exactly ONCE: the
  // handler is a TOGGLE, so a retry loop around the open closes it again — which is what made this
  // pass alone and fail in the suite, alternating with the run order.
  await row.hover();
  // dispatchEvent, not click: the actions are revealed by CSS hover and the menu button sits under
  // it, so a synthetic click can land on the cell instead. This runs the handler itself.
  await row.getByTitle('More actions').dispatchEvent('click');

  const menu = row.locator('.dropdown-menu.show');
  await expect(menu).toBeVisible({ timeout: 20_000 });
  await menu.getByRole('button', { name: 'Delete' }).click();

  await expect(page.getByText('Dr Ada Handentered')).toHaveCount(0, { timeout: 20_000 });

  // Gone from the store, not merely from the page — the old behaviour left it there either way.
  await page.reload();
  await expect(page.getByText('Dr Ada Handentered')).toHaveCount(0, { timeout: 20_000 });

  expect(errors).toEqual([]);
});
