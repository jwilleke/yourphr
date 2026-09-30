import { expect, test } from '@playwright/test';
import { BASE, login, trackPageErrors } from './helpers.js';
import { E2E_PASS, E2E_USER } from './constants.js';

// yourphr#690 (practitioners, #683): add, edit and view history each end in something a person can
// see — the practitioner in the list, the change on its page, a history that opens. Only delete
// had a journey (12-practitioner-delete).
//
// yourphr#774: the form's lookups used to search clinicaltables.nlm.nih.gov (names) and tx.fhir.org
// (countries) FROM THE BROWSER, carrying what the person typed and their IP address. They no longer
// may: the NPI lookup is the server's, off by default, and countries are a local list. So the
// journey records every request the page makes and asserts NONE leaves for those hosts — and that
// the page says the lookup is off, so the empty suggestion list is not mistaken for "no match".
const OFF_HOST = /nlm\.nih\.gov|tx\.fhir\.org|wikipedia\.org/;
test('a person adds a practitioner, edits it, and opens its history', async ({ page }) => {
  const errors = trackPageErrors(page);
  const leaked: string[] = [];
  page.on('request', (request) => { if (OFF_HOST.test(request.url())) leaked.push(request.url()); });
  // Create and update report with alert(); accept, as a person would.
  page.on('dialog', (dialog) => dialog.accept());

  await login(page, E2E_USER, E2E_PASS);

  // --- add ---
  await page.goto(`${BASE}/practitioners/new`);
  // The typeaheads carry the placeholder on their host element; a person types into the input inside.
  const typeahead = (name: string) => page.locator(`app-nlm-typeahead[formcontrolname="${name}"] input`).first();
  await expect(page.getByTestId('npi-lookup-note')).toContainText('off on this instance', { timeout: 20_000 });
  await typeahead('data').fill('Dr Grace Synthetic');
  await typeahead('data').press('Tab');
  await typeahead('profession').fill('Cardiology');
  await typeahead('profession').press('Tab');
  await page.getByPlaceholder('(123) 456-7890').first().fill('555-0100');
  await page.getByPlaceholder('City').fill('Springfield');
  await page.getByRole('button', { name: 'Create Practitioner' }).click();

  await expect(page).toHaveURL(/\/practitioners$/, { timeout: 20_000 });
  const row = page.locator('tr', { hasText: 'Dr Grace Synthetic' });
  await expect(row).toBeVisible({ timeout: 20_000 });
  // The store's, not the page's.
  await page.reload();
  await expect(page.locator('tr', { hasText: 'Dr Grace Synthetic' })).toBeVisible({ timeout: 20_000 });

  // --- view, then edit ---
  await page.waitForLoadState('networkidle');
  await page.locator('tr', { hasText: 'Dr Grace Synthetic' }).getByText('Dr Grace Synthetic').first().click();
  await expect(page).toHaveURL(/\/practitioners\/view\//, { timeout: 20_000 });
  await expect(page.getByText('Dr Grace Synthetic').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('555-0100').first()).toBeVisible();
  const viewUrl = page.url();

  await page.getByRole('button', { name: 'Edit' }).click();
  await expect(page).toHaveURL(/\/practitioners\/edit\//, { timeout: 20_000 });
  const phone = page.getByPlaceholder('(123) 456-7890').first();
  await expect(phone).toHaveValue('555-0100', { timeout: 20_000 });
  await phone.fill('555-0199');
  await page.getByRole('button', { name: 'Update Practitioner' }).click();

  // The change is on the practitioner's own page, after a fresh load.
  await page.goto(viewUrl);
  await expect(page.getByText('555-0199').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('555-0100')).toHaveCount(0);

  // --- history: the button says "Encounters". A new practitioner has none, and says so. ---
  await page.getByRole('button', { name: 'Encounters' }).click();
  await expect(page).toHaveURL(/\/practitioner-history\//, { timeout: 20_000 });
  await expect(page.getByText('Dr Grace Synthetic History')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('No Medical History Found!')).toBeVisible();

  expect(leaked).toEqual([]);
  expect(errors).toEqual([]);
});

test('a practitioner\'s history shows the encounter that names them', async ({ page }) => {
  const errors = trackPageErrors(page);
  await page.route(/nlm\.nih\.gov/, (route) => route.abort());
  await login(page, E2E_USER, E2E_PASS);

  await page.goto(`${BASE}/practitioners`);
  await page.waitForLoadState('networkidle');
  await page.locator('tr', { hasText: 'Dr Linus Seeded' }).getByText('Dr Linus Seeded').first().click();
  await expect(page).toHaveURL(/\/practitioners\/view\//, { timeout: 20_000 });
  await page.getByRole('button', { name: 'Encounters' }).click();

  await expect(page).toHaveURL(/\/practitioner-history\//, { timeout: 20_000 });
  await expect(page.getByText('Dr Linus Seeded History')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('No Medical History Found!')).toHaveCount(0);
  await expect(page.getByText('Synthetic annual check-up').first()).toBeVisible({ timeout: 20_000 });

  expect(errors).toEqual([]);
});
