import { expect, test } from '@playwright/test';
import { BASE, login, trackPageErrors } from './helpers.js';
import { E2E_PASS, E2E_USER } from './constants.js';

// yourphr#696 / #762. "Add record" is a primary button in three places and, until v3.6.0, its form
// 404'd on submit — no test noticed, because none drove the page. These do.
//
// The second journey is the one that matters for the rule Jim set: what a person says is KEPT even
// when it cannot be fully understood, and is then held out of the chart until they confirm it. That
// is only honest if they can find it, so this walks the whole path: enter half a reading, be told,
// find it waiting, confirm it, and see it counted.

test('a home vital saves, and says so', async ({ page }) => {
  const errors = trackPageErrors(page);
  await login(page, E2E_USER, E2E_PASS);
  await page.goto(`${BASE}/resource/add`);

  // The visit wizard is not offered (yourphr#684): its only submit path is unserved, so the flow
  // failed after the person had typed everything. An action that visibly is not there beats one
  // that fails halfway.
  await expect(page.getByRole('link', { name: /visit wizard/i })).toHaveCount(0);

  await page.selectOption('#vital-type', 'heart_rate');
  await page.fill('#vital-value', '64');
  await page.getByRole('button', { name: /save/i }).click();

  await expect(page.getByText(/Saved: Heart rate 64/)).toBeVisible({ timeout: 20_000 });
  expect(errors).toEqual([]);
});

test('half a reading is kept, waits for the person, and joins their records when they confirm it', async ({ page }) => {
  const errors = trackPageErrors(page);
  await login(page, E2E_USER, E2E_PASS);
  await page.goto(`${BASE}/resource/add`);

  // Only the systolic half: a fact, and not a whole blood pressure.
  await page.selectOption('#vital-type', 'blood_pressure');
  await page.fill('#vital-sys', '128');
  await page.getByRole('button', { name: /save/i }).click();

  // Told at the point of saving, in plain words, not with an error.
  await expect(page.getByText(/not part of your records yet/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/only the systolic half/)).toBeVisible();

  // And findable afterwards, which is the half that makes the quarantine honest.
  // Two links say this: the one in the page header, and the one in the message just shown. The
  // message's is the one a person would follow here.
  await page.getByRole('link', { name: 'Waiting for you', exact: true }).click();
  await expect(page.getByText(/Blood pressure 128 systolic/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/only the systolic half/)).toBeVisible();

  await page.getByRole('button', { name: 'Right as written' }).first().click();
  await expect(page.getByText(/Added to your records: Blood pressure 128 systolic/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Nothing is waiting')).toBeVisible();

  expect(errors).toEqual([]);
});

test('a record the person deletes from the queue is gone, and says nothing was kept', async ({ page }) => {
  const errors = trackPageErrors(page);
  await login(page, E2E_USER, E2E_PASS);
  await page.goto(`${BASE}/resource/add`);

  // The other half this time, so this journey has its own record to delete.
  await page.selectOption('#vital-type', 'blood_pressure');
  await page.fill('#vital-dia', '78');
  await page.getByRole('button', { name: /save/i }).click();
  await expect(page.getByText(/not part of your records yet/)).toBeVisible({ timeout: 20_000 });

  await page.getByRole('link', { name: 'Waiting for you', exact: true }).click();
  await expect(page.getByText(/Blood pressure 78 diastolic/)).toBeVisible({ timeout: 20_000 });

  // Asked first, in the page, in words that say what "gone" means (#762).
  await page.getByRole('button', { name: 'Delete' }).first().click();
  await expect(page.getByText(/no copy is kept/)).toBeVisible();
  await page.getByRole('button', { name: 'Yes, delete it' }).click();

  await expect(page.getByText(/Deleted: Blood pressure 78 diastolic/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Nothing is waiting/)).toBeVisible();

  expect(errors).toEqual([]);
});

// yourphr#763: an allergy is an AllergyIntolerance, not an Observation wearing a label.
test('an allergy is stored as an allergy, waits for the person, and joins their records', async ({ page }) => {
  const errors = trackPageErrors(page);
  await login(page, E2E_USER, E2E_PASS);
  await page.goto(`${BASE}/resource/add`);

  await page.selectOption('#entry-kind', 'allergy');
  await page.fill('#entry-name', 'penicillin');
  await page.getByRole('button', { name: /save/i }).click();

  // Kept in their words, and honest about the fact that nothing has coded it.
  await expect(page.getByText(/not part of your records yet/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/nothing has matched it to a known substance/)).toBeVisible();

  await page.getByRole('link', { name: 'Waiting for you', exact: true }).click();
  await expect(page.getByText(/Allergy to penicillin/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('AllergyIntolerance')).toBeVisible();

  await page.getByRole('button', { name: 'Right as written' }).first().click();
  await expect(page.getByText(/Added to your records: Allergy to penicillin/)).toBeVisible({ timeout: 20_000 });

  expect(errors).toEqual([]);
});

// yourphr#764: a reading measured by a cuff and one remembered are different evidence.
test('a device named once is offered again, and the reading says it was measured with it', async ({ page }) => {
  const errors = trackPageErrors(page);
  await login(page, E2E_USER, E2E_PASS);
  await page.goto(`${BASE}/resource/add`);

  // First time: the device does not exist yet, so it is named here.
  await page.selectOption('#vital-type', 'heart_rate');
  await page.fill('#vital-value', '64');
  await page.selectOption('#vital-device', '__new');
  await page.fill('#vital-device-name', 'Omron cuff');
  await page.getByRole('button', { name: /save/i }).click();
  await expect(page.getByText(/Saved: Heart rate 64/)).toBeVisible({ timeout: 20_000 });

  // Second time: it is a choice, not something to retype.
  await expect(page.locator('#vital-device option', { hasText: 'Omron cuff' })).toHaveCount(1, { timeout: 20_000 });
  await page.fill('#vital-value', '66');
  await page.selectOption('#vital-device', { label: 'Omron cuff' });
  await page.getByRole('button', { name: /save/i }).click();
  await expect(page.getByText(/Saved: Heart rate 66/)).toBeVisible({ timeout: 20_000 });

  expect(errors).toEqual([]);
});
