# Releasing YourPHR

> The full published deploy contract (image tags, what integrators should key off) lives in
> [`docs/deployment/deployment-contract.md`](deployment/deployment-contract.md). This page covers how a
> maintainer cuts a release.

Releases are cut by **direct annotated git tag** — no release bot, no release PR, no tokens, no admin overrides. (We removed release-please, inherited from upstream Fasten, because its bot-created release PR could not pass `main`'s required status checks without a privileged token — see issue #241.)

## Versioning

Semver `MAJOR.MINOR.PATCH`, chosen by what changed since the last tag:

- **PATCH** (`1.5.0 → 1.5.1`) — backward-compatible bug fixes only.
- **MINOR** (`1.5.0 → 1.6.0`) — new backward-compatible features. Resets patch to 0.
- **MAJOR** (`1.5.0 → 2.0.0`) — breaking changes. Resets minor + patch to 0. (Rare pre-2.0.)

Between releases the running build reports **git-describe** (`vX.Y.Z-N-g<sha>`) — the last tag, commits since, and the short hash. That is expected; it is not "unreleased = broken."

## Cutting a release

From a clean `main` with everything pushed and tests green:

1. Bump the version constant: `backend/pkg/version/version.go` → `const VERSION = "X.Y.Z"`.
2. Prepend a section to `CHANGELOG.md` (`## [X.Y.Z](compare-link) (DATE)` with Features / Bug Fixes).
3. Commit: `chore(release): vX.Y.Z`.
4. Tag + push: `git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin main --tags`.
5. GitHub Release: `gh release create vX.Y.Z --title "vX.Y.Z" --generate-notes --notes-start-tag v<previous>`.

## Deployment is release-gated

The live instance deploys **strictly off release tags** — not off `main`:

- Pushing the `vX.Y.Z` tag triggers `docker-jwilleke.yaml`, which builds + pushes `ghcr.io/jwilleke/yourphr:X.Y.Z` (+ `:X.Y`, `:latest`).
- Flux's `ImagePolicy` (in `jwilleke/mj-infra-flux`, `apps/production/image-automation/yourphr-policy.yaml`) filters **semver** tags and bumps the deployment to the newest release. So the live instance updates **only when you cut a release**.
- Pushes to `main` are CI-tested but produce **no image and no deploy**. To ship anything to the live instance — including a hotfix — cut a release (a `patch` release for hotfixes).

Publishing the GitHub Release also fires `ci.yaml`'s `release: [published]` (the release is created with a real user token via `gh`, so it triggers CI normally).

For the full contract (exact tags emitted, how to integrate other deployment tools), see [`docs/deployment/deployment-contract.md`](deployment/deployment-contract.md).
