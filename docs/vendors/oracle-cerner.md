# Oracle Health (Cerner) — patient access integration guide

A field guide to connecting a **patient-access SMART-on-FHIR app** to **Oracle Health / Cerner Millennium**, written from a working YourPHR integration ([#338](https://github.com/jwilleke/yourphr/issues/338)). It covers app registration, the connection challenges we hit and how we solved them, Cerner's conformance/scope quirks, and the shape of the data you actually get back.

> **Difficulty: high.** Cerner is the most involved of the major patient-access platforms we've integrated — appreciably harder than Epic or CMS Blue Button. The auth flow has a non-obvious endpoint trap, the scope handling is strict and version-sensitive, and the sandbox is slow and flaky. Budget real time. None of it is impossible; all of it is documented below.

## At a glance — the working configuration

The values that took the longest to find. YourPHR's catalog seed (`SandboxProviderSeeds()`) already encodes all of this; substitute your own `client_id`/tenant.

| Field | Value |
|---|---|
| FHIR base / `aud` | `https://fhir-ehr.cerner.com/r4/{tenant}` |
| Authorize endpoint | `https://authorization.cerner.com/tenants/{tenant}/protocols/oauth2/profiles/smart-v1/personas/patient/authorize` — **pinned override, NOT discoverable** (see Challenge 1) |
| Token endpoint | `https://authorization.cerner.com/tenants/{tenant}/hosts/fhir-ehr.cerner.com/protocols/oauth2/profiles/smart-v1/token` — taken from discovery, works as-is |
| Client type | **Public** (PKCE `S256`, no secret) |
| Scopes | **SMART v2 `.rs`, enumerated per resource** — NOT v1 `.read`, NOT the `*.rs` wildcard (see Challenge 3) |
| App access type | **Offline** — required for a refresh token (see Challenge 4) |
| Sandbox tenant | `ec2458f2-1e24-41c8-b71b-0e701af7583d` (the public Cerner sandbox tenant) |
| Sandbox test patient | `nancysmart` / `Cerner01` |

## Part 1 — Register the app

Register at the developer **code Console**: <https://code-console.cerner.com/>. A free **CernerCare** account is created on first use; the console issues your `client_id` (you do not supply one). No client secret — register as a **Public (PKCE)** client. Keep all credential values in a gitignored store (`private/secrets.md`), never in committed docs.

### App settings

| Setting | Value | Notes |
|---|---|---|
| App Name | YourPHR | |
| App Type | **Patient** | not Provider — see Challenge 1 |
| Type of Access | **Offline** | **required** — "Online" yields no refresh token (Challenge 4) |
| SMART Version | SMART v2 | request `.rs` scopes, not `.read` (Challenge 3) |
| Client Type | **Public (PKCE)** | no secret |
| FHIR Spec | R4 | |
| SMART Launch URI | *(blank)* | standalone, not EHR launch |
| Redirect URI | your relay/callback URL (e.g. `https://relay.nerdsbythehour.com/callback`) | must match exactly |
| Resource access / scopes | enumerate each patient resource you want (`Patient`, `Condition`, `Observation`, …) | NOT a wildcard (Challenge 3) |
| Terms / Privacy URLs | `https://yourphr.org/terms`, `https://yourphr.org/privacy` | |

On **Register**, save the `client_id` and Application ID.

### Two registration traps

1. **The "Organization (Client Number)" prompt.** CernerCare *account* creation asks for an Organization (Client Number) that must match a real Cerner customer org — this ties your account to a client and is **not** part of app registration. If a portal asks for an "Oracle CID" just to register an app, you are on the **wrong portal** (Oracle's enterprise console); the developer code Console issues the `client_id` itself.
2. **Subscribe to the FHIR R4 API product.** After registering, the app's FHIR Version may show `-` and FHIR calls fail until you **subscribe the app to "Oracle Health FHIR APIs for Millennium: FHIR R4, All."** That subscription grants R4 access.

## Part 2 — The connection challenges

Four distinct obstacles, in the order you'll hit them. Each is *symptom → cause → fix*.

### Challenge 1 — the patient authorize endpoint is not discoverable

**Symptom:** Following `.well-known/smart-configuration` for the FHIR base lands you on a **provider**-persona authorize endpoint, which rejects a patient app with `client-persona-mismatch`.

**Cause:** Cerner splits authorization by *persona* (patient vs provider) **and** by host, and the two don't line up in discovery:

- `fhir-ehr.cerner.com` (the host that knows the sandbox tenant) advertises `authorization.cerner.com/…/personas/**provider**/authorize`.
- `fhir-myrecord.sandboxcerner.com` (the patient-looking host) advertises `authorization.sandboxcerner.com/…/personas/**patient**/authorize` — but **that authz server returns `unknown-tenant`** for the sandbox tenant (a bogus `client_id` gets the same error, proving it's tenant-level, not app-level).

The working patient endpoint exists only by **hand-combining** "tenant-aware authz host (`authorization.cerner.com`) + patient persona path" — a URL **no discovery document publishes**.

**Fix:** Pin the patient authorize endpoint explicitly instead of trusting discovery. YourPHR adds an optional per-catalog-entry `AuthorizeUrlOverride`; the token endpoint is host-based (not persona-split) and is still taken from discovery.

### Challenge 2 — the app is SMART v2, but only smart-v1 endpoints exist

**Symptom:** Constructing the obvious `…/profiles/smart-v2/…` authorize/token URLs returns **404**.

**Cause:** Cerner registers the app as SMART **v2**, but the sandbox exposes **only `smart-v1` endpoints** — every published endpoint (`authorization_endpoint`, `token_endpoint`, `revocation_endpoint`) is `…/profiles/smart-v1/…`; there is no `smart-v2` URL anywhere. A v2-registered app authorizes and exchanges tokens fine on the **v1** endpoints. Don't confuse this *endpoint-profile* version with the *scope-grammar* version below — they are independent (the discovery doc advertises both `permission-v1` and `permission-v2` capabilities, which is about scope syntax, not endpoints).

**Fix:** Use the `smart-v1` endpoints (as in the config table). No v2 endpoint to target.

### Challenge 3 — scopes: `.read` is silently dropped, and the wildcard doesn't work

This is the one that produces a successful connect with **zero data**, so it's the most deceptive.

**Symptom:** Connect succeeds, token issues, but **nothing imports** — every FHIR fetch returns `403 insufficient_scope` (`no_scope_for_resource_path`). Inspecting the granted token shows only `fhirUser launch/patient openid` — all clinical read scopes were dropped.

**Cause, two parts:**

1. **`.read` vs `.rs`.** The app is SMART v2, and Cerner **silently drops** SMART v1 `.read` scopes for a v2 client. You must request **v2 `.rs`** (read+search) scope syntax (`patient/Observation.rs`, not `patient/Observation.read`).
2. **No wildcards.** Cerner drops the `patient/*.rs` wildcard **whole** (same as it drops `*.read`), leaving no read scopes. You must **enumerate every resource** (`patient/Patient.rs patient/Condition.rs patient/Observation.rs …`). Specific `.rs` scopes are granted per resource; resources you don't list return `403 insufficient_scope` and are simply skipped.

**Fix:** Request enumerated v2 `.rs` scopes. **Verified:** with specific `.rs`, `GET /Patient/{id}` and `/Observation?patient=` / `/Condition?patient=` return 200; with `.read` or the `*` wildcard, reads 403. See [Conformance](#conformance-and-scope-notes) — this is documented Cerner behavior, not a bug.

### Challenge 4 — "Online" access type gives no refresh token, so long imports die

**Symptom:** The import starts, fetches several resource types, then **fails partway** with a 401 — and (before resilience work) discarded everything.

**Cause:** A code Console app set to **Type of Access = Online** is issued **no refresh token** (`offline_access` is dropped from the grant). Cerner access tokens are short-lived, so a large/slow patient import outlives the token and the next fetch 401s.

**Fix:** Set the code Console app to **Type of Access = Offline**. It then issues a refresh token, and the client renews it automatically mid-import.

## Conformance and scope notes

Cerner's strictness is **spec-conformant**, just less permissive than some EHRs — worth understanding so you design to it rather than fight it:

- The SMART App Launch spec **permits** broad scopes like `patient/*.read`, and many IG examples and other EHRs accept them — but the spec **does not require** a server to.
- Cerner chose **not to implement wildcard scopes**. The sandbox *and production* accept only the exact individual scopes they publish, and advertise precisely what they support in `.well-known/smart-configuration` and their docs. Unsupported scopes are returned as `invalid_scope` or silently ignored.
- Practical rule: **enumerate explicitly**, request only resources you'll use, and treat any resource you didn't scope as a graceful skip (it will 403).

The full list of scopes Cerner advertises for this tenant is captured in [`oracle-cerner.json`](./oracle-cerner.json) (`scopes_supported`).

## Reliability — expect a slow, flaky sandbox

Cerner/Oracle Health Millennium is consistently reported (open-source aggregators and commercial tools alike) as one of the **flakiest and slowest** major platforms to develop against. Epic sandboxes are markedly more consistent. What we observed, and what others report:

- **Frequent 504 Gateway Timeouts** (~57 s each — Cerner's internal timeout).
- **Inconsistent per-resource behavior** — some resources return fine; others (even small ones like CareTeam) randomly 504.
- **Sandbox-specific load issues** that don't reflect real customer instances — so this is largely a *sandbox* problem; production endpoints are expected to behave better.

YourPHR's SMART client is built to survive this ([#341](https://github.com/jwilleke/yourphr/issues/341)):

- **90 s per-request timeout** — a hung request fails fast rather than blocking the whole import.
- **Two-pass fetch** — try each resource once, then retry the transiently-failed ones in a single deferred pass at the end, so a slow resource never blocks the others.
- **Incremental upsert** — each page is stored as it arrives; a later failure keeps everything already imported.
- **Graceful skip** — a persistent failure (504, or a 403 for an unrequested scope) skips that resource, never the whole import.
- **Per-resource logging** — every resource emits a `smart sync:` line (`fetched N page(s)` / `deferred for retry (…)` / `skipped (…)`), so an import is fully explainable from the logs.

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

- **No `meta.profile` on any resource.** Nothing asserts US-Core conformance — **do not branch display logic on profile**; drive it off resource shape and fall back gracefully.
- **DocumentReferences are metadata stubs.** Every `content.attachment` is a **`Binary` URL** (`…/Binary/…`), not inline data, and the documents themselves are a **separate authenticated fetch** — so a list of 2,149 titles has nothing to open until you follow the Binary links (tracked: [#342](https://github.com/jwilleke/yourphr/issues/342)). ContentTypes: ~1622 PDF, 488 text, 25 XML, 14 HTML.
- **No discrete lab/vital values.** `Observation` wasn't in our scope set (so 403-skipped), and DiagnosticReports are document-style (`presentedForm` Binary), not discrete `result[]`. Add `patient/Observation.rs` for values (tracked: [#343](https://github.com/jwilleke/yourphr/issues/343)).
- **Human-readable text is reliably present.** `type`/`code` carry `.text` or a coding `.display` across the board — so display rarely needs code translation.
- **Mixed coding systems.** Standard (LOINC, SNOMED, RxNorm, HL7) appear alongside Cerner-proprietary systems (`fhir.cerner.com/ceuuid`, `…/codeSet/{n}`) and a `…/StructureDefinition/precision` extension. Harmless because text is present — but any code-based logic must ignore unknown systems.
- **Present-but-absent fields.** Some codes are text-only with an empty `coding[]`; `data-absent-reason` / `v3-NullFlavor` appear. Render these as "unknown," never blank.

## Reference — authorize probing matrix

Read-only probes that established the working path (a bare HTTP `200` is **not** proof of a completed login — confirm in a browser):

| Authorize combination (smart-v1) | Result |
|---|---|
| `authorization.cerner.com` + `personas/patient`, `aud=fhir-ehr.cerner.com/r4/{tenant}` | ✅ reaches the Cerner login — **the working path** |
| `authorization.cerner.com` + `personas/provider` | `client-persona-mismatch` |
| `authorization.sandboxcerner.com` + `personas/patient` | `unknown-tenant` (identical for a bogus `client_id` → tenant-level) |
| any `…/profiles/smart-v2/…` (any host/persona) | `404` — no smart-v2 endpoint exists |

## See also

- Sandbox index: [`../test-sandboxes.md`](../test-sandboxes.md)
- Cerner discovery document (scopes + endpoints): [`oracle-cerner.json`](./oracle-cerner.json)
- Oracle docs: [Build & Test SMART on FHIR Apps](https://docs.oracle.com/en/industries/health/millennium-platform-apis/build-smart-on-fhir-apps/) · [SMART App Provisioning](https://docs.oracle.com/en/industries/health/millennium-platform-apis/smart-app-provisioning/)
