/**
 * YourPHR add-on for ngdpbase — first test of jwilleke/yourphr#920.
 *
 * Question it answers: can an ngdpbase add-on serve YourPHR's built Angular
 * app so that, after signing in on ngdpbase's own /login, the app's calls to
 * an add-on route ride the same ngdpbase session (ApiContext.from(req))?
 *
 * register() mounts:
 *   /api/yourphr          — routes/api.ts (whoami, echo)
 *   <mount-path>/ (/phr)  — the Angular build, with SPA fallback to index.html
 *
 * Configuration keys:
 *   ngdpbase.addons.yourphr.enabled    — true/false (defaults to false)
 *   ngdpbase.addons.yourphr.mount-path — where the app is served (default /phr)
 *   ngdpbase.addons.yourphr.web-root   — the built app's directory (default <add-on dir>/web)
 *
 * No records, no PHI, no database yet.
 *
 * The exported `name` MUST equal `ngdpbase.slug` in package.json (#927).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Request, type Response, type NextFunction } from 'express';
import hostLogger from '../../dist/src/utils/logger.js';
import apiRoutes from './routes/api.js';

const logger = hostLogger as unknown as { info(message: string): void; warn(message: string): void };

interface Engine {
  getManager<T = unknown>(name: string): T | null | undefined;
  app?: { use(route: string, ...handlers: unknown[]): void };
}

interface AddonConfig { 'mount-path'?: unknown; 'web-root'?: unknown }

const ADDON_DIR = path.dirname(fileURLToPath(import.meta.url));

let unavailable: string | null = 'not registered yet';

/** "/phr", "phr/", "" all become "/phr" or "/". */
function normaliseMount(value: unknown): string {
  const raw = typeof value === 'string' && value.trim() !== '' ? value.trim() : '/phr';
  const trimmed = '/' + raw.replace(/^\/+|\/+$/g, '');
  return trimmed;
}

/**
 * The Angular index.html picks its <base href> at run time: "/web/" when the
 * path contains /web, otherwise "/". Served anywhere else, every chunk would
 * load from the site root. Point it at the mount path instead.
 */
function rewriteBaseHref(html: string, mount: string): { html: string; rewritten: boolean } {
  const pattern = /var baseHref = "\/"/;
  if (!pattern.test(html)) return { html, rewritten: false };
  return { html: html.replace(pattern, `var baseHref = "${mount}/"`), rewritten: true };
}

const YourPhrAddon = {
  name: 'yourphr',
  version: '0.0.1',
  description: 'YourPHR: the patient record app, served on ngdpbase and signed in through it',
  author: 'jwilleke',
  dependencies: [] as string[],

  async register(engine: Engine, config: AddonConfig = {}): Promise<void> {
    if (!engine.app) { unavailable = 'the engine has no Express app'; return; }

    engine.app.use('/api/yourphr', apiRoutes(engine));

    const mount = normaliseMount(config['mount-path']);
    const configuredRoot = typeof config['web-root'] === 'string' ? config['web-root'].trim() : '';
    const webRoot = configuredRoot !== '' ? path.resolve(configuredRoot) : path.join(ADDON_DIR, 'web');
    const indexFile = path.join(webRoot, 'index.html');
    if (!fs.existsSync(indexFile)) {
      unavailable = `no Angular build at ${webRoot} (index.html missing) — the API is mounted, the app is not`;
      logger.warn(`[yourphr] ${unavailable}`);
      return;
    }

    const { html: indexHtml, rewritten } = rewriteBaseHref(fs.readFileSync(indexFile, 'utf8'), mount);
    if (!rewritten) logger.warn('[yourphr] index.html has no baseHref line to rewrite; served as built');

    const sendIndex = (_req: Request, res: Response): void => {
      res.setHeader('Cache-Control', 'no-cache');
      res.type('html').send(indexHtml);
    };

    // Exact mount without the slash: redirect so relative URLs resolve under it.
    engine.app.use(mount, (req: Request, res: Response, next: NextFunction): void => {
      if (req.originalUrl === mount) { res.redirect(301, `${mount}/`); return; }
      next();
    });
    engine.app.use(mount, express.static(webRoot, { index: false, fallthrough: true, maxAge: '1h' }));
    // SPA fallback: any other GET under the mount is an Angular route.
    engine.app.use(mount, (req: Request, res: Response, next: NextFunction): void => {
      if (req.method !== 'GET' && req.method !== 'HEAD') { next(); return; }
      sendIndex(req, res);
    });

    unavailable = null;
    logger.info(`[yourphr] Angular app served at ${mount}/ from ${webRoot}; API at /api/yourphr`);
  },

  /** Surfaced in the admin add-on dashboard. */
  status(): { healthy: boolean; message: string } {
    return unavailable ? { healthy: false, message: `YourPHR: ${unavailable}` } : { healthy: true, message: 'YourPHR app and API mounted' };
  }
};

export default YourPhrAddon;
