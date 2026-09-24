import { expect, test } from '@playwright/test';
import { BASE, login, trackPageErrors } from './helpers.js';
import { E2E_PASS, E2E_USER } from './constants.js';

// yourphr#761. A portal can be one you read on someone else's behalf, so which source identities
// are the account holder is ASKED — prefilled from the evidence, and never assumed. This walks the
// question: find it waiting, see what it rests on, answer it, and see that it stays answered.
test('the person is asked which source identities are them, with the evidence shown', async ({ page }) => {
  const errors = trackPageErrors(page);
  await login(page, E2E_USER, E2E_PASS);
  await page.goto(`${BASE}/records/review`);

  await expect(page.getByText('Which of these records are about you?')).toBeVisible({ timeout: 20_000 });

  // The card for the provider the person signed in to. Other journeys leave their own identities
  // unanswered — an uploaded file among them — so this asks about one and asserts about that one.
  // By its heading, not by its text: another card NAMES this provider in a conflict line about it.
  const connected = page.locator('.alert-light').filter({ has: page.getByRole('heading', { name: 'Fake Regional Health', exact: true }) });
  await expect(connected.getByText(/You signed in to Fake Regional Health yourself/)).toBeVisible();
  // What the source states about the person, as the source states it.
  await expect(connected.getByText(/has this record as Jane Doe, born 1971-04-02/)).toBeVisible();

  await connected.getByRole('button', { name: 'Yes, this is me' }).click();

  // Answered, so it stops being asked — including after a reload, because the answer is a record.
  await expect(connected).toBeHidden({ timeout: 20_000 });
  await page.reload();
  await expect(page.getByText('Which of these records are about you?')).toBeVisible({ timeout: 20_000 }); // the uploaded file is still unanswered
  await expect(page.locator('.alert-light').filter({ has: page.getByRole('heading', { name: 'Fake Regional Health', exact: true }) })).toBeHidden();

  expect(errors).toEqual([]);
});
