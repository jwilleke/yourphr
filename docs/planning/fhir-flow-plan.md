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
| 2 | Record types come from the scopes the catalog entry __requests__, never from what the server supports or actually granted | Types are requested that a server refuses; types it offers can be missed | none yet | open |
| 3 | No CapabilityStatement (`/metadata`) reading — every provider is asked the same way; v2 did this and v3 dropped it | Each new provider is a new surprise, found in production | none yet | open |
| 4 | Vendor knowledge sits inside one class in this repo | Adding Cerner or athenahealth means editing YourPHR itself; nothing else can reuse it | none yet — `@jwilleke/fhir-sources` | open |
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

__Decision:__ not yet discussed.

## Gap 3 — no CapabilityStatement reading

__Decision:__ not yet discussed.

## Gap 4 — extracting `@jwilleke/fhir-sources`

Named 2026-09-22. `fhir-sources` over `ehr-sources` because CMS Blue Button is a payer rather than an EHR, and "source" is already this product's word; over `*-connector` because that term is overloaded elsewhere.

__Decision:__ name settled; shape and timing not yet discussed.

## Gap 5 — `$everything` where advertised

__Decision:__ not yet discussed.

## Gap 6 — page budget and retry

__Decision:__ not yet discussed.

## What has already been settled

- __Not a FHIR client library.__ `fhir-kit-client`, `fhirclient` and `@medplum/core`'s client speak the protocol; none of them knows that Epic needs `category`. The missing layer is per-source knowledge, not REST plumbing — and a library doing its own fetching would breach the SSRF boundary. The hand-written fetch in `src/sync` (paging, same-origin `next` check) stays.
- __Not an aggregator.__ Metriport, Flexpa, 1up and Particle solve this by holding the vendor knowledge themselves, as a service. That contradicts the product's self-hosted premise.
- __fasten-sources is the closest open-source precedent__ — per-platform clients over a shared base, which is what v2 used and what v2.10.3 still carries in `backend/pkg/sources`. It is Go, so v3 cannot import it; its *shape* is the reference, not the dependency.
