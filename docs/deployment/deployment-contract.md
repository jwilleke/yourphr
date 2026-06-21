# YourPHR deployment contract

This is the **published contract** for deploying YourPHR. If you run your own instance — with Flux,
Argo CD, plain Kubernetes, Docker Compose, Watchtower, or anything else — key your automation off the
rules here and it will behave predictably across upgrades.

See also: [`docs/releasing.md`](../releasing.md) (how releases are cut) and the project `CLAUDE.md`
(deployment overview).

## What is published, and where

| | |
|---|---|
| Registry image | `ghcr.io/jwilleke/yourphr` |
| Visibility | **public** (anonymous pull + tag scanning) |
| Platform | `linux/amd64` |
| Built by | [`.github/workflows/docker-jwilleke.yaml`](../../.github/workflows/docker-jwilleke.yaml) |

## The contract: deploy off **semver tags only**

**A deployable image is built and pushed only when a release tag `vX.Y.Z` is created.** Pushes to
`main` are CI-tested but produce **no image** and trigger **no deploy**. This is deliberate
(release-gated deployment): the running instance changes only when a release is cut.

Image tags emitted:

| Trigger | Tags pushed to ghcr | Deployable? |
|---|---|---|
| Release tag `vX.Y.Z` | `:X.Y.Z`, `:X.Y`, `:latest` | ✅ yes |
| Manual `workflow_dispatch` | `:sha-<shortsha>` | ⚠️ build only — not a release |
| Push to `main` | *(nothing built)* | — |

**Integrator rule:** follow the immutable `:X.Y.Z` tags (or `:X.Y` for auto-patch, or `:latest` for
"newest release"). Never deploy `:sha-*` or expect a `:main` tag — they are not part of the contract.

## Versioning

Semver `MAJOR.MINOR.PATCH`:

- **PATCH** — backward-compatible fixes.
- **MINOR** — new backward-compatible features.
- **MAJOR** — breaking changes.

Releases are cut on any **minor/major or on request** (patch chains may be consolidated). Between
releases a running build self-reports **git-describe** (`vX.Y.Z-N-g<sha>`) in the UI — that is the
last release tag plus commits-since, not a deployable artifact.

## Reference implementation (the production instance)

The canonical instance (`yourphr.nerdsbythehour.com`) is delivered by **Flux** from
[`jwilleke/mj-infra-flux`](https://github.com/jwilleke/mj-infra-flux)
(`apps/production/image-automation/yourphr-policy.yaml`). The `ImagePolicy` encodes the contract:

```yaml
# ImageRepository scans ghcr.io/jwilleke/yourphr every 1m
filterTags:
  pattern: '^(\d+\.\d+\.\d+)$'   # the :X.Y.Z release tags
  extract: '$1'
policy:
  semver:
    range: '>=1.0.0'             # pick the highest released version
```

An `ImageUpdateAutomation` then writes the selected tag into the Deployment's `image:` line (marked
with `# {"$imagepolicy": "flux-system:yourphr"}`) and commits it back to the GitOps repo.

## Integrating other deployment tools

Apply the same "highest `:X.Y.Z`" rule:

- **Argo CD Image Updater** — `argocd-image-updater.argoproj.io/image-list: yourphr=ghcr.io/jwilleke/yourphr` with `update-strategy: semver` and a `^\d+\.\d+\.\d+$` tag filter.
- **Plain Kubernetes** — pin `image: ghcr.io/jwilleke/yourphr:X.Y.Z` and bump it (by hand or CI) when a release you want lands.
- **Docker Compose** — `image: ghcr.io/jwilleke/yourphr:X.Y.Z` (or `:latest` for newest release); `docker compose pull && up -d` after a release.
- **Watchtower / similar** — track `:latest` (it only moves on a release) if you want auto-upgrade-on-release.

## To ship a change to a running instance

Cut a release. There is no "merge to deploy" path — including for hotfixes, which ship as a **patch**
release. See [`docs/releasing.md`](../releasing.md) for the steps.
