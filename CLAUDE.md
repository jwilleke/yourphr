# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Mission: Your medical records, immediately and in your hands — for free.** (Fulfilling the 21st Century Cures Act, 2016. See issue #15 / `private-jims/goals.md`.) Prioritize work that advances immediate, complete patient access to records.

**YourPHR** is a self-hosted personal/family electronic medical record viewer — a community continuation of Fasten OnPrem. It imports FHIR R4 bundles (manual upload or, in the original project, provider sync) and displays them. A **Go backend** (Gin + GORM, SQLite) serves a JSON API and the compiled **Angular 20 frontend**.

**YourPHR is a standalone, community-maintained continuation** of `fastenhealth/fasten-onprem` (original by Jason Kulatunga / @AnalogJ and Alex Szilagyi, GPL v3 — attribution retained). It carries the project forward as a fully open-source build after upstream's hosted sync relay (Lighthouse) moved into the commercial Fasten Connect product (breaking OSS provider sync), and is going standalone (see EPIC #2). Near-term focus: improve display compatibility with **non-US-Core FHIR R4 exports**, specifically Veradigm/FollowMyHealth patient portal data. See `docs/Roadmap.md` and `README.md`. When fixing display issues, prefer fallbacks for missing US-Core fields (e.g. `class.code` when `type[]` is absent) rather than assuming strict US-Core conformance.

> **Note on identifiers:** The product is being rebranded to **YourPHR**, but the Go **module path stays `github.com/fastenhealth/fasten-onprem`** (internal identifier; renaming it is pure churn — see EPIC #2). Likewise, do not rename technical identifiers tied to upstream (`fasten-sources`, `FastenLighthouseEnvSandbox`, `FastenDisplayModel`). Only user-facing product strings become "YourPHR".

## ⚠️ NEVER commit personal health data or unencrypted secrets

This is a **Personal Health Record** application. Patient data (PHI) and secrets must never enter git history — a leak here is irreversible and a privacy breach. Treat this as a hard rule that overrides convenience.

**Never commit:**

- **The runtime database.** SQLite files contain all imported PHR. `docker-compose` writes the DB to `./db/`, and the dev config may put `fasten.db` elsewhere. All of `*.db`, `*.db-shm`, `*.db-wal`, `*.sqlite*`, and `/db/` are gitignored — keep it that way.
- **Real FHIR bundles.** Only ever commit *synthetic* fixtures (Synthea-generated) under `frontend/src/lib/fixtures/` and `backend/pkg/database/testdata/`. Never add a real patient export. Drop ad-hoc real bundles in a gitignored dir (`/sample-data/`, `/phi/`, `/patient-data/`).
- **Secrets / keys.** No real `jwt.issuer.key`, encryption keys, OAuth client secrets, access/refresh tokens, `.env`, `*.pem/*.key/*.p12/*.pfx`. Real config goes in `config.dev.yaml` (gitignored) or environment variables — never in the committed `config.yaml`.
- **Certs.** `certs/` is gitignored (the app generates its own CA at runtime).

**Note on `config.yaml`:** the committed file ships the upstream *default* placeholder `jwt.issuer.key` (`"thisismysupersecure..."`). That is a known public default, not a real secret — it **must** be overridden in any real deployment (via `config.dev.yaml`/env). Never replace it with a real generated key in the committed file.

**Before any commit or push:** run `git status` / `git diff --staged` and confirm no DB, `.env`, key, or real-patient file is staged. Never use `git add -A`/`git add .` blindly — add specific files. If something sensitive was already committed, treat it as compromised: rotate the secret and scrub history (`git filter-repo` / BFG), don't just delete it in a new commit.

## Commands

All commands are driven through the `Makefile`. There is also a Nix flake (`direnv allow`) that provisions Go, Node, Angular CLI, yarn, and tygo. (The flake still pins the old Angular CLI 14.1.3 + Node 18 — stale vs the project's Angular 20 / Node 24; tracked in #138. Day-to-day `make`/`npx ng` use the correct local toolchain from `node_modules` + `.nvmrc`.)

```bash
make test              # run both backend and frontend test suites
make test-backend      # go vet ./... && go test -v ./...  (slow on first run; vendors deps + generates)
make test-frontend     # cd frontend && npx ng test --watch=false  (ChromeHeadless)

make serve-backend     # go run backend/cmd/fasten/fasten.go start --config ./config.dev.yaml --debug
make serve-frontend    # cd frontend && ng serve --hmr --live-reload -c dev  (proxies API to backend)
make migrate           # run DB migrations without starting the server

make serve-storybook   # component dev/test in isolation
make build-storybook   # verify all stories build (checked in CI)
```

Run a single test:

```bash
# Backend (Go) — from repo root
go test -v ./backend/pkg/models/database/ -run TestFhirAllergyIntolerance_ExtractSearchParameters

# Frontend (Angular) — from the frontend/ directory
ng test --include='**/badge.component.spec.ts'
```

`make serve-backend` expects a `config.dev.yaml` (not committed; copy/adapt from `config.yaml`). The frontend dev server runs in **sandbox mode** by default (talks only to synthetic-data test servers); `prod` mode talks to real servers. Build configs are selected with `-c` (e.g. `make build-frontend-prod`, `build-frontend-desktop-prod`, `build-frontend-offline-sandbox`).

## Backend architecture (`backend/`)

- **Entry point**: `backend/cmd/fasten/fasten.go` — urfave/cli app with `start`, `migrate`, `version` subcommands.
- **Web layer**: `backend/pkg/web/server.go` defines all routes (Gin). Route groups: `/api` (public — auth, glossary, support, CORS proxy), `/api/secure` (behind `middleware.RequireAuth()` JWT), and `/api/unsafe`. Handlers live in `backend/pkg/web/handler/`.
- **Database layer**: `backend/pkg/database/interface.go` declares the `DatabaseRepository` interface — the central contract for all data access. Implemented by GORM (`gorm_*.go`, `sqlite_repository.go`). Postgres exists (`postgres_repository.go`) but is **broken/unsupported** — SQLite is the only working backend. Construct via `factory.go`. SQLite uses an encrypted build (`sqlite-jdbc-crypt`); DB encryption is on by default (`config.yaml`).
- **FHIR resource models**: `backend/pkg/models/database/fhir_*.go` — one struct per FHIR resource type (~70 types). **These are generated, do not edit by hand.** Each has a `PopulateAndExtractSearchParameters` method that runs `searchParameterExtractor.js` via the **goja** JS engine to evaluate FHIRPath expressions and flatten searchable fields into indexed SQLite columns.
- **Migrations**: `backend/pkg/database/migrations/<timestamp>/` — applied by `make migrate` / on startup.

### Code generation (important)

Two generators must be re-run when their inputs change; generated files are committed.

- `make generate-backend` runs:
  - `go generate ./...` → regenerates `backend/pkg/models/database/fhir_*.go` from `search-parameters.json` using the **dave/jennifer** code generator in `backend/pkg/models/database/generate.go` (build-tagged `exclude`; entry is `//go:generate go run generate.go`).
  - `tygo generate` → generates frontend TypeScript types into `frontend/src/app/models/patient-access-brands/` from Go structs (config in `tygo.yaml`).
- `make dep-backend` also runs `cd scripts && go generate ./...` (related-versions generation).

### fasten-sources stub

The upstream `github.com/fastenhealth/fasten-sources` package was made private. This repo replaces it with a **local stub** (`./fasten-sources-stub`, wired via a `replace` directive in `go.mod`). The stub provides catalog/client interfaces but no real provider OAuth clients — so live provider sync is non-functional in this fork (manual FHIR bundle upload is the supported import path). Implementing a real SMART-on-FHIR client for Veradigm/FollowMyHealth is a roadmap item.

## Frontend architecture (`frontend/src/app/`)

Standard Angular 20 module layout (upgraded 14→20 via foundation epic #12):

- `services/` — `fasten-api.service.ts` is the main backend API client; `auth.service.ts` + `auth-interceptor.service.ts` handle JWT; `event-bus.service.ts` for SSE/streaming.
- `pages/`, `components/`, `widgets/` — UI; `models/` — typed view models (the `patient-access-brands/` subdir is tygo-generated, don't edit).
- Backend `/api/secure/events/stream` is a Server-Sent Events endpoint (used for sync/job progress).

## Deployment

- **Project site:** `https://yourphr.org` — the public landing/docs site, served by **GitHub Pages** from this repo's `gh-pages` branch (CNAME=yourphr.org). It is *not* the app.
- **Running instance:** the app is deployed (internal/LAN, behind Authentik forward-auth) at **`yourphr.nerdsbythehour.com`**.
- **Delivery:** GitOps via **Flux** in the separate repo `jwilleke/mj-infra-flux` (`apps/production/fasten/`). On push to `main`, `.github/workflows/docker-jwilleke.yaml` builds and pushes **`ghcr.io/jwilleke/yourphr`** (tags `:main` and `:main-<run_number>`); Flux image-automation picks the latest `main-<N>` tag and updates the deployment. The k8s app/namespace are still named `fasten`.
- The image name follows `${{ github.repository }}`, so it tracks the repo name automatically.

## Conventions

- When changing a Go struct that tygo exports, or `search-parameters.json`, re-run `make generate-backend` and commit the regenerated files — never hand-edit `fhir_*.go` or the generated TS models.
- Backend tests use real FHIR JSON fixtures in `testdata/` directories; mirror that pattern (add a fixture + an `ExtractSearchParameters` test) when adding resource handling.
