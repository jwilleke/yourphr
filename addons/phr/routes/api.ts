/**
 * phr API, mounted under /api/phr by index.ts.
 *
 * Routes only parse, ask permission on the request's own context, and answer.
 * Refusals go out through core's sendApiError, never a hand-written status.
 */
import type { Application, Request, Response } from 'express';
import type { AddonHost, WikiEngine } from '@jwilleke/ngdpbase-types';
import { healthRecordsOn, type UserManagerLike } from '../preferences.js';

export function mountApi(app: Application, engine: WikiEngine, host: AddonHost, users: () => UserManagerLike | null | undefined): void {
  // Who you are, as phr sees you. The first proof that phr rides ngdpbase's sign-in.
  app.get('/api/phr/whoami', (req: Request, res: Response) => {
    void (async () => {
      try {
        const ctx = host.ApiContext.from(req, engine);
        await ctx.requirePermission('phr-read');
        const username = ctx.actingUsername();
        const healthRecords = healthRecordsOn(await users()?.getUser(username)) ? 'on' : 'off';
        res.json({ success: true, data: { username, isTest: ctx.isTest, healthRecords } });
      } catch (err) {
        if (err instanceof host.ApiError) { host.sendApiError(res, err); return; }
        host.logger.error(`[phr] whoami: ${String(err)}`);
        res.status(500).json({ success: false, error: 'internal error' });
      }
    })();
  });
}
