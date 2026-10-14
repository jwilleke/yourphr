/** The synthetic household the E2E backend seeds (yourphr#610). No real person, no PHI. */
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const E2E_DIR = fileURLToPath(new URL('.', import.meta.url));
export const E2E_PORT = Number(process.env['SPIKE_E2E_PORT'] ?? 18111);
export const BASE = `http://127.0.0.1:${E2E_PORT}`;
export const E2E_USER = 'e2e';
export const E2E_PASS = 'e2e-long-enough-password';
export const E2E_PW_USER = 'carol';
export const E2E_PW_PASS = 'carols-long-enough-password';
export const E2E_RESET_USER = 'dave';
export const E2E_RESET_PASS = 'daves-long-enough-password';
/** Holds the one seeded notification (yourphr#793), so no other journey sees a banner. */
export const E2E_NOTE_USER = 'nora';
export const E2E_NOTE_PASS = 'noras-long-enough-password';
/** A test account (yourphr#919): it connects the sandbox catalog entries, where everyone else sees production ones. */
export const E2E_TEST_USER = 'tess';
export const E2E_TEST_PASS = 'tess-long-enough-password';
/** Written by server.ts at boot (0600, gitignored); read by the admin journeys. */
export const ADMIN_PASS_FILE = join(E2E_DIR, '.admin-pass');
