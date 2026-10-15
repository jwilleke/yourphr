# Contributing to YourPHR

__You don't have to be a developer to make YourPHR better.__ Patients, clinicians, designers, writers, translators, FHIR/standards folks, and engineers all have a place here. This page is both an invitation and a map.

> __Mission: Your medical records, immediately and in your hands — for free.__ YourPHR is a self-hosted personal/family health record viewer — a [community-maintained, standalone continuation](README.md) of Fasten OnPrem (GPL v3, attribution retained).

## Why contribute

- __It matters.__ People can't act on records they can't read. YourPHR exists to put your health *in your hands* in plain language — see the [patient-legible display north star](docs/your-phr-dashboard/patient-legible-display.md). Your work goes straight to that.
- __It stays yours.__ YourPHR is __community-owned and stays free__ — GPL v3, self-hosted, your data never leaves your control and is never sold. This is a continuation that exists to keep a fully open-source build alive after upstream's sync moved into a commercial product; the whole point is that effort here compounds and won't be locked away.
- __The problems are genuinely interesting__ (see below).

## The interesting problems (if you want something meaty)

This is real-world health-data engineering, not CRUD. A few of the juicy ones:

- __Turn messy, vendor-specific FHIR into something a human can read.__ Patient portals export non-conformant FHIR R4 (FollowMyHealth/Veradigm collapse social/lifestyle items into clinical `Condition`s, omit `Condition.category`, use proprietary code systems). We normalize it at read time and route it to legible patient sections — the __two-layer source-adapter / display-mapper__ design in [classification-and-display-architecture.md](docs/your-phr-dashboard/classification-and-display-architecture.md).
- __Reconcile "Current Medications" across resource types__ — one drug scattered across `MedicationRequest` / `MedicationStatement` / `MedicationDispense`, no clean "is current" flag. A derived, de-duplicated, provenance-aware view ([#264](https://github.com/jwilleke/yourphr/issues/264)).
- __Self-hosted SMART-on-FHIR without a commercial relay__ — a tiny public store-and-poll OAuth `code` bouncer that never sees tokens, so a LAN instance can still sync ([relay README](relay/README.md), [EPIC #20](https://github.com/jwilleke/yourphr/issues/20)).
- __US Core 9.0.0 Must-Support display conformance__ — a CI gate checks our display against the IG's own example resources ([docs/us-core/](docs/us-core/README.md)).
- __Importing the formats portals actually give patients__ — C-CDA/CCD XML ([#254](https://github.com/jwilleke/yourphr/issues/254)), PDFs ([#255](https://github.com/jwilleke/yourphr/issues/255)).

Start with the [architecture overview](./docs/architecture/architecture.md) for the whole map, then the [roadmap](docs/Roadmap.md) for where it's headed.

## Ways to contribute — by what you're good at

| If you are a… | You can help with… | Start here |
|---|---|---|
| __Developer__ (Go / Angular) | Backend FHIR handling, display models, the API, frontend cards & dashboards | [`good first issue`](https://github.com/jwilleke/yourphr/labels/good%20first%20issue) · [`help wanted`](https://github.com/jwilleke/yourphr/labels/help%20wanted) · the [dev setup](#development-environment) below |
| __FHIR / health-IT / standards__ person | US Core conformance, vendor-quirk mappings, value-set translation, SMART-on-FHIR | [docs/us-core/](docs/us-core/README.md), [docs/EHR-vendors/](./docs/EHR-vendors/README.md), [#136](https://github.com/jwilleke/yourphr/issues/136) |
| __Clinician / health professional__ | Sanity-check that displays are *correct* and *legible*, validate medication/condition reconciliation | open a [feature/bug issue](https://github.com/jwilleke/yourphr/issues/new/choose) describing what's wrong or misleading |
| __Designer / UX__ | Make the dashboard and cards genuinely legible — the [patient-legible](docs/your-phr-dashboard/patient-legible-display.md) bar | [#262](https://github.com/jwilleke/yourphr/issues/262), [#244](https://github.com/jwilleke/yourphr/issues/244), the BS5 migration [#209](https://github.com/jwilleke/yourphr/issues/209) |
| __Writer / plain-language__ | Docs, the glossary that translates codes to words, READMEs, onboarding | the `documentation` label; the `glossary-lookup` component |
| __Translator__ | Make YourPHR usable in more languages | open an issue — i18n is welcome |
| __Tester with real exports__ | Run *your own* FHIR/CCD/PDF export through it and report what renders poorly (__never paste real PHI__ — see below) | the display-gap path / a [bug report](https://github.com/jwilleke/yourphr/issues/new/choose) |
| __Security / privacy__ | Review auth, the SSRF guard, CSP, the relay; threat-model the self-hosted deployment | [SECURITY.md](SECURITY.md), [security review](docs/planning/architecture-security-review.md) |
| __Ops / packaging__ | Docker, k8s/Flux, the Nix flake, CI | the `dependencies` / build issues |

New here and not sure? Open a [blank issue](https://github.com/jwilleke/yourphr/issues/new/choose) or say hello — "I'd like to help, where do I start?" is a perfectly good first message.

## Find something to work on

- __Newcomers:__ [`good first issue`](https://github.com/jwilleke/yourphr/labels/good%20first%20issue) — small, well-scoped, low-context.
- __Want impact:__ [`help wanted`](https://github.com/jwilleke/yourphr/labels/help%20wanted) — meatier work where an extra pair of hands moves the mission.
- Comment on an issue to claim it (so two people don't duplicate effort), then open a PR that references it (`Fixes #123`).
- Be kind: we follow the [Code of Conduct](CODE_OF_CONDUCT.md) (Contributor Covenant).

### A note on health data (important)

YourPHR handles __Personal Health Information__. __Never__ attach real patient data, real exports, secrets, or keys to an issue or PR — use *synthetic* (Synthea-generated) fixtures only. If you found a display bug in your own records, describe the *shape* of the problem and paste a small __synthetic__ example, never the real thing. See the data rules in [AGENTS.md](AGENTS.md).

---

## Development environment

> The authoritative pinned versions live in `frontend/.nvmrc`, `frontend/package.json`, `go.mod`, and `Dockerfile` — keep this section in sync with those. In the meantime, the [Fasten Docs Repository](https://github.com/fastenhealth/docs/tree/main/technical) has extensive background.

## Tech stack

### Frontend

- Node.js `v24` — pinned in `frontend/.nvmrc` (run `nvm use` in `frontend/`)
- Yarn `1.22.22` (classic) — pinned via `package.json` `packageManager`; enable with `corepack enable`
- Angular `v20` — use the project-local CLI via `npx ng …` (don't install a global CLI)

### Backend

- Go `v1.24` — built with `golang:1.24`; `go.mod` requires `go 1.23+`

### Misc

- Docker `v24+`

> Stack modernization (Node 24, Angular 20, Go 1.24, Docker distroless) is tracked in [#12](https://github.com/jwilleke/yourphr/issues/12); the Angular 14 → 20 climb and the Node → 24 flip are complete.

## Versioning

YourPHR follows [SemVer](https://semver.org/). Releases are cut by a maintainer pushing an annotated `vX.Y.Z` tag — no release bot, no release PR ([#241](https://github.com/jwilleke/yourphr/issues/241) removed release-please, whose bot PR could not pass `main`'s required checks without a privileged token). Write commits as [Conventional Commits](https://www.conventionalcommits.org/); `CHANGELOG.md` is written by hand at release time in that format. The steps are in [`docs/development/releasing.md`](./docs/development/releasing.md). The version lives in `package.json` and nowhere else — a v3 instance reads it there and serves it on `/api/version`.

## Setup

### Nix (recommended)

If you use Nix, the included flake provisions everything:

1. Install [Nix](https://nixos.org/download/) with flakes enabled, and optionally [direnv](https://direnv.net/).
2. `direnv allow` in this directory — the environment activates automatically on entry.

### macOS

```bash
brew install node            # then: cd frontend && nvm use   (or use the .nvmrc version)
corepack enable              # provides the pinned Yarn 1.22.22

brew install go

brew install docker

# Frontend tests run with the ChromeHeadless browser.
brew install --cask google-chrome

# Go tooling (TypeScript type generation from Go structs)
go install github.com/gzuidhof/tygo@latest
```

## Running tests

Before changing anything, confirm your environment is set up:

```bash
make test            # both suites
make test-frontend   # Angular only (ChromeHeadless)
npm test             # the server's unit tests (vitest)
```

The server also has integration harnesses under `scripts/`, run one at a time — `npm run app`,
`npm run auth`, `npm run records`, and so on. CI runs each as its own job; the authoritative list
is `.github/workflows/server-ci.yaml`. Before pushing, run that whole list rather than a subset:
`npm run typecheck` and `npm run build` read *different* TypeScript configs and can disagree.

## Start the dev environment

Running from source needs two processes: the Angular frontend and the TypeScript server.

```bash
cp .env.dev.example .env
```

```bash
# .env — bootstrap and secrets only; every other setting is Admin -> Configuration
YOURPHR_WEB_LISTEN_PORT=9090          # frontend/proxy.conf.json proxies /api here
YOURPHR_FAST_STORAGE=./data           # the databases, the config store, the signing key
```

Leave the encryption key unset for dev and the databases are written in the clear — the server says
so on every start. (The `.env.*.example` templates still describe the Go stack's keys and are being
rewritten, [#676](https://github.com/jwilleke/yourphr/issues/676).)

Then, in two terminals:

```bash
# Terminal 1
make serve-frontend

# Terminal 2
make serve-server
```

Open `http://localhost:4200`. The frontend dev server proxies API requests to the backend.

*Modes:* YourPHR runs in __sandbox__ (talks only to synthetic-data test servers — the default for dev) or __prod__ (real servers).

## Credentials

All user data is stored locally, including your account. On first start, register a new account, then visit the Sources tab. See [Connecting a new Source](https://docs.fastenhealth.com/getting-started/sandbox.html#connecting-a-new-source) for sandbox credentials.

## Source code layout

See the [architecture overview](./docs/architecture/architecture.md) for the high-level map and diagrams. In short:

__Frontend__ (`frontend/src/app/`)

```
├── components      # shared/partial components reused across pages
├── models          # API models + view models (patient-access-brands/ is tygo-generated — don't edit)
├── pages           # auth, dashboard, medical-sources, resource-detail, source-detail …
├── services        # fasten-api.service.ts (backend client), auth, event-bus (SSE)
└── widgets         # dashboard widget components
```

__Backend__ (`backend/`)

```
├── cmd
│   ├── fasten       # entry point: start / migrate / version
│   └── relay        # SMART-on-FHIR store-and-poll OAuth relay
└── pkg
    ├── auth         # HS256 JWT + bcrypt
    ├── database     # DatabaseRepository interface + GORM (encrypted SQLite); migrations/
    ├── models
    │   └── database # generated fhir_*.go (FHIRPath → indexed columns) — DO NOT hand-edit
    └── web
        ├── handler  # API endpoints
        ├── middleware
        └── server.go
```

> __Generated code:__ `fhir_*.go` and `frontend/.../models/patient-access-brands/*.ts` are generated. Re-run `make generate-backend` when their inputs (`search-parameters.json`, tygo-exported Go structs) change, and commit the result. Details in [AGENTS.md](AGENTS.md).

## FAQ

### How do I run individual frontend tests?

From `frontend/`, use `ng test --include`:

```bash
npx ng test --include='**/badge.component.spec.ts'
npx ng test --include='lib/**/*.spec.ts'
```

### How do I work with Storybook?

[Storybook](https://storybook.js.org) develops/tests frontend components in isolation:

```bash
make serve-storybook   # interactive
make build-storybook   # verify all stories build (a CI check)
```

### Generate a JWT for local use

```bash
curl -X POST http://localhost:9090/api/auth/signup -H 'Content-Type: application/json' -d '{"username":"user1","password":"user1"}'
curl -X POST http://localhost:9090/api/auth/signin -H 'Content-Type: application/json' -d '{"username":"user1","password":"user1"}'
```

The default encryption key and admin credentials can be overridden via `YOURPHR_JWT_ISSUER_KEY`.

### Access the encrypted SQLite DB with IntelliJ

- Download the latest `sqlite-jdbc-crypt` jar from <https://github.com/Willena/sqlite-jdbc-crypt/releases>.
- IntelliJ → Data Source Properties → Driver tab → duplicate `Sqlite`, rename to `Sqlite (Encrypted)`, set Driver Files to the downloaded jar, remove the `Xerial Sqlite JDBC` jar, Apply/OK.
- New Data Source → `Sqlite (Encrypted)` → Connection Type `Url only`:
  `jdbc:sqlite:fasten.db?cipher=sqlcipher&legacy=3&hmac_use=0&kdf_iter=4000&legacy_page_size=1024&key=<your database.encryption_key>`
- Test Connection → Apply/OK.

### Flush the SQLite Write-Ahead-Log to the DB

```sql
PRAGMA wal_checkpoint(TRUNCATE);
```

See <https://www.sqlite.org/pragma.html#pragma_wal_checkpoint>.

---

Work your magic and open a pull request — we love pull requests. Found something but short on time? [Open an issue](https://github.com/jwilleke/yourphr/issues/new/choose) and tell us.
