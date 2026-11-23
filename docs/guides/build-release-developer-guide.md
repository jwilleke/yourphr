---
name: Build and release developer guide
description: How the server and the app are built into one image, and why nothing reaches the live instance until a release tag is cut
dateModified: 2026-11-23
category: guides
relatedModules: [tsconfig.build.json, Dockerfile, release-image.yaml, scripts/version.ts]
---

# Build and release developer guide

How a commit becomes an image and an image becomes the running instance. Cutting a release step by step is [releasing.md](../development/releasing.md), and what the image promises an operator is the [deployment contract](../deployment/deployment-contract.md); this page is the map and the rules.

## Standing rules

- `package.json` is the only version source. `npm run bump -- <patch|minor|major>` (`scripts/version.ts`) moves `package.json`, `package-lock.json` and the `CHANGELOG.md` heading together; never edit them by hand. The running server reports it on `GET /api/version`.
- Pushes to `main` are tested and build __no image__. An image is built only for a `vX.Y.Z` tag or a published GitHub Release (`.github/workflows/release-image.yaml`), and the live instance moves only when Flux sees a newer semver tag. To ship anything, including a hotfix, cut a release.
- One image holds the server and the Angular app, built from the same commit.
- Nothing is generated: there is no code generation step, and nothing needs regenerating before a commit.

## The build

- `npm run build`: `tsc -p tsconfig.build.json`, `src/**` only, tests excluded, into `dist/server/`. `npm start` runs `node dist/server/main.js`.
- The Angular app: `make build-frontend-prod` (or `yarn build -- -c prod` in `frontend/`) writes `dist/web/`.
- The image (`Dockerfile`), multi-stage:
  1. `frontend`: Yarn install and the production Angular build.
  2. `build`: `npm ci`, `npm run build`, and the demo baseline (`scripts/build-demo-baseline.ts`).
  3. `deps`: production `node_modules` only.
  4. Runtime on `node:24-bookworm-slim` as user `node`, `WORKDIR /opt/yourphr`: `dist/server`, `config/`, `baseline/`, the app in `web/`. Defaults `YOURPHR_FAST_STORAGE` and `YOURPHR_SLOW_STORAGE` to `/opt/yourphr/data` (a volume), `YOURPHR_WEB_STATIC_DIR=/opt/yourphr/web`, port 8080. `ENTRYPOINT ["node", "dist/server/main.js"]`, `CMD ["start"]`, so `docker run <image> migrate …` runs a subcommand.
- Secrets are never in the image. They come from the orchestrator or `<data>/.env` on the volume.

## Images and workflows

| Workflow | What it does |
| --- | --- |
| `server-ci.yaml` | The server's checks and E2E, every push and pull request |
| `release-image.yaml` | `ghcr.io/jwilleke/yourphr:X.Y.Z`, `:X.Y`, `:latest`, on a release tag or a published release |
| `docker-relay-release.yaml` | `ghcr.io/jwilleke/yourphr-relay` at the same version |
| `docker-cda-converter.yaml` | The C-CDA converter sidecar image (manual trigger only) |
| `release-gate-check.yaml` | Daily: opens an issue if the newest release tag has no image in the registry ([#658](https://github.com/jwilleke/yourphr/issues/658)) |

## How you know you are done

- Before a release: `npm run build`, `npm run typecheck`, `npm test`, `make test-e2e`, then `npm run test:baseline:compare` (see [releasing.md](../development/releasing.md)).
- After: `gh run list --workflow=release-image.yaml` shows the tag's build, and the instance's `/api/version` reports the new version.

## See also

- [deployment/README.md](../deployment/README.md): installing and configuring an instance
- [deployment/upgrading-v2-to-v3.md](../deployment/upgrading-v2-to-v3.md): moving off the Go stack
- [AGENTS.md § Deployment](../../AGENTS.md#deployment): where the live instance runs

## Known gaps

- [architecture/architecture.md](../architecture/architecture.md#deployment--delivery)'s delivery diagram still shows pushes to `main` building `:main` images and a Kubernetes namespace and Flux directory named `fasten`. The workflow above builds only on release tags; AGENTS.md names the namespace `yourphr` and the directory `apps/production/yourphr`.
- [architecture/architecture.md](../architecture/architecture.md) also says Angular 20 and lists `start`, `migrate`, `reset-password`, `version`, `help` as the commands; `frontend/package.json` is on Angular 22, and `compact` and `reindex` are commands too.
