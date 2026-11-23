---
name: Developer guides
description: Index of yourPHR's developer guides — the door for how to change this codebase
dateModified: 2026-11-23
category: guides
---

# Developer guides

Each file is the door for one area of the TypeScript server in `src/`: standing rules, a checklist, pointers into the code, and known gaps. They describe the code as it is on `main`; when the code changes, the guide changes in the same pull request. A fact that already has a home (a design note, a contract, a setting's `_comment_*`) is linked, not copied.

Out of scope for now: everything under `addons/` (the `phr` ngdpbase add-on), the Angular app's internals (`frontend/`), and the Go relay (`relay/`).

| Area | Guide |
| --- | --- |
| Getting started (prerequisites, `.env`, the dev servers, the CLI, the repository layout) | [getting-started-developer-guide.md](getting-started-developer-guide.md) |
| Managers and providers (the engine, one door per resource, `ApiContext`) | [managers-developer-guide.md](managers-developer-guide.md) |
| Configuration (three layers, keys, environment-owned keys, secrets) | [configuration-developer-guide.md](configuration-developer-guide.md) |
| API (how `src/server.ts` routes, the envelope, the route and category checks) | [api-developer-guide.md](api-developer-guide.md) |
| Security (permissions and roles, the request pipeline, agent tokens, the access log, outbound HTTP, PHI) | [security-developer-guide.md](security-developer-guide.md) |
| Storage (the three databases, migrations, encryption, backup) | [storage-developer-guide.md](storage-developer-guide.md) |
| FHIR records (how records arrive, are stored and are shown; FHIR coding, medications in particular) | [fhir-records-developer-guide.md](fhir-records-developer-guide.md) |
| Connected devices and health samples (the code behind the device contract) | [devices-developer-guide.md](devices-developer-guide.md) |
| Testing (unit tests, harnesses, boundary checks, E2E, CI) | [testing-developer-guide.md](testing-developer-guide.md) |
| Build and release (the build, the image, release-gated deploys) | [build-release-developer-guide.md](build-release-developer-guide.md) |
| Demo mode (the public demo and its read-only admin) | [demo-mode.md](demo-mode.md) |

## yourPHR and ngdpbase

The TypeScript stack is built on [ngdpbase](https://github.com/jwilleke/ngdpbase)'s model: many classes in `src/framework/` are ports of ngdpbase managers of the same name (`ConfigurationManager`, `BackgroundJobManager`, `NotificationManager`, `EmailManager`, `FilterManager`), and each file's header says where it diverges and why. yourPHR does not depend on ngdpbase at run time; nothing in `src/` imports it. The rule for new work (default to ngdpbase's shape) is in [AGENTS.md](../../AGENTS.md#typescript-stack-default-to-ngdpbase), and the direction (yourPHR as ngdpbase add-ons) is in [planning/ngdp-move.md](../planning/ngdp-move.md). These guides follow the shape of [ngdpbase's guides](https://github.com/jwilleke/ngdpbase/tree/master/docs/guides) but describe only what yourPHR's code does.

## Standing law

- [AGENTS.md](../../AGENTS.md): the agent brief, PHI rules, commands, deployment.
- [architecture/architecture.md](../architecture/architecture.md): the system as a whole.
- [docs/README.md](../README.md): every other document, by section.
