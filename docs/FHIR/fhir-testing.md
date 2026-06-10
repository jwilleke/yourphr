# SMART on FHIR — Testing Guide

How to test the "Connect a SMART source" flow in YourPHR, and — most importantly —
**which environments are test vs. real**.

## TL;DR — everything below is TEST data

| Environment | What it is | Real patient data (PHI)? |
|---|---|---|
| **SMART Health IT sandbox** (`launch.smarthealthit.org`) | Public demo FHIR server, fake test patients | **No** |
| **Veradigm Test organizations** (`…/fhirroute/open/…Test`) | Veradigm test endpoints, fake patients | **No** |
| **Veradigm Production** | Real provider, real patients | **Yes — and not enabled.** Requires Veradigm to explicitly grant production access (a request with a ~10-day review). |

By default a registered Veradigm app is **"Test Only."** You cannot reach real patient
data until Veradigm grants production. So all routine testing touches **zero PHI**.

## What the connect flow does

```
[Add-source form] → POST /api/secure/source/authorize   (backend: SMART discovery + builds the PKCE authorize URL)
        → popup opens the provider login
        → provider redirects to the RELAY: https://relay.nerdsbythehour.com/callback   (stores {state → code}, ~60s)
        → POST /api/secure/source/connect   (backend polls the relay for the code, exchanges it for tokens)
        → GET {fhir}/Patient/$everything   → records imported + displayed
```

The browser never handles tokens; the relay never sees tokens (it only bounces the short-lived
`code`). See [`../planning/smart-on-fhir/oauth-gateway.md`](../planning/smart-on-fhir/oauth-gateway.md).

## Option A — SMART Health IT sandbox (fastest; no registration)

Use this to confirm the YourPHR pipeline works. No account, no credentials, fake patients.

In **Medical Sources → Connect a SMART source (beta)**:

| Field | Value |
|---|---|
| **FHIR base URL** | `https://launch.smarthealthit.org/v/r4/sim/eyJsYXVuY2hfdHlwZSI6InBhdGllbnQtc3RhbmRhbG9uZSJ9/fhir` |
| **Client ID** | anything, e.g. `my-client-id` (the open sandbox ignores it) |
| **Scopes** | leave the prefilled value |

Connect → a login/patient-picker popup → pick any test patient → records import.

> ⚠️ **Why the long `/sim/…/` URL?** The SMART Health IT launcher encodes the launch mode in
> its base-URL path. The plain `https://launch.smarthealthit.org/v/r4/fhir` returns
> `invalid_request — Invalid launch options: Unexpected end of JSON input`. The `/sim/<base64>/`
> segment above is base64url of `{"launch_type":"patient-standalone"}`. **Real providers do NOT
> need this** — it is purely a quirk of this test launcher.

## Option B — Veradigm / FollowMyHealth (test)

This exercises the real target's auth server (still test data).

**1. Register the app** at `developer.veradigm.com` (My Dashboard → Register FHIR application):

| Field | Value |
|---|---|
| App Type | **Patient** |
| Client Type | **Public Client** (PKCE — no secret) |
| App Type (platform) | **Web App** |
| Redirect URI | `https://relay.nerdsbythehour.com/callback` (must match exactly) |
| JWKS URI | leave blank (only for confidential/system apps) |
| Scopes | `launch/patient openid fhirUser offline_access patient/*.read` |

> ⚠️ **Do not mix SMART v1 (`.read`) and v2 (`.rs`) scopes** — Veradigm rejects the app. We use **v1**.
>
> ⚠️ **`patient/*.read` wildcard:** FollowMyHealth's `scopes_supported` lists *individual* resource
> scopes, **not** the wildcard. The authorize step accepts the wildcard, but if login/consent
> rejects it or returns no data, use the explicit scope list below. Also note their identity scope
> is advertised lowercase as **`fhiruser`** (not `fhirUser`).

**2. Find the FHIR base URL (`FhirURL`).** In the endpoint directory
(`https://open.platform.veradigm.com/fhirendpoints`) or your app's Test-org list, each org's
endpoint has this shape:

```
https://fhir.fhirpoint.open.allscripts.com/fhirroute/open/{OrganizationID}
```

Pick a **Test** org you're authorized for (names ending `Test`/`TEST`). No `/sim/` — that was
only the SMART Health IT sandbox.

**3. Connect** with that `FhirURL`, your **Client ID** (the GUID from registration), and the
test-patient credentials Veradigm lists for that org.

**Production** (real patients) requires the explicit Veradigm grant — request it from the portal
only once test works; reviews take ~10 days.

### Verified — FollowMyHealth Test org `76308` (2026-06-05)

Automated pre-flight against `https://fhir.fhirpoint.open.allscripts.com/fhirroute/open/76308`
(a FollowMyHealth org) passed every step our code controls, up to the interactive login:

- `.well-known/smart-configuration` → **200**; `authorization_endpoint` =
  `https://open.allscripts.com/fhirroute/fmhpatientauth/fmhorgid/<guid>/connect/authorize`,
  `token_endpoint` = `https://muauthentication.followmyhealth.com/api/access`, PKCE `S256`.
- Authorize request (our Client ID + `redirect_uri=…/callback` + PKCE) → **302 to the
  FollowMyHealth login** — i.e. the Client ID is recognized and the redirect URI is accepted.
- Remaining step is interactive: a FollowMyHealth **test-patient login** → relay `/callback` →
  backend token exchange → `$everything` import. (Cannot be automated headlessly.)

### Explicit scopes (FollowMyHealth) — fallback if `patient/*.read` is rejected

Built from this org's advertised `scopes_supported` (read-only; their `DocumentReference.write` omitted).
Paste into the **Scopes** field:

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
| Token exchange fails with `client authentication required` (or similar) | FollowMyHealth's discovery advertises `token_endpoint_auth_methods` of only `client_secret_post`/`client_secret_basic` (not `none`), yet its `capabilities` include `client-public`. The **authorize** step accepts our public/PKCE client, so PKCE-public *should* be fine for the token exchange too — but if the token call is rejected for missing client auth, this is the cause. Revisit then (e.g. confirm FMH's public-client handling, or register a confidential client + secret). **Not a blocker for the authorize flow.** |

## Reference

- **Relay:** `https://relay.nerdsbythehour.com` — `/callback` (open), `/pending` (shared-secret gated), `/healthz`, `/metrics` (in-cluster). Issue #50.
- **Backend endpoints:** `POST /api/secure/source/authorize`, `POST /api/secure/source/connect`. Issue #51.
- **Frontend:** Medical Sources → "Connect a SMART source (beta)". Issue #52.
- **Config (env):** `YOURPHR_RELAY_URL` (default `https://relay.nerdsbythehour.com`), `YOURPHR_RELAY_SECRET` (shared with the relay).
- **Design:** [`../planning/smart-on-fhir/smart-on-fhir.md`](../planning/smart-on-fhir/smart-on-fhir.md), [`../planning/smart-on-fhir/oauth-gateway.md`](../planning/smart-on-fhir/oauth-gateway.md).
- **Epic:** #20. Veradigm integration: #53.

## Issues

Known issues found during live SMART connect testing (2026-06-05).

### 1. Backend must poll the relay over the in-cluster Service — FIXED

**Symptom:** `POST /api/secure/source/connect` always 502'd; app logs showed
`relay: request failed: Get "https://relay.nerdsbythehour.com/pending?state=…": context deadline exceeded`
and `relay: timed out waiting for authorization code`. The relay *did* store the code
(`relay: stored authorization code for state=…`), but the backend never retrieved it.
**Cause:** the backend (in-cluster) was polling the relay's **public** Cloudflare URL, which
hairpins out to Cloudflare and back through the tunnel and times out.
**Fix:** set `YOURPHR_RELAY_URL=http://yourphr-relay.yourphr.svc.cluster.local:8080` on the app
Deployment so it polls the relay pod directly (mj-infra-flux#109). The provider `redirect_uri`
stays the public `/callback`; only the backend *poll* moves in-cluster.

### 2. Veradigm `unauthorized_client` on the patient flow — BLOCKED ON VERADIGM

**Symptom:** after a successful login, Veradigm's Professional-EHR auth server returns
`unauthorized_client` (its own error page, with a Request Id; never reaches our relay). Seen
across multiple valid orgs (A02Test, 10028917), which proves it's **app-level**, not a URL/org issue.
**Cause:** the registered Test app (`1C6F1F13-…`) isn't authorized to run the patient
`authorization_code` flow — a Veradigm provisioning gate. Possibly also a public-vs-confidential
client requirement (their discovery advertises only `client_secret_*` token auth).
**Status:** Veradigm support ticket **#17849** (channel: `VeradigmConnect@veradigm.com`). Error-page Request Ids:
`400039ba-0001-cf00-b63f-84710c7967bb` (A02Test) and `40001cf7-0001-7100-b63f-84710c7967bb` (10028917).
**Not a YourPHR bug** — the authorize request is well-formed and reaches Veradigm.

#### Steps to reproduce (for the Veradigm support ticket)

Registered app (developer.veradigm.com → My Dashboard): Client ID `1C6F1F13-…` (full GUID), App Type **Patient**, Client Type **Public Client (PKCE, no secret)**, platform **Web App**, Redirect URI `https://relay.nerdsbythehour.com/callback`, Scopes `launch/patient openid fhirUser offline_access patient/*.read` (SMART v1), **Test** access. Test orgs: `A02Test` and `10028917` (reproduces on both).

1. **Discover** — `GET https://fhir.fhirpoint.open.allscripts.com/fhirroute/open/{OrgID}/.well-known/smart-configuration` → HTTP 200; `authorization_endpoint = https://open.allscripts.com/fhirroute/fmhpatientauth/fmhorgid/{guid}/connect/authorize`, `token_endpoint = https://muauthentication.followmyhealth.com/api/access`, `code_challenge_methods_supported` includes `S256`.
2. **Authorize** — open the `authorization_endpoint` with `response_type=code`, `client_id={our GUID}`, `redirect_uri=https://relay.nerdsbythehour.com/callback`, `scope=launch/patient openid fhirUser offline_access patient/*.read`, `state={random}`, `aud={FHIR base}`, `code_challenge={S256}`, `code_challenge_method=S256`. → **302 to the FollowMyHealth login** (Client ID recognized, redirect URI accepted).
3. **Log in** as the Veradigm-provided **test patient** for the org and complete consent → login **succeeds**.
4. **Observe** — immediately after login, the auth server renders its own **`unauthorized_client`** error page (with a Request Id); the browser is **never** redirected back to `redirect_uri`, so no `code` is issued.

**Expected:** after login/consent → redirect to `redirect_uri` with `?code=…&state=…`.
**Actual:** `unauthorized_client` error page; no redirect, no code.

Questions for Veradigm: (a) does this app need authorization in the **License Management Portal** (or a **Partner Request**) for the patient `authorization_code` flow? (b) the org's discovery advertises `token_endpoint_auth_methods_supported = ["client_secret_post","client_secret_basic"]` (no `none`) — does a public PKCE client need converting to a **confidential client (client_secret)** for this flow?

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
