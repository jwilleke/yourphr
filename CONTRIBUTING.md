# Contributing to YourPHR

**You don't have to be a developer to make YourPHR better.** Patients, clinicians, designers, writers, translators, FHIR/standards folks, and engineers all have a place here. This page is both an invitation and a map.

> **Mission: Your medical records, immediately and in your hands — for free.** YourPHR is a self-hosted personal/family health record viewer — a [community-maintained, standalone continuation](README.md) of Fasten OnPrem (GPL v3, attribution retained).

## Why contribute

- **It matters.** People can't act on records they can't read. YourPHR exists to put your health *in your hands* in plain language — see the [patient-legible display north star](docs/your-phr-dashboard/patient-legible-display.md). Your work goes straight to that.
- **It stays yours.** YourPHR is **community-owned and stays free** — GPL v3, self-hosted, your data never leaves your control and is never sold. This is a continuation that exists *because* the original stalled; the whole point is that effort here compounds and won't be locked away.
- **The problems are genuinely interesting** (see below).

## The interesting problems (if you want something meaty)

This is real-world health-data engineering, not CRUD. A few of the juicy ones:

- **Turn messy, vendor-specific FHIR into something a human can read.** Patient portals export non-conformant FHIR R4 (FollowMyHealth/Veradigm collapse social/lifestyle items into clinical `Condition`s, omit `Condition.category`, use proprietary code systems). We normalize it at read time and route it to legible patient sections — the **two-layer source-adapter / display-mapper** design in [classification-and-display-architecture.md](docs/your-phr-dashboard/classification-and-display-architecture.md).
- **Reconcile "Current Medications" across resource types** — one drug scattered across `MedicationRequest` / `MedicationStatement` / `MedicationDispense`, no clean "is current" flag. A derived, de-duplicated, provenance-aware view ([#264](https://github.com/jwilleke/yourphr/issues/264)).
- **Self-hosted SMART-on-FHIR without a commercial relay** — a tiny public store-and-poll OAuth `code` bouncer that never sees tokens, so a LAN instance can still sync ([relay README](backend/cmd/relay/README.md), [EPIC #20](https://github.com/jwilleke/yourphr/issues/20)).
- **US Core 9.0.0 Must-Support display conformance** — a CI gate checks our display against the IG's own example resources ([docs/us-core/](docs/us-core/README.md)).
- **Importing the formats portals actually give patients** — C-CDA/CCD XML ([#254](https://github.com/jwilleke/yourphr/issues/254)), PDFs ([#255](https://github.com/jwilleke/yourphr/issues/255)).

Start with the [architecture overview](docs/architecture.md) for the whole map, then the [roadmap](docs/Roadmap.md) for where it's headed.

## Ways to contribute — by what you're good at

| If you are a… | You can help with… | Start here |
|---|---|---|
| **Developer** (Go / Angular) | Backend FHIR handling, display models, the API, frontend cards & dashboards | [`good first issue`](https://github.com/jwilleke/yourphr/labels/good%20first%20issue) · [`help wanted`](https://github.com/jwilleke/yourphr/labels/help%20wanted) · the [dev setup](#development-environment) below |
| **FHIR / health-IT / standards** person | US Core conformance, vendor-quirk mappings, value-set translation, SMART-on-FHIR | [docs/us-core/](docs/us-core/README.md), [docs/vendors/](docs/vendors/README.md), [#136](https://github.com/jwilleke/yourphr/issues/136) |
| **Clinician / health professional** | Sanity-check that displays are *correct* and *legible*, validate medication/condition reconciliation | open a [feature/bug issue](https://github.com/jwilleke/yourphr/issues/new/choose) describing what's wrong or misleading |
| **Designer / UX** | Make the dashboard and cards genuinely legible — the [patient-legible](docs/your-phr-dashboard/patient-legible-display.md) bar | [#262](https://github.com/jwilleke/yourphr/issues/262), [#244](https://github.com/jwilleke/yourphr/issues/244), the BS5 migration [#209](https://github.com/jwilleke/yourphr/issues/209) |
| **Writer / plain-language** | Docs, the glossary that translates codes to words, READMEs, onboarding | the `documentation` label; the `glossary-lookup` component |
| **Translator** | Make YourPHR usable in more languages | open an issue — i18n is welcome |
| **Tester with real exports** | Run *your own* FHIR/CCD/PDF export through it and report what renders poorly (**never paste real PHI** — see below) | the display-gap path / a [bug report](https://github.com/jwilleke/yourphr/issues/new/choose) |
| **Security / privacy** | Review auth, the SSRF guard, CSP, the relay; threat-model the self-hosted deployment | [SECURITY.md](SECURITY.md), [security review](docs/planning/architecture-security-review.md) |
| **Ops / packaging** | Docker, k8s/Flux, the Nix flake, CI | the `dependencies` / build issues |

New here and not sure? Open a [blank issue](https://github.com/jwilleke/yourphr/issues/new/choose) or say hello — "I'd like to help, where do I start?" is a perfectly good first message.

## Find something to work on

- **Newcomers:** [`good first issue`](https://github.com/jwilleke/yourphr/labels/good%20first%20issue) — small, well-scoped, low-context.
- **Want impact:** [`help wanted`](https://github.com/jwilleke/yourphr/labels/help%20wanted) — meatier work where an extra pair of hands moves the mission.
- Comment on an issue to claim it (so two people don't duplicate effort), then open a PR that references it (`Fixes #123`).
- Be kind: we follow the [Code of Conduct](CODE_OF_CONDUCT.md) (Contributor Covenant).

### A note on health data (important)

YourPHR handles **Personal Health Information**. **Never** attach real patient data, real exports, secrets, or keys to an issue or PR — use *synthetic* (Synthea-generated) fixtures only. If you found a display bug in your own records, describe the *shape* of the problem and paste a small **synthetic** example, never the real thing. See the data rules in [CLAUDE.md](CLAUDE.md).

---

# Development environment

> The authoritative pinned versions live in `frontend/.nvmrc`, `frontend/package.json`, `go.mod`, and `Dockerfile` — keep this section in sync with those. In the meantime, the [Fasten Docs Repository](https://github.com/fastenhealth/docs/tree/main/technical) has extensive background.

## Tech stack

**Frontend**

- Node.js `v24` — pinned in `frontend/.nvmrc` (run `nvm use` in `frontend/`)
- Yarn `1.22.22` (classic) — pinned via `package.json` `packageManager`; enable with `corepack enable`
- Angular `v20` — use the project-local CLI via `npx ng …` (don't install a global CLI)

**Backend**

- Go `v1.24` — built with `golang:1.24`; `go.mod` requires `go 1.23+`

**Misc**

- Docker `v24+`

> Stack modernization (Node 24, Angular 20, Go 1.24, Docker distroless) is tracked in [#12](https://github.com/jwilleke/yourphr/issues/12); the Angular 14 → 20 climb and the Node → 24 flip are complete.

## Versioning

YourPHR follows [SemVer](https://semver.org/): releases are cut on demand by a maintainer running the **release-please** workflow (not per commit), and each release is a **patch** bump by default (e.g. `1.1.3` → `1.1.4`). Write commits as [Conventional Commits](https://www.conventionalcommits.org/) (they drive the auto-generated `CHANGELOG.md`); for a **minor** or **major** release, add a `Release-As: 1.2.0` (or `2.0.0`) footer. Never hand-edit `backend/pkg/version/version.go` or `CHANGELOG.md`.

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
make test-backend    # Go only
```

**Note:** the first backend run takes a while (it vendors deps and generates code).

## Start the dev environment

Running from source needs two processes: the Angular frontend and the Go backend. First create a dev config (`config.dev.yaml`):

```yaml
version: 1
web:
  listen:
    port: 9090
    host: 0.0.0.0
    basepath: ''
  src:
    frontend:
      path: ./dist
database:
  location: 'fasten.db'
cache:
  location: ''
log:
  file: '' # absolute or relative paths allowed, eg. web.log
  level: INFO
```

Then, in two terminals:

```bash
# Terminal 1
make serve-frontend

# Terminal 2
make serve-backend
```

Open `http://localhost:4200`. The frontend dev server proxies API requests to the backend.

_Modes:_ YourPHR runs in **sandbox** (talks only to synthetic-data test servers — the default for dev) or **prod** (real servers).

## Credentials

All user data is stored locally, including your account. On first start, register a new account, then visit the Sources tab. See [Connecting a new Source](https://docs.fastenhealth.com/getting-started/sandbox.html#connecting-a-new-source) for sandbox credentials.

## Source code layout

See the [architecture overview](docs/architecture.md) for the high-level map and diagrams. In short:

**Frontend** (`frontend/src/app/`)

```
├── components      # shared/partial components reused across pages
├── models          # API models + view models (patient-access-brands/ is tygo-generated — don't edit)
├── pages           # auth, dashboard, medical-sources, resource-detail, source-detail …
├── services        # fasten-api.service.ts (backend client), auth, event-bus (SSE)
└── widgets         # dashboard widget components
```

**Backend** (`backend/`)

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

> **Generated code:** `fhir_*.go` and `frontend/.../models/patient-access-brands/*.ts` are generated. Re-run `make generate-backend` when their inputs (`search-parameters.json`, tygo-exported Go structs) change, and commit the result. Details in [CLAUDE.md](CLAUDE.md).

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

The default encryption key and admin credentials can be overridden via `FASTEN_ISSUER_JWT_KEY`.

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
