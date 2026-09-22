# Connecting a provider and pulling records — the flow, its gaps, and what closes them

> __Status: working document, opened 2026-09-22.__ The flow below is what v3.5.2 actually does, checked against the code and against a live Epic sandbox run on 2026-09-22 ([#753](https://github.com/jwilleke/yourphr/issues/753)) that imported 29 records for Camila Lopez. The gaps are worked one at a time; each carries its decision and the issue that closes it. Nothing here is adopted until its __Decision__ line says so.

## The flow as it stands

| # | Step | Where it lives |
|---|---|---|
| 1 | An operator adds a provider: FHIR base URL, client id, client secret, scopes, environment | Admin → provider catalog, `CatalogManager` |
| 2 | A patient clicks Connect: SMART discovery, then a PKCE authorize URL | `CatalogManager.beginAuthorization` → `SmartSourceClientProvider` → `src/smart` |
| 3 | The patient signs in at the provider and approves; the provider redirects to the __relay__, the address registered with it | the patient's browser, `relay/` |
| 4 | Connect completes: the code is polled from the relay, exchanged for a token, the patient id read from the token response, the source stored | `CatalogManager.connect`, `RelayProvider` |
| 5 | The first sync runs in the background: one request per record type, records written through the records door, one job and one log line | `SourcesManager.syncInBackground` → `syncOne` → `SmartSourceClientProvider.fetchPages` → `src/sync` |
| 6 | Every cycle after: refresh near expiry, sync again, skip disconnected sources | `SourcesManager.pass` |

__The seam that matters.__ `SourcesManager` owns ownership, jobs, events and what counts as a failure. `BaseSourceClientProvider` is the contract for *how a provider is talked to* — `beginAuthorization`, `completeAuthorization`, `refresh`, `fetchPages` — and `SmartSourceClientProvider` is its only real implementation. Everything below is about that provider layer; the manager above it should not have to change.

__One hard constraint.__ All outbound network access goes through `src/http` so the SSRF guard applies, enforced by `scripts/check-http-boundary.sh`. Anything extracted or adopted must take a guarded fetch rather than doing its own.

## The gaps

Ordered by what they cost a patient, not by effort.

| # | Gap | Effect | Issue | Decision |
|---|---|---|---|---|
| 1 | Epic refuses `Observation` without a `category` | __No labs, no vital signs__ from Epic | [#754](https://github.com/jwilleke/yourphr/issues/754) | __settled 2026-09-22__ — US Core combinations + adaptive fallback |
| 2 | Record types come from the scopes the catalog entry __requests__, never from what the server supports or actually granted | Types are requested that a server refuses; types it offers can be missed | none yet | __settled 2026-09-22__ — granted scopes ∩ advertised resources |
| 3 | No CapabilityStatement (`/metadata`) reading — every provider is asked the same way; v2 did this and v3 dropped it | Each new provider is a new surprise, found in production | none yet | __settled 2026-09-22__ — read at connect, store, re-read weekly, narrow only |
| 4 | Vendor knowledge sits inside one class in this repo | Adding Cerner or athenahealth means editing YourPHR itself; nothing else can reuse it | none yet | __settled 2026-09-22__ — build as `src/sources/`, extract later |
| 5 | No `$everything` when a server advertises it | More requests than needed where one would do | none yet | open |
| 6 | No per-type page budget and no retry on 5xx | A large or flaky provider can stall a sync | none yet | open |

## Gap 1 — Epic refuses an unqualified Observation search

__Evidence.__ Live, 2026-09-22: `GET /Observation?patient={id}&_count=100` → __HTTP 400__, OperationOutcome `severity: fatal, code: required`. Since [#753](https://github.com/jwilleke/yourphr/issues/753) the type is skipped and named rather than sinking the sync, so the import succeeds without labs or vitals.

__Epic is within the rules.__ US Core's required search combination for Observation is patient + category (and patient + category + date); base FHIR lets a server refuse a search it considers too costly. v2 did not send `category` either, so this is a long-standing gap rather than a v3 regression.

__Not an Epic quirk.__ Oracle Health (Cerner) Millennium documents the same rule — Observation's `patient` "must be used in combination with `category` or `code`". Both implement it because both certify to US Core, which is also why the answer below is a conformance rule rather than a vendor table. Other types are looser and not uniform: Cerner requires `patient` (or `_id`) for DiagnosticReport and treats `category` as a filter; Epic 400s CarePlan for the same reason it 400s Observation.

__Discovery does not answer this, and that was checked, not assumed.__ Epic's own CapabilityStatement (fetched 2026-09-22, `fhirVersion 4.0.1`, 60 resources) lists the parameters it __supports__ for Observation — `category`, `code`, `patient`, `date` and 25 more — and carries __no__ `search-parameter-combination` extension anywhere in the document. A server tells you what it accepts, never what it insists on.

__US Core does answer it, machine-readably.__ `CapabilityStatement-us-core-server.json` (version 9.0.0) carries the `search-parameter-combination` extension, and for Observation declares exactly: `patient+category`, `patient+category+date`, `patient+category+status`, `patient+category+_lastUpdated`, `patient+code`, `patient+code+date`.

### Decision (2026-09-22): behave as a US Core client, with an adaptive fallback

1. __A pinned data file of US Core required combinations__, derived from that published CapabilityStatement and committed — not fetched at runtime, so a sync has no dependency on hl7.org and the rule cannot change under us. Where a type's required combination is `patient+category`, the fetch expands into one search per category instead of one `patient=` search.
2. __Category values come from the standard too__: the `observation-category` codes US Core uses — `laboratory`, `vital-signs`, `social-history`, `survey`, `exam`, `imaging`, `therapy`, `activity`, `procedure`.
3. __Adaptive fallback for servers outside US Core__: a plain search refused with `400` and `code: required` is split and retried once, and the outcome is remembered for that source, so the wasted request happens at most once per source per type.
4. __One type, one line in the job__: categories page independently and merge through the existing writer — the `(type, id)` key keeps a record arriving twice idempotent — but the job summary and the `sync:` line report the type once, with its total.

__Why this shape.__ No vendor list to maintain: Epic, Cerner and athenahealth are covered by one rule because they all certify to US Core. It is defensible — the spec artifact is the reason we query that way. And it composes with Gap 3 rather than competing with it: `/metadata` says which types and parameters a server supports, US Core says which combinations are required, and neither substitutes for the other.

__Deliberately not decided yet:__ whether to use `patient+code` for types where category fits poorly. Nothing needs it today.

__Issue:__ [#754](https://github.com/jwilleke/yourphr/issues/754).

## Gap 2 — the record-type list comes from requested scopes

__What happens now.__ `CatalogManager.connect` builds the source's types from `resourceTypesFromScopes(entry.scopes)` — the scopes typed into the __catalog entry__, i.e. what was asked for, with a wildcard mapping to a fixed list of 11 types. So we ask for types a server will not give (today's live run: `MedicationStatement` 403, because Epic grants by app registration and ignores the request), and we never ask for types it would give but our wildcard list omits (CarePlan, Goal, Device, CareTeam). The second is silent.

__This is discoverable, and the standard obliges the server to tell us.__ SMART App Launch makes `scope` a __required__ field of the access token response — *"Scope of access authorized. Note that this can be different from the scopes requested by the app."* `src/smart/index.ts:214` already parses it into `TokenResponse.scope`; `AuthorizationResult` then drops it, which is why `connect` falls back to the requested scopes. The looseness is ours, not the specification's.

__What is published where, checked 2026-09-22:__

| Question | Published in | Reliable |
|---|---|---|
| Which scopes may I request? | `.well-known/smart-configuration` → `scopes_supported` | __No__ — Epic lists only `fhirUser, launch, openid, profile`; its `capabilities` confirm `permission-patient` and `permission-v2` but enumerate nothing |
| What was I granted? | the token response `scope` | __Yes__ — required by SMART |
| Which types does this server have, searchable how? | `/metadata` | __Yes__ — Epic publishes 60 resources with full parameter lists |
| Which parameter combinations are required? | US Core's published CapabilityStatement | __Yes__, and __not__ in the server's own metadata |

### Decision (2026-09-22): types come from granted scopes ∩ advertised resources

1. Carry `scope` from the token response through `AuthorizationResult` and store the __granted__ scopes on the source; re-derive them on refresh, since a re-consent can change the grant.
2. Build the type list from granted scopes intersected with what `/metadata` advertises (Gap 3). The hard-coded 11-type wildcard list goes away.
3. Requested scopes remain only as the fallback for a server that omits `scope` — non-conformant, but not a reason to fail.
4. A difference between requested and granted is reported __once__, so "Epic did not grant MedicationStatement" is visible instead of recurring as a 403 every cycle.

__Unverified:__ that Epic populates `scope` in practice, rather than merely being obliged to. Check it during implementation, not before.

__Issue:__ none yet.

## Gap 3 — no CapabilityStatement reading

__What `/metadata` is.__ Every FHIR server publishes a menu at `<base>/metadata`, a CapabilityStatement: which record types it holds, and for each, which searches it accepts. Epic's, fetched 2026-09-22 with __no token at all__, is 95 KB and declares 60 resources — for Observation it lists `patient`, `category`, `code`, `date` and 25 more parameters.

__What we do instead today.__ Nothing reads it. A hard-coded list of 11 types is asked of every provider in the same shape. So we ask for types a server does not serve (today's `MedicationStatement` 403) and never ask for types it does serve but the list omits (CarePlan, Goal, CareTeam) — the second is silent, which is the worse half. v2 read the menu and searched a type only where the server advertised a patient-style parameter for it; v3 dropped that.

__What it buys, and what it does not.__ It buys the type list and the search shape (whether a type takes `patient` or only `subject`). It does __not__ buy required combinations — Epic's carries none, which is Gap 1's subject. The two are complementary and neither substitutes for the other.

### Decision (2026-09-22): read at connect, store it, narrow with it

1. __Read `/metadata` at connect__, right after the token exchange — send the token, fall back to unauthenticated, since servers generally serve it openly (Epic does).
2. __Store it with the source__ and __re-read weekly__, so a provider that gains a resource type is noticed without waiting for a reconnect.
3. __When it cannot be read__ — transient failure, a gateway serving HTML, a size or time limit, or a wrong tenant-specific base URL, __not__ a permissions problem — fall back to the __granted scopes alone__, say so in the job and the log ("could not read the provider's capability statement; using granted scopes only"), and try again next sync. This is better than v2's fallback of a fixed 20-type list, which could ask for types the server never had.
4. __Narrow only.__ The menu prunes the type list; it never adds a type the grant did not cover. A type the menu says is not searchable by patient is skipped silently, rather than recording the same refusal every cycle.

__Issue:__ none yet.

## Gap 4 — extracting `@jwilleke/fhir-sources`

Named 2026-09-22: __`@jwilleke/fhir-sources`__. `fhir-sources` over `ehr-sources` because CMS Blue Button is a payer rather than an EHR, and "source" is already this product's word; over `*-connector` because that term is overloaded elsewhere.

__What it holds — two data files, split by WHY the knowledge exists.__ One file keyed by vendor would rot, which is the maintenance burden fasten-sources carries.

- __`fhir-sources/us-core-search.json`__ — standard-derived, not vendor-keyed: the required search combinations and the category codes, with the US Core version they came from recorded. Epic, Cerner and athenahealth all fall under it; copying it per vendor would mean three places to fix when US Core moves.
- __`fhir-sources/source-quirks.json`__ — genuinely per-platform, and __starts empty__. The name is deliberately unflattering: nobody dumps configuration into a file called quirks, whereas `source-config.json` would hold endpoints and timeouts within a year.

__The rule at the top of the quirks file.__ An entry is allowed only when the behaviour is (a) not discoverable from `/metadata`, (b) not implied by US Core, and (c) has been observed against a real server, with the date and what was seen. As of today no entry is needed: the category rule belongs to US Core and the grant comes from the token response.

__What does NOT belong in either file__, because it already lives somewhere: endpoints, client id, client secret, scopes and environment (the provider catalog entry, per instance — your Epic entry's client secret is not mine); which types a server has and how they can be searched (`/metadata`); what this connection was granted (the token response).

### Decision (2026-09-22): build it in-repo behind a package seam; do NOT extract yet

__Not a package today.__ One consumer, and `source-quirks.json` is empty. Publishing, versioning and a second repo to keep green buy tidiness and nothing else right now. It is built as __`src/sources/`__ with the package boundary observed, so the later lift is mechanical rather than a rewrite.

__The seam, stated so it survives.__

| Lives in `src/sources/` (the future package) | Stays outside it |
|---|---|
| The SMART flow: discovery, PKCE, authorize, exchange, refresh (today `src/smart`) | `SourcesManager` — ownership, jobs, events, what counts as a failure |
| Fetch and paging, including the same-origin `next` check (the fetch half of `src/sync`) | The records door and the writer — __PHI never enters the package__; it yields resources, YourPHR stores them |
| The query plan: US Core combinations, category expansion, `/metadata` reading | The provider catalog: endpoints, client ids, secrets, consent policy — per instance, not per vendor |
| `us-core-search.json`, `source-quirks.json` | The relay, which belongs to the deployment, not to a source |

__Two rules that make extraction mechanical later:__ it takes a __guarded fetch as an argument__ (never its own HTTP, or `check-http-boundary.sh` breaks), and it has __one entry point__, so nothing reaches inside it.

__The trigger to extract__, when one of these becomes true: a second consumer needs it (the ts-spike, or another app); someone outside wants the vendor knowledge; or `source-quirks.json` starts collecting real entries.

## Gap 5 — `$everything` where advertised

__Decision:__ not yet discussed.

## Gap 6 — page budget and retry

__Decision:__ not yet discussed.

## What has already been settled

- __Not a FHIR client library.__ `fhir-kit-client`, `fhirclient` and `@medplum/core`'s client speak the protocol; none of them knows that Epic needs `category`. The missing layer is per-source knowledge, not REST plumbing — and a library doing its own fetching would breach the SSRF boundary. The hand-written fetch in `src/sync` (paging, same-origin `next` check) stays.
- __Not an aggregator.__ Metriport, Flexpa, 1up and Particle solve this by holding the vendor knowledge themselves, as a service. That contradicts the product's self-hosted premise.
- __fasten-sources is the closest open-source precedent__ — per-platform clients over a shared base, which is what v2 used and what v2.10.3 still carries in `backend/pkg/sources`. It is Go, so v3 cannot import it; its *shape* is the reference, not the dependency.
