# Running the dev servers

Local development runs __two processes__: the Go API and the Angular dev server. The frontend dev server proxies `/api` to the backend, so you browse the SPA on `:4200` and it talks to the API on `:9090`.

## Prerequisites

- __`.env`__ at the repo root (gitignored; `cp .env.dev.example .env`). It sets the backend listen port and dev settings (encryption off, no converter sidecar). `make serve-backend` reads it from the working directory.

## Start

In two terminals:

```bash
make serve-backend      # Go API on :9090 (reads ./.env, --debug)
make serve-frontend     # ng serve on :4200; proxies /api -> :9090 (sandbox mode)
```

Then open __<http://localhost:4200>__.

## LAN access (other devices)

By default `ng serve` binds to `localhost` only. To reach the dev app from another device on your network (a phone, another machine) use the LAN target instead of `serve-frontend`:

```bash
make serve-frontend-lan   # ng serve on 0.0.0.0 (+ --disable-host-check), still :4200
```

Then browse to `http://<this-host-ip>:4200` from the other device. The backend already listens on all interfaces (`:9090`), so no change is needed there.

`--disable-host-check` accepts the LAN IP as the `Host` header (it turns off the dev server's DNS-rebinding protection). __Dev-only, trusted networks only__ — don't expose it on an untrusted network.

## Notes

- __Ports:__ backend __9090__ (`YOURPHR_WEB_LISTEN_PORT` in `.env` — the `ng serve` dev proxy forwards `/api` here), frontend __4200__.
- __Sandbox mode:__ the frontend dev server defaults to __sandbox__ (talks only to synthetic-data test servers). `prod` mode talks to real servers; pick the build config with `-c` (e.g. `make build-frontend-prod`).
- __Version:__ the footer shows `dev-<version>` (e.g. `dev-1.12.0`) via the public `/api/version` endpoint.
- __Dev data:__ synthetic patient logins live in the local dev SQLite DB (persists on disk between restarts). See [Dev test accounts](#dev-test-accounts).

## Dev test accounts

Synthetic accounts seeded in the local dev SQLite DB (they persist across restarts). All share __one__ dev password kept in `private/secrets.md` (gitignored) — not committed here.

- `test` — admin
- `clopez` — Epic sandbox (Camila Lopez): conditions / encounters / documents
- `jdoe` — Synthea: full happy-path record (encounters)
- `aheller` — Synthea (encounters)
- `bblick` — Synthea (encounters)
- `nsmart` — Oracle/Cerner sandbox (Nancy Smart): documents + allergies only (no `Patient`/`Encounter`)

## Check whether they're running

```bash
lsof -nP -iTCP -sTCP:LISTEN | grep -E ':(9090|4200)'
curl -s -o /dev/null -w "backend  %{http_code}\n" http://localhost:9090/api/version
curl -s -o /dev/null -w "frontend %{http_code}\n" http://localhost:4200/
```

A connection refused on both means dev is __not__ running — start it with the two `make` commands above. (Note: a local listener on `:3000` is the separate ngdpbase "jimstest" app, __not__ YourPHR.)

## Troubleshooting a local-only build/test failure

If `ng test` / `ng serve` / `make test-frontend-coverage` fails locally but __CI passes on the same commit__, the cause is almost always stale local state — not the code and not the lockfile. Work through these in order; each is cheap and safe (all three targets are gitignored and regenerate themselves).

### 1. `Cannot find module` / `Can't resolve` a path containing `.../node_modules/.../node_modules/...`

Clear the Angular build cache __first__:

```bash
make clean-frontend-cache
```

> `make dep-frontend` now clears this cache automatically whenever `frontend/yarn.lock` changes (it hashes the lockfile into `frontend/.angular/.yarn-lock-hash`), and every `serve-*` / `build-*` / `test-*` target depends on `dep-frontend`. So this failure should no longer occur after a normal `git pull` + build. Reach for the manual command if you hit it anyway, or to reclaim disk.

The cache stores __absolute__ resolved paths. When a dependency bump changes how packages nest — e.g. a `resolutions` pin hoisting `@babel/runtime` out of `@angular-devkit/build-angular/node_modules/` — the cached paths point at directories that no longer exist. It lives __outside `node_modules`, so reinstalling never clears it__, and the error reads like a broken install, which sends you down the wrong path. CI never hits this because it starts with no cache.

Also worth checking its size — Angular CLI offers no maximum-size setting and never prunes, so on a long-lived checkout it can reach tens of GB (89 GB on this one before it was first cleared):

```bash
du -sh frontend/.angular/cache
```

### 2. A module genuinely missing from `node_modules`

```bash
rm -rf frontend/node_modules && make dep-frontend
```

Needed after merging any PR that changes `frontend/yarn.lock`. A plain `make dep-frontend` may report "Already up-to-date" and do nothing when the tree is inconsistent rather than incomplete — delete `node_modules` to force it.

### 3. Go equivalent

```bash
go mod vendor
```

`vendor/` is gitignored and goes stale after any `go.mod` change, producing `inconsistent vendoring` errors.

> __Verify the behaviour, not a proxy.__ After any of these, re-run the actual suite and check the __exit code__ — do not conclude from whether a file is now present, or from filtered command output. `grep -c` exits non-zero when it matches nothing, so a "no failures found" filter can itself look like a failure (and vice versa).

## Related

- `Makefile` — the `serve-*` / `build-*` targets.
- `AGENTS.md` — the Commands section.
- `.env.dev.example` — the template for `.env`.
