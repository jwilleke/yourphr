// Shared constants for the E2E suite (#114-era browser-interaction automation).
// The backend runs on :9191 serving the SPA under /web (see config.e2e.yaml).
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const BASE_URL = 'http://localhost:9191/web/';
export const API_BASE = 'http://localhost:9191/api';

// Seeded by global-setup via POST /api/auth/signup (first user => admin).
export const E2E_USER = 'e2e';

// The account password is NOT committed (#132). global-setup generates it once at runtime
// (or honours $E2E_PASS) and writes it here; the login helper reads it back. Single source,
// so it's consistent across the globalSetup process and every test worker. The account lives
// only in the throwaway ./db/fasten-e2e.db, which is reset every run. cwd is frontend/.
export const PASS_FILE = path.resolve('e2e/.e2e-pass');

export function getE2EPass(): string {
  return process.env.E2E_PASS || readFileSync(PASS_FILE, 'utf8').trim();
}
