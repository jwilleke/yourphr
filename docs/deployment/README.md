# Deployment & configuration

YourPHR is **deployment-agnostic**. It is a single Go binary that serves the compiled Angular app and stores everything in an embedded **SQLite** database — **no required external services**. Run it however suits you: `docker compose`, a plain `docker run`, a bare-metal binary, or Kubernetes. The same configuration interface works for all of them, so nothing here depends on any particular orchestrator (the maintainer's instance happens to use Flux/GitOps in a separate repo — that is *one option*, not a requirement).

The published image is **public and multi-arch**: `ghcr.io/jwilleke/yourphr` (tags `:main`, `:main-<run#>`, and release tags like `:v1.2.0`).

> **This page is the lead deployment doc.** Start here for how to run YourPHR and how it is configured; the deeper, topic-specific guides are linked from [Deployment docs](#deployment-docs) below and the [See also](#see-also) at the end.

## Deployment docs

This page covers running and configuring an instance. The rest of the deployment-related docs:

| Doc | What it covers |
|---|---|
| [Deployment options](#deployment-options) (this page) | docker-compose, `docker run`, bare metal, Kubernetes/GitOps — all from the same `YOURPHR_*` config interface. |
| [Configuration model](#configuration-model) (this page) | Precedence (`config.yaml` < `.env` < `.env_custom` < `YOURPHR_*`), the env mapping, and the full key reference. |
| [Sandbox provider credentials](#sandbox-provider-credentials) (this page) | The optional `YOURPHR_SANDBOX_*` one-click sandbox catalog ([#291](https://github.com/jwilleke/yourphr/issues/291)) — env-only, works on any deployment. |
| [OAuth relay (self-hosting)](#oauth-relay-self-hosting) (this page) | Self-host the public SMART redirect relay ([#20](https://github.com/jwilleke/yourphr/issues/20)) — Docker or k8s; only needed for live provider sync. |
| [`../testing-sandboxes/test-sandboxes.md`](../testing-sandboxes/test-sandboxes.md) | The test sandboxes themselves (Blue Button, Epic, SMART Health IT, …) and how to exercise them. |
| [`../vendors/README.md`](../vendors/README.md) | Per-vendor connection notes, onboarding gates, and registration friction. |
| [`../provider-catalog/`](../provider-catalog/) | The admin-configured provider catalog model (server-held creds; patients never see `client_id`/`client_secret`). |
| [`../medicare-bluebutton.md`](../medicare-bluebutton.md) | A full worked SMART-on-FHIR connect example with exact settings. |
| [`../FHIR/fhir-converter-local.md`](../FHIR/fhir-converter-local.md) | The optional C-CDA/CCD converter sidecar. |

> **Deployment-agnostic by rule.** Every option below is driven by the same `YOURPHR_*` environment contract and a SQLite file — nothing requires Kubernetes, Flux, SOPS, or any specific orchestrator. The maintainer's production instance uses Flux/GitOps in a separate repo (`mj-infra-flux`); that repo's only job is to *populate the same env vars* a `docker run` would. If a feature can only be configured one way, that is a bug — file it.

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

The committed `docker-compose-prod.yml` + `set_env.sh` flow in the [README](../../README.md#-launch) is the simplest route — it sets the LAN `HOSTNAME`/`IP` and starts the container. Use this if you want a one-command home server.

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
| `cda_converter.enabled` | `false` | C-CDA/CCD import — needs the Metriport sidecar (opt-in). See [`FHIR/fhir-converter-local.md`](../FHIR/fhir-converter-local.md). |
| `cda_converter.url` | `""` | Sidecar URL when enabled (internal-only — raw CCD is PHI). |
| `cda_converter.timeout_seconds` | `60` | Conversion timeout. |

## Secrets & credentials

There are **two distinct kinds** — don't conflate them:

1. **Operator/server secrets** (deployment-level, one set): the **DB encryption key** (required) and an optional pinned **JWT key**. Supply via `YOURPHR_*` env, a mounted `config.yaml`, or `.env_custom` — never in the committed `config.yaml`.
2. **Per-user OAuth credentials** (runtime, per user *and* per connected source): when a user connects a SMART source they enter their own `client_id`/`client_secret` in the UI. These are **stored encrypted in the database** (the `source_credentials` table, [#286](https://github.com/jwilleke/yourphr/issues/286)) — **not** an env var or file, because they are dynamic per-user data, not server config.

## Sandbox provider credentials

For trying live SMART-on-FHIR sync against vendor **test sandboxes**, YourPHR ships a one-click `/sandbox` provider catalog ([#291](https://github.com/jwilleke/yourphr/issues/291)). Instead of every user pasting a `client_id`/`client_secret`, the **operator** supplies them once as environment variables; the backend seeds the sandbox catalog from them on startup, and the secret is held server-side — it is `json:"-"` and **never serialized to the browser**.

This is **env-only and deployment-agnostic** — populate it however your deployment supplies env (docker `environment:`/`env_file:`, a bare-metal `.env_custom`, a k8s Secret, …). Set only the providers you have a registered app for:

| Provider | `client_id` env var | `client_secret` env var | Notes |
|---|---|---|---|
| CMS Blue Button 2.0 | `YOURPHR_SANDBOX_BLUEBUTTON_CLIENT_ID` | `YOURPHR_SANDBOX_BLUEBUTTON_CLIENT_SECRET` | Confidential — needs both. |
| Epic (sandbox) | `YOURPHR_SANDBOX_EPIC_CLIENT_ID` | *(none)* | Public/PKCE — no secret. |
| Oracle/Cerner (sandbox) | `YOURPHR_SANDBOX_ORACLE_CLIENT_ID` | *(none)* | Public/PKCE — no secret. |
| athenahealth (sandbox) | `YOURPHR_SANDBOX_ATHENA_CLIENT_ID` | `YOURPHR_SANDBOX_ATHENA_CLIENT_SECRET` | Confidential — needs both; vendor onboarding-gated. |
| SMART Health IT | *(none — fixed literal `client_id`)* | *(none)* | Open sandbox; always seeded, no config. |

**Behaviour:** a provider whose `client_id` env value is **empty is skipped** — that provider just doesn't appear under `/sandbox` on that instance; nothing errors and the open SMART Health IT sandbox is unaffected. Seeding is idempotent and re-runs on every startup, so updating an env value and restarting refreshes the stored creds. These are **operator/sandbox config**, not per-user data — production patient connects use the admin-configured provider catalog ([`../provider-catalog/`](../provider-catalog/)), not these env vars.

For the sandboxes themselves and how to exercise them, see [`../testing-sandboxes/test-sandboxes.md`](../testing-sandboxes/test-sandboxes.md) and the per-vendor notes in [`../vendors/README.md`](../vendors/README.md).

## OAuth relay (self-hosting)

Live SMART-on-FHIR sync ([EPIC #20](https://github.com/jwilleke/yourphr/issues/20)) needs a small public **OAuth relay** to catch the provider's redirect. After you authorize at the provider, it redirects the **browser** to `…/callback?code&state`; the relay stores `{state → code}` in memory (short TTL) and the YourPHR instance polls `…/pending?state=` (shared-secret gated) to retrieve the code and finish the token exchange itself. **The relay never sees tokens, and manual record upload needs no relay at all** — this is only for live provider sync.

By default the app points at the project's demo relay (`https://relay.nerdsbythehour.com`). Self-hosting it is optional but recommended for a real deployment, and — like everything else here — is **deployment-agnostic**: the relay is a single Go binary (`ghcr.io/jwilleke/yourphr-relay`) configured entirely by env.

### Relay configuration

| Env var | Required | Default | Purpose |
|---|---|---|---|
| `YOURPHR_RELAY_SECRET` | **yes** | — | Shared secret gating `/pending`. Generate with `openssl rand -hex 32`. Must match the app's `YOURPHR_RELAY_SECRET`. |
| `PORT` | no | `8080` | Public listener. Serves `/callback` (open) and `/pending` (secret-gated). |
| `METRICS_PORT` | no | `9090` | Prometheus `/metrics` + `/healthz`. **Internal only — do not expose publicly** (keeps callback/poll counts off the internet). |

Two hard requirements:

- The relay must be **publicly reachable** and **excluded from any forward-auth** (e.g. Authentik). The provider redirects the user's browser to `/callback`, so it must arrive **unauthenticated**.
- The `/callback` URL must **exactly match** the redirect URI you registered with each provider.

### Run it (Docker)

```bash
docker run -d --name yourphr-relay -p 8080:8080 \
  -e YOURPHR_RELAY_SECRET="$(openssl rand -hex 32)" \
  ghcr.io/jwilleke/yourphr-relay:main
```

Put it behind your own TLS-terminating reverse proxy / tunnel at a public hostname (e.g. `relay.example.org`), routing only the main `:8080` port — leave `METRICS_PORT` off the internet.

### Run it (Kubernetes / GitOps)

A ready-to-adapt manifest (Secret + Deployment + Service + Ingress, with the forward-auth exclusion called out) lives at [`../../backend/cmd/relay/deploy/yourphr-relay.example.yaml`](../../backend/cmd/relay/deploy/yourphr-relay.example.yaml). Copy it into your GitOps repo and adjust the host + secret. The maintainer's instance does exactly this via `mj-infra-flux`; the manifest is a template, not applied from this repo.

### Point the app at it

Set both on the YourPHR app (same `YOURPHR_*` env contract as the rest of this page):

```
YOURPHR_RELAY_URL=https://relay.example.org      # default: https://relay.nerdsbythehour.com
YOURPHR_RELAY_SECRET=<the same secret the relay was given>
```

If `YOURPHR_RELAY_SECRET` is unset, the app simply doesn't use a relay (it falls back to a directly-supplied auth code) — so a manual-upload-only instance needs neither var.

## Importing records

- **FHIR JSON / NDJSON** — uploaded directly, no extra services.
- **PDF / DICOM / image** — uploaded as viewable documents, no extra services ([#255](https://github.com/jwilleke/yourphr/issues/255)).
- **C-CDA / CCD** — requires the optional **Metriport fhir-converter sidecar** (`cda_converter.*`); see [`FHIR/fhir-converter-local.md`](../FHIR/fhir-converter-local.md).
- **Live provider sync (SMART on FHIR)** — connect a provider with your own `client_id` (bring-your-own). This is the one feature with an external touch point: an **OAuth relay** catches the provider's redirect. The default is the project's demo relay (`relay.nerdsbythehour.com`); a self-hoster can point at their own with `YOURPHR_RELAY_URL`. **Manual upload needs no relay.** Worked example with exact settings: [`medicare-bluebutton.md`](../medicare-bluebutton.md).

## See also

- [README — Launch / HTTPS / Develop](../../README.md#instructions)
- [`../testing-sandboxes/test-sandboxes.md`](../testing-sandboxes/test-sandboxes.md) — the test sandboxes and how to exercise them
- [`../vendors/README.md`](../vendors/README.md) — per-vendor connection notes and onboarding gates
- [`../provider-catalog/`](../provider-catalog/) — admin-configured production provider catalog
- [`../medicare-bluebutton.md`](../medicare-bluebutton.md) — a full worked SMART-on-FHIR connect example
- [`../../backend/cmd/relay/deploy/yourphr-relay.example.yaml`](../../backend/cmd/relay/deploy/yourphr-relay.example.yaml) — example k8s manifest for the OAuth relay
- [`FHIR/fhir-converter-local.md`](../FHIR/fhir-converter-local.md) — running the C-CDA converter sidecar
- [`architecture.md`](../architecture.md) — system overview
