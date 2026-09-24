import { expect, test } from '@playwright/test';
import { BASE, adminPassword, login, trackPageErrors } from './helpers.js';

// yourphr#685. The gap this covers is not "an endpoint 404s" — it is that the record of a failed
// connection was the thing going missing, and an empty job history reads exactly like a healthy
// instance. So this fails a connection for a real reason (no relay is configured here, which is
// what a misconfigured instance looks like) and then goes to the page a person would actually
// check. Proving the endpoint answers 200 would prove nothing about that.
test('a connection that fails is written down, and shows on Background Jobs', async ({ page }) => {
  const errors = trackPageErrors(page);
  // The sandbox page is the admin/developer connect tool, so this journey is the admin's.
  await login(page, 'admin', adminPassword());

  await page.goto(`${BASE}/sandbox`);
  await expect(page.getByRole('button', { name: 'Connect' }).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Connect' }).first().click();

  // Told, in words, that it failed — this part already worked.
  const failure = page.locator('.alert-danger, .alert-warning').first();
  await expect(failure).toBeVisible({ timeout: 30_000 });
  const shown = (await failure.innerText()).trim();
  expect(shown.length, 'the person is told something specific').toBeGreaterThan(10);

  // And it is on the page that exists to answer "did anything go wrong?".
  await page.goto(`${BASE}/background-jobs`);
  await expect(page.getByText('STATUS_FAILED').first()).toBeVisible({ timeout: 20_000 });

  // And it says WHICH connection failed, not merely that something did. The job carries no source
  // — a connect that fails never makes one — so it is attributed to the person directly, and this
  // is the assertion that proves the attribution works end to end.
  await page.getByRole('button', { name: 'Details' }).first().click();
  await expect(page.getByText(/Connecting to Fake Regional Health failed/i).first()).toBeVisible({ timeout: 20_000 });

  expect(errors).toEqual([]);
});
