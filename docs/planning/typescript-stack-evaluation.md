# TypeScript stack evaluation — planning

> __Status: planning, not decided.__ Nothing here is built and nothing is committed to. This records the landscape, the measured costs, and the questions still open, so the argument does not have to be reconstructed from memory next time. Started 2026-08-13.

## Scope

__Runtime and stack only__ — whether YourPHR's backend stays Go or moves to TypeScript/Node, and what open-source FHIR work already exists in that ecosystem to adopt rather than rebuild.

__Explicitly out of scope: the rendering model.__ Whether the admin surfaces should be server-rendered rather than an SPA is a separate decision, argued in [`authorization-framework.md`](authorization-framework.md), and it can be taken independently and later. Conflating the two makes both harder.

__Explicitly out of scope: the delivery unit.__ Container for self-hosters, desktop app, or hosted service — that question constrains the design more than the language does, and it is unresolved. Noted in the open questions below.

## What prompted this

Three defects on 2026-08-13: two in [#527](https://github.com/jwilleke/yourphr/issues/527), one in [#528](https://github.com/jwilleke/yourphr/issues/528). Two of the three were in the Angular half, one in the Go half. All three were the same shape — a framework's silent default disagreeing with what the code assumed, with a green test suite on top because the test wired the subject differently from production.

So the language was not the variable in the day's failures. But a second argument is stronger and is not about defect rates: __for a single maintainer, fluency is an architecture constraint, not a preference.__ A stack the maintainer thinks slowly in produces worse designs, not merely slower ones. Fasten chose Go for a centralized multi-tenant product; that reasoning does not transfer to a family-scale PHR maintained by one person who is fastest in TypeScript.

## Where we are today — measured

| Measure | Value |
|---|---|
| Backend Go, non-test | 47,661 lines |
| — of which generated FHIR models | 18,518 lines across 70 files in `backend/pkg/models/database/` (39%) |
| Frontend TypeScript / HTML / SCSS | 76,776 lines |
| Migrations | 24, in `backend/pkg/database/gorm_repository_migrations.go` |
| ngdpbase, non-test TypeScript | 101,515 lines, 40 managers |

Coupling to upstream Fasten is already largely broken:

- `fasten-sources` was made private, so `go.mod` carries `replace github.com/fastenhealth/fasten-sources => ./fasten-sources-stub`.
- The C-CDA converter is __Metriport — already an external TypeScript service__, built by `.github/workflows/docker-cda-converter.yaml`.
- Database encryption depends entirely on a pinned fork: `replace github.com/mattn/go-sqlite3 => github.com/jgiannuzzi/go-sqlite3 v1.14.17-...` for SQLCipher DSN pragmas.
- [#278](https://github.com/jwilleke/yourphr/issues/278) (rename Fasten* → YourPHR) is deferred pending a decision to commit to a hard fork. Much of that fork has already happened in practice.

## The two findings that matter most

### 1. The data is already portable

Every resource table carries __`resource_raw JSON`__ holding the canonical FHIR resource whole, alongside extracted columns. Verified against `seed/fasten.seed.db`:

```sql
CREATE TABLE `fhir_condition` (`id` uuid, ..., `resource_raw` JSON, `abatementAge` JSON, `abatementDate` datetime, `clinicalStatus` JSON, `onsetDate` datetime, `severity` JSON, ...);
```

So a migration is a __dump and re-index__, not a transformation. Read `resource_raw` out, hand it to a new implementation, let that implementation build its own indexes. Nothing lossy, no schema archaeology — and both stacks can be run against the same exported corpus and their results diffed. This removes the largest risk normally attached to a rewrite of a data-holding product.

### 2. A generic indexer replaces the 70 generated models

Those 18.5k generated lines exist to produce __one column per search parameter, per resource type__. That is the search index, hand-generated.

In TypeScript the same job is done generically: take each SearchParameter definition from `@medplum/definitions`, evaluate its FHIRPath expression with `fhirpath`, write the result to a generic index table. __One indexer replaces 70 generated model files.__

This is the strongest *technical* argument for the move, and it is worth separating from the fluency argument: it is not a translation of the same design into another language, it is a simpler design that the TypeScript ecosystem makes available.

## FOSS adoption map

Versions and licenses verified 2026-08-13 against the npm registry.

| Package | Version | License | Covers | Does not cover |
|---|---|---|---|---|
| `@medplum/fhir-router` | 5.1.29 | Apache-2.0 | Abstract `FhirRepository` + working `MemoryRepository`; URL routing, search-parameter matching (`matchesSearchRequest`), reference resolution, history/versioning, JSONPatch, batch/transaction, GraphQL | Storage. You implement one interface over SQLite |
| `@medplum/fhirtypes` | 5.1.x | Apache-2.0 | R4 TypeScript types — the replacement for the 18.5k generated Go lines | — |
| `@medplum/definitions` | 5.1.x | Apache-2.0 | StructureDefinitions and SearchParameters | — |
| `@medplum/core` | 5.1.x | Apache-2.0 | Validation, client, utilities; usable standalone against any FHIR server | — |
| [`fhirpath`](https://github.com/HL7/fhirpath.js) | 5.1.1 | HL7 | FHIRPath evaluation — HL7's own implementation | — |
| [`fhirclient`](https://github.com/smart-on-fhir/client-js) | 2.6.3 | Apache-2.0 | SMART launch and token flow, browser and Node | Provider catalog, brand/portal/endpoint model, registration |
| [`better-sqlite3-multiple-ciphers`](https://github.com/m4heshd/better-sqlite3-multiple-ciphers) | 13.0.3 | MIT | Encrypted SQLite — the answer to the SQLCipher objection | Note the documented caveat on legacy-SQLCipher database compatibility; migrating an existing encrypted database needs proving |

The significant point: __the expensive part of a FHIR server — search semantics — is off the shelf and Apache-2.0.__ The remaining work is a `FhirRepository` implementation over SQLite.

## What stays hand-written regardless of language

- __Provider catalog, SMART connect, DCR__ ([#355](https://github.com/jwilleke/yourphr/issues/355)) — `fhirclient` does the launch dance; nothing does the catalog, the brand/portal/endpoint model, or dynamic registration.
- __Sync jobs and re-import dedup__ ([#252](https://github.com/jwilleke/yourphr/issues/252)).
- __Config manager, backup/restore, bootstrap provisioning__ — recent work, ported rather than rethought.
- __Patient-legible display__ ([#262](https://github.com/jwilleke/yourphr/issues/262)) — the actual product, and already TypeScript.

## `jwilleke/ngdpbase` as prior art and possible source

Measured: 101.5k non-test TypeScript lines, 40 managers, a provider architecture with pluggable authentication (`PasswordAuthProvider`, `MagicLinkAuthProvider`, `AuthentikBearerAuthProvider`, `CloudflareAccessAuthProvider`, `AgentTokenAuthProvider`), `ACLManager` at 1,137 lines driven by a `PolicyEvaluator` over allow/deny `AccessPolicy` objects, and — directly relevant to the audit thread on [#507](https://github.com/jwilleke/yourphr/issues/507) — `DatabaseAuditProvider`, `FileAuditProvider` and `CloudAuditProvider` already exist.

Two caveats worth recording before anyone plans around them:

- __`src/plugins/` are JSPWiki-style markup macros, not app modules.__ "YourPHR as an ngdpbase plugin" is not the shape that is actually available. Reuse would be of the managers and providers.
- __The ACL is page-oriented.__ Medical records need resource and compartment rules, which is what Medplum's declarative Access Policies are built for.

Three reuse shapes, none chosen:

1. __Copy the managers__ into YourPHR and adapt for resource-level rules. No coupling; two copies to maintain.
2. __Extract a shared package__ both products consume. Best long-term if both keep running; largest up-front refactor of ngdpbase, and couples release cycles.
3. __Medplum AccessPolicy for records, ngdpbase ideas for roles and UI gating.__ Least new code; adopts someone else's model for the part that governs medical data.

## What this does not force

__A backend rewrite does not force a frontend rewrite.__ The Angular app talks to an HTTP contract that a TypeScript backend can serve unchanged, leaving 76.8k lines in place. Server-rendering — the thing that would actually remove the authorization-projection problem described in [`authorization-framework.md`](authorization-framework.md) — is a separate decision that could be taken later, incrementally, or never.

## Angular vs React vs something else — deliberately deferred

Recorded here so it stops being relitigated every time the stack comes up. __The answer for now is: stay on Angular, and do not bundle this with the backend question.__

__The "one language" goal does not require touching the frontend.__ Angular *is* TypeScript. A Node backend plus the existing Angular app is already a single-language stack; dropping Angular buys nothing on that axis.

__The frontend is the larger rewrite, not the backend.__ 76,776 lines of TypeScript/HTML/SCSS against ~29k hand-written Go (47.7k minus the 18.5k generated models). Bundling "move to Node" with "move to React" more than doubles the program and couples two decisions that can be taken years apart.

Dependency coupling, measured from `frontend/package.json`:

- __Angular-coupled: ~17__ — `@angular/*` core, plus `@ng-bootstrap/ng-bootstrap`, `@ng-select/ng-select`, `@swimlane/ngx-datatable`, `ng2-charts`, `ngx-highlightjs`, `ngx-infinite-scroll`, `@fortawesome/angular-fontawesome`. Wrappers, each with a React equivalent.
- __Framework-agnostic: ~27__ — and this is where the expensive domain work lives: `dwv` (DICOM viewer), `lforms` (LHC questionnaire renderer), `fhirpath`, `@types/fhir`, `chart.js`, `jose`, `idb`, `@panva/oauth4webapi`, `rtf.js`. __None of these are rewritten by a framework migration.__

So a React move is cheaper than the raw line count implies — the hard widgets survive — but it is still tens of thousands of lines of components and templates for no user-visible gain.

__The real fork is SPA vs server-rendered, not Angular vs React.__ That is the decision [`authorization-framework.md`](authorization-framework.md) identifies as the source of the permission-projection problem, and it is why the demo's dead admin buttons are structural rather than a bug. If server-rendering wins for the admin surfaces, the framework question is moot for those screens.

__Where React genuinely pulls:__ `@medplum/react` ships prebuilt FHIR UI — resource tables, search controls, questionnaire forms. If Medplum is adopted on the backend, adopting their components too has real coherence. That is an argument about batteries, not about React being a better framework, and it should be weighed as such.

Sequencing, if this is ever revisited:

1. The backend spike proves or kills the larger question first; the frontend keeps talking to the same HTTP contract either way.
2. Settle the rendering model before the framework — it subsumes the question for at least the admin half.
3. If it stays an SPA, stay on Angular. [#482](https://github.com/jwilleke/yourphr/issues/482) (Angular 22) is a cost paid regardless and is a fraction of a migration.

## Costs and risks that remain

- __Time.__ Even with the FHIR domain adopted rather than built, this is months of evenings, during which the live instance keeps needing fixes ([#528](https://github.com/jwilleke/yourphr/issues/528) did not wait).
- __Re-earned knowledge.__ Line count is not the cost; understanding search parameters, reference graphs and re-import dedup is. Adoption reduces this but does not remove it.
- __Encrypted-database migration.__ The existing SQLCipher database must be provably readable by whatever replaces it, before anything switches.
- __No upstream, ever again.__ Already nearly true, but a rewrite makes it final.

## Spike result — 2026-08-13

The thesis above was tested rather than argued. Local throwaway repo `yourphr-ts-spike` (not on GitHub; issues stay here), run against the __synthetic__ seed corpus — no real records were used.

__The generic indexer works.__ `SqliteFhirRepository` implements Medplum's `FhirRepository` over `better-sqlite3-multiple-ciphers` in __551 lines, roughly half of them comment__, with __three tables serving every resource type__ and no per-resource-type code anywhere. 72/72 resources loaded in ~100ms, producing 1,261 index rows across 59 distinct SearchParameter codes, entirely from FHIR's own definitions.

__Searches answer correctly__, matching the corpus exactly:

```text
Condition?patient=Patient/a08...    -> 2   (corpus has 2)
Observation?patient=Patient/a08...  -> 40  (corpus has 40)
Encounter?patient=Patient/a08...    -> 4   (corpus has 4)
Condition?clinical-status=active    -> 1
```

__Encryption is real__, asserted in both directions — the right key reads, no key fails, the wrong key fails, and a known plaintext marker is absent from the raw bytes on disk. 5/5.

### The finding that justified running it

The first pass returned __zero__ for `Condition?patient=X` while `Immunization?patient=X` returned six. FHIR defines reference parameters like `Condition.patient` as `subject.where(resolve() is Patient)`; `fhirpath.js` refuses `resolve()` in synchronous mode, so parameters with plain paths worked and guarded ones silently indexed nothing. __A search that is confidently wrong, not one that errors__ — the same shape as [#527](https://github.com/jwilleke/yourphr/issues/527) and [#528](https://github.com/jwilleke/yourphr/issues/528).

Fixed by stripping the guard and reinstating it at index time from the reference's own type prefix: a reference already knows it is `Patient/123`. The alternative — fhirpath's async mode with a database-backed resolver — would make indexing depend on referential integrity that a partially synced PHR does not have.

### Run against real records — 2026-08-15/16

A snapshot of the live instance, taken with `sqlite3 .backup` rather than a file copy, and read as a __copy__ throughout. One account: __19,796 resources, 8 sources, 29 resource types__.

| | |
|---|---|
| Load | 19,796 / 19,796, ~22s, 413,175 index rows |
| __id collisions__ | __0__ — the identity seam did not bite |
| Agreement with Medplum's reference | __71/71 queries__ |
| __Agreement with the Go stack in production__ | __29/29 resource types, id for id__ |
| Write path | __11/11__ — re-import, update, delete, reindex |

__Open question 1 is answered.__ The identity seam — YourPHR keys on `(source_id, source_resource_type, source_resource_id)` because one record arrives from several providers, Medplum keys on `ResourceType/id` — produced __zero collisions across 8 sources__. Not proof it can never happen, but the concern was hypothetical and now has a number against it.

Nine resource types the spike had never seen loaded with no special-casing, which is what a generic indexer is for.

The __shadow read-only__ step of the sequencing below is therefore done, at the repository layer: the Go stack and the TypeScript stack return the same identifiers for the same records. It reads through `GormRepository`, the same code path the HTTP handler uses, so no session or credentials were involved — but it does __not__ exercise the handlers themselves.

Two harness flaws that real data exposed and synthetic data could not, both fixed:

- comparing __truncated__ result sets reported three false disagreements, because neither repository promises an order beyond a page and the corpus holds 15,225 DocumentReferences
- comparing __across accounts__ compared 20,061 resources against 19,796, because the API enforces per-user isolation and the export did not

### Auth and the HTTP layer — 2026-08-16

Two of the three gaps in [#537](https://github.com/jwilleke/yourphr/issues/537) closed against real records.

__Per-user isolation: 6/6__, tested with two real accounts sharing one database (19,796 resources against 265, 18 shared resource types). Ownership is a property of the repository instance rather than an argument, so a caller cannot forget it. `(resource_type, id)` proved insufficient as a key — two family members treated at the same hospital receive the __same Organization id__ — and the shared-id case is tested explicitly because it does not occur naturally in this corpus. Verified to detect a leak.

__The HTTP layer: 9/9__ over real HTTP — 3,456 Conditions served, matching the Go stack id for id, all 29 summary counts equal.

__This corrects an assumption made above.__ "A backend rewrite does not force a frontend rewrite" is __true but not free__. The Angular app does not speak FHIR REST: it calls `/api/secure/resource/fhir?sourceResourceType=X` and expects a `ResourceFhir` wrapper, while Medplum's router serves FHIR-native `GET /Condition` → `Bundle`. Keeping the frontend therefore requires an adapter, and the adapter needs data a FHIR-native store does not hold — `source_id`, `sort_title`, `provenance`, `classified`. None is hard; all are invisible until a screen renders wrong. Bounded and known, against 76.8k lines of Angular kept.

__Sync remains untested and was not faked.__ It needs live provider credentials and a real OAuth round trip; mocking one would test the mock. The specific uncertainty is incremental re-fetch dedup: records dedup when the same bytes arrive twice, but a resync sends *slightly different bytes for the same clinical fact*, which is [#252](https://github.com/jwilleke/yourphr/issues/252)'s real problem.

### What the spike did NOT prove

- __72 synthetic resources.__ Nothing about scale, or about the long tail of real provider data.
- __No id collisions observed — but the corpus came from one source.__ The identity seam (open question 1) is therefore still untested. `createResource` counts and rejects duplicates rather than upserting, so the number will be meaningful when a multi-source corpus is loaded.
- __Sync, auth and the HTTP layer remain untested.__ Writes and re-import dedup are now covered; nothing fetches from a provider, authenticates anybody, or serves a request. The spike has __no concept of a user at all__, which on a family instance is a disclosure rather than a missing feature. Tracked in [#537](https://github.com/jwilleke/yourphr/issues/537).
- __The existing encrypted database has not been opened.__ Round-tripping a database this code wrote is not the same as reading one that SQLCipher-via-Go wrote. Less pressing than it looked: the live instance turns out to be __unencrypted__, despite `database.encryption.enabled` defaulting to true.

Unimplemented and deliberately throwing rather than returning partial answers: `withTransaction`, `readHistory`, `readVersion`, `patchResource`, `searchByReference`, `_include`/`_revInclude`, chained and composite parameters.

__Status is unchanged: this is still planning, not a decision.__ What changed is that the central technical claim is no longer a hypothesis.

## Open questions

1. __Resource identity.__ YourPHR keys on `(source_id, source_resource_type, source_resource_id)` because one record can arrive from three providers; FHIR's `id` is single-server. Where does that seam land against Medplum's model? Expected to be the first real friction.
2. __Is `PolicyEvaluator`'s shape reusable__ when the subject is a resource compartment rather than a wiki page?
3. __What is the delivery unit__ — self-hoster's container, desktop app, or hosted service? It constrains the stack more than the language does, and today's k3s + Flux + GHCR pipeline implies an audience of one.
4. __What is the smallest experiment that would settle this__, run against real records rather than argued? A candidate: export the live records, implement `FhirRepository` over `better-sqlite3-multiple-ciphers`, index via `@medplum/definitions` + `fhirpath`, and render one condition list correctly — with the success criteria agreed before starting.
5. __Does the release-gated deploy loop change independently of all this?__ It was the largest time cost in the session that prompted the question, and it is neither a language nor a rendering problem.
