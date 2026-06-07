import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { request, FullConfig } from '@playwright/test';
import { API_BASE, E2E_USER, PASS_FILE } from './constants';

// Runs once after the webServer (Go backend) is up, before any tests.
// Generates a throwaway account password at runtime (or honours $E2E_PASS) — no credential
// literal is committed (#132) — writes it to a gitignored file so the login helper reads the
// SAME value in every worker, then seeds the account via the public signup API (first user
// becomes admin). Idempotent-ish: if the account already exists (reused dev server / non-fresh
// DB), signup returns non-2xx and we ignore it.
export default async function globalSetup(_config: FullConfig) {
  const pass = process.env.E2E_PASS || randomBytes(18).toString('hex');
  writeFileSync(PASS_FILE, pass, { mode: 0o600 });

  const ctx = await request.newContext();
  try {
    const res = await ctx.post(`${API_BASE}/auth/signup`, {
      data: { username: E2E_USER, password: pass },
    });
    if (res.ok()) {
      console.log(`[e2e] seeded account "${E2E_USER}"`);
    } else {
      console.log(`[e2e] signup returned ${res.status()} (account likely already exists) — continuing`);
    }
  } catch (e) {
    console.log(`[e2e] signup request failed (${e}) — continuing; login may still work`);
  } finally {
    await ctx.dispose();
  }
}
