import { expect, test } from '@playwright/test';
import { BASE, login, trackPageErrors } from './helpers.js';
import { E2E_TEST_PASS, E2E_TEST_USER } from './constants.js';

// yourphr#685. The gap this covers is not "an endpoint 404s" — it is that the record of a failed
// connection was the thing going missing, and an empty job history reads exactly like a healthy
// instance. So this fails a connection for a real reason (no relay is configured here, which is
// what a misconfigured instance looks like) and then goes to the page a person would actually
// check. Proving the endpoint answers 200 would prove nothing about that.
test('a connection that fails is written down, and shows on Background Jobs', async ({ page }) => {
  const errors = trackPageErrors(page);
  // The catalog's one entry is a sandbox, so this journey is a test account's (yourphr#919): it
  // connects from Sources like anyone, and sees the sandbox where a real account sees production.
  await login(page, E2E_TEST_USER, E2E_TEST_PASS);

  await page.goto(`${BASE}/sources`);
  const provider = page.getByRole('button', { name: /Fake Regional Health/ });
  await expect(provider).toBeVisible({ timeout: 20_000 });
  await provider.click();
  // The pre-connect explanation, when the entry's profile has one; Continue starts the connect.
  const proceed = page.locator('.modal-footer .btn-az-primary');
  if (await proceed.isVisible({ timeout: 3_000 }).catch(() => false)) await proceed.click();

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
