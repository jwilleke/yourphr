import { expect, test } from '@playwright/test';
import { BASE, login, trackPageErrors } from './helpers.js';
import { E2E_PASS, E2E_USER } from './constants.js';

// yourphr#687. "Export to PDF" saved a .pdf holding the API's JSON envelope, and "Send to Email"
// posted to a route that does not exist. The instance has no mail transport (#536), so the person
// takes the file and sends it themselves — which only works if the file is what it says it is.
test('the summary downloads as a page a person can actually read', async ({ page }) => {
  const errors = trackPageErrors(page);
  await login(page, E2E_USER, E2E_PASS);
  await page.goto(`${BASE}/medical-history`); // where the report header lives

  const download = page.waitForEvent('download');
  await page.getByText('Export summary').click();
  const file = await download;

  expect(file.suggestedFilename()).toBe('yourphr-records.html');
  const body = await (await import('node:fs/promises')).readFile(await file.path(), 'utf8');
  expect(body.startsWith('<!DOCTYPE html>'), 'an HTML document, not an envelope in a .html file').toBe(true);
  expect(body).not.toContain('"success"');
  // The file travels, so the warning travels with it.
  expect(body).toContain('Anyone who opens it can read it');

  expect(errors).toEqual([]);
});

test('Send to Email hands over the file instead of pretending to send it', async ({ page }) => {
  const errors = trackPageErrors(page);
  await login(page, E2E_USER, E2E_PASS);
  await page.goto(`${BASE}/medical-history`); // where the report header lives

  await page.getByText('Send to Email').click();
  await expect(page.getByText('This instance does not send email')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/cannot be taken back/)).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download to attach' }).click();
  expect((await download).suggestedFilename()).toBe('yourphr-records.html');

  expect(errors).toEqual([]);
});
