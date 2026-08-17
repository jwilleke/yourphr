<!-- KIT:START v1.9.0-0-g22c939c — managed by mjs-project-template; edit below the KIT:END marker -->
## Agent Kit Protocols

This section is __managed by the kit__ (`install-kit.sh`) — it is identical across repos. Put repo-specific context __below the `KIT:END` marker__; do not edit here.

The heading above names the kit on purpose. It used to read `Agent Context & Protocols`, which is the
same wording a repo naturally picks for its own agent section below `KIT:END` — two identical `##`
headings in one file, and `markdownlint` MD024 fails on it. The kit owns one heading string in every
repo that installs it, so that string says whose it is.

### Session continuity

- Before starting, read the `▶ Resume here` block at the top of `TODO.md` (committed, so it syncs across machines) and recent `git log`. That is where the last session left off — repeating finished work is the most common avoidable mistake.
- Commit a chunk of work with `/session-commit`: commits code + `TODO.md`, appends a journal entry to `private/project_log.md` (the log is never committed).
- Run `/pstatus` often (after every `/session-commit`): it ranks open work and recommends the next step.
- End a session with `/wrap`: commits anything outstanding, refreshes the `▶ Resume here` pointer, and reports whether it is safe to shut down the editor.

### Priorities — GitHub labels are the source of truth

Priority labels are mutually exclusive and mean:

- `P0` — __Broken. Stop all work and fix it.__ (production down / blocked / security breach)
- `P1` — __Delivers value to the mission.__
- `P2` — __Nice to have.__
- `deferred` — consciously postponed; `needs-triage` — awaiting a priority decision.

Then:

- Security comes first. Scanner alerts (Dependabot / code-scanning / GitGuardian) become issues labeled `security` + a graded priority: critical/high → `P0`, medium → `P1`, low → `P2`.
- `TODO.md` = a `▶ Resume here` block (maintained by `/wrap`) on top, then priority bands that `/pstatus` regenerates from the labels. Do not hand-edit the bands.
- The two halves have one writer each and a deliberate handover: `/wrap` writes the resume pointer at session end, `/context` reads it at session open, and the first `/pstatus` of the session __removes__ it — by then you have already resumed, so it has served its purpose. A bands-only `TODO.md` mid-session is expected, not a loss.
- Kit files are overwritten wholesale on every sync — `.claude/commands/*.md`, `utility/sync-labels.sh`, `.markdownlint-cli2.jsonc`. Never add a rule to one of them: it is destroyed at the next sync (the installer now warns, but the rule still goes). A __generic__ rule belongs upstream in [mjs-project-template](https://github.com/jwilleke/mjs-project-template) so every repo gets it. A __repo-specific__ note about a command — a package manager the kit does not name, a scanner only this repo has — goes in `.claude/commands/<command>.local.md`, which the kit never writes, reads, or deletes. Read that file, if present, as part of the command; commit it, so it travels with the repo.
- `TODO.md` holds __no history__ — only what is open right now. Never add "merged since last run", closed/merged counts, a session narrative, a dated changelog, or work from other repos. A closed item just stops appearing; that disappearance is the whole record. Session history goes in `private/project_log.md` via `/session-commit` and `/wrap`, and nowhere else.

### Working agreement

- Think before coding: state assumptions, surface trade-offs, ask when scope is ambiguous.
- Simplicity first: the minimum that solves the problem; nothing speculative.
- Use Conventional Commits for messages.
- Issue decomposition — NEVER put "Steps", "Phases", or numbered sequences inside a single GitHub issue. Break each step into its own issue and link them using GitHub relationships: `closes #N` / `fixes #N` (resolves another), `blocked by #N` (dependency), `relates to #N` (context link). Example: a 3-phase migration = 3 issues with "blocked by" chains, not one issue with Phase headings.
- Issue/PR links — Never use a bare `#N` reference alone. Always pair it with the full GitHub URL: `[#333](https://github.com/owner/repo/issues/333)`. This applies in commit messages, PR descriptions, comments, and any agent output. Use `/issues/N` for issues and `/pull/N` for PRs.
- Awaiting approval — When work is complete but requires human sign-off before closing, apply the `in-review` label and leave a comment on the issue/PR that states: what was done, what the human needs to verify, and what action closes it. Never self-close an issue or PR.
- Closing issues — __Always remove the `in-review` label when closing__ an issue or PR (`gh issue edit N --remove-label in-review` before or with the close). Closed items must not keep `in-review`, or the label stops meaning "awaiting a decision" and the queue it drives can no longer be trusted.
- Commits — always use the `/session-commit` skill. Never run a bare `git commit` directly. `/session-commit` enforces the session log update, conventional commit format, and co-author trailer.
- Direct commits by default — commit to the default branch; do not open a pull request unless someone other than you will actually look at it before it lands. On a single-maintainer repo a self-opened, self-merged PR reviews nothing: it just splits one explanation across a commit message and a near-identical PR body. Put the reasoning in the commit message. A change touching a "risky" path, closing an issue, or feeling significant is __not__ a reason to open one — CI runs on `push` as well as `pull_request`, so a direct commit is still tested. Where a PR does exist, its body points at the commit message rather than restating it.

### Markdown conventions

__Read `.markdownlint-cli2.jsonc` before writing markdown.__ It is the control file — rules, globs
and ignores in one place, read by the editor, the CLI, CI and you, and identical in every repo the
kit installs into. Do not rely on a summary: this section deliberately does not restate the rules,
because a second copy drifts from the first the moment someone changes one.

Most markdown here is written by agents, so these are writing rules, not review rules — conform on
the first draft rather than relying on `--fix`. There is no exemption mechanism and none is wanted;
a disabled check is a check nobody revisits. Verify with `npm run lint:md`, or `npx markdownlint-cli2`
where there is no `package.json`.

Only committed files are linted: anything `.gitignore`d is generated or vendored, so its source is
linted instead.
<!-- KIT:END -->

## Project Context

Repo-specific brief for agents. The kit-managed protocol is __above__ `KIT:END`; everything below is owned by this repo and is the single source of truth for product context (formerly `CLAUDE.md`). Claude Code loads [`CLAUDE.md`](CLAUDE.md), which is a short pointer here.

### What this is

__Mission: Your medical records, immediately and in your hands — for free.__ (Fulfilling the 21st Century Cures Act, 2016. See [issue #15](https://github.com/jwilleke/yourphr/issues/15) / `private/goals.md`.) Prioritize work that advances immediate, complete patient access to records.

__YourPHR__ is a self-hosted personal/family electronic medical record viewer — a community continuation of Fasten OnPrem. It imports FHIR R4 bundles (manual upload or provider SMART sync) and displays them. A __Go backend__ (Gin + GORM, SQLite) serves a JSON API and the compiled __Angular 20 frontend__.

__YourPHR is a standalone, community-maintained continuation__ of `fastenhealth/fasten-onprem` (original by Jason Kulatunga / @AnalogJ and Alex Szilagyi, GPL v3 — attribution retained). It carries the project forward as a fully open-source build after upstream's hosted sync relay (Lighthouse) moved into the commercial Fasten Connect product (breaking OSS provider sync), and is going standalone (see [EPIC #2](https://github.com/jwilleke/yourphr/issues/2)). Near-term focus: improve display compatibility with __non-US-Core FHIR R4 exports__, specifically Veradigm/FollowMyHealth patient portal data. See [`docs/Roadmap.md`](docs/Roadmap.md) and [`README.md`](README.md). When fixing display issues, prefer fallbacks for missing US-Core fields (e.g. `class.code` when `type[]` is absent) rather than assuming strict US-Core conformance.

__Note on identifiers:__ The product is being rebranded to __YourPHR__, but the Go __module path stays `github.com/fastenhealth/fasten-onprem`__ (internal identifier; renaming it is pure churn — see [EPIC #2](https://github.com/jwilleke/yourphr/issues/2)). Likewise, do not rename technical identifiers tied to upstream (`fasten-sources`, `FastenLighthouseEnvSandbox`, `FastenDisplayModel`). Only user-facing product strings become "YourPHR".

| | |
|---|---|
| Live SMART sync | Generic SMART client + store-and-poll relay + provider catalog — map: [`docs/SMART-flow-map.md`](docs/SMART-flow-map.md) |
| Import without SMART | Manual FHIR R4 JSON + C-CDA/XML (converter sidecar) |
| Deploy | Release-gated images on `vX.Y.Z` only — [`docs/deployment/deployment-contract.md`](docs/deployment/deployment-contract.md) |

### NEVER commit personal health data or unencrypted secrets

This is a __Personal Health Record__ application. Patient data (PHI) and secrets must never enter git history — a leak here is irreversible and a privacy breach. Treat this as a hard rule that overrides convenience.

__Never commit:__

- __The runtime database.__ SQLite files contain all imported PHR. `docker-compose` writes the DB to `./db/`, and the dev config may put `fasten.db` elsewhere. All of `*.db`, `*.db-shm`, `*.db-wal`, `*.sqlite*`, and `/db/` are gitignored — keep it that way.
- __Real FHIR bundles.__ Only ever commit *synthetic* fixtures (Synthea-generated) under `frontend/src/lib/fixtures/` and `backend/pkg/database/testdata/`. Never add a real patient export. Drop ad-hoc real bundles in a gitignored dir (`/sample-data/`, `/phi/`, `/patient-data/`).
- __Secrets / keys.__ No real `jwt.issuer.key`, encryption keys, OAuth client secrets, access/refresh tokens, `.env`, `*.pem` / `*.key` / `*.p12` / `*.pfx`. Real config goes in `.env` (gitignored) or environment variables — never in a committed file. The `.env.*.example` templates are committed: placeholders only.
- __Certs.__ `certs/` is gitignored (the app generates its own CA at runtime).

__Note on YAML configuration:__ removed in [#470](https://github.com/jwilleke/yourphr/issues/470) and [#474](https://github.com/jwilleke/yourphr/issues/474) — there is no `config.yaml` and no `--config` flag. Defaults live in `backend/pkg/config/app-default-config.json`, bootstrap comes from `.env` plus `YOURPHR_*` env, and everything else is changed at Admin → Configuration (`<data>/config/app-custom-config.json`). For local development `cp .env.dev.example .env`. See [`docs/configuration-system.md`](docs/configuration-system.md).

__Before any commit or push:__ run `git status` / `git diff --staged` and confirm no DB, `.env`, key, or real-patient file is staged. Never use `git add -A` / `git add .` blindly — add specific files. If something sensitive was already committed, treat it as compromised: rotate the secret and scrub history (`git filter-repo` / BFG), don't just delete it in a new commit.

### Commands

All commands are driven through the `Makefile`. There is also a Nix flake (`direnv allow`) that provisions Go, Node, Angular CLI, yarn, and tygo. (The flake still pins the old Angular CLI 14.1.3 + Node 18 — stale vs the project's Angular 20 / Node 24; tracked in [#138](https://github.com/jwilleke/yourphr/issues/138). Day-to-day `make` / `npx ng` use the correct local toolchain from `node_modules` + `.nvmrc`.)

```bash
make test              # run both backend and frontend test suites
make test-backend      # go vet ./... && go test -v ./...  (slow on first run; vendors deps + generates)
make test-frontend     # cd frontend && npx ng test --watch=false  (ChromeHeadless)

make serve-backend     # go run backend/cmd/fasten/fasten.go start --debug   (reads ./.env)
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

`make serve-backend` expects a `.env` at the repo root (not committed; `cp .env.dev.example .env`). The frontend dev server runs in __sandbox mode__ by default (talks only to synthetic-data test servers); `prod` mode talks to real servers. Build configs are selected with `-c` (e.g. `make build-frontend-prod`, `build-frontend-desktop-prod`, `build-frontend-offline-sandbox`).

### Backend architecture (`backend/`)

- __Entry point__: `backend/cmd/fasten/fasten.go` — urfave/cli app with `start`, `migrate`, `version` subcommands.
- __Web layer__: `backend/pkg/web/server.go` defines all routes (Gin). Route groups: `/api` (public — auth, glossary, support, CORS proxy), `/api/secure` (behind `middleware.RequireAuth()` JWT), and `/api/unsafe`. Handlers live in `backend/pkg/web/handler/`.
- __Database layer__: `backend/pkg/database/interface.go` declares the `DatabaseRepository` interface — the central contract for all data access. Implemented by GORM (`gorm_*.go`, `sqlite_repository.go`). Postgres exists (`postgres_repository.go`) but is __broken/unsupported__ — SQLite is the only working backend. Construct via `factory.go`. SQLite uses an encrypted build (`sqlite-jdbc-crypt`); DB encryption is __off__ by default (`database.encryption.enabled`), and enabling it currently disables backup and restore ([#367](https://github.com/jwilleke/yourphr/issues/367)).
- __FHIR resource models__: `backend/pkg/models/database/fhir_*.go` — one struct per FHIR resource type (~70 types). __These are generated, do not edit by hand.__ Each has a `PopulateAndExtractSearchParameters` method that runs `searchParameterExtractor.js` via the __goja__ JS engine to evaluate FHIRPath expressions and flatten searchable fields into indexed SQLite columns.
- __Migrations__: `backend/pkg/database/migrations/<timestamp>/` — applied by `make migrate` / on startup.

#### Code generation (important)

Two generators must be re-run when their inputs change; generated files are committed.

- `make generate-backend` runs:
  - `go generate ./...` → regenerates `backend/pkg/models/database/fhir_*.go` from `search-parameters.json` using the __dave/jennifer__ code generator in `backend/pkg/models/database/generate.go` (build-tagged `exclude`; entry is `//go:generate go run generate.go`).
  - `tygo generate` → generates frontend TypeScript types into `frontend/src/app/models/patient-access-brands/` from Go structs (config in `tygo.yaml`).
- `make dep-backend` also runs `cd scripts && go generate ./...` (related-versions generation).

#### fasten-sources stub

The upstream `github.com/fastenhealth/fasten-sources` package was made private. This repo replaces it with a __local stub__ (`./fasten-sources-stub`, wired via a `replace` directive in `go.mod`). What the stub drops is the upstream __provider catalog__ — the big pre-registered provider list and the hosted __Lighthouse__ OAuth relay, which moved into the commercial Fasten Connect.

What it does __not__ drop: this fork has its own __working SMART-on-FHIR OAuth client__ — `fasten-sources-stub/clients/smart` (`.well-known/smart-configuration` discovery, PKCE, token exchange/refresh), a self-hosted OAuth __relay__ (`backend/pkg/relay`, default `relay.nerdsbythehour.com` — store-and-poll for the auth code; the backend does the token exchange, the relay never sees tokens), and the backend + connect-UI wiring (EPIC [#20](https://github.com/jwilleke/yourphr/issues/20): generic client [#49](https://github.com/jwilleke/yourphr/issues/49), relay [#50](https://github.com/jwilleke/yourphr/issues/50), backend OAuth [#51](https://github.com/jwilleke/yourphr/issues/51), connect UI [#52](https://github.com/jwilleke/yourphr/issues/52)). Live connect today is primarily the __provider catalog__ path; as-built map: [`docs/SMART-flow-map.md`](docs/SMART-flow-map.md). Manual FHIR bundle upload and C-CDA remain the zero-setup import path.

The real gap is a __proven first end-to-end production provider__: Veradigm/FollowMyHealth ([#53](https://github.com/jwilleke/yourphr/issues/53)) is blocked on vendor app approval (`unauthorized_client`); CMS Blue Button 2.0 and catalog production proof ([#408](https://github.com/jwilleke/yourphr/issues/408)) are the self-serve paths. (When citing the older "live sync is non-functional" framing, note it predates EPIC #20 and is stale.)

### Frontend architecture (`frontend/src/app/`)

Standard Angular 20 module layout (upgraded 14→20 via foundation epic [#12](https://github.com/jwilleke/yourphr/issues/12)):

- `services/` — `fasten-api.service.ts` is the main backend API client; `auth.service.ts` + `auth-interceptor.service.ts` handle JWT; `event-bus.service.ts` for SSE/streaming.
- `pages/`, `components/`, `widgets/` — UI; `models/` — typed view models (the `patient-access-brands/` subdir is tygo-generated, don't edit).
- Backend `/api/secure/events/stream` is a Server-Sent Events endpoint (used for sync/job progress).

### Deployment

- __Project site:__ `https://yourphr.org` — the public landing/docs site, served by __GitHub Pages__ from this repo's `gh-pages` branch (CNAME=yourphr.org). It is *not* the app.
- __Running instance:__ the app is deployed (internal/LAN, behind Authentik forward-auth) at __`yourphr.nerdsbythehour.com`__.
- __Delivery is RELEASE-GATED (GitOps via Flux).__ `.github/workflows/docker-jwilleke.yaml` builds + pushes __`ghcr.io/jwilleke/yourphr`__ (tags `:X.Y.Z`, `:X.Y`, `:latest`) __only on a `vX.Y.Z` release tag__ — pushes to `main` are CI-tested but build NO image and do NOT deploy. Flux (repo `jwilleke/mj-infra-flux`, `apps/production/image-automation/yourphr-policy.yaml`) has a __semver `ImagePolicy`__ that deploys the highest released `:X.Y.Z`. So __to ship anything to the live instance you must cut a release__ (a `patch` release for hotfixes). The k8s app dir is `apps/production/yourphr` and the __namespace is `yourphr`__ (the DB lives on a `local-path` PVC `yourphr-data` mounted at `/opt/fasten/db`, i.e. a node-local dir on the k3s node).
- The full contract is in [`docs/deployment/deployment-contract.md`](docs/deployment/deployment-contract.md); cutting a release is in [`docs/releasing.md`](docs/releasing.md).
- The image name follows `${{ github.repository }}`, so it tracks the repo name automatically.

### Conventions

- When changing a Go struct that tygo exports, or `search-parameters.json`, re-run `make generate-backend` and commit the regenerated files — never hand-edit `fhir_*.go` or the generated TS models.
- Backend tests use real FHIR JSON fixtures in `testdata/` directories; mirror that pattern (add a fixture + an `ExtractSearchParameters` test) when adding resource handling.
- Prefer display __fallbacks__ for non-US-Core FHIR (e.g. missing `type[]`) over assuming US-Core-only shape.

## Status

- project_state: active
- blockers: none
