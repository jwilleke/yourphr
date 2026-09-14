<!-- KIT:START v1.13.0-3-g9e83986 — managed by mjs-project-template; edit below the KIT:END marker -->
## Agent Kit Protocols

This section is __managed by the kit__ (`install-kit.sh`) — it is identical across repos. Put repo-specific context __below the `KIT:END` marker__; do not edit here.

The heading above names the kit on purpose. It used to read `Agent Context & Protocols`, which is the
same wording a repo naturally picks for its own agent section below `KIT:END` — two identical `##`
headings in one file, and `markdownlint` MD024 fails on it. The kit owns one heading string in every
repo that installs it, so that string says whose it is.

### Don't Repeat Yourself

Two halves of one rule. Both fire before you write anything.

- __Knowledge: one representation.__ Every fact — a rule, a decision, a version, a list — has exactly one authoritative home. Point at it; never restate it. A second copy is not redundancy, it is a future contradiction: the copies drift, and nothing tells you which one is current. Before writing a fact down, find where it already lives. If it lives in two places already, that is a defect worth fixing, not a pattern to follow.
- __Work: check it is not already done.__ Before starting, read the `▶ Resume here` block in `TODO.md`, recent `git log`, and the related GitHub issue. Repeating finished work is the most common avoidable mistake.

The long form is the operator's __Do NOT Repeat Yourself (DRY)__ page. It lives on a private wiki, so it is named here, not linked. It is not copied here on purpose — copying it would be the very defect this protocol names. The kit owns this paragraph; the page owns the rest.

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

## TypeScript stack: DEFAULT TO ngdpbase

__Before any work on the TypeScript stack, read [`architecture-principles-typescript.md`](https://github.com/jwilleke/ngdpbase/blob/master/docs/planning/architecture-principles-typescript.md).__ It lives in __ngdpbase__, not here — it is the baseline `src/framework/` is extracted from, so it sits beside the code it describes rather than in one consumer. It is the guiding document, and its first section is the rule that matters most:

- __Default to `/Volumes/hd2A/workspaces/github/ngdpbase`__ — the code, not its docs. It is checked out locally. When this stack needs a mechanism ngdpbase already has, take ngdpbase's shape as it is built, even where something else looks tidier.
- __Improvements are FILED, not built in flight.__ A better idea found mid-implementation becomes an issue against the adopted shape, never a structure invented on the spot.
- __A divergence is legitimate only if that document names it.__ The test before writing code: *does the document name this divergence, or am I about to create one?*
- __Nothing says "spike".__ That word was scaffolding for the transition, never the product. This stack becomes YourPHR; the Go stack goes silent.

## Project Context

Repo-specific brief for agents. The kit-managed protocol is __above__ `KIT:END`; everything below is owned by this repo and is the single source of truth for product context (formerly `CLAUDE.md`). Claude Code loads [`CLAUDE.md`](CLAUDE.md), which is a short pointer here.

### What this is

__Mission: Your medical records, immediately and in your hands — for free.__ (Fulfilling the 21st Century Cures Act, 2016. See [issue #15](https://github.com/jwilleke/yourphr/issues/15) / `private/goals.md`.) Prioritize work that advances immediate, complete patient access to records.

__YourPHR__ is a self-hosted personal/family electronic medical record viewer — a community continuation of Fasten OnPrem. It imports FHIR R4 bundles (manual upload or provider SMART sync) and displays them. A __TypeScript backend__ (`src/`, Node 24, SQLite via better-sqlite3-multiple-ciphers) serves a JSON API and the compiled __Angular 22 frontend__, both built from this repository into one image.

__The Go stack is gone.__ It served the product to v2.10.3 and was deleted on 2026-08-27 ([#677](https://github.com/jwilleke/yourphr/issues/677)) once both instances ran TypeScript. Its history is preserved by the `v1.0.0`…`v2.10.3` tags and the frozen image `ghcr.io/jwilleke/yourphr-go:2.10.3`. The ONLY Go left in the tree is `relay/` — a pure-stdlib SMART store-and-poll OAuth relay with no dependencies, kept because it is deployed and has no TypeScript replacement. Documents under `docs/planning/` and `docs/vendors/` that describe Go internals are history; read them as such.

__YourPHR is a standalone, community-maintained continuation__ of `fastenhealth/fasten-onprem` (original by Jason Kulatunga / @AnalogJ and Alex Szilagyi, GPL v3 — attribution retained). It carries the project forward as a fully open-source build after upstream's hosted sync relay (Lighthouse) moved into the commercial Fasten Connect product (breaking OSS provider sync), and is going standalone (see [EPIC #2](https://github.com/jwilleke/yourphr/issues/2)). Near-term focus: improve display compatibility with __non-US-Core FHIR R4 exports__, specifically Veradigm/FollowMyHealth patient portal data. See [`docs/Roadmap.md`](docs/Roadmap.md) and [`README.md`](README.md). When fixing display issues, prefer fallbacks for missing US-Core fields (e.g. `class.code` when `type[]` is absent) rather than assuming strict US-Core conformance.

__Note on identifiers:__ The word __fasten__ is being removed from everything the project ships ([EPIC #676](https://github.com/jwilleke/yourphr/issues/676)); the Go module path that made renaming "pure churn" went with the Go stack, and `relay/` now has a module path of its own. Three occurrences stay on purpose and should not be re-litigated:

- the __GPL attribution__ to Fasten OnPrem in `README.md` — a licence obligation
- __`platform_type = 'fasten'`__, a value stored in Go databases the migration reads; `src/migrate/` must keep naming it to read people's data correctly
- upstream identifiers still inside the __Angular frontend__ (`FastenApiService`, `FastenDisplayModel`), which are the remaining bulk and are [#676](https://github.com/jwilleke/yourphr/issues/676)'s next lever

Everything else — the session cookie, paths, filenames, templates — is fair game.

__No runtime dependency on Fasten-operated services. This is a rule, not a preference.__ Nothing YourPHR ships may call a host Fasten runs. The identifier note above is about NAMES; this is about where a patient's browser and this server send requests, which is a different and more serious thing. A self-hosted personal health record whose provider-connection path traverses a third party's infrastructure is not self-hosted in the sense the mission claims, and it is not something the patient is told about on the screen where they connect.

It is also incoherent with the reason this project exists: the paragraph above says YourPHR went standalone BECAUSE upstream's Lighthouse relay moved into the commercial Fasten Connect product. Continuing to call that relay is depending on the thing we forked away from, and it is a liveness risk in every self-hosted instance — if Fasten retires or gates the endpoint, that path breaks everywhere at once, and no operator can fix it without a rebuild.

Known and being removed ([#700](https://github.com/jwilleke/yourphr/issues/700)): `frontend/src/environments/environment*.ts` sets `connect_gateway_api_endpoint_base` to `https://lighthouse.fastenhealth.com/...` in EVERY configuration including `environment.prod.ts`, and `connect-gateway.service.ts` calls `/search`, `/catalog`, `/connect/{id}`, `/redirect/{state}` and `/token/{endpoint_id}` there. It is live, not dead code — `medical-sources.component.ts` and `explore.component.ts` both inject the service — and the strings are verifiably in the shipped bundle on the live demo. The replacement is ours and already exists: `CatalogManager`, `SmartSourceClientProvider`, and `relay/`.

When touching provider connection, source authorisation, or the catalog: route through OUR catalog and OUR relay. If a change would add or preserve a call to a Fasten-operated host, stop and raise it rather than carrying it forward because it was already there.

| | |
|---|---|
| Live SMART sync | Generic SMART client + store-and-poll relay + provider catalog — map: [`docs/SMART-flow-map.md`](docs/SMART-flow-map.md) |
| Import without SMART | Manual FHIR R4 JSON + C-CDA/XML (converter sidecar) |
| Deploy | Release-gated images on `vX.Y.Z` only — [`docs/deployment/deployment-contract.md`](docs/deployment/deployment-contract.md) |

### NEVER commit personal health data or unencrypted secrets

This is a __Personal Health Record__ application. Patient data (PHI) and secrets must never enter git history — a leak here is irreversible and a privacy breach. Treat this as a hard rule that overrides convenience.

__Never commit:__

- __The runtime database.__ SQLite files contain all imported PHR. `docker-compose` writes the DB to `./db/`, and the dev config may put `fasten.db` elsewhere. All of `*.db`, `*.db-shm`, `*.db-wal`, `*.sqlite*`, and `/db/` are gitignored — keep it that way.
- __Real FHIR bundles.__ Only ever commit *synthetic* fixtures (Synthea-generated) under `frontend/src/lib/fixtures/` and the harnesses' own `scripts/` fixtures. Never add a real patient export. Drop ad-hoc real bundles in a gitignored dir (`/sample-data/`, `/phi/`, `/patient-data/`).
- __Secrets / keys.__ No real `jwt.issuer.key`, encryption keys, OAuth client secrets, access/refresh tokens, `.env`, `*.pem` / `*.key` / `*.p12` / `*.pfx`. Real config goes in `.env` (gitignored) or environment variables — never in a committed file. The `.env.*.example` templates are committed: placeholders only.
- __Certs.__ `certs/` is gitignored (the app generates its own CA at runtime).

__Note on YAML configuration:__ there is no `config.yaml` and no `--config` flag ([#470](https://github.com/jwilleke/yourphr/issues/470), [#474](https://github.com/jwilleke/yourphr/issues/474)). For local development `cp .env.dev.example .env`. The layering is described under __Configuration__ below.

__Before any commit or push:__ run `git status` / `git diff --staged` and confirm no DB, `.env`, key, or real-patient file is staged. Never use `git add -A` / `git add .` blindly — add specific files. If something sensitive was already committed, treat it as compromised: rotate the secret and scrub history (`git filter-repo` / BFG), don't just delete it in a new commit.

### Commands

`Makefile` targets wrap the common ones; the TypeScript suites are npm scripts and are run directly.

```bash
make test              # server (vitest) + frontend (Angular)
make test-frontend     # cd frontend && npx ng test --watch=false  (ChromeHeadless)
make test-e2e          # builds the Angular app, boots the server over it, drives a browser
make serve-server      # npx tsx src/main.ts        (reads <YOURPHR_FAST_STORAGE>/.env, then ./.env)
make serve-frontend    # cd frontend && ng serve --hmr --live-reload -c dev  (proxies to the server)
make migrate           # import a Go v2 instance:  make migrate ARGS="--go … --data …"
make test-relay        # the one Go thing left
make serve-storybook   # component dev/test in isolation
```

__The server's own suites are npm scripts__, and CI runs them one job per script — see
`.github/workflows/server-ci.yaml` for the authoritative list.

```bash
npm test               # vitest: unit tests, src/**/__tests__/**
npm run <harness>      # integration harnesses in scripts/: app, auth, config, records, sync,
                       # migrate:tool, process, ssrf, backup, worker, web, demo-reset, …
npm run typecheck      # tsconfig.json  — spans src, scripts, e2e
npm run build          # tsconfig.build.json — src only, tests excluded. NOT the same check.
npm run check:boundary # nothing outside src/http reaches the network
npm run check:store    # no database handle escapes a provider
```

__`typecheck` and `build` read different configs and disagree__ — that difference has turned a green
laptop into a red CI run. Before pushing, run the whole `server-ci` list, not a subset.

Run a single test:

```bash
npx vitest run src/app/providers/__tests__/record-text.test.ts
cd frontend && ng test --include='**/badge.component.spec.ts'
```

### Server architecture (`src/`)

Built on the ngdpbase model ([#608](https://github.com/jwilleke/yourphr/issues/608)) — read
[`architecture-principles-typescript.md`](https://github.com/jwilleke/ngdpbase/blob/master/docs/planning/architecture-principles-typescript.md)
(in ngdpbase) before changing any of it.

- __Entry point__: `src/main.ts` — a subcommand layer ([#654](https://github.com/jwilleke/yourphr/issues/654)) over `src/cli/`: `start` (the default), `migrate`, `reset-password`, `version`, `help`. An unknown command exits non-zero and never starts a server.
- __Composition root__: `src/app.ts` — `openStores()` and `assembleApp()` build the engine, its managers in dependency order, and the providers configuration selects.
- __Web layer__: `src/server.ts` — routes, the session cookie, the access-log hook, and the demo read-only guard.
- __The manager rule__: a resource has exactly one door. Managers live in `src/framework/managers/` (configuration, users, sessions, audit, backups, jobs, settings, database) and `src/app/managers/` (records, sources, catalog, glossary, demo). Providers behind them are chosen by configuration and are the only code that touches a store. `npm run check:store` fails CI if that is breached.
- __Request context__: `src/framework/ApiContext.ts` — who is asking, on every manager call.
- __Records__: `src/app/providers/SqliteRecordsProvider.ts` over `records.db`; the app database is `spike.db` (a name [#676](https://github.com/jwilleke/yourphr/issues/676) still owes you).
- __Migration from Go__: `src/migrate/` — one-way, idempotent, and its exit criterion is a record-for-record verification rather than a successful import.
- __Logging__: `src/log/` — one logger, a ring buffer the Logs page reads, and secret redaction driven by `yourphr.config.secret-keys` ([#638](https://github.com/jwilleke/yourphr/issues/638)).

There is __no code generation__. The Go generators (`go generate`, `tygo`) went with the Go stack;
`frontend/src/app/models/patient-access-brands/` was tygo output and is now ordinary source.

#### Configuration

Three layers, one vocabulary: environment > `<data>/config/app-custom-config.json` > shipped
defaults in `config/app-default-config.json`. `ConfigurationManager` is the only reader. There is no
`config.yaml` and no `--config` flag ([#470](https://github.com/jwilleke/yourphr/issues/470),
[#474](https://github.com/jwilleke/yourphr/issues/474)). Bootstrap and secrets come from
`<YOURPHR_FAST_STORAGE>/.env` or the ambient environment; everything else is Admin → Configuration.
See [`docs/configuration-system.md`](docs/configuration-system.md).

`yourphr.config.env-keys` names the handful of keys the environment OWNS — read-only on the settings
screen whether or not the variable is set. Every other key still honours its `YOURPHR_*` variable
when one is present; declaring a key in that list does not add the variable, it removes the screen.

#### SMART on FHIR

The SMART client is a provider behind `SourcesManager`, selected by `yourphr.sources.client.provider`
with an inert `null` alternative. The OAuth relay (`relay/`, deployed as
`ghcr.io/jwilleke/yourphr-relay`) is store-and-poll for the auth code — the server does the token
exchange and the relay never sees tokens.

__Live relay-based sync is not a v3 capability yet__, and the stack says so rather than pretending: `GET /api/secure/source/relay-config` reports that none is configured. The gap to a proven production provider is [#408](https://github.com/jwilleke/yourphr/issues/408); Veradigm/FollowMyHealth ([#53](https://github.com/jwilleke/yourphr/issues/53)) is blocked on vendor approval. Manual FHIR bundle upload is the zero-setup import path ([#736](https://github.com/jwilleke/yourphr/issues/736) restored it after v3.4.0); C-CDA adds one step, running the converter service and setting its address ([#735](https://github.com/jwilleke/yourphr/issues/735), [`docs/import/c-cda.md`](docs/import/c-cda.md)).

### Frontend architecture (`frontend/src/app/`)

Standard Angular 22 module layout (upgraded 14→20 via foundation epic [#12](https://github.com/jwilleke/yourphr/issues/12), then 20→22 in [#701](https://github.com/jwilleke/yourphr/pull/701)):

- `services/` — `fasten-api.service.ts` is the main backend API client; `auth.service.ts` + `auth-interceptor.service.ts` handle JWT; `event-bus.service.ts` for SSE/streaming.
- `pages/`, `components/`, `widgets/` — UI; `models/` — typed view models (the `patient-access-brands/` subdir is tygo-generated, don't edit).
- Backend `/api/secure/events/stream` is a Server-Sent Events endpoint (used for sync/job progress).

__Yarn Classic is on its way out — do not extend it ([#699](https://github.com/jwilleke/yourphr/issues/699)).__ `frontend/` is the only part of this repository not on npm, and nobody here chose that: the lockfile arrived with the Angular app from fasten-onprem in 2022 (`fa09bfaf`), and `packageManager: yarn@1.22.22` was pinned later only to stop Node/Yarn version drift during the Angular 14→20 upgrade (`2fbd59bb`, closing [#13](https://github.com/jwilleke/yourphr/issues/13)) — freezing the status quo, not endorsing it. `1.22.22` is the FINAL Yarn Classic release; the line is finished and takes no fixes.

Four defects it has already cost us:

- __`yarn audit` exits a severity BITMASK__ (1 info, 2 low, 4 moderate, 8 high, 16 critical), not pass/fail, and `--level` does not filter — it still reports and still counts. That is the whole reason for the 37-line audit-gate workaround in `development.yaml`.
- __`yarn upgrade <pkg>` silently does nothing for a transitive dependency__ and prints `success`. It only re-resolves DIRECT dependencies. Do not read its success as "already fixed" — [#590](https://github.com/jwilleke/yourphr/issues/590) was nearly closed on that misreading.
- __It rewrites the lockfile behind you__: yarn 1.22.22 turns `elliptic "git+https://…git"` back into `"https://…"`, undoing what Dependabot writes. Expect that hunk on unrelated installs and do not commit it.
- __Its lax peer resolution hides real defects.__ `@angular/common` and `@angular/forms`, both declared `^20.3.29`, once resolved to DIFFERENT patches — yarn installs that happily, npm refuses it. That instance is closed: every `@angular/*` package is now pinned exactly (`22.1.4`) through `resolutions`, so the skew is gone from the tree. The mechanism is not, and yarn will hide the next one the same way — note that the pins masking it are themselves a Yarn-only field npm ignores.

Plus the cost of two package managers: `npm audit` reads clean while the frontend carries 39 advisories, which is exactly how [#530](https://github.com/jwilleke/yourphr/issues/530) hid a vulnerable `elliptic` in the shipped bundle for months.

So: do not add yarn scripts, yarn-only syntax, or new `resolutions` entries. `resolutions` is a Yarn field npm ignores entirely — a naive `npm install` silently drops all 37 of the pins there, most of which are security pins from [#416](https://github.com/jwilleke/yourphr/issues/416). Anything new that needs pinning should be written so it survives the move (npm `overrides`). Yarn Berry is not the destination either; the goal is ONE package manager for the repository, and that is npm.

### Deployment

- __Project site:__ `https://yourphr.org` — the public landing/docs site, served by __GitHub Pages__ from this repo's `gh-pages` branch (CNAME=yourphr.org). It is *not* the app.
- __Running instance:__ the app is deployed (internal/LAN, behind Authentik forward-auth) at __`yourphr.nerdsbythehour.com`__.
- __Delivery is RELEASE-GATED (GitOps via Flux).__ [`.github/workflows/release-image.yaml`](.github/workflows/release-image.yaml) builds + pushes __`ghcr.io/jwilleke/yourphr`__ (tags `:X.Y.Z`, `:X.Y`, `:latest`) __only on a `vX.Y.Z` release tag__, or when the GitHub Release is published — a second trigger added because a tag push once produced no run at all ([#658](https://github.com/jwilleke/yourphr/issues/658)). Pushes to `main` are CI-tested but build NO image and do NOT deploy. __Use this filename when checking that a release built__ (`gh run list --workflow=release-image.yaml`): the old name `docker-jwilleke.yaml` no longer exists, and asking for it returns an empty list that is indistinguishable from the [#658](https://github.com/jwilleke/yourphr/issues/658) symptom. Flux (repo `jwilleke/mj-infra-flux`, `apps/production/image-automation/yourphr-policy.yaml`) has a __semver `ImagePolicy`__ that deploys the highest released `:X.Y.Z`. So __to ship anything to the live instance you must cut a release__ (a `patch` release for hotfixes). The k8s app dir is `apps/production/yourphr` and the __namespace is `yourphr`__. The serving Deployment is `yourphr-ts`, whose database is on the `local-path` PVC `yourphr-ts-data` mounted at `/opt/yourphr/data`; the frozen Go Deployment beside it still holds `yourphr-data` at `/opt/fasten/db` as the rollback, which is why both PVCs exist.
- The full contract is in [`docs/deployment/deployment-contract.md`](docs/deployment/deployment-contract.md); cutting a release is in [`docs/releasing.md`](docs/releasing.md).
- The image name follows `${{ github.repository }}`, so it tracks the repo name automatically.

### Conventions

- When changing a Go struct that tygo exports, or `search-parameters.json`, re-run `make generate-backend` and commit the regenerated files — never hand-edit `fhir_*.go` or the generated TS models.
- Backend tests use real FHIR JSON fixtures in `testdata/` directories; mirror that pattern (add a fixture + an `ExtractSearchParameters` test) when adding resource handling.
- Prefer display __fallbacks__ for non-US-Core FHIR (e.g. missing `type[]`) over assuming US-Core-only shape.

## Status

- project_state: active
- blockers: none
