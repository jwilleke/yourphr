# Oracle Health (Cerner) — patient access integration guide

A field guide to connecting a __patient-access SMART-on-FHIR app__ to __Oracle Health / Cerner Millennium__, written from a working YourPHR integration ([#338](https://github.com/jwilleke/yourphr/issues/338)). It covers app registration, the connection challenges we hit and how we solved them, Cerner's conformance/scope quirks, and the shape of the data you actually get back.

> __Difficulty: high.__ Cerner is the most involved of the major patient-access platforms we've integrated — appreciably harder than Epic or CMS Blue Button. The auth flow has a non-obvious endpoint trap, the scope handling is strict and version-sensitive, and the sandbox is slow and flaky. Budget real time. None of it is impossible; all of it is documented below.

## At a glance — the working configuration

The values that took the longest to find. YourPHR's catalog seed (`SandboxProviderSeeds()`) already encodes all of this; substitute your own `client_id`/tenant.

| Field | Value |
|---|---|
| FHIR base / `aud` | `https://fhir-ehr.cerner.com/r4/{tenant}` |
| Authorize endpoint | `https://authorization.cerner.com/tenants/{tenant}/protocols/oauth2/profiles/smart-v1/personas/patient/authorize` — __pinned override, NOT discoverable__ (see Challenge 1) |
| Token endpoint | `https://authorization.cerner.com/tenants/{tenant}/hosts/fhir-ehr.cerner.com/protocols/oauth2/profiles/smart-v1/token` — taken from discovery, works as-is |
| Client type | __Public__ (PKCE `S256`, no secret) |
| Scopes | __SMART v2 `.rs`, enumerated per resource__ — NOT v1 `.read`, NOT the `*.rs` wildcard (see Challenge 3) |
| App access type | __Offline__ — required for a refresh token (see Challenge 4) |
| Sandbox tenant | `ec2458f2-1e24-41c8-b71b-0e701af7583d` (the public Cerner sandbox tenant) |
| Sandbox test patient | `nancysmart` / `Cerner01` |

## Part 1 — Register the app

Register at the developer __code Console__: <https://code-console.cerner.com/>. A free __CernerCare__ account is created on first use; the console issues your `client_id` (you do not supply one). No client secret — register as a __Public (PKCE)__ client. Keep all credential values in a gitignored store (`private/secrets.md`), never in committed docs.

### App settings

| Setting | Value | Notes |
|---|---|---|
| App Name | YourPHR | |
| App Type | __Patient__ | not Provider — see Challenge 1 |
| Type of Access | __Offline__ | __required__ — "Online" yields no refresh token (Challenge 4) |
| SMART Version | SMART v2 | request `.rs` scopes, not `.read` (Challenge 3) |
| Client Type | __Public (PKCE)__ | no secret |
| FHIR Spec | R4 | |
| SMART Launch URI | *(blank)* | standalone, not EHR launch |
| Redirect URI | your relay/callback URL (e.g. `https://relay.nerdsbythehour.com/callback`) | must match exactly |
| Resource access / scopes | enumerate each patient resource you want (`Patient`, `Condition`, `Observation`, …) | NOT a wildcard (Challenge 3) |
| Terms / Privacy URLs | `https://yourphr.org/terms`, `https://yourphr.org/privacy` | |

On __Register__, save the `client_id` and Application ID.

### Two registration traps

1. __The "Organization (Client Number)" prompt.__ CernerCare *account* creation asks for an Organization (Client Number) that must match a real Cerner customer org — this ties your account to a client and is __not__ part of app registration. If a portal asks for an "Oracle CID" just to register an app, you are on the __wrong portal__ (Oracle's enterprise console); the developer code Console issues the `client_id` itself.
2. __Subscribe to the FHIR R4 API product.__ After registering, the app's FHIR Version may show `-` and FHIR calls fail until you __subscribe the app to "Oracle Health FHIR APIs for Millennium: FHIR R4, All."__ That subscription grants R4 access.

## Part 2 — The connection challenges

Four distinct obstacles, in the order you'll hit them. Each is *symptom → cause → fix*.

### Challenge 1 — the patient authorize endpoint is not discoverable

__Symptom:__ Following `.well-known/smart-configuration` for the FHIR base lands you on a __provider__-persona authorize endpoint, which rejects a patient app with `client-persona-mismatch`.

__Cause:__ Cerner splits authorization by *persona* (patient vs provider) __and__ by host, and the two don't line up in discovery:

- `fhir-ehr.cerner.com` (the host that knows the sandbox tenant) advertises `authorization.cerner.com/…/personas/**provider**/authorize`.
- `fhir-myrecord.sandboxcerner.com` (the patient-looking host) advertises `authorization.sandboxcerner.com/…/personas/**patient**/authorize` — but __that authz server returns `unknown-tenant`__ for the sandbox tenant (a bogus `client_id` gets the same error, proving it's tenant-level, not app-level).

The working patient endpoint exists only by __hand-combining__ "tenant-aware authz host (`authorization.cerner.com`) + patient persona path" — a URL __no discovery document publishes__.

__Fix:__ Pin the patient authorize endpoint explicitly instead of trusting discovery. YourPHR adds an optional per-catalog-entry `AuthorizeUrlOverride`; the token endpoint is host-based (not persona-split) and is still taken from discovery.

### Challenge 2 — the app is SMART v2, but only smart-v1 endpoints exist

__Symptom:__ Constructing the obvious `…/profiles/smart-v2/…` authorize/token URLs returns __404__.

__Cause:__ Cerner registers the app as SMART __v2__, but the sandbox exposes __only `smart-v1` endpoints__ — every published endpoint (`authorization_endpoint`, `token_endpoint`, `revocation_endpoint`) is `…/profiles/smart-v1/…`; there is no `smart-v2` URL anywhere. A v2-registered app authorizes and exchanges tokens fine on the __v1__ endpoints. Don't confuse this *endpoint-profile* version with the *scope-grammar* version below — they are independent (the discovery doc advertises both `permission-v1` and `permission-v2` capabilities, which is about scope syntax, not endpoints).

__Fix:__ Use the `smart-v1` endpoints (as in the config table). No v2 endpoint to target.

### Challenge 3 — scopes: `.read` is silently dropped, and the wildcard doesn't work

This is the one that produces a successful connect with __zero data__, so it's the most deceptive.

__Symptom:__ Connect succeeds, token issues, but __nothing imports__ — every FHIR fetch returns `403 insufficient_scope` (`no_scope_for_resource_path`). Inspecting the granted token shows only `fhirUser launch/patient openid` — all clinical read scopes were dropped.

__Cause, two parts:__

1. __`.read` vs `.rs`.__ The app is SMART v2, and Cerner __silently drops__ SMART v1 `.read` scopes for a v2 client. You must request __v2 `.rs`__ (read+search) scope syntax (`patient/Observation.rs`, not `patient/Observation.read`).
2. __No wildcards.__ Cerner drops the `patient/*.rs` wildcard __whole__ (same as it drops `*.read`), leaving no read scopes. You must __enumerate every resource__ (`patient/Patient.rs patient/Condition.rs patient/Observation.rs …`). Specific `.rs` scopes are granted per resource; resources you don't list return `403 insufficient_scope` and are simply skipped.

__Fix:__ Request enumerated v2 `.rs` scopes. __Verified:__ with specific `.rs`, `GET /Patient/{id}` and `/Observation?patient=` / `/Condition?patient=` return 200; with `.read` or the `*` wildcard, reads 403. See [Conformance](#conformance-and-scope-notes) — this is documented Cerner behavior, not a bug.

### Challenge 4 — "Online" access type gives no refresh token, so long imports die

__Symptom:__ The import starts, fetches several resource types, then __fails partway__ with a 401 — and (before resilience work) discarded everything.

__Cause:__ A code Console app set to __Type of Access = Online__ is issued __no refresh token__ (`offline_access` is dropped from the grant). Cerner access tokens are short-lived, so a large/slow patient import outlives the token and the next fetch 401s.

__Fix:__ Set the code Console app to __Type of Access = Offline__. It then issues a refresh token, and the client renews it automatically mid-import.

## Conformance and scope notes

Cerner's strictness is __spec-conformant__, just less permissive than some EHRs — worth understanding so you design to it rather than fight it:

- The SMART App Launch spec __permits__ broad scopes like `patient/*.read`, and many IG examples and other EHRs accept them — but the spec __does not require__ a server to.
- Cerner chose __not to implement wildcard scopes__. The sandbox *and production* accept only the exact individual scopes they publish, and advertise precisely what they support in `.well-known/smart-configuration` and their docs. Unsupported scopes are returned as `invalid_scope` or silently ignored.
- Practical rule: __enumerate explicitly__, request only resources you'll use, and treat any resource you didn't scope as a graceful skip (it will 403).

The full list of scopes Cerner advertises for this tenant is captured in [`oracle-cerner.json`](./oracle-cerner.json) (`scopes_supported`).

## Reliability — expect a slow, flaky sandbox

Cerner/Oracle Health Millennium is consistently reported (open-source aggregators and commercial tools alike) as one of the __flakiest and slowest__ major platforms to develop against. Epic sandboxes are markedly more consistent. What we observed, and what others report:

- __Frequent 504 Gateway Timeouts__ (~57 s each — Cerner's internal timeout).
- __Inconsistent per-resource behavior__ — some resources return fine; others (even small ones like CareTeam) randomly 504.
- __Sandbox-specific load issues__ that don't reflect real customer instances — so this is largely a *sandbox* problem; production endpoints are expected to behave better.

YourPHR's SMART client is built to survive this ([#341](https://github.com/jwilleke/yourphr/issues/341)):

- __90 s per-request timeout__ — a hung request fails fast rather than blocking the whole import.
- __Two-pass fetch__ — try each resource once, then retry the transiently-failed ones in a single deferred pass at the end, so a slow resource never blocks the others.
- __Incremental upsert__ — each page is stored as it arrives; a later failure keeps everything already imported.
- __Graceful skip__ — a persistent failure (504, or a 403 for an unrequested scope) skips that resource, never the whole import.
- __Per-resource logging__ — every resource emits a `smart sync:` line (`fetched N page(s)` / `deferred for retry (…)` / `skipped (…)` / `truncated after N page(s)`), so an import is fully explainable from the logs.
- __Patient first + per-type page caps ([#439](https://github.com/jwilleke/yourphr/issues/439))__ — `Patient/{id}` is always fetched before other types; a fat type (e.g. DocumentReference) soft-truncates at __250 pages__ and the plan continues; a global __5000-page__ budget only stops remaining types (soft), never fails the job solely for page limits.

### Live failure — global 1000-page cap aborts remaining types (__2026-07-31__; fixed in client)

Tracked: __[#439](https://github.com/jwilleke/yourphr/issues/439)__.

On production (`yourphr.nerdsbythehour.com`), sandbox patient connect ran __~1 h 48 min__ (13:56:33–15:44:11 UTC), imported large __Condition__ + __DocumentReference__ sets (DocRef alone __967 pages__), then hit the SMART client's __then-global__ `maxFetchPages = 1000` mid-__Encounter__:

```text
smart sync: DocumentReference fetched 967 page(s)
smart sync: Encounter skipped (aborting capability fetch: exceeded 1000 pages)
fetching 9697 document attachment(s) as Binary resources  →  nearly all 403 insufficient_scope
```

__Effect (pre-fix):__ types after the abort (including __Patient__ when capability order put it late) never ran. No `Patient/{oauth-patient-id}` was stored → UI __500 / no resource found__ → “Oracle Failed” despite thousands of clinical rows already imported.

| Date | Host | Result |
|---|---|---|
| __2026-06-18__ (matrix) | production | ✅ works — imports records (pinned authorize + enumerated v2 `.rs` + Offline) |
| __2026-07-31__ | production sandbox | ⛔ long import then __page-cap abort__; missing Patient → UI Failed |
| __2026-08-01__ | production UI recheck | still 500 on Oracle Patient for the broken source (until re-sync on fixed client) |
| __Fix (#439 quick hit)__ | SMART client | ✅ Patient always first; per-type truncate (250) + soft global budget (5000); page limits no longer abort the plan as a hard error |

__Operator note:__ Existing broken Oracle sources need a __re-sync / reconnect__ after deploy so Patient is fetched. Huge DocumentReference sets may still take a long wall clock but should leave the source usable; docs may be partial when truncated.

## Data shape — what you actually get back

From a real sandbox import (test patient `nancysmart`, 2,299 resources). Useful for setting expectations and planning the display layer:

| Resource | Count | Notes |
|---|---|---|
| DocumentReference | 2149 | metadata only — see below |
| AllergyIntolerance | 120 | |
| DiagnosticReport | 15 | mostly document-style, not discrete results |
| CarePlan | 14 | includes full `text.div` narrative |
| Device | 1 | |

Key quirks for a patient-facing display:

- __No `meta.profile` on any resource.__ Nothing asserts US-Core conformance — __do not branch display logic on profile__; drive it off resource shape and fall back gracefully.
- __DocumentReferences are metadata stubs.__ Every `content.attachment` is a __`Binary` URL__ (`…/Binary/…`), not inline data, and the documents themselves are a __separate authenticated fetch__ — so a list of 2,149 titles has nothing to open until you follow the Binary links (tracked: [#342](https://github.com/jwilleke/yourphr/issues/342)). ContentTypes: ~1622 PDF, 488 text, 25 XML, 14 HTML.
- __No discrete lab/vital values.__ `Observation` wasn't in our scope set (so 403-skipped), and DiagnosticReports are document-style (`presentedForm` Binary), not discrete `result[]`. Add `patient/Observation.rs` for values (tracked: [#343](https://github.com/jwilleke/yourphr/issues/343)).
- __Human-readable text is reliably present.__ `type`/`code` carry `.text` or a coding `.display` across the board — so display rarely needs code translation.
- __Mixed coding systems.__ Standard (LOINC, SNOMED, RxNorm, HL7) appear alongside Cerner-proprietary systems (`fhir.cerner.com/ceuuid`, `…/codeSet/{n}`) and a `…/StructureDefinition/precision` extension. Harmless because text is present — but any code-based logic must ignore unknown systems.
- __Present-but-absent fields.__ Some codes are text-only with an empty `coding[]`; `data-absent-reason` / `v3-NullFlavor` appear. Render these as "unknown," never blank.

## Reference — authorize probing matrix

Read-only probes that established the working path (a bare HTTP `200` is __not__ proof of a completed login — confirm in a browser):

| Authorize combination (smart-v1) | Result |
|---|---|
| `authorization.cerner.com` + `personas/patient`, `aud=fhir-ehr.cerner.com/r4/{tenant}` | ✅ reaches the Cerner login — __the working path__ |
| `authorization.cerner.com` + `personas/provider` | `client-persona-mismatch` |
| `authorization.sandboxcerner.com` + `personas/patient` | `unknown-tenant` (identical for a bogus `client_id` → tenant-level) |
| any `…/profiles/smart-v2/…` (any host/persona) | `404` — no smart-v2 endpoint exists |

## See also

- Sandbox index: [`../testing-sandboxes/test-sandboxes.md`](../testing-sandboxes/test-sandboxes.md)
- Cerner discovery document (scopes + endpoints): [`oracle-cerner.json`](./oracle-cerner.json)
- Open: page-cap abort / missing Patient UI fail — [#439](https://github.com/jwilleke/yourphr/issues/439)
- Resilience / long-import survival — [#341](https://github.com/jwilleke/yourphr/issues/341); Binary attachments — [#342](https://github.com/jwilleke/yourphr/issues/342)
- Oracle docs: [Build & Test SMART on FHIR Apps](https://docs.oracle.com/en/industries/health/millennium-platform-apis/build-smart-on-fhir-apps/) · [SMART App Provisioning](https://docs.oracle.com/en/industries/health/millennium-platform-apis/smart-app-provisioning/)
