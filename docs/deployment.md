# Deployment & configuration

YourPHR is **deployment-agnostic**. It is a single Go binary that serves the compiled Angular app and stores everything in an embedded **SQLite** database — **no required external services**. Run it however suits you: `docker compose`, a plain `docker run`, a bare-metal binary, or Kubernetes. The same configuration interface works for all of them, so nothing here depends on any particular orchestrator (the maintainer's instance happens to use Flux/GitOps in a separate repo — that is *one option*, not a requirement).

The published image is **public and multi-arch**: `ghcr.io/jwilleke/yourphr` (tags `:main`, `:main-<run#>`, and release tags like `:v1.2.0`).

## Quick start (minimal, no external services)

```bash
docker run -p 8080:8080 -v "$(pwd)/db:/opt/fasten/db" ghcr.io/jwilleke/yourphr:main
```

Open `http://localhost:8080` and complete the first-run setup. On first run YourPHR is **secure by default**:

- The **JWT signing key auto-generates** and is persisted (0600) at `<db-dir>/.jwt_issuer_key` — zero config ([#102](https://github.com/jwilleke/yourphr/issues/102)). The committed `config.yaml` ships a *known public placeholder* key that the server treats as "unset" and never signs with.
- The **database-encryption key** is set during first-run setup (the setup wizard prompts for it) — or you can supply it ahead of time via `YOURPHR_DATABASE_ENCRYPTION_KEY` (see below). DB encryption is **on by default**.
- The **first user to register becomes the admin**.

## Deployment options

### A. docker-compose (easy home-server path)

The committed `docker-compose-prod.yml` + `set_env.sh` flow in the [README](../README.md#-launch) is the simplest route — it sets the LAN `HOSTNAME`/`IP` and starts the container. Use this if you want a one-command home server.

### B. Plain `docker run`

Mount what you want to persist and pass config as env (or mount a file):

```bash
docker run -d --name yourphr -p 9090:8080 \
  -v "$(pwd)/db:/opt/fasten/db" \
  -v "$(pwd)/certs:/opt/fasten/certs/shared" \
  -e YOURPHR_DATABASE_ENCRYPTION_KEY="$(openssl rand -hex 16)" \
  -e YOURPHR_LOG_LEVEL=INFO \
  ghcr.io/jwilleke/yourphr:main
```

To override many keys at once, mount a config file at `/opt/fasten/config/config.yaml`, or drop a `.env_custom` at `/opt/fasten/.env_custom` (see [Configuration model](#configuration-model)).

### C. Bare metal

Build the binary (or download a release asset), then run it with a config file and/or env:

```bash
# build (needs Go + Node toolchains; see the Develop section of the README)
make build-frontend-prod
go build -o fasten ./backend/cmd/fasten/

# run — config via a file and/or YOURPHR_* env
YOURPHR_DATABASE_ENCRYPTION_KEY="$(openssl rand -hex 16)" \
  ./fasten start --config ./config.yaml
```

`fasten start --config <path>` reads that YAML; `fasten migrate` runs DB migrations without starting the server.

### D. Kubernetes / GitOps

Provide config via a `ConfigMap` (non-secret) + `Secret` (the DB encryption key, an optional pinned JWT key) injected as `YOURPHR_*` environment variables. Mount a `PersistentVolume` at `/opt/fasten/db`. Any GitOps tool works; nothing in the app is Kubernetes- or Flux-specific.

## Configuration model

Configuration is layered. **Precedence, lowest → highest:**

```
built-in defaults  <  config.yaml  <  .env  <  .env_custom  <  YOURPHR_* environment
```

- **Built-in defaults** — baked into the binary (`backend/pkg/config/config.go`); sensible for a stock install.
- **`config.yaml`** — the committed file ships defaults + placeholders. Override by pointing `--config` at your own file (e.g. a gitignored `config.dev.yaml`); never put real secrets in the committed `config.yaml`.
- **`.env` / `.env_custom`** — *optional* dotenv files loaded from the process **working directory** at startup (repo root for `make serve-backend`; `/opt/fasten/` inside the container — mount `.env_custom` there). `.env` is a per-deployment base; `.env_custom` (gitignored) holds instance overrides. Both are optional — config works on defaults + `YOURPHR_*` env alone. Copy `.env.example` to start.
- **`YOURPHR_*` environment** — the universal override, highest precedence (ideal for secrets and k8s).

### The `YOURPHR_*` env mapping

Any config key can be set as an env var: prefix **`YOURPHR_`**, uppercase the key, and turn every `.` and `-` into `_`.

| Config key | Env var |
|---|---|
| `database.encryption.key` | `YOURPHR_DATABASE_ENCRYPTION_KEY` |
| `jwt.issuer.key` | `YOURPHR_JWT_ISSUER_KEY` |
| `web.listen.port` | `YOURPHR_WEB_LISTEN_PORT` |
| `log.level` | `YOURPHR_LOG_LEVEL` |
| `cda_converter.enabled` | `YOURPHR_CDA_CONVERTER_ENABLED` |
| `web.smart_connect.login_wait_seconds` | `YOURPHR_WEB_SMART_CONNECT_LOGIN_WAIT_SECONDS` |

## Configuration reference

| Key | Default | Notes |
|---|---|---|
| `web.listen.port` | `8080` | Backend listen port inside the container. |
| `web.listen.host` | `0.0.0.0` | Bind address. |
| `web.listen.basepath` | `""` | Sub-path when behind a reverse proxy (e.g. `/phr`). |
| `web.listen.https.enabled` | `false` | Serve HTTPS with a self-generated CA (see the README HTTPS section). |
| `web.allow_unsafe_endpoints` | `false` | **Never enable in production** — exposes unauthenticated API access. |
| `web.smart_connect.login_wait_seconds` | `240` | How long the SMART-on-FHIR connect flow waits for the user to finish logging in at the provider before timing out. Served to the frontend, so changing it needs **no frontend rebuild** — raise it for slow provider logins (e.g. CMS Blue Button). |
| `database.type` | `sqlite` | Only SQLite is supported; Postgres is present but **broken**. |
| `database.location` | `/opt/fasten/db/fasten.db` | SQLite file — mount this path to persist data. |
| `database.encryption.enabled` | `true` | DB-at-rest encryption (encrypted SQLite build). |
| `database.encryption.key` | *(unset — required)* | Set on first-run setup or via `YOURPHR_DATABASE_ENCRYPTION_KEY` (≥10 chars). |
| `jwt.issuer.key` | *(public placeholder — auto-gen)* | Auto-generates a strong key if unset; override with `YOURPHR_JWT_ISSUER_KEY` (`openssl rand -hex 32`). Never use the committed default in production. |
| `log.level` | `INFO` | `DEBUG` / `INFO` / `WARN` / `ERROR`. |
| `log.file` | `""` | Optional log file (also writes to stderr). |
| `cda_converter.enabled` | `false` | C-CDA/CCD import — needs the Metriport sidecar (opt-in). See [`FHIR/fhir-converter-local.md`](FHIR/fhir-converter-local.md). |
| `cda_converter.url` | `""` | Sidecar URL when enabled (internal-only — raw CCD is PHI). |
| `cda_converter.timeout_seconds` | `60` | Conversion timeout. |

## Secrets & credentials

There are **two distinct kinds** — don't conflate them:

1. **Operator/server secrets** (deployment-level, one set): the **DB encryption key** (required) and an optional pinned **JWT key**. Supply via `YOURPHR_*` env, a mounted `config.yaml`, or `.env_custom` — never in the committed `config.yaml`.
2. **Per-user OAuth credentials** (runtime, per user *and* per connected source): when a user connects a SMART source they enter their own `client_id`/`client_secret` in the UI. These are **stored encrypted in the database** (the `source_credentials` table, [#286](https://github.com/jwilleke/yourphr/issues/286)) — **not** an env var or file, because they are dynamic per-user data, not server config.

## Importing records

- **FHIR JSON / NDJSON** — uploaded directly, no extra services.
- **PDF / DICOM / image** — uploaded as viewable documents, no extra services ([#255](https://github.com/jwilleke/yourphr/issues/255)).
- **C-CDA / CCD** — requires the optional **Metriport fhir-converter sidecar** (`cda_converter.*`); see [`FHIR/fhir-converter-local.md`](FHIR/fhir-converter-local.md).
- **Live provider sync (SMART on FHIR)** — connect a provider with your own `client_id` (bring-your-own). This is the one feature with an external touch point: an **OAuth relay** catches the provider's redirect. The default is the project's demo relay (`relay.nerdsbythehour.com`); a self-hoster can point at their own with `YOURPHR_RELAY_URL`. **Manual upload needs no relay.** Worked example with exact settings: [`medicare-bluebutton.md`](medicare-bluebutton.md).

## See also

- [README — Launch / HTTPS / Develop](../README.md#instructions)
- [`FHIR/fhir-converter-local.md`](FHIR/fhir-converter-local.md) — running the C-CDA converter sidecar
- [`architecture.md`](architecture.md) — system overview
