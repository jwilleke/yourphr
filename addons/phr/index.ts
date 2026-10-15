/**
 * phr — yourPHR as an ngdpbase add-on (jwilleke/yourphr#920).
 *
 * "Your medical records, immediately and in your hands — for free."
 *
 * This first version proves the shape, nothing more:
 *   - /api/phr/whoami answers who is signed in, through ngdpbase's own sign-in;
 *   - [{PhrWelcome}] draws inside ngdpbase's page layout;
 *   - the "My Health Records" page is seeded.
 * No records, no PHI, no database yet.
 *
 * ngdpbase hands the add-on its tools as the third argument of register()
 * (ngdpbase#1813). Until core does, host.ts builds the same object from the
 * running core. The add-on never imports ngdpbase.
 *
 * Configuration keys:
 *   ngdpbase.addons.phr.enabled — true/false (defaults to false)
 *
 * The exported `name` MUST equal `ngdpbase.slug` in package.json (#927).
 */
import { standInHost, type AddonHost } from './host.js';
import { mountApi } from './routes/api.js';
import PhrWelcomePlugin from './plugins/PhrWelcomePlugin.js';

interface Engine {
  getManager<T = unknown>(name: string): T | null | undefined;
  app?: { get(path: string, handler: (req: unknown, res: never) => void): void };
}
interface PluginManagerLike { registerPlugin(name: string, plugin: unknown): Promise<void> }
interface AddonsManagerLike {
  registerDashboardCard?(card: { addonName: string; title: string; icon: string; adminUrl: string }): void;
}

let unavailable: string | null = 'not registered yet';

const PhrAddon = {
  name: 'phr',
  version: '0.0.1',
  description: 'yourPHR: your health records, in your hands',
  author: 'jwilleke',
  dependencies: [] as string[],

  async register(engine: Engine, _config: Record<string, unknown> = {}, host?: AddonHost): Promise<void> {
    const tools = host ?? await standInHost();

    if (!engine.app) {
      unavailable = 'the engine has no web app to mount on';
      tools.logger.warn(`[phr] Not started: ${unavailable}`);
      return;
    }

    mountApi(engine.app as never, engine, tools);
    await engine.getManager<PluginManagerLike>('PluginManager')?.registerPlugin('PhrWelcome', PhrWelcomePlugin);
    engine.getManager<AddonsManagerLike>('AddonsManager')?.registerDashboardCard?.({
      addonName: 'phr',
      title: 'Health records',
      icon: 'fas fa-notes-medical',
      adminUrl: '/view/My%20Health%20Records'
    });

    unavailable = null;
    tools.logger.info(`[phr] Ready (${host ? "core's host" : 'development stand-in host'})`);
  },

  /** Shown on Admin → Add-ons. */
  status(): { healthy: boolean; message: string } {
    return unavailable ? { healthy: false, message: `phr is off: ${unavailable}` } : { healthy: true, message: 'Ready' };
  }
};

export default PhrAddon;
