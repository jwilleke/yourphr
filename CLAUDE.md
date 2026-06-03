# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Fasten OnPrem is a self-hosted personal/family electronic medical record viewer. It imports FHIR R4 bundles (manual upload or, in the original project, provider sync) and displays them. A **Go backend** (Gin + GORM, SQLite) serves a JSON API and the compiled **Angular 14 frontend**.

**This is a personal fork** of `fastenhealth/fasten-onprem` (original by Jason Kulatunga / @AnalogJ, GPL v3). The fork's purpose: improve display compatibility with **non-US-Core FHIR R4 exports**, specifically Veradigm/FollowMyHealth patient portal data. See `docs/Roadmap.md` for the current focus and `README.md` for the fork notice. When fixing display issues, prefer fallbacks for missing US-Core fields (e.g. `class.code` when `type[]` is absent) rather than assuming strict US-Core conformance.

## Commands

All commands are driven through the `Makefile`. There is also a Nix flake (`direnv allow`) that provisions Go, Node, Angular CLI 14.1.3, yarn, and tygo.

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

Standard Angular 14 module layout:
- `services/` — `fasten-api.service.ts` is the main backend API client; `auth.service.ts` + `auth-interceptor.service.ts` handle JWT; `event-bus.service.ts` for SSE/streaming.
- `pages/`, `components/`, `widgets/` — UI; `models/` — typed view models (the `patient-access-brands/` subdir is tygo-generated, don't edit).
- Backend `/api/secure/events/stream` is a Server-Sent Events endpoint (used for sync/job progress).

## Conventions

- When changing a Go struct that tygo exports, or `search-parameters.json`, re-run `make generate-backend` and commit the regenerated files — never hand-edit `fhir_*.go` or the generated TS models.
- Backend tests use real FHIR JSON fixtures in `testdata/` directories; mirror that pattern (add a fixture + an `ExtractSearchParameters` test) when adding resource handling.
