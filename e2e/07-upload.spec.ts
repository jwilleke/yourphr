import { expect, test } from '@playwright/test';
import { BASE, login, trackPageErrors } from './helpers.js';
import { E2E_PASS, E2E_USER } from './constants.js';

// yourphr#736 / #735. From v3.0.0 to v3.4.0 every upload on this page failed with "Error uploading
// file: not found" and no test noticed, because none drove the page. These do, through the real
// file input. An allergy rather than a condition, so the dashboard counts other journeys assert on
// stay what they are.

const bundle = JSON.stringify({
  resourceType: 'Bundle',
  type: 'transaction',
  entry: [
    { fullUrl: 'urn:uuid:e2e-upload-patient', resource: { resourceType: 'Patient', id: 'e2e-upload-patient', name: [{ family: 'Upload', given: ['Ema'] }] } },
    { fullUrl: 'urn:uuid:e2e-upload-allergy', resource: { resourceType: 'AllergyIntolerance', id: 'e2e-upload-allergy', code: { text: 'Synthetic upload allergy' }, patient: { reference: 'urn:uuid:e2e-upload-patient' } } },
  ],
});

test('uploading a FHIR file imports it in the background and the notice says what was added', async ({ page }) => {
  const errors = trackPageErrors(page);
  await login(page, E2E_USER, E2E_PASS);
  await page.goto(`${BASE}/sources`);
  await page.locator('input[type=file]').setInputFiles({ name: 'e2e-export.json', mimeType: 'application/json', buffer: Buffer.from(bundle) });
  // Set and walk away (yourphr#913): the page says the import is under way; what it added is a notice.
  await expect(page.getByText(/e2e-export\.json: importing in the background/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Error uploading file/)).toHaveCount(0);
  const banner = page.getByTestId('notification-banner');
  await expect(async () => {
    await page.reload();
    await expect(banner).toContainText('Added 2 new records.', { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });

  // The file is now a source of its own, and a second upload of it changes nothing, and says so (#781).
  await expect(page.getByText('Uploaded e2e-export.json').first()).toBeVisible({ timeout: 20_000 });
  await page.locator('input[type=file]').setInputFiles({ name: 'e2e-export.json', mimeType: 'application/json', buffer: Buffer.from(bundle) });
  await expect(async () => {
    await page.reload();
    await expect(banner).toContainText('You already had all 2 records in this file; nothing changed.', { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  expect(errors, errors.join('\n')).toEqual([]);
});

test('a C-CDA file on a server with no converter says so, with the setup steps, instead of failing after upload', async ({ page }) => {
  const errors = trackPageErrors(page);
  await login(page, E2E_USER, E2E_PASS);
  await page.goto(`${BASE}/sources`);
  const ccd = '<?xml version="1.0"?><ClinicalDocument xmlns="urn:hl7-org:v3"><recordTarget><patientRole><id root="2.16.840.1.113883.19.5" extension="e2e"/></patientRole></recordTarget></ClinicalDocument>';
  await page.locator('input[type=file]').setInputFiles({ name: 'summary.xml', mimeType: 'text/xml', buffer: Buffer.from(ccd) });
  const modal = page.locator('.modal-content');
  await expect(modal.getByText(/needs one more piece set up/)).toBeVisible({ timeout: 20_000 });
  await expect(modal.getByText(/yourphr\.cda-converter\.url/)).toBeVisible();
  await expect(modal.getByRole('button', { name: 'Convert' })).toHaveCount(0);
  await modal.locator('.modal-footer').getByRole('button', { name: 'Close' }).click();
  expect(errors, errors.join('\n')).toEqual([]);
});
