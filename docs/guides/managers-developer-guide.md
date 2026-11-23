---
name: Managers and providers developer guide
description: How to add or change a manager or provider — the typed engine, one door per resource, the request context on every call, configuration selects the implementation
dateModified: 2026-11-23
category: guides
relatedModules: [Engine, BaseManager, ApiContext, app.ts]
---

# Managers and providers developer guide

How to add or change a manager or a provider. The invariant: a resource has exactly one door, its manager, and only the providers behind it touch a store or the network. The ngdpbase document this stack is built from is [architecture-principles-typescript.md](https://github.com/jwilleke/ngdpbase/blob/master/docs/planning/architecture-principles-typescript.md); read it before changing the shape.

## Standing rules

- One manager per resource, and no second write path around it. The 70-odd FHIR resource types are __one__ resource: `RecordsManager` is their door (`src/app/managers/RecordsManager.ts`).
- Managers extend `BaseManager` (`src/framework/BaseManager.ts`). It declares `name`, `dependsOn`, `initialize()`, `shutdown()`, and abstract `backup()` and `restore()`: a manager cannot exist without saying how its resource is copied and brought back.
- The engine is a typed registry (`src/framework/Engine.ts`). A manager adds itself to `ManagerRegistry` by module augmentation in its own file:

  ```ts
  declare module '../Engine.js' {
    interface ManagerRegistry {
      sessions: SessionsManager;
    }
  }
  ```

  Callers write `engine.managers.sessions`. There is no `getManager<T>('Name')`. Use `engine.has('name')` where a manager is optional; the HTTP layer gates whole route families on it (`engine.has('agentTokens')`, `engine.has('demo')`).
- Declare dependencies in `dependsOn`. `Engine.initialize()` orders managers topologically, refuses a missing dependency and refuses a cycle at boot, and `shutdown()` runs in reverse.
- Every method that acts for someone takes an `ApiContext` (`src/framework/ApiContext.ts`) as its first argument and acts for `ctx.username`. Build one with `ApiContext.from(principal, engine)` (a session), `ApiContext.agent(...)` (an agent token or device key), `ApiContext.anonymous(engine)` or `ApiContext.system(name, onBehalfOf, engine)` (the worker, the migration tool). A request context lives for one request; there is no global one.
- A manager reaches its siblings through its own `engine` field, never through `ctx.engine`.
- Authorize at the door with `ctx.require(permission)` (401 unauthenticated, 403 without the permission), `ctx.can(permission)` or `ctx.canRead(category)`. Throw `ApiError(status, message)` for a refusal; the server's one error boundary turns it into the envelope. See [security-developer-guide.md](security-developer-guide.md).
- Providers extend the matching `Base*Provider` (`src/framework/providers/`, `src/app/providers/`). They are the only code that may open a database handle (`npm run check:store`) or reach the network, and the network only through `src/http/` (`npm run check:boundary`).
- Configuration selects a provider by name and the composition root builds it: `yourphr.audit.provider`, `yourphr.backup.storage.provider`, `yourphr.sources.client.provider`, `yourphr.glossary.provider`, `yourphr.lookups.npi.provider` (the `*For(name)` functions in `src/app.ts`). An optional capability has an inert `null` alternative that says so; an unknown name refuses the boot. `ConfigurationManager` is the one exception: it reads configuration, so `src/app.ts` picks its provider (`FileConfigProvider`).
- Long work never holds the request. A request that starts something slow answers at once, and the outcome arrives as a notification (`NotificationManager.createNotification`). The rule is [#905](https://github.com/jwilleke/yourphr/issues/905), stated in [AGENTS.md](../../AGENTS.md#frontend-architecture-frontendsrcapp). Two shapes exist today: a job registered with `BackgroundJobManager.registerJob` and started with `enqueue(jobId, ctx)` (the search index rebuild and the integrity check, in `RecordsManager`), and a `start*` method that runs the work without awaiting it and notifies at the end (`SourcesManager.startUpload`, `SourcesManager.startRemoval`, `BackupManager.startRestore`). `BackgroundJobManager` is the ngdpbase-shaped mechanism: one active run per job id, and a status (`getStatus`, `latestRun`) the admin screens read.

## The managers today

Registered in `openStores()` (`src/app.ts`), grouped here by folder; the engine orders them by `dependsOn`:

| Name | Class | Folder |
| --- | --- | --- |
| `configuration` | `ConfigurationManager` | `src/framework/` |
| `policy`, `filters`, `settings`, `email`, `notifications`, `backgroundJobs`, `database`, `audit`, `users`, `sessions`, `agentTokens`, `backups`, `jobs` | `PolicyManager`, `FilterManager`, `SettingsManager`, `EmailManager`, `NotificationManager`, `BackgroundJobManager`, `DatabaseManager`, `AuditManager`, `UsersManager`, `SessionsManager`, `AgentTokensManager`, `BackupManager`, `JobsManager` | `src/framework/managers/` |
| `records`, `health`, `sources`, `catalog`, `glossary`, `lookups`, `demo` | `RecordsManager`, `HealthManager`, `SourcesManager`, `CatalogManager`, `GlossaryManager`, `LookupsManager`, `DemoManager` | `src/app/managers/` |

`src/framework/` holds what any instance of this platform needs and names no PHR resource; `src/app/` holds the PHR. Keep that split: a framework manager that imports from `src/app/` is in the wrong folder.

## How to add a manager

1. Create `src/framework/managers/<Name>Manager.ts` or `src/app/managers/<Name>Manager.ts`, extending `BaseManager`, with `readonly name`, `dependsOn`, and the `ManagerRegistry` augmentation.
2. Implement `backup()` and `restore()`. A manager with nothing to carry returns a payload that says so (see `SessionsManager.backup`).
3. Take `ctx: ApiContext` on every method that acts for someone, and check permissions there.
4. Register it in `openStores()` with `engine.register('<name>', manager)`.
5. Put its unit test beside it in `__tests__/`, over an in-memory fake of its provider interface. See [testing-developer-guide.md](testing-developer-guide.md).

## How to add a provider

1. Define or extend the `Base<Capability>Provider` interface; add an inert `Null<Capability>Provider` if the capability can be left unconfigured.
2. Implement it. If it touches the network, go through `OutboundHttp` or `guardedFetch` in `src/http/`, never `fetch` or `node:http` directly.
3. Add a configuration key naming it (with a `_comment_*` sibling) to `config/app-default-config.json`, and a `*For(name)` branch in `src/app.ts` that refuses an unknown name.
4. A provider that fetches from the internet is loaded with a dynamic `import()` so an instance bound to `null` never loads it (see `glossaryProviderFor`).

## How you know you are done

- `npm run typecheck`, `npm run build`, `npm run check:store`, `npm run check:boundary` and the manager's unit test pass.
- The boot log line `engine: configuration -> …` lists the manager after its dependencies.

## See also

- [configuration-developer-guide.md](configuration-developer-guide.md): keys and provider selection
- [storage-developer-guide.md](storage-developer-guide.md): what a provider may open, and migrations
- [security-developer-guide.md](security-developer-guide.md): checks at the door
- [architecture/architecture.md](../architecture/architecture.md): the component map

## Known gaps

- `scripts/check-store-boundary.sh` keeps a transitional allow-list (`src/migrate`, `src/app.ts`); each entry names the [#608](https://github.com/jwilleke/yourphr/issues/608) child that removes it.
- `BackgroundJobManager` records no audit event for a job: `AuditManager` is the patient's access log, and there is no operator audit log (the port, [#840](https://github.com/jwilleke/yourphr/issues/840), was closed as not planned). The manager's header still says job events will go there.
- [architecture/architecture.md](../architecture/architecture.md)'s manager row lists eight framework and five app managers; the table above is the full set registered in `src/app.ts`.
