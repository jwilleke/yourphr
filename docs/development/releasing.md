# Releasing YourPHR

> The full published deploy contract (image tags, what integrators should key off) lives in
> [`docs/deployment/deployment-contract.md`](../deployment/deployment-contract.md). This page covers how a
> maintainer cuts a release.

Releases are cut with the __`/semver <patch|minor|major>`__ skill, which runs the steps below. There is still no release bot, release PR, token or admin override. (We removed release-please, inherited from upstream Fasten, because its bot-created release PR could not pass `main`'s required status checks without a privileged token; see issue #241.) The Go stack was released by hand; the TypeScript stack uses the tooling ported from ngdpbase.

## Versioning

Semver `MAJOR.MINOR.PATCH`, chosen by what changed since the last tag:

- __PATCH__ (`1.5.0 → 1.5.1`) — backward-compatible bug fixes only.
- __MINOR__ (`1.5.0 → 1.6.0`) — new backward-compatible features. Resets patch to 0.
- __MAJOR__ (`1.5.0 → 2.0.0`) — breaking changes. Resets minor + patch to 0. (Rare pre-2.0.)

Between releases the running build reports __git-describe__ (`vX.Y.Z-N-g<sha>`) — the last tag, commits since, and the short hash. That is expected; it is not "unreleased = broken."

The UI shows `<environment-name>-<version>`, e.g. `willeke-3.2.0`. The name is the instance's own (`yourphr.web.environment-name`, or `YOURPHR_WEB_ENVIRONMENT_NAME` in `<data>/.env`), not something compiled into a build — one image serves every instance ([#673](https://github.com/jwilleke/yourphr/issues/673)).

## Cutting a release

From a clean `main` with everything pushed and CI green, `/semver <level>` does this:

1. __Test first.__ `npm run build`, `npm run typecheck`, `npm test`, then `make test-e2e` (it builds the Angular app and runs the whole Playwright suite). Nothing is bumped until these pass, so a failure leaves nothing to roll back.
2. __Bump.__ `npm run bump -- <patch|minor|major>` (`scripts/version.ts`, ported from ngdpbase) sets `package.json`, the two version fields in `package-lock.json`, and a `## [X.Y.Z](compare-link) (DATE)` heading in `CHANGELOG.md`. If an `## [Unreleased]` section exists it becomes the release. `package.json` is the __only__ version source: the running instance reads it beside its own compiled output and serves it on `/api/version`, which is what the footer shows. `npm run process` fails if `package.json` is behind the newest tag.
3. __Write the entry__ under the new heading: Features / Bug Fixes / Internal, in words a patient can follow, as the existing entries are.
4. __Baseline.__ `npm run test:baseline:compare` (`scripts/baseline-profile.ts`, ported from ngdpbase) boots the app over the synthetic E2E household, records cold start, server memory and response times to `docs/performance/baseline-vX.Y.Z-DATE.md`, and appends a drift table against the previous baseline. It exits 1 on a regression candidate (memory +25%, or a route +50% __and__ +50 ms; override with `BASELINE_MEM_DELTA_PCT`, `BASELINE_RT_DELTA_PCT`, `BASELINE_RT_DELTA_MS`). Read the flag before proceeding; measurement noise is real.
5. __Commit, tag, push:__ `chore: release vX.Y.Z` with `package.json`, `package-lock.json`, `CHANGELOG.md` and the baseline file; then `git tag -a vX.Y.Z -m "vX.Y.Z"`, `git push origin main`, `git push origin vX.Y.Z`.
6. __GitHub Release:__ `gh release create vX.Y.Z --title "vX.Y.Z" --generate-notes --notes-start-tag v<previous>`.
7. __Confirm it deployed__ (next section): the release image built, and the live pod runs the new tag and answers.

## Deployment is release-gated

The live instance deploys __strictly off release tags__ — not off `main`:

- Pushing the `vX.Y.Z` tag triggers [`release-image.yaml`](../../.github/workflows/release-image.yaml), which builds + pushes `ghcr.io/jwilleke/yourphr:X.Y.Z` (+ `:X.Y`, `:latest`). Publishing the GitHub Release fires the same workflow again ([#658](https://github.com/jwilleke/yourphr/issues/658)) — a duplicate build is a far better failure than a missing one. __That is the name to use when confirming a release built__; `docker-jwilleke.yaml` is the old name and no longer exists, so `gh run list --workflow=docker-jwilleke.yaml` returns an empty list that looks exactly like the failure it is supposed to detect.
- The same tag triggers `docker-relay-release.yaml`, which publishes `ghcr.io/jwilleke/yourphr-relay:X.Y.Z` (+ `:X.Y`, `:latest`) — so both images are always available at the same version, even if the relay's sources did not change in that release ([#450](https://github.com/jwilleke/yourphr/issues/450)).
- Flux's `ImagePolicy` (in `jwilleke/mj-infra-flux`, `apps/production/image-automation/yourphr-policy.yaml`) filters __semver__ tags and bumps the deployment to the newest release. So the live instance updates __only when you cut a release__.
- Pushes to `main` are CI-tested but produce __no image and no deploy__. To ship anything to the live instance — including a hotfix — cut a release (a `patch` release for hotfixes).

Publishing the GitHub Release also fires `ci.yaml`'s `release: [published]` (the release is created with a real user token via `gh`, so it triggers CI normally).

For the full contract (exact tags emitted, how to integrate other deployment tools), see [`docs/deployment/deployment-contract.md`](../deployment/deployment-contract.md).
