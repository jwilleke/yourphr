import { defineConfig, devices } from '@playwright/test';
import { BASE_URL } from './e2e/constants';

// The throwaway E2E-account password is generated once at runtime in global-setup and
// written to a gitignored file (no committed credential, #132); the login helper reads it
// back. See e2e/constants.ts.

// E2E config: drives a real browser against the PRODUCTION-SERVED path — the Go backend
// serving the built dist under /web (config.e2e.yaml), not `ng serve` (which wouldn't
// apply the backend CSP). `make test-e2e` builds the frontend first.
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,        // single backend + shared seeded account
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
  // Boot the Go backend with a fresh test DB, serving the built dist. cwd is the repo
  // root (one level up from frontend/). `go run` recompiles, hence the generous timeout.
  webServer: {
    // mkdir -p db: the db/ dir is gitignored, so it's absent on a fresh CI checkout and
    // sqlite can't create the test DB without it (no-op locally).
    command:
      'mkdir -p db && rm -f db/fasten-e2e.db db/fasten-e2e.db-shm db/fasten-e2e.db-wal && go run backend/cmd/fasten/fasten.go start --config config.e2e.yaml',
    cwd: '..',
    url: BASE_URL,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
