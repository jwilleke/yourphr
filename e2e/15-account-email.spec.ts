import { expect, test } from '@playwright/test';
import { BASE, adminPassword, login, trackPageErrors } from './helpers.js';
import { E2E_PASS, E2E_USER } from './constants.js';

// yourphr#792. An account's own email address: optional, set on Settings, and the only way an alert
// about the instance (#789) can reach a person. The admin's Users list says whether one is given,
// never what it is. The journey removes the address again, so no other spec sees it.
test('a person adds their email address on Settings, the admin sees one is given, and it is removed', async ({ browser }) => {
  const person = await browser.newPage();
  const errors = trackPageErrors(person);
  await login(person, E2E_USER, E2E_PASS);
  await person.goto(`${BASE}/settings`);

  const cell = person.getByTestId('account-email');
  await expect(cell).toContainText('Not set', { timeout: 20_000 });
  await cell.getByRole('button', { name: 'Add' }).click();
  await person.fill('#accountEmail', 'not an address');
  await cell.getByRole('button', { name: 'Save' }).click();
  await expect(person.getByTestId('account-email-error')).toContainText('not an email address');

  await person.fill('#accountEmail', 'e2e-person@example.org');
  await cell.getByRole('button', { name: 'Save' }).click();
  await expect(cell).toContainText('e2e-person@example.org');

  // It survives a reload: it is the server's, not the page's.
  await person.reload();
  await expect(person.getByTestId('account-email')).toContainText('e2e-person@example.org', { timeout: 20_000 });

  const admin = await browser.newPage();
  await login(admin, 'admin', adminPassword());
  await admin.goto(`${BASE}/admin/users`);
  const row = admin.getByRole('row').filter({ has: admin.getByRole('cell', { name: E2E_USER, exact: true }) });
  await expect(row).toContainText('Given', { timeout: 20_000 });
  await expect(admin.getByText('e2e-person@example.org')).toHaveCount(0);

  await person.getByTestId('account-email').getByRole('button', { name: 'Change' }).click();
  await person.getByTestId('account-email').getByRole('button', { name: 'Remove' }).click();
  await expect(person.getByTestId('account-email')).toContainText('Not set');

  expect(errors).toEqual([]);
});
