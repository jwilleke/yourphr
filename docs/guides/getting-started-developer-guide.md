---
name: Getting started developer guide
description: From a fresh clone to a running server and app — prerequisites, the .env, the dev servers, the CLI and where the code lives
dateModified: 2026-11-23
category: guides
relatedModules: [main, start, bootstrap-env, UsersManager]
---

# Getting started developer guide

From a fresh clone to a running yourPHR, and a map of where the code lives. The day-to-day details of the two dev servers (ports, LAN access, local-only build failures) are in [devserver.md](../development/devserver.md); this page does not repeat them.

## Standing rules

- Node 24 or later (`"engines": { "node": ">=24" }` in `package.json`). The root uses __npm__ (`package-lock.json`); `frontend/` still uses Yarn Classic (`"packageManager": "yarn@1.22.22"`). Do not add Yarn scripts or `resolutions` entries; the reason is in [AGENTS.md § Frontend architecture](../../AGENTS.md#frontend-architecture-frontendsrcapp).
- No patient data and no secrets in git, ever: not the databases, not a real export, not a `.env`. The rules are in [AGENTS.md § NEVER commit personal health data or unencrypted secrets](../../AGENTS.md#never-commit-personal-health-data-or-unencrypted-secrets). Commit synthetic fixtures only.
- Settings are not flags. Bootstrap values and secrets come from the environment or a `.env`; everything else is Admin → Configuration. `start` refuses any flag. See [configuration-developer-guide.md](configuration-developer-guide.md).

## First run

```bash
npm ci                       # server dependencies (root)
cp .env.dev.example .env     # dev bootstrap: port 9090, data under ./db, no C-CDA converter
make serve-server            # npx tsx src/main.ts
make serve-frontend          # in a second terminal: ng serve on :4200, proxies /api to the server
```

Open <http://localhost:4200>. `make serve-frontend` runs `dep-frontend` first, which installs `frontend/` with Yarn.

On first start the server:

- creates the data directory if it can (`YOURPHR_FAST_STORAGE`, else the older `YOURPHR_STORAGE_DATA_DIR`, else `./data`) and refuses to start if it is not writable (`src/cli/start.ts`);
- loads `.env` files before any other module runs (`src/bootstrap-env.ts`, the first import in `src/main.ts`): the ambient environment wins, then `<YOURPHR_FAST_STORAGE>/.env`, then `./.env`;
- generates `YOURPHR_SESSION_SECRET` and `YOURPHR_CREDENTIALS_KEY` into `<data>/.env` when nothing supplies them (`src/config/instance-env-backfill.ts`); the repository-root `.env` is never written;
- creates the `admin` account whenever no account is named `admin`, and writes its random password to `<data>/.admin_bootstrap_password` (mode 0600). The log names the file, never the password. The file is deleted after that account's first sign-in (`UsersManager.bootstrapAdmin`).

## The CLI

`src/main.ts` is one binary with subcommands; each is a dynamic import of `src/cli/<name>.ts`. An unknown word exits 2 with the usage and never starts a server.

| Command | What it does |
| --- | --- |
| `start` (default) | Run the server. Takes no flags. |
| `migrate` | Import a Go v1/v2 instance and verify it record for record (`make migrate ARGS="…"`). |
| `reset-password` | Set a fresh password on an account when nobody can sign in. |
| `compact` | Remove identical history copies and reclaim space (server stopped). |
| `reindex` | Rebuild the search index from stored records (server stopped). |
| `version`, `help` | Print the version, or the usage. |

Run a command with no flags for its own usage.

## Where the code lives

| Path | What is there |
| --- | --- |
| `src/main.ts`, `src/cli/` | Entry point and subcommands |
| `src/app.ts` | Composition root: `openStores()` and `assembleApp()` build the engine, the managers and their providers |
| `src/server.ts` | The HTTP layer: every route, the session cookie, the request guards. See [api-developer-guide.md](api-developer-guide.md) |
| `src/framework/` | Platform code with no PHR knowledge: `Engine`, `BaseManager`, `ApiContext`, `ConfigurationManager`, `managers/`, `providers/`, `filters/` |
| `src/app/` | The PHR: `managers/` (records, sources, catalog, health, glossary, lookups, demo), `providers/`, `health/` |
| `src/medication/`, `src/conditions/`, `src/allergies/`, `src/immunizations/`, `src/classify/`, `src/provenance/`, `src/ips/` | Pure derivations over raw FHIR that the record pages read. See [fhir-records-developer-guide.md](fhir-records-developer-guide.md) |
| `src/upload/`, `src/sync/`, `src/sources/`, `src/patient-entry/` | How records arrive |
| `src/http/` | The only code that may reach the network (SSRF guard, SMTP, rate limiter) |
| `src/log/` | The logger, its ring buffer and secret redaction |
| `src/migrate/` | One-way import from the Go stack |
| `src/SqliteFhirRepository.ts` | The generic FHIR store behind `SqliteRecordsProvider` |
| `config/app-default-config.json` | Every configuration key and its shipped default |
| `scripts/` | Integration harnesses (`npm run <name>`), boundary checks, release tooling |
| `e2e/` | Playwright journeys |
| `frontend/` | The Angular 22 app |
| `relay/` | The Go SMART OAuth relay (its own module, `github.com/jwilleke/yourphr/relay`) |

## How you know you are done

- `make serve-server` logs the boot order (`engine: configuration -> …`) and `yourphr <version> listening on <host>:<port>`, and `curl -s http://localhost:9090/api/version` answers `{"success":true,"data":{"version":…,"environment_name":…}}`.
- You can sign in as `admin` with the password from `<data>/.admin_bootstrap_password`.

## See also

- [devserver.md](../development/devserver.md): ports, LAN access, troubleshooting
- [deployment/README.md](../deployment/README.md): installing an instance for real
- [testing-developer-guide.md](testing-developer-guide.md): what to run before you push

## Known gaps

- `.env.dev.example` sets `YOURPHR_DATABASE_ENCRYPTION_ENABLED=false` and `YOURPHR_BACKUP_LABEL=dev`. Neither is a configuration key or a variable the server reads, so both have no effect. At-rest encryption is off when `yourphr.database.encryption.key` is empty, which is the shipped default.
- `.env.dev.example` sets the app database to `./db/fasten.db` through `YOURPHR_DATABASE_LOCATION`; the shipped default is `${YOURPHR_FAST_STORAGE}/spike.db`. Both names are owed a rename by [#676](https://github.com/jwilleke/yourphr/issues/676).
- `npm run hooks` and `prepare` set `core.hooksPath` to `.githooks`, but no `.githooks/` directory is committed, so no pre-commit hook runs. `scripts/check-no-phi.sh` (written to run as a pre-commit hook) runs only in CI (`phi-guard.yaml`) unless you run it yourself.
- [CONTRIBUTING.md](../../CONTRIBUTING.md) still describes the Go backend (`backend/`, Go 1.24, `tygo`, `make generate-backend`, JWT); none of that exists on `main`. Use this guide and [AGENTS.md](../../AGENTS.md) instead.
