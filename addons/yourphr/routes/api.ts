/**
 * YourPHR API — mounted at /api/yourphr by index.ts.
 *
 * First test (jwilleke/yourphr#920): one route that says who the request's
 * ngdpbase session belongs to, and one state-changing route that proves a
 * browser app can pass ngdpbase's CSRF check. No records, no PHI.
 *
 * The host is imported through `dist/`, never `src/` (ngdpbase #1192).
 */
import { Router, type Request, type Response } from 'express';
import { ApiContext, ApiError, sendApiError } from '../../../dist/src/context/ApiContext.js';

interface Engine { getManager<T = unknown>(name: string): T | null | undefined }

export default function apiRoutes(engine: Engine): Router {
  const router = Router();

  const fail = (res: Response, err: unknown): void => {
    if (err instanceof ApiError) { sendApiError(res, err); return; }
    res.status(500).json({ ok: false, error: 'internal error' });
  };

  // Who is signed in. 401 when nobody is: actingUsername() is the host's own
  // "a person this acts as" check. The CSRF token is the session's own, so the
  // Angular app can send it as X-CSRF-Token on state-changing calls; only a
  // same-origin script can read this response.
  router.get('/whoami', (req: Request, res: Response): void => {
    try {
      const ctx = ApiContext.from(req, engine as never);
      const username = ctx.actingUsername();
      res.json({ ok: true, username, roles: ctx.roles, csrfToken: req.session?.csrfToken ?? null });
    } catch (err) { fail(res, err); }
  });

  // A POST, to prove the session and ngdpbase's CSRF middleware both apply.
  router.post('/echo', (req: Request, res: Response): void => {
    try {
      const ctx = ApiContext.from(req, engine as never);
      const username = ctx.actingUsername();
      res.json({ ok: true, username, received: req.body ?? null });
    } catch (err) { fail(res, err); }
  });

  return router;
}
