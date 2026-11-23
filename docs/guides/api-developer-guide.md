---
name: API developer guide
description: How to add or change an HTTP route — one server file, the order every request passes through, the JSON envelope, and the two static checks that keep the frontend and the access log honest
dateModified: 2026-11-23
category: guides
relatedModules: [server.ts, ApiContext, ApiError, check-routes, check-access-categories]
---

# API developer guide

How to add or change a route. The whole HTTP layer is `createYourPhrServer` in `src/server.ts`, a plain `node:http` server with no framework and no TLS (a reverse proxy terminates TLS). Routes are `if` tests on `url.pathname` and `req.method`, with regular expressions for path parameters, in one request handler. The route decides nothing a manager should: it reads the request, calls one manager with the request's `ApiContext`, and writes the answer.

## Standing rules

- Every answer is JSON in one envelope, written by `send(res, status, body)`: `{ "success": true, "data": … }`, or `{ "success": false, "error": "…" }` with any extra fields an `ApiError` carries. The field names are the Go stack's wire format, because the Angular app reads them.
- Refuse by throwing `ApiError(status, message)` from the manager. The one error boundary at the end of the handler sends it in the envelope. Anything else becomes a 500 through `serverFailure`: the caller sees a generic message and an 8-character `error_id`; the log gets the error with the same id. Never put a raw error message in a response.
- Read JSON bodies with `readJsonBody` (64 KiB). A larger body needs its own limit, as health samples (8 MiB) and uploads (`yourphr.sources.upload.max-bytes`) have.
- `/api/*` without `/secure/` is public: `/api/version`, `/api/health`, `/api/legal/:document`, `/api/instance/public`, the sign-in, sign-up, passkey and demo sign-in routes, and the device claim and token routes. The sign-in, sign-up, passkey, demo sign-in and device routes are rate-limited per client IP (`yourphr.auth.rate-limit.*`), trusting `X-Forwarded-For` only from `yourphr.auth.trusted-proxies`.
- `/api/secure/*` requires a session (a `Bearer` header or the `yourphr_session` cookie) or an agent token (`Bearer` only, never a cookie). `/api/secure/admin/*` additionally requires `admin-read`; each manager behind it requires what it changes.
- A route that reads record content under `/api/secure/` has an __access category__ (`accessCategoryFor` in `src/account/index.ts`), or is listed in `EXEMPT` in `scripts/check-access-categories.ts` with its reason. The category is the line in the patient's access log and the only thing an agent token's scope can name. See [security-developer-guide.md](security-developer-guide.md#the-access-log-and-agent-scopes).
- Every path the Angular app calls is a path `src/server.ts` routes. `npm run check:routes` compares them statically; `KNOWN_MISSING` lists the exceptions, each with its issue, and should only shrink.
- A route that starts long work answers at once and lets a notification report the outcome. See [managers-developer-guide.md](managers-developer-guide.md#standing-rules).
- Non-`/api/` paths serve the built Angular app from the static directory (`YOURPHR_WEB_STATIC_DIR`, the environment-owned `yourphr.web.static-dir`; unset, the server answers the API only), with an SPA fallback to `index.html` and a 404 for any path that escapes the directory. An unmatched `/api/` path answers `404 not found`.

## What every request passes through

In order, inside `createYourPhrServer`:

1. Security headers (`applySecurityHeaders`, `src/security-headers.ts`): the CSP (`yourphr.web.csp.connect-src`) and HSTS (`yourphr.web.hsts.enabled`).
2. The public routes above.
3. For `/api/secure/*`: the session, else an agent token, else `401 unauthorized`. A session with less than half its sliding window left (`yourphr.auth.session.sliding-seconds`, capped by `absolute-seconds`) is renewed and returned in `X-Renewed-Token` and a new cookie. The request's `ApiContext` is built here.
4. The demo admin's read-only guard (`DemoManager.refuseUnlessRead`), default-deny by method.
5. Maintenance mode (`yourphr.features.maintenance.*`): `503` with `Retry-After: 300`, except for an `admin-system` caller when `allow-admins` is on.
6. The agent-token gate: an agent reaches only a `GET` with an access category its token names, or a connected device's one write. Everything else is `403`.
7. The access log: a `GET` with a category is recorded by `AuditManager.record` __before__ it is served. A read that cannot be recorded fails.
8. The route.

A route added anywhere below step 7 inherits all of it. Do not add a route above step 3 unless it is meant to be public.

## How to add a route

1. Put the behaviour in a manager method that takes `ctx: ApiContext` and checks its own permission.
2. Add the `if` block in `src/server.ts` next to its family (account, health, sources, provider catalog, admin, records). Gate it on `engine.has('<manager>')` if the manager is optional.
3. A `GET` that reads record content: add its path to `accessCategoryFor`, using an existing category where one fits. A new category is a new agent-token scope, so it is the operator's decision. Otherwise add it to `EXEMPT` with a reason.
4. If the Angular app calls it, add the call in `frontend/src/app/services/fasten-api.service.ts`.
5. Cover it: a manager unit test, and the harness for its family (`npm run app`, `npm run auth`, `npm run records`, `npm run health-intake` and so on).

## How you know you are done

- `npm run check:routes` and `npm run check:categories` pass.
- `npm run typecheck` and `npm run build` pass (they read different configs).
- The family's harness passes, and a refusal path (401, 403) is tested, not only the success.

## See also

- [security-developer-guide.md](security-developer-guide.md): permissions, agent tokens, the access log
- [devices/connected-devices.md](../devices/connected-devices.md): the device routes' contract
- [architecture/agent-access-policy.md](../architecture/agent-access-policy.md): agent tokens and the MCP bridge (`npm run mcp`, `scripts/mcp-server.ts`)

## Known gaps

- There is no route table: routes are found by reading `src/server.ts` (about 130 path tests). The two checks above read it statically for the same reason, and a method test several lines from its path test can escape them.
- `KNOWN_MISSING` in `scripts/check-routes.ts` is not empty: it still lists `/api/auth/callback/:p` against [#693](https://github.com/jwilleke/yourphr/issues/693), which was closed as not planned, so the Angular app still calls a route the server does not have.
- [architecture/SMART-flow-map.md](../architecture/SMART-flow-map.md) describes the Go handlers (`backend/pkg/web/handler/…`) and the bring-your-own `POST /api/secure/source/authorize` and `/connect` routes, which `src/server.ts` does not have. The TypeScript server routes the catalog path: `POST /api/secure/provider-catalog/:id/authorize` and `…/connect`.
