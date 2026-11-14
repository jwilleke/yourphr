# #920 first test — the Angular app on ngdpbase's session

> Plan step 1 of [`ngdp-move.md`](ngdp-move.md) for [#920](https://github.com/jwilleke/yourphr/issues/920), run 2026-10-14 on branch `yourphr-addon`. Local only: a scratch copy of ngdpbase v5.9.0 (`master`, its prebuilt `dist/`) on `localhost:3917`, an empty data folder, the bootstrap `admin` with a random password through `NGDPBASE_ADMIN_PASSWORD` and `HEADLESS_INSTALL=true`. The ngdpbase checkout was not changed.

## The question

Can an ngdpbase add-on serve YourPHR's built Angular app so that, after a person signs in on ngdpbase's own `/login`, the app's calls to an add-on route ride the same session (`ApiContext.from(req)` sees the signed-in user)?

__Answer: yes.__ Nothing in ngdpbase had to change.

## What was built

`addons/yourphr/` (`@jwilleke/yourphr-addon`, `ngdpbase.slug` `yourphr`), the shape of ngdp-accounting-addons:

- Off unless `ngdpbase.addons.yourphr.enabled` is true. `status()` reports what is mounted, or why the app is not.
- `/api/yourphr/whoami`: `{ok, username, roles, csrfToken}` from `ApiContext.from(req, engine)`. 401 through `ctx.actingUsername()` and `sendApiError` when nobody is signed in.
- `/api/yourphr/echo`: a POST, to prove ngdpbase's CSRF middleware applies to add-on routes.
- The Angular build (`frontend`: `yarn build -c prod`, output `dist/web`) served at `/phr/` with `express.static`, and every other GET under `/phr/` answered with `index.html` (SPA fallback). `ngdpbase.addons.yourphr.mount-path` and `web-root` are configurable.

## Results

| Check | Result |
|---|---|
| Add-on discovered, enabled, loaded | PASS (`Add-on loaded: yourphr v0.0.1`) |
| Anonymous `GET /api/yourphr/whoami` | PASS: 401 `{"success":false,"error":"Authentication required"}` |
| Anonymous `POST /api/yourphr/echo` | 403, CSRF (the middleware covers add-on routes) |
| Sign in on ngdpbase `/login` (form `_csrf`) | PASS: 302 |
| `whoami` with that session | PASS: 200 `{"username":"admin","roles":["admin","vault-owner"]}` |
| Signed-in POST without `X-CSRF-Token` | 403 |
| Signed-in POST with `X-CSRF-Token` from `whoami` | PASS: 200 |
| `GET /phr` | 301 to `/phr/` |
| `GET /phr/` | PASS: Angular `index.html`, base href rewritten to `/phr/` |
| `GET /phr/explore/some/deep/route` | PASS: `index.html` (SPA fallback) |
| Hashed bundle `/phr/main.<hash>.js`, `/phr/assets/...` | PASS: 200, correct types |
| `/login?redirect=/phr/dashboard` | PASS: after sign-in, 302 to `/phr/dashboard` |
| `POST /logout` | PASS: `whoami` then 401 |

Not tested: the app booting in a real browser, and SSE (`/secure/events/stream`) under ngdpbase.

## What ngdpbase would need upstream

Nothing for this test. Worth knowing:

- __CSRF token for a single-page app.__ ngdpbase puts the token in its rendered pages (`_csrf`, `<meta name="csrf-token">`). An SPA has no page from ngdpbase, so the add-on hands the session's token out in `whoami`. That works, but a core way (a JSON endpoint, or a readable cookie Angular's built-in XSRF support reads) would serve every SPA add-on. A candidate upstream issue, not a blocker.
- __Core's `/addons` static mount__ serves the whole bundled `addons/` directory, so a bundled add-on's `config/` and `.ts` source are public at `/addons/yourphr/...`. Nothing secret is there today. Keep it that way, or ship the add-on packaged (`node_modules:`) rather than bundled.
- __CSP is report-only today__ (`Content-Security-Policy-Report-Only`). Angular's `index.html` uses an inline script and `document.write` for its base href. If ngdpbase moves to an enforced `script-src`, that script must go (see below).
- __A session cookie is set on an anonymous `GET /phr/`__ (the CSRF middleware issues a token per session). Harmless; noted.

## What the Angular app would need

From reading `frontend/src`. Nothing was rewritten.

1. __API base.__ `environment.prod.ts` has `fasten_api_endpoint_base: '/api'`. On ngdpbase, `/api/secure/account/me` and `/api/health` are 404s (ngdpbase's HTML). Change it to `/api/yourphr`, and the routes move under that prefix as the Sources slice is built. `GetEndpointAbsolutePath` needs no change, since `/phr` does not contain `/web`.
2. __Base href.__ `index.html` picks `/web/` or `/`. The add-on rewrites that one line at serve time. Cleaner: build with `--base-href /phr/` and drop the inline script, which also clears the CSP point above.
3. __Sign-in.__ `AuthInterceptorService` sends a 401 to Angular's own `/auth/signin`, and `IsAuthenticated()` asks `/secure/account/me`. Point the 401 at ngdpbase's `/login?redirect=<current /phr path>`, and point `IsAuthenticated()` at `whoami`. The interceptor's `/api/auth/` exception and the Bearer-token branch go away. The cookie is already same-origin, so it needs no other change.
4. __CSRF.__ Mutating calls need `X-CSRF-Token`. Angular's built-in XSRF support uses the `XSRF-TOKEN` cookie and the `X-XSRF-TOKEN` header, which ngdpbase does not use. Add the header in the interceptor from `whoami`'s `csrfToken`.
5. __Chrome components__ (sign-in, sign-up, account, admin) stop being routed, as already decided on [#920](https://github.com/jwilleke/yourphr/issues/920). They are deleted at cutover.

## Repository friction found

- __`../../dist` collides with our own `dist/`.__ The ngdpbase convention imports the host as `../../dist/src/...` from `addons/<slug>/`. In this repo `../../dist` is YourPHR's own build output (`dist/web`, the backend). ngdp-accounting-addons gets around this with an untracked `dist -> ../ngdpbase/dist` symlink, which this repo cannot use. For this test the add-on was copied into the scratch ngdpbase's `addons/` and compiled there. Before the Sources slice, decide how to handle it: move YourPHR's own build output, or keep a separate add-on repository.
- `addons/` sits outside the root `tsconfig.json` and vitest includes, so the repo's `npm run typecheck` and CI ignore it today. The add-on is typechecked only inside an ngdpbase tree.

## Effort

About 1.5 hours, including reading. Building and running ngdpbase was straightforward: its prebuilt `dist/`, a copy with `node_modules` symlinked, and `HEADLESS_INSTALL=true`. The only stumble was an rsync exclude of `data` that also dropped `dist/src/parsers/data/`.

## Reproduce

1. `cd frontend && yarn install --frozen-lockfile && yarn build -c prod`, which writes `dist/web`.
2. Copy ngdpbase (with its `dist/`) to a scratch directory and symlink its `node_modules`. Put `addons/yourphr` in the copy's `addons/` and compile it with `tsc -p tsconfig.json`.
3. Write `$FAST_STORAGE/config/app-custom-config.json` with `ngdpbase.addons.yourphr.enabled: true`, `ngdpbase.addons.yourphr.web-root: <repo>/dist/web`, `ngdpbase.user.security.defaultpassword: "$NGDPBASE_ADMIN_PASSWORD"`, `ngdpbase.session.secure: false` and a localhost port.
4. Start it with `FAST_STORAGE`, `SLOW_STORAGE`, `PUID`, `PGID`, `NGDPBASE_SYSTEM_USER`, `NGDPBASE_ADMIN_PASSWORD` and `HEADLESS_INSTALL=true`: `node dist/src/app.js`. Then run the curl checks above, following the cookie-jar pattern of ngdp-accounting-addons' `scripts/smoke.sh`.
