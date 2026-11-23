---
name: Testing developer guide
description: What to run and what to write — Vitest unit tests beside the code, the integration harnesses in scripts/, the boundary checks, Playwright journeys, and the CI that runs them
dateModified: 2026-11-23
category: guides
relatedModules: [vitest.config.ts, scripts, e2e, server-ci.yaml]
---

# Testing developer guide

What to run before you push, and where a new test goes. Write the failing test first, then the code. The reasoning about test data (vendor slices, Synthea, the golden-test idea) is in [testing-and-data.md](../development/testing-and-data.md); vendor sandboxes are in [test-sandboxes.md](../development/test-sandboxes.md).

## Standing rules

- No real patient data in any test, fixture or snapshot. Synthetic only; see [AGENTS.md](../../AGENTS.md#never-commit-personal-health-data-or-unencrypted-secrets).
- Test credentials are generated at run time (for example `` `pw-${randomUUID()}` ``), never written as literals. GitGuardian skips test paths (`**/__tests__/**`, `e2e/**`, `**/*.spec.ts`, `scripts/*-tests.ts` in `.gitguardian.yaml`), so this rule is the only guard there.
- A regression test written with a fix is run once with the fix reverted and seen to fail.
- A security or audit door is tested by its refusal (401, 403, the refused write), not only by its success.
- Unit tests use in-memory fakes of a manager's provider interface; provider tests use a temp file. Never point a test at a live data directory.
- `npm run typecheck` (`tsconfig.json`: `src`, `scripts`, `e2e`) and `npm run build` (`tsconfig.build.json`: `src` only, tests excluded) read different configs and can disagree. Run both.

## The layers

| Layer | Where | Run |
| --- | --- | --- |
| Unit | `src/**/__tests__/**/*.test.ts`, `scripts/__tests__/**/*.test.ts` (Vitest, `vitest.config.ts`) | `npm test`; `npm run test:coverage`; `npm run test:changed`; one file: `npx vitest run <path>` |
| Integration harnesses | `scripts/*-tests.ts` and friends, each an `npm run <name>` (`auth`, `agent-tokens`, `health-intake`, `config`, `env`, `backup`, `mail`, `worker`, `migrations`, `ips`, `provenance`, `medication`, `records`, `dcr`, `app`, `migrate`, `web`, `migrate:tool`, `process`, `demo-reset`, `ssrf`, `smart`, `sync`, `scale`, `framework`, `mcp-tests`) | `npm run <name>` |
| Corpus harnesses | `scripts/make-synthetic-corpus.ts` writes a synthetic NDJSON corpus; `smoke.ts`, `diff-repositories.ts`, `write-tests.ts` read it | as in `.github/workflows/server-ci.yaml` |
| Static checks | `check:boundary`, `check:store`, `check:routes`, `check:categories`, `check:phi`, `lint:md` | `npm run <name>` |
| E2E | `e2e/*.spec.ts` (Playwright, Chromium), booted by `e2e/server.ts` over the built Angular app with a synthetic household and a fake FHIR provider in a fresh temp directory | `make test-e2e` (builds the app, then `npm run e2e`) |
| Frontend | `frontend/src/**/*.spec.ts` (Karma, ChromeHeadless) | `make test-frontend` |
| Relay | `relay/` (Go) | `make test-relay` |

Coverage floors (`vitest.config.ts`) apply to `src/framework/**` and `src/app/**`: 80% lines, functions and statements, 70% branches.

## What CI runs

`.github/workflows/server-ci.yaml`, on every push and pull request:

- `verify`: `npm ci`, `typecheck`, `build`, `check:boundary`, `check:store`, `check:routes`, `check:categories`, `framework`, `test:coverage`, the harnesses listed above, the corpus harnesses, and a demo baseline build.
- `e2e`: builds the Angular app, then `npm run e2e`.

Also: `phi-guard.yaml` (`scripts/check-no-phi.sh --all`), `development.yaml` (frontend tests, lint, Storybook, the frontend dependency audit, and markdownlint), `markdown-lint.yml`, `secret-scan.yml`.

## How to add a test

1. A manager or provider: a `__tests__/<Name>.test.ts` beside it, over a fake provider (managers) or a temp file (providers).
2. A rule that crosses the HTTP layer: the harness for that family in `scripts/`, which boots the real app over a temp directory.
3. A user journey: an `e2e/NN-<name>.spec.ts`. The journeys run serially and share the seeded household.
4. A new harness: add the `npm run` script and add it to `server-ci.yaml`'s `verify` job, or it will never run.

## How you know you are done

- `npm run typecheck`, `npm run build` and `npm test` pass, plus the harness and static checks for the area you changed. Before a push that touches the server, run the whole `verify` list.
- A docs-only change needs `npm run lint:md` only.

## See also

- [testing-and-data.md](../development/testing-and-data.md): test data sources and guardrails (but see Known gaps)
- [FHIR/fhir-testing.md](../FHIR/fhir-testing.md): testing the SMART connect flow
- [build-release-developer-guide.md](build-release-developer-guide.md): the release gate

## Known gaps

- Some harnesses are not in CI: `classify`, `http`, `isolation` (needs a database with two accounts), `roundtrip`, `shadow`, `load`, `export`, `live` and `live:smart` (need a real sandbox). They run only when someone runs them.
- No pre-commit hook is installed: `npm run hooks` points `core.hooksPath` at `.githooks/`, which is not committed.
- [AGENTS.md](../../AGENTS.md) says CI runs the server suites "one job per script"; they are steps of one `verify` job.
- [testing-and-data.md](../development/testing-and-data.md) points fixtures at `backend/pkg/database/testdata/`, which went with the Go stack.
