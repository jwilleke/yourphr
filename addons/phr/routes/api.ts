/**
 * phr API, mounted under /api/phr by index.ts.
 *
 * Routes only parse, ask permission on the request's own context, and answer.
 * Refusals go out through core's sendApiError, never a hand-written status.
 */
import type { AddonHost } from '../host.js';

interface ExpressLikeApp {
  get(path: string, handler: (req: unknown, res: ResponseLike) => void): void;
}
interface ResponseLike { json(body: unknown): void; status(code: number): ResponseLike }

export function mountApi(app: ExpressLikeApp, engine: unknown, host: AddonHost): void {
  // Who you are, as phr sees you. The first proof that phr rides ngdpbase's sign-in.
  app.get('/api/phr/whoami', (req, res) => {
    void (async () => {
      try {
        const ctx = host.ApiContext.from(req, engine);
        await ctx.requirePermission('phr-read');
        res.json({ success: true, data: { username: ctx.actingUsername(), isTest: ctx.isTest === true } });
      } catch (err) {
        if (err instanceof host.ApiError) { host.sendApiError(res, err); return; }
        host.logger.error(`[phr] whoami: ${String(err)}`);
        res.status(500).json({ success: false, error: 'internal error' });
      }
    })();
  });
}
