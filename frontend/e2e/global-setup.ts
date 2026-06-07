import { randomBytes } from 'node:crypto';
import { writeFileSync, readFileSync } from 'node:fs';
import { request, FullConfig } from '@playwright/test';
import { API_BASE, E2E_USER, PASS_FILE, SEED_BUNDLE } from './constants';

// Runs once after the webServer (Go backend) is up, before any tests:
//  1. Generate a throwaway account password at runtime (no committed credential, #132) and
//     write it to a gitignored file the login helper reads (same value in every worker).
//  2. Create (or sign in to) the E2E account via the public auth API; capture the bearer token.
//  3. Seed a synthetic Synthea bundle via POST /api/secure/source/manual (Bearer-authed) so
//     data-dependent flows have content (#131 Phase 3). RequireAuth takes the Authorization
//     header first, which sidesteps sending the Secure session cookie over http from a non-browser.
export default async function globalSetup(_config: FullConfig) {
  const pass = process.env.E2E_PASS || randomBytes(18).toString('hex');
  writeFileSync(PASS_FILE, pass, { mode: 0o600 });

  const ctx = await request.newContext();
  try {
    let token = '';
    const signup = await ctx.post(`${API_BASE}/auth/signup`, { data: { username: E2E_USER, password: pass } });
    if (signup.ok()) {
      token = (await signup.json())?.data ?? '';
      console.log(`[e2e] seeded account "${E2E_USER}"`);
    } else {
      // account likely already exists (reused dev server) — sign in for a token
      const signin = await ctx.post(`${API_BASE}/auth/signin`, { data: { username: E2E_USER, password: pass } });
      if (signin.ok()) token = (await signin.json())?.data ?? '';
      console.log(`[e2e] signup ${signup.status()}; signin ${signin.status()} — continuing`);
    }

    if (token) {
      const res = await ctx.post(`${API_BASE}/secure/source/manual`, {
        headers: { Authorization: `Bearer ${token}` },
        multipart: { file: { name: 'synthea.json', mimeType: 'application/json', buffer: readFileSync(SEED_BUNDLE) } },
        timeout: 120_000,
      });
      console.log(`[e2e] seed bundle import -> HTTP ${res.status()}`);
      // #148 diagnostic: the import summary enumerates stored resources — log whether a
      // Patient was actually stored (its absence here would explain the IPS "no patients").
      try {
        const summary = (await res.json())?.data;
        const refs: string[] = summary?.UpdatedResources ?? [];
        const patients = refs.filter((r) => typeof r === 'string' && r.startsWith('Patient/'));
        console.log(`[e2e] import stored total=${summary?.TotalResources}; Patient refs=${JSON.stringify(patients)}`);
      } catch { /* non-JSON response — ignore */ }

      // Readiness gate: the import processes resources (related-resources / search params)
      // asynchronously after returning 200, so a too-early IPS summary query can 500. Wait
      // until the (cheap JSON) IPS summary succeeds before tests run, so data-dependent specs
      // see a settled state. (Backend should also not 500 on in-progress data — see the issue.)
      for (let i = 0; i < 20; i++) {
        const r = await ctx.get(`${API_BASE}/secure/summary/ips`, { headers: { Authorization: `Bearer ${token}` } });
        if (r.ok()) { console.log(`[e2e] IPS data ready after ~${i * 3}s`); break; }
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    } else {
      console.log('[e2e] no token — skipped data seed; data-dependent specs will see an empty account');
    }
  } catch (e) {
    console.log(`[e2e] setup issue (${e}) — continuing`);
  } finally {
    await ctx.dispose();
  }
}
