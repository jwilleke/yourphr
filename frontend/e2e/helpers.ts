import { Page, expect } from '@playwright/test';
import { E2E_USER, getE2EPass } from './constants';

// Log in through the real UI (exercises the cookie/JWT signin flow from #103).
export async function login(page: Page): Promise<void> {
  await page.goto('auth/signin');
  await page.fill('input[name="username"]', E2E_USER);
  await page.fill('input[name="password"]', getE2EPass());
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/web\/dashboard/, { timeout: 30_000 });
}

export interface PageHealth {
  pageErrors: string[];      // uncaught JS exceptions (e.g. the oauth4webapi SyntaxError)
  cspViolations: string[];   // ENFORCING CSP blocks only (report-only ones are expected, filtered out)
}

// Attach to a page to collect the two bug-classes that bit us this cycle.
// Call BEFORE navigating.
export function trackPageHealth(page: Page): PageHealth {
  const health: PageHealth = { pageErrors: [], cspViolations: [] };

  page.on('pageerror', (err) => {
    health.pageErrors.push(err.message);
  });

  page.on('console', (msg) => {
    const text = msg.text();
    // The strict script-src rides along as Content-Security-Policy-Report-Only, so the
    // browser logs report-only inline-handler violations on purpose — those are NOT failures.
    if (/content security policy/i.test(text) && !/report.?only/i.test(text)) {
      health.cspViolations.push(text);
    }
  });

  return health;
}
