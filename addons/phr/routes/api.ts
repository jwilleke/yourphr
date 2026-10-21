/**
 * phr API, mounted under /api/phr by index.ts.
 *
 * Routes only parse, ask permission on the request's own context, and answer.
 * Refusals go out through core's sendApiError, never a hand-written status.
 */
import type { Application, Request, Response } from 'express';
import type { AddonHost, WikiEngine } from '@jwilleke/ngdpbase-types';
import { healthRecordsOn, type UserManagerLike } from '../preferences.js';
import type { PhrManager } from '../managers/PhrManager.js';
import { StoreError } from '../managers/PhrRecordStore.js';

export function mountApi(app: Application, engine: WikiEngine, host: AddonHost, users: () => UserManagerLike | null | undefined, records: () => PhrManager | null = () => null): void {
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

  // A person's note about one of their records (stored as patient-entered data).
  // JSON { resourceType, id, text }; core's CSRF check applies (X-CSRF-Token).
  app.post('/api/phr/notes', (req: Request, res: Response) => {
    void (async () => {
      try {
        const ctx = host.ApiContext.from(req, engine);
        const phr = records();
        if (!phr) { res.status(503).json({ success: false, error: 'health records are not available' }); return; }
        const body = (req.body ?? {}) as { resourceType?: unknown; id?: unknown; text?: unknown };
        if (typeof body.resourceType !== 'string' || typeof body.id !== 'string' || typeof body.text !== 'string') {
          res.status(400).json({ success: false, error: 'resourceType, id and text are required' });
          return;
        }
        const note = await phr.addNote(ctx, { resourceType: body.resourceType, id: body.id }, body.text);
        res.status(201).json({ success: true, data: { id: note.id } });
      } catch (err) {
        if (err instanceof host.ApiError) { host.sendApiError(res, err); return; }
        if (err instanceof StoreError) { res.status(err.status).json({ success: false, error: err.message }); return; }
        host.logger.error(`[phr] notes: ${String(err)}`);
        res.status(500).json({ success: false, error: 'internal error' });
      }
    })();
  });
}
