# YourPHR deployment contract

This is the __published contract__ for deploying YourPHR. If you run your own instance — with Flux,
Argo CD, plain Kubernetes, Docker Compose, Watchtower, or anything else — key your automation off the
rules here and it will behave predictably across upgrades.

See also: [`docs/releasing.md`](../releasing.md) (how releases are cut) and the project `AGENTS.md`
(deployment overview).

## What is published, and where

Two images are published. Both follow the same semver contract.

### Application

| | |
|---|---|
| Registry image | `ghcr.io/jwilleke/yourphr` |
| Visibility | __public__ (anonymous pull + tag scanning) |
| Platform | `linux/amd64`, `linux/arm64` |
| Built by | [`.github/workflows/docker-jwilleke.yaml`](../../.github/workflows/docker-jwilleke.yaml) |

### SMART on FHIR relay

Only needed if you connect providers that require a public OAuth callback.

| | |
|---|---|
| Registry image | `ghcr.io/jwilleke/yourphr-relay` |
| Visibility | __public__ (anonymous pull + tag scanning) |
| Platform | `linux/amd64`, `linux/arm64` |
| Built by | [`docker-relay-release.yaml`](../../.github/workflows/docker-relay-release.yaml) (semver) and [`docker-relay.yaml`](../../.github/workflows/docker-relay.yaml) (dev tags) |

## The contract: deploy off __semver tags only__

__A deployable image is built and pushed only when a release tag `vX.Y.Z` is created.__ Pushes to
`main` are CI-tested but produce __no image__ and trigger __no deploy__. This is deliberate
(release-gated deployment): the running instance changes only when a release is cut.

Image tags emitted — `ghcr.io/jwilleke/yourphr`:

| Trigger | Tags pushed to ghcr | Deployable? |
|---|---|---|
| Release tag `vX.Y.Z` | `:X.Y.Z`, `:X.Y`, `:latest` | ✅ yes |
| Manual `workflow_dispatch` | `:sha-<shortsha>` | ⚠️ build only — not a release |
| Push to `main` | *(nothing built)* | — |

Image tags emitted — `ghcr.io/jwilleke/yourphr-relay`:

| Trigger | Tags pushed to ghcr | Deployable? |
|---|---|---|
| Release tag `vX.Y.Z` | `:X.Y.Z`, `:X.Y`, `:latest` | ✅ yes |
| Push to `main` touching relay sources | `:main`, `:main-<run>` | ⚠️ dev build — not a release |
| Manual `workflow_dispatch` | as above, per workflow | ⚠️ build only |

The relay's semver tags track the __repository__ release, not a separate relay version — `yourphr-relay:1.20.3` is the relay as of the `v1.20.3` release. A release always publishes both images, even when the relay's own sources did not change in it, so the two are always pullable at the same version.

__Integrator rule:__ follow the immutable `:X.Y.Z` tags (or `:X.Y` for auto-patch, or `:latest` for
"newest release") on both images. Never deploy `:sha-*` or `:main` / `:main-<run>` — they are not
part of the contract, and `:main-<run>` in particular is a CI run counter, not a version.

## Versioning

Semver `MAJOR.MINOR.PATCH`:

- __PATCH__ — backward-compatible fixes.
- __MINOR__ — new backward-compatible features.
- __MAJOR__ — breaking changes.

Releases are cut on any __minor/major or on request__ (patch chains may be consolidated). Between
releases a running build self-reports __git-describe__ (`vX.Y.Z-N-g<sha>`) in the UI — that is the
last release tag plus commits-since, not a deployable artifact.

## Reference implementation (the production instance)

The canonical instance (`yourphr.nerdsbythehour.com`) is delivered by __Flux__ from
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

- __Argo CD Image Updater__ — `argocd-image-updater.argoproj.io/image-list: yourphr=ghcr.io/jwilleke/yourphr` with `update-strategy: semver` and a `^\d+\.\d+\.\d+$` tag filter.
- __Plain Kubernetes__ — pin `image: ghcr.io/jwilleke/yourphr:X.Y.Z` and bump it (by hand or CI) when a release you want lands.
- __Docker Compose__ — `image: ghcr.io/jwilleke/yourphr:X.Y.Z` (or `:latest` for newest release); `docker compose pull && up -d` after a release.
- __Watchtower / similar__ — track `:latest` (it only moves on a release) if you want auto-upgrade-on-release.

## To ship a change to a running instance

Cut a release. There is no "merge to deploy" path — including for hotfixes, which ship as a __patch__
release. See [`docs/releasing.md`](../releasing.md) for the steps.
