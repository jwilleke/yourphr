/**
 * phr — yourPHR as an ngdpbase add-on (jwilleke/yourphr#920).
 *
 * "Your medical records, immediately and in your hands — for free."
 *
 * This first version proves the shape, nothing more:
 *   - /api/phr/whoami answers who is signed in, through ngdpbase's own sign-in;
 *   - [{PhrWelcome}] draws inside ngdpbase's page layout;
 *   - the "My Health Records" page is seeded;
 *   - each person turns health records on in /profile (off until they do);
 *   - the PHR vault (one per person, encrypted) is declared in config.
 * No records, no PHI, no database yet.
 *
 * ngdpbase hands the add-on its tools as the third argument of register()
 * (ngdpbase#1813, v5.10.0). The add-on never imports ngdpbase's code; its
 * types come from @jwilleke/ngdpbase-types, a development dependency.
 *
 * Configuration keys:
 *   ngdpbase.addons.phr.enabled — true/false (defaults to false)
 *   ngdpbase.system-category.phr — the PHR vault, owned by phr (ngdpbase#1559)
 *
 * The exported `name` MUST equal `ngdpbase.slug` in package.json (#927).
 */
import type { AddonHost, PolicyDecisionPoint, WikiEngine } from '@jwilleke/ngdpbase-types';
import { openPhrStore } from './managers/PhrRecordStore.js';
import { PhrManager } from './managers/PhrManager.js';
import { mountApi } from './routes/api.js';
import { createPhrWelcomePlugin } from './plugins/PhrWelcomePlugin.js';
import { createPhrRecordsPlugin } from './plugins/PhrRecordsPlugin.js';
import { profileSectionHtml, saveProfileSection } from './profile.js';
import type { UserLike, UserManagerLike } from './preferences.js';

// PluginManager and AddonsManager aren't in core's public types yet (asked of ngdpbase); only the calls phr makes.
interface PluginManagerLike { registerPlugin(name: string, plugin: unknown): Promise<void> }
interface AddonsManagerLike {
  registerDashboardCard?(card: { addonName: string; title: string; icon: string; adminUrl: string }): void;
}

let unavailable: string | null = 'not registered yet';
let engineRef: WikiEngine | null = null;
let records: PhrManager | null = null;

/** The one door to health records, for phr's routes, plugins and jobs. Null until phr has started. */
export function phrRecords(): PhrManager | null {
  return records;
}
const users = (): UserManagerLike | null | undefined => engineRef?.getManager<UserManagerLike>('UserManager');

/**
 * DEVELOPMENT ONLY: the made-up-records loader, on a local test site that asks
 * for it. dev/ is not in the published package, so on a real site the import
 * below fails and nothing is mounted, whatever the configuration says.
 */
async function maybeMountDevSeed(engine: WikiEngine, config: Record<string, unknown>, tools: AddonHost): Promise<void> {
  if (config['dev-seed'] !== true || !engine.app) return;
  const base = String(engine.getManager<{ getProperty(k: string, d?: unknown): unknown }>('ConfigurationManager')?.getProperty('ngdpbase.application.base-url', '') ?? '');
  let host = '';
  try { host = new URL(base).hostname; } catch { return; }
  if (host !== 'localhost' && !host.endsWith('.localhost')) {
    tools.logger.warn('[phr] dev-seed is set but this is not a localhost site; ignored');
    return;
  }
  try {
    const dev = await import('./dev/seedSynthetic.js');
    dev.mountDevSeed(engine.app, engine, tools, phrRecords);
  } catch {
    // Not in the published package: nothing to mount.
  }
}

const PhrAddon = {
  name: 'phr',
  version: '0.0.1',
  description: 'yourPHR: your health records, in your hands',
  author: 'jwilleke',
  dependencies: [] as string[],

  async register(engine: WikiEngine, _config: Record<string, unknown> = {}, host?: AddonHost): Promise<void> {
    // phr is site-critical (config/default-config.json): anything that stops it
    // starting is thrown, so core puts the site in maintenance and tells admins
    // why, instead of a yourPHR running without its records.
    if (!host) throw new Error('ngdpbase passed no host tools (phr needs ngdpbase 5.20.0 or later)');
    const tools = host;
    engineRef = engine;
    if (!engine.app) throw new Error('the engine has no web app to mount on');

    const store = openPhrStore(engine.getManager('DatabaseManager'));
    const pdp = engine.getManager<PolicyDecisionPoint>('PolicyDecisionPoint');
    if (!pdp) throw new Error("ngdpbase's PolicyDecisionPoint is not available");
    const auditSink = engine.getManager<Parameters<AddonHost['recordAuditEvent']>[0]>('AuditManager');
    records = new PhrManager({
      store,
      decide: (subject, request) => pdp.decide(subject, request),
      recordAudit: (event) => tools.recordAuditEvent(auditSink, event),
      host: tools
    });

    mountApi(engine.app, engine, tools, users, phrRecords);
    await maybeMountDevSeed(engine, _config, tools);
    const plugins = engine.getManager<PluginManagerLike>('PluginManager');
    await plugins?.registerPlugin('PhrWelcome', createPhrWelcomePlugin(users));
    await plugins?.registerPlugin('PhrRecords', createPhrRecordsPlugin(phrRecords, users));
    engine.getManager<AddonsManagerLike>('AddonsManager')?.registerDashboardCard?.({
      addonName: 'phr',
      title: 'Health records',
      icon: 'fas fa-notes-medical',
      adminUrl: '/view/My%20Health%20Records'
    });

    unavailable = null;
    tools.logger.info('[phr] Ready');
  },

  /** The "Health records" switch in /profile (ngdpbase#534). */
  profileSection(user: UserLike): { title: string; html: string } | null {
    return unavailable ? null : { title: 'Health records', html: profileSectionHtml(user) };
  },

  async saveProfileSection(ctx: { username: string }, body: Record<string, unknown>): Promise<void> {
    if (unavailable) return;
    await saveProfileSection(users(), ctx, body);
  },

  /** Shown on Admin → Add-ons. */
  status(): { healthy: boolean; message: string } {
    return unavailable ? { healthy: false, message: `phr is off: ${unavailable}` } : { healthy: true, message: 'Ready' };
  }
};

export default PhrAddon;
