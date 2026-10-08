import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { ADMIN_PASS_FILE, BASE } from './constants.js';

export { BASE };

export function adminPassword(): string {
  return readFileSync(ADMIN_PASS_FILE, 'utf8').trim();
}

/** Sign in through the real form, as a person does. */
export async function login(page: Page, username: string, password: string): Promise<void> {
  await page.goto(`${BASE}/auth/signin`);
  await page.getByPlaceholder('Enter your username').fill(username);
  await page.getByPlaceholder('Enter your password').fill(password);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
}

/** Uncaught page errors are a failure in every journey — an Angular TypeError is a bug, not noise. */
export function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}
