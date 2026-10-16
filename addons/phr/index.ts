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
 * (ngdpbase#1813, v5.10.0). The add-on never imports ngdpbase.
 *
 * Configuration keys:
 *   ngdpbase.addons.phr.enabled — true/false (defaults to false)
 *   ngdpbase.system-category.phr — the PHR vault, owned by phr (ngdpbase#1559)
 *
 * The exported `name` MUST equal `ngdpbase.slug` in package.json (#927).
 */
import type { AddonHost } from './host.js';
import { mountApi } from './routes/api.js';
import { createPhrWelcomePlugin } from './plugins/PhrWelcomePlugin.js';
import { profileSectionHtml, saveProfileSection } from './profile.js';
import type { UserLike, UserManagerLike } from './preferences.js';

interface Engine {
  getManager<T = unknown>(name: string): T | null | undefined;
  app?: { get(path: string, handler: (req: unknown, res: never) => void): void };
}
interface PluginManagerLike { registerPlugin(name: string, plugin: unknown): Promise<void> }
interface AddonsManagerLike {
  registerDashboardCard?(card: { addonName: string; title: string; icon: string; adminUrl: string }): void;
}

let unavailable: string | null = 'not registered yet';
let engineRef: Engine | null = null;
const users = (): UserManagerLike | null | undefined => engineRef?.getManager<UserManagerLike>('UserManager');

const PhrAddon = {
  name: 'phr',
  version: '0.0.1',
  description: 'yourPHR: your health records, in your hands',
  author: 'jwilleke',
  dependencies: [] as string[],

  async register(engine: Engine, _config: Record<string, unknown> = {}, host?: AddonHost): Promise<void> {
    if (!host) {
      // Core before v5.10.0 passes no host; package.json's minVersion should stop that load first.
      unavailable = 'ngdpbase passed no host tools (needs ngdpbase 5.10.0 or later)';
      return;
    }
    const tools = host;
    engineRef = engine;

    if (!engine.app) {
      unavailable = 'the engine has no web app to mount on';
      tools.logger.warn(`[phr] Not started: ${unavailable}`);
      return;
    }

    mountApi(engine.app as never, engine, tools, users);
    await engine.getManager<PluginManagerLike>('PluginManager')?.registerPlugin('PhrWelcome', createPhrWelcomePlugin(users));
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
