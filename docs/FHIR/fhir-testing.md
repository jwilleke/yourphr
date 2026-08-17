# SMART on FHIR — Testing Guide

How to test the "Connect a SMART source" flow in YourPHR, and — most importantly —
__which environments are test vs. real__.

## TL;DR — everything below is TEST data

| Environment | What it is | Real patient data (PHI)? |
|---|---|---|
| __SMART Health IT sandbox__ (`launch.smarthealthit.org`) | Public demo FHIR server, fake test patients | __No__ |
| __Veradigm Test organizations__ (`…/fhirroute/open/…Test`) | Veradigm test endpoints, fake patients | __No__ |
| __Veradigm Production__ | Real provider, real patients | __Yes — and not enabled.__ Requires Veradigm to explicitly grant production access (a request with a ~10-day review). |

By default a registered Veradigm app is __"Test Only."__ You cannot reach real patient
data until Veradigm grants production. So all routine testing touches __zero PHI__.

## What the connect flow does

```
[Add-source form] → POST /api/secure/source/authorize   (backend: SMART discovery + builds the PKCE authorize URL)
        → popup opens the provider login
        → provider redirects to the RELAY: https://relay.nerdsbythehour.com/callback   (stores {state → code}, ~60s)
        → POST /api/secure/source/connect   (backend polls the relay for the code, exchanges it for tokens)
        → GET {fhir}/Patient/$everything   → records imported + displayed
```

The browser never handles tokens; the relay never sees tokens (it only bounces the short-lived
`code`). Full as-built map (sequence, timeouts, config, failure modes): [`../SMART-flow-map.md`](../SMART-flow-map.md). Design history: [`../planning/smart-on-fhir/oauth-gateway.md`](../planning/smart-on-fhir/oauth-gateway.md).

## Option A — SMART Health IT sandbox (fastest; no registration)

Use this to confirm the YourPHR pipeline works. No account, no credentials, fake patients.

In __Medical Sources → Connect a SMART source (beta)__:

| Field | Value |
|---|---|
| __FHIR base URL__ | `https://launch.smarthealthit.org/v/r4/sim/eyJsYXVuY2hfdHlwZSI6InBhdGllbnQtc3RhbmRhbG9uZSJ9/fhir` |
| __Client ID__ | anything, e.g. `my-client-id` (the open sandbox ignores it) |
| __Scopes__ | leave the prefilled value |

Connect → a login/patient-picker popup → pick any test patient → records import.

> ⚠️ __Why the long `/sim/…/` URL?__ The SMART Health IT launcher encodes the launch mode in
> its base-URL path. The plain `https://launch.smarthealthit.org/v/r4/fhir` returns
> `invalid_request — Invalid launch options: Unexpected end of JSON input`. The `/sim/<base64>/`
> segment above is base64url of `{"launch_type":"patient-standalone"}`. __Real providers do NOT
> need this__ — it is purely a quirk of this test launcher.

## Option B — Veradigm / FollowMyHealth (test)

This exercises the real target's auth server (still test data).

__1. Register the app__ at `developer.veradigm.com` (My Dashboard → Register FHIR application):

| Field | Value |
|---|---|
| App Type | __Patient__ |
| Client Type | __Public Client__ (PKCE — no secret) |
| App Type (platform) | __Web App__ |
| Redirect URI | `https://relay.nerdsbythehour.com/callback` (must match exactly) |
| JWKS URI | leave blank (only for confidential/system apps) |
| Scopes | `launch/patient openid fhirUser offline_access patient/*.read` |

> ⚠️ __Do not mix SMART v1 (`.read`) and v2 (`.rs`) scopes__ — Veradigm rejects the app. We use __v1__.
>
> ⚠️ __`patient/*.read` wildcard:__ FollowMyHealth's `scopes_supported` lists *individual* resource
> scopes, __not__ the wildcard. The authorize step accepts the wildcard, but if login/consent
> rejects it or returns no data, use the explicit scope list below. Also note their identity scope
> is advertised lowercase as __`fhiruser`__ (not `fhirUser`).

__2. Find the FHIR base URL (`FhirURL`).__ In the endpoint directory
(`https://open.platform.veradigm.com/fhirendpoints`) or your app's Test-org list, each org's
endpoint has this shape:

```
https://fhir.fhirpoint.open.allscripts.com/fhirroute/open/{OrganizationID}
```

Pick a __Test__ org you're authorized for (names ending `Test`/`TEST`). No `/sim/` — that was
only the SMART Health IT sandbox.

__3. Connect__ with that `FhirURL`, your __Client ID__ (the GUID from registration), and the
test-patient credentials Veradigm lists for that org.

__Production__ (real patients) requires the explicit Veradigm grant — request it from the portal
only once test works; reviews take ~10 days.

### Verified — FollowMyHealth Test org `76308` (2026-06-05)

Automated pre-flight against `https://fhir.fhirpoint.open.allscripts.com/fhirroute/open/76308`
(a FollowMyHealth org) passed every step our code controls, up to the interactive login:

- `.well-known/smart-configuration` → __200__; `authorization_endpoint` =
  `https://open.allscripts.com/fhirroute/fmhpatientauth/fmhorgid/<guid>/connect/authorize`,
  `token_endpoint` = `https://muauthentication.followmyhealth.com/api/access`, PKCE `S256`.
- Authorize request (our Client ID + `redirect_uri=…/callback` + PKCE) → __302 to the
  FollowMyHealth login__ — i.e. the Client ID is recognized and the redirect URI is accepted.
- Remaining step is interactive: a FollowMyHealth __test-patient login__ → relay `/callback` →
  backend token exchange → `$everything` import. (Cannot be automated headlessly.)

### Explicit scopes (FollowMyHealth) — fallback if `patient/*.read` is rejected

Built from this org's advertised `scopes_supported` (read-only; their `DocumentReference.write` omitted).
Paste into the __Scopes__ field:

```
launch/patient openid profile fhiruser offline_access patient/Patient.read patient/AllergyIntolerance.read patient/Binary.read patient/CarePlan.read patient/CareTeam.read patient/Composition.read patient/Condition.read patient/Coverage.read patient/Device.read patient/DiagnosticOrder.read patient/DiagnosticReport.read patient/DocumentReference.read patient/Encounter.read patient/Goal.read patient/Immunization.read patient/Location.read patient/Medication.read patient/MedicationDispense.read patient/MedicationOrder.read patient/MedicationRequest.read patient/MedicationStatement.read patient/Observation.read patient/Organization.read patient/Practitioner.read patient/PractitionerRole.read patient/Procedure.read patient/Provenance.read patient/QuestionnaireResponse.read patient/RelatedPerson.read patient/ServiceRequest.read patient/Specimen.read
```

(`fhiruser` lowercase to match their advertised value. Confirm a given org's exact
`scopes_supported` from its discovery doc — see below — since it can vary by org.)

## Pre-flight a FHIR endpoint before connecting

The backend needs `{base}/.well-known/smart-configuration` to return the authorize/token
endpoints. Check any endpoint first:

```bash
curl -s "{FHIR_BASE}/.well-known/smart-configuration" | python3 -m json.tool
```

Expect HTTP 200 JSON containing `authorization_endpoint`, `token_endpoint`, and
`code_challenge_methods_supported` (PKCE). Both the SMART Health IT sandbox and Veradigm test
endpoints serve this (verified: Veradigm returns it with FHIR `4.0.1`), so no CapabilityStatement
fallback is needed. If `.well-known` ever 404s, the OAuth URIs are also in `{base}/metadata`
(CapabilityStatement → `rest.security.extension`).

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `invalid_request — Invalid launch options: Unexpected end of JSON input` | SMART Health IT sandbox only — use the `/sim/…/fhir` base URL (Option A), not `/v/r4/fhir`. |
| Modal opens but fields are not clickable / "locked" | Fixed in PR #78 (modal z-index). Hard-refresh (⌘⇧R) to clear cached CSS/JS. |
| `FHIR base URL, Client ID and Scopes are all required` | The grey text is a *placeholder*, not a value — actually type into each box (text turns dark). |
| Veradigm app won't approve | Don't request both v1 `.read` and v2 `.rs` scopes; pick v1 only. |
| Token exchange fails / `redirect_uri` mismatch | The registered redirect URI must exactly equal `https://relay.nerdsbythehour.com/callback`. |
| Token exchange fails with `client authentication required` (or similar) | FollowMyHealth's discovery advertises `token_endpoint_auth_methods` of only `client_secret_post`/`client_secret_basic` (not `none`), yet its `capabilities` include `client-public`. The __authorize__ step accepts our public/PKCE client, so PKCE-public *should* be fine for the token exchange too — but if the token call is rejected for missing client auth, this is the cause. Revisit then (e.g. confirm FMH's public-client handling, or register a confidential client + secret). __Not a blocker for the authorize flow.__ |

## Reference

- __Relay:__ `https://relay.nerdsbythehour.com` — `/callback` (open), `/pending` (shared-secret gated), `/healthz`, `/metrics` (in-cluster). Issue #50.
- __Backend endpoints:__ `POST /api/secure/source/authorize`, `POST /api/secure/source/connect`. Issue #51.
- __Frontend:__ Medical Sources → "Connect a SMART source (beta)". Issue #52.
- __Config (env):__ `YOURPHR_RELAY_URL` (default `https://relay.nerdsbythehour.com`), `YOURPHR_RELAY_SECRET` (shared with the relay).
- __Design:__ [`../planning/smart-on-fhir/smart-on-fhir.md`](../planning/smart-on-fhir/smart-on-fhir.md), [`../planning/smart-on-fhir/oauth-gateway.md`](../planning/smart-on-fhir/oauth-gateway.md).
- __Epic:__ #20. Veradigm integration: #53.

## Issues

Known issues found during live SMART connect testing (2026-06-05).

### 1. Backend must poll the relay over the in-cluster Service — FIXED

__Symptom:__ `POST /api/secure/source/connect` always 502'd; app logs showed
`relay: request failed: Get "https://relay.nerdsbythehour.com/pending?state=…": context deadline exceeded`
and `relay: timed out waiting for authorization code`. The relay *did* store the code
(`relay: stored authorization code for state=…`), but the backend never retrieved it.
__Cause:__ the backend (in-cluster) was polling the relay's __public__ Cloudflare URL, which
hairpins out to Cloudflare and back through the tunnel and times out.
__Fix:__ set `YOURPHR_RELAY_URL=http://yourphr-relay.yourphr.svc.cluster.local:8080` on the app
Deployment so it polls the relay pod directly (mj-infra-flux#109). The provider `redirect_uri`
stays the public `/callback`; only the backend *poll* moves in-cluster.

### 2. Veradigm `unauthorized_client` on the patient flow — BLOCKED ON VERADIGM

__Symptom:__ after a successful login, Veradigm's Professional-EHR auth server returns
`unauthorized_client` (its own error page, with a Request Id; never reaches our relay). Seen
across multiple valid orgs (A02Test, 10028917), which proves it's __app-level__, not a URL/org issue.
__Cause:__ the registered Test app (`1C6F1F13-…`) isn't authorized to run the patient
`authorization_code` flow — a Veradigm provisioning gate. Possibly also a public-vs-confidential
client requirement (their discovery advertises only `client_secret_*` token auth).
__Status:__ Veradigm support ticket __#17849__ (channel: `VeradigmConnect@veradigm.com`). Error-page Request Ids:
`400039ba-0001-cf00-b63f-84710c7967bb` (A02Test) and `40001cf7-0001-7100-b63f-84710c7967bb` (10028917).
__Not a YourPHR bug__ — the authorize request is well-formed and reaches Veradigm.

#### Steps to reproduce (for the Veradigm support ticket)

Registered app (developer.veradigm.com → My Dashboard): Client ID `1C6F1F13-…` (full GUID), App Type __Patient__, Client Type __Public Client (PKCE, no secret)__, platform __Web App__, Redirect URI `https://relay.nerdsbythehour.com/callback`, Scopes `launch/patient openid fhirUser offline_access patient/*.read` (SMART v1), __Test__ access. Test orgs: `A02Test` and `10028917` (reproduces on both).

1. __Discover__ — `GET https://fhir.fhirpoint.open.allscripts.com/fhirroute/open/{OrgID}/.well-known/smart-configuration` → HTTP 200; `authorization_endpoint = https://open.allscripts.com/fhirroute/fmhpatientauth/fmhorgid/{guid}/connect/authorize`, `token_endpoint = https://muauthentication.followmyhealth.com/api/access`, `code_challenge_methods_supported` includes `S256`.
2. __Authorize__ — open the `authorization_endpoint` with `response_type=code`, `client_id={our GUID}`, `redirect_uri=https://relay.nerdsbythehour.com/callback`, `scope=launch/patient openid fhirUser offline_access patient/*.read`, `state={random}`, `aud={FHIR base}`, `code_challenge={S256}`, `code_challenge_method=S256`. → __302 to the FollowMyHealth login__ (Client ID recognized, redirect URI accepted).
3. __Log in__ as the Veradigm-provided __test patient__ for the org and complete consent → login __succeeds__.
4. __Observe__ — immediately after login, the auth server renders its own __`unauthorized_client`__ error page (with a Request Id); the browser is __never__ redirected back to `redirect_uri`, so no `code` is issued.

__Expected:__ after login/consent → redirect to `redirect_uri` with `?code=…&state=…`.
__Actual:__ `unauthorized_client` error page; no redirect, no code.

Questions for Veradigm: (a) does this app need authorization in the __License Management Portal__ (or a __Partner Request__) for the patient `authorization_code` flow? (b) the org's discovery advertises `token_endpoint_auth_methods_supported = ["client_secret_post","client_secret_basic"]` (no `none`) — does a public PKCE client need converting to a __confidential client (client_secret)__ for this flow?

### 3. Connect poll window vs slow logins — WATCH

The frontend calls `connectSource` (backend polls the relay ~30s) up to 3× (~90s total). If a
provider login takes longer than that budget, the code can arrive at the relay *after* the backend
stopped polling (code stored, never delivered). Fine for fast sandbox logins; revisit (longer
budget / lazy poll) if real-provider logins routinely exceed it.

### 4. Token-endpoint client auth (public vs confidential) — WATCH

Some Veradigm/FMH discovery docs advertise `token_endpoint_auth_methods` of only
`client_secret_post`/`client_secret_basic` (not `none`) while also listing `client-public`. If the
token exchange ever fails with "client authentication required," the provider requires a
confidential client (secret) and our public/PKCE flow needs a backend change. Not hit yet.
