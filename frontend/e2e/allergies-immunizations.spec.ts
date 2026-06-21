import { test, expect } from '@playwright/test';
import { login, trackPageHealth } from './helpers';

// #289/#290 (revised): Allergies and Immunizations are dedicated /medications-style pages fed by the
// deduped classifiers. Drive the real app against seeded Synthea data: each page renders its heading and
// either the deduped table or an honest empty-state, with no CSP/JS errors. Chromium-only (data-dependent).

test('allergies page renders the deduped classifier list (#290)', async ({ page }) => {
  const health = trackPageHealth(page);
  await login(page);
  await page.goto('allergies');

  await expect(page.getByRole('heading', { name: 'Allergies & Intolerances' })).toBeVisible({ timeout: 20_000 });
  // Either the deduped table or the "no allergies" info alert — both are valid rendered states.
  await expect(page.locator('table.table, .alert').first()).toBeVisible({ timeout: 20_000 });

  expect(health.cspViolations, `CSP violations:\n${health.cspViolations.join('\n')}`).toEqual([]);
  expect(health.pageErrors, `uncaught page errors:\n${health.pageErrors.join('\n')}`).toEqual([]);
});

test('immunizations page renders the deduped classifier list (#289)', async ({ page }) => {
  const health = trackPageHealth(page);
  await login(page);
  await page.goto('immunizations');

  await expect(page.getByRole('heading', { name: 'Immunizations', exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('table.table, .alert').first()).toBeVisible({ timeout: 20_000 });

  expect(health.cspViolations, `CSP violations:\n${health.cspViolations.join('\n')}`).toEqual([]);
  expect(health.pageErrors, `uncaught page errors:\n${health.pageErrors.join('\n')}`).toEqual([]);
});
