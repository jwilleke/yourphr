# YourPHR deployment contract

This is the __published contract__ for deploying YourPHR. If you run your own instance — with Flux,
Argo CD, plain Kubernetes, Docker Compose, Watchtower, or anything else — key your automation off the
rules here and it will behave predictably across upgrades.

See also: [`docs/development/releasing.md`](../development/releasing.md) (how releases are cut) and the project `AGENTS.md`
(deployment overview).

## What is published, and where

Two images are published. Both follow the same semver contract.

### Application

| | |
|---|---|
| Registry image | `ghcr.io/jwilleke/yourphr` |
| Visibility | __public__ (anonymous pull + tag scanning) |
| Platform | `linux/amd64`, `linux/arm64` |
| Built by | [`.github/workflows/release-image.yaml`](../../.github/workflows/release-image.yaml) |
| Contains | the TypeScript server and the Angular app, built from the same commit (yourphr#652) |

From __3.0.0__ this image is the TypeScript stack. The Go stack is finished at 2.10.3 and lives on,
byte for byte, as `ghcr.io/jwilleke/yourphr-go:2.10.3` — copied by digest, not rebuilt. Anything
still pulling `ghcr.io/jwilleke/yourphr:2.10.3` keeps working; nothing new will appear under 2.x.

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

### Every automated instance needs BOTH halves

There are two instances on this contract, not one:

| Instance | Deployment | Automation |
|---|---|---|
| `yourphr.nerdsbythehour.com` | `apps/production/yourphr-ts` | `yourphr-policy.yaml` |
| `demo.yourphr.org` | `apps/production/demo-yourphr-ts` | `demo-yourphr-policy.yaml` |

Both share the __same__ `ImageRepository` and `ImagePolicy` (`flux-system:yourphr`) — one GHCR
scan, one release-gated semver rule. Each keeps its own `ImageUpdateAutomation` so its image bump
commits independently rather than both instances moving in a single commit.

Automation needs __two__ things, and either one missing is silent:

1. the `ImageUpdateAutomation`'s `path` points at the directory holding that instance's Deployment
2. that Deployment's `image:` line carries the `# {"$imagepolicy": "flux-system:yourphr"}` marker

The setter rewrites a marked line inside the watched path. A watched path with no marker updates
nothing; a marked line nobody watches updates nothing. Neither raises an error — Flux simply has no
work to do, and the instance stays on whatever tag it was last given while every other instance
moves on. That is exactly what happened to the demo ([#675](https://github.com/jwilleke/yourphr/issues/675)):
its automation still pointed at the old Go directory after the TypeScript swap, so it sat on 3.1.0
through the 3.2.0 release with nothing reporting a problem.

__A deliberately pinned Deployment has neither__, and that is how you tell the two apart. The
frozen Go deployments (`apps/production/demo-yourphr`, and prod's `yourphr`) pin
`ghcr.io/jwilleke/yourphr-go:2.10.3` with no marker on purpose: they are the rollback and must not
float. Absence of a marker is a statement, so it is worth being sure which statement it is making.

__Verifying it, rather than assuming:__ after a release, every instance that should have moved
reports the new version.

```bash
kubectl -n yourphr      get deploy yourphr-ts      -o jsonpath='{.spec.template.spec.containers[0].image}'
kubectl -n demo-yourphr get deploy demo-yourphr-ts -o jsonpath='{.spec.template.spec.containers[0].image}'
```

Nothing checks this automatically yet. Until something does, it belongs beside the two post-release
checks below — the failure mode is the same one: silence that looks like success.

## Integrating other deployment tools

Apply the same "highest `:X.Y.Z`" rule:

- __Argo CD Image Updater__ — `argocd-image-updater.argoproj.io/image-list: yourphr=ghcr.io/jwilleke/yourphr` with `update-strategy: semver` and a `^\d+\.\d+\.\d+$` tag filter.
- __Plain Kubernetes__ — pin `image: ghcr.io/jwilleke/yourphr:X.Y.Z` and bump it (by hand or CI) when a release you want lands.
- __Docker Compose__ — `image: ghcr.io/jwilleke/yourphr:X.Y.Z` (or `:latest` for newest release); `docker compose pull && up -d` after a release.
- __Watchtower / similar__ — track `:latest` (it only moves on a release) if you want auto-upgrade-on-release.

## To ship a change to a running instance

Cut a release. There is no "merge to deploy" path — including for hotfixes, which ship as a __patch__
release. See [`docs/development/releasing.md`](../development/releasing.md) for the steps.

### Cutting one is not finished until you have checked it happened

Two steps, and neither is optional, because __both failure modes here are silent__:

1. __Confirm the image was built.__ `gh run list --workflow=release-image.yaml` must show a run for
   the tag you just pushed. Pushing `v3.1.0` once produced no run at all — not a failed one, none
   (yourphr#658) — and a missing image looks exactly like a working deployment: Flux simply keeps
   the digest it already has. If no run appeared, dispatch one from the tag:
   `gh workflow run release-image.yaml --ref vX.Y.Z`.
2. __Publish the GitHub Release.__ The Releases page is where a self-hoster looks to answer "what
   changed and should I upgrade", and for four releases it said the newest YourPHR was the frozen Go
   one (yourphr#659). Take the body from the matching `CHANGELOG.md` entry. Publishing also fires the
   image build a second time, which is the point: the two announcements of a release are also two
   chances for it to exist.

Behind both sits a backstop that does not depend on anyone remembering: the scheduled
[`release-gate-check.yaml`](../../.github/workflows/release-gate-check.yaml) workflow compares the
newest `vX.Y.Z` tag against the registry daily, and when the tag has no published image it fails red
__and files a P0 issue__ — because the failure mode being guarded against is precisely a silence
that looks like success (yourphr#658).
