import { test, expect } from '@playwright/test';
import { login, trackPageHealth } from './helpers';

// #358: /medical-history is a master-detail group/filter view. Drive the real app against the seeded
// Synthea data (which has Encounters): the Group-by selector + master rail + detail pane render, and
// switching the dimension re-pivots the rail.
test('medical-history master-detail: group-by selector + rail + detail render and re-pivot (#358)', async ({ page }) => {
  const health = trackPageHealth(page);
  await login(page);
  await page.goto('medical-history');

  // Group-by selector is present (Date is the default).
  await expect(page.getByRole('button', { name: 'Date', exact: true })).toBeVisible({ timeout: 20_000 });
  for (const dim of ['Condition', 'Provider', 'Place']) {
    await expect(page.getByRole('button', { name: dim, exact: true })).toBeVisible();
  }

  // Master rail has groups, and the detail pane renders timeline panels for the selected group.
  const railItems = page.locator('.list-group-item-action');
  await expect(railItems.first()).toBeVisible({ timeout: 20_000 });
  expect(await railItems.count(), 'expected ≥1 master group from seeded encounters').toBeGreaterThan(0);

  const panels = page.locator('app-report-medical-history-timeline-panel');
  await expect(panels.first()).toBeVisible({ timeout: 20_000 });

  // "N records across M groups" honest total is shown.
  await expect(page.getByText(/record(s)? across/)).toBeVisible();

  // Re-pivot: switch to Provider — the rail still renders groups (different grouping).
  await page.getByRole('button', { name: 'Provider', exact: true }).click();
  await expect(railItems.first()).toBeVisible();
  expect(await railItems.count(), 'rail still populated after grouping by Provider').toBeGreaterThan(0);
  await expect(panels.first()).toBeVisible();

  // #359: Condition dimension is sourced from /conditions/classified — the rail lists the patient's
  // canonical conditions (not only encounter-linked ones). Seeded Synthea data has conditions.
  await page.getByRole('button', { name: 'Condition', exact: true }).click();
  await expect(railItems.first()).toBeVisible();
  expect(await railItems.count(), 'condition rail populated from /conditions/classified').toBeGreaterThan(0);

  // Clean render — no enforcing-CSP violations or uncaught JS.
  expect(health.cspViolations, `CSP violations:\n${health.cspViolations.join('\n')}`).toEqual([]);
  expect(health.pageErrors, `uncaught page errors:\n${health.pageErrors.join('\n')}`).toEqual([]);
});
