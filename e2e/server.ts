/**
 * The E2E backend (yourphr#610): one spike, booted the way the image boots it, serving the BUILT
 * Angular app, with a synthetic household and the fake FHIR provider. No PHI anywhere: the data
 * directory is a fresh temp dir, the accounts are invented, the records are the fake's.
 *
 * Playwright starts this as its webServer; it prints the admin bootstrap password into
 * e2e/.admin-pass (0600, gitignored) for the admin journeys.
 *
 *   SPIKE_E2E_WEB_DIR   the built Angular bundle (default /tmp/spike-web — what the audit uses)
 *   SPIKE_E2E_PORT      default 18111
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assembleApp } from '../src/app.js';
import { ApiContext } from '../src/framework/ApiContext.js';
import { startFakeProvider, listenFake } from '../scripts/lib/fake-provider.js';
import { ADMIN_PASS_FILE, E2E_PASS, E2E_PORT, E2E_PW_PASS, E2E_PW_USER, E2E_RESET_PASS, E2E_RESET_USER, E2E_USER } from './constants.js';

const webDir = process.env['SPIKE_E2E_WEB_DIR'] ?? '/tmp/spike-web';
if (!existsSync(join(webDir, 'index.html'))) {
  console.error(`[e2e] no built Angular app at ${webDir} (index.html missing). Set SPIKE_E2E_WEB_DIR to the bundle — the image holds it at /opt/yourphr/web.`);
  process.exit(78);
}

const dir = mkdtempSync(join(tmpdir(), 'spike-e2e-'));
// Agent tokens are off by default and the Settings screen hides itself when they are (yourphr#719).
// Written BEFORE the app assembles: AgentTokensManager reads its policy once, at initialize, so a
// set() afterwards would leave the screen offering a mint the manager refuses.
mkdirSync(join(dir, 'config'), { recursive: true });
writeFileSync(join(dir, 'config', 'app-custom-config.json'), JSON.stringify({ 'yourphr.auth.agent-token.enabled': true }, null, 2));
const fake = startFakeProvider('tok');
const fakeBase = await listenFake(fake);

const app = await assembleApp(dir, {
  env: {
    YOURPHR_DATABASE_ENCRYPTION_KEY: 'e2e-at-rest-key',
    YOURPHR_BACKUP_ENCRYPTION_KEY: 'e2e-backup-key',
    SPIKE_TEST_ALLOW_INTERNAL: '1',
  },
  webDir,
  version: 'e2e',
  seeds: [{ display: 'Fake Regional Health', environment: 'sandbox', fhirBaseUrl: fakeBase, scopes: 'patient/Condition.read patient/MedicationStatement.read', clientId: 'fake-cid', enabled: true }],
});
writeFileSync(ADMIN_PASS_FILE, readFileSync(app.bootstrapPasswordFile!, 'utf8'), { mode: 0o600 });

// The household: a member with a connected, synced source; one who will change a password; one
// whose password the admin resets.
const seed = ApiContext.system('e2e-seed', 'admin', app.engine);
await app.users.createUser(seed, E2E_USER, E2E_PASS);
await app.users.createUser(seed, E2E_PW_USER, E2E_PW_PASS);
await app.users.createUser(seed, E2E_RESET_USER, E2E_RESET_PASS);
await app.users.setConsent(ApiContext.system('e2e-seed', E2E_USER, app.engine), new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'));
await app.sources.add(ApiContext.system('e2e-seed', E2E_USER, app.engine), {
  userId: E2E_USER, display: 'Fake Regional Health', fhirBaseUrl: fakeBase, tokenUrl: `${fakeBase}/token`, clientId: 'fake-cid',
  patient: 'pa', resourceTypes: ['Condition', 'MedicationStatement', 'Patient'], accessToken: 'tok', refreshToken: '', expiresAt: 99_999_999,
  platformType: 'ehr', environment: 'production', // a production source for the member's Explore page; the catalog seed stays a sandbox entry
});
await app.syncNow(1_000_000);

// A practitioner the member typed in themselves (yourphr#683), so the Address book has one that is
// theirs to delete (yourphr#771). A provider's would be refused, which is the point of the rule.
await app.engine.managers.records.savePatientRecord(ApiContext.system('e2e-seed', E2E_USER, app.engine), {
  resourceType: 'Practitioner',
  id: 'e2e-practitioner-1',
  name: [{ text: 'Dr Ada Handentered' }],
} as never);
app.config.set('yourphr.backup.destination', join(dir, 'backups'));

await new Promise<void>((resolve) => app.server.listen(E2E_PORT, '127.0.0.1', resolve));
console.log(`[e2e] spike listening on http://127.0.0.1:${E2E_PORT}; data in ${dir}; web ${webDir}`);

const stop = async (): Promise<void> => { fake.close(); await app.close(); process.exit(0); };
process.on('SIGTERM', () => { void stop(); });
process.on('SIGINT', () => { void stop(); });
