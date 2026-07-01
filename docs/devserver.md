# Running the dev servers

Local development runs **two processes**: the Go API and the Angular dev server. The frontend dev server proxies `/api` to the backend, so you browse the SPA on `:4200` and it talks to the API on `:9090`.

## Prerequisites

- **`config.dev.yaml`** at the repo root (gitignored; copy/adapt from the committed `config.yaml`). It sets the backend listen port and dev settings (encryption off, debug). `make serve-backend` requires it.

## Start

In two terminals:

```bash
make serve-backend      # Go API on :9090 (config.dev.yaml, --debug)
make serve-frontend     # ng serve on :4200; proxies /api -> :9090 (sandbox mode)
```

Then open **<http://localhost:4200>**.

## Notes

- **Ports:** backend **9090** (`config.dev.yaml` `web.listen.port` — the `ng serve` dev proxy forwards `/api` here), frontend **4200**.
- **Sandbox mode:** the frontend dev server defaults to **sandbox** (talks only to synthetic-data test servers). `prod` mode talks to real servers; pick the build config with `-c` (e.g. `make build-frontend-prod`).
- **Version:** the footer shows `dev-<version>` (e.g. `dev-1.12.0`) via the public `/api/version` endpoint.
- **Dev data:** synthetic patient logins live in the local dev SQLite DB (persists on disk between restarts). The shared dev password is in `private/secrets.md` (gitignored) — not committed here.

## Check whether they're running

```bash
lsof -nP -iTCP -sTCP:LISTEN | grep -E ':(9090|4200)'
curl -s -o /dev/null -w "backend  %{http_code}\n" http://localhost:9090/api/version
curl -s -o /dev/null -w "frontend %{http_code}\n" http://localhost:4200/
```

A connection refused on both means dev is **not** running — start it with the two `make` commands above. (Note: a local listener on `:3000` is the separate ngdpbase "jimstest" app, **not** YourPHR.)

## Related

- `Makefile` — the `serve-*` / `build-*` targets.
- `CLAUDE.md` — the Commands section.
- `config.yaml` — the template for `config.dev.yaml`.
