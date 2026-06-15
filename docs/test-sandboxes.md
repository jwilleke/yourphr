# Test sandboxes & servers

Every FHIR sandbox / test server YourPHR can connect to, in one place — with the **exact** connect values, quirks, and current status. All of these serve **synthetic data (zero real PHI)**.

> **Test-data hygiene.** Synthetic sandbox data must never commingle with real records. Connect sandboxes under a **dedicated test login** (or a throwaway instance), and delete the source when you're done.

> **How the connect flow works** (same for all SMART sandboxes): the connect form → `/api/secure/source/authorize` (SMART discovery + PKCE URL) → provider login popup → the **relay** catches the redirect → `/api/secure/source/connect` (token exchange) → records import. Full walkthrough: [`FHIR/fhir-testing.md`](FHIR/fhir-testing.md).

## At a glance

| Sandbox | Client | Registration | Bulk fetch | Status | Deep-dive |
|---|---|---|---|---|---|
| **SMART Health IT** | public (no secret) | **none** | `$everything` | 📄 documented, not yet run live | this doc |
| **CMS Blue Button 2.0** | **confidential** (secret) | sandbox app | per-resource (no `$everything`) | ✅ **verified working** (2026-06-14) | [`medicare-bluebutton.md`](medicare-bluebutton.md) |
| **Epic** | public (PKCE) | BYO `client_id` | `$everything` | 🧪 used earlier | [`vendors/epic-sandbox.md`](vendors/epic-sandbox.md) |
| **Veradigm / FollowMyHealth (test)** | public (PKCE) | Veradigm app | per-resource | ⛔ **blocked** (`unauthorized_client`, ticket #17849) | [`FHIR/fhir-testing.md`](FHIR/fhir-testing.md) |
| **Raw FHIR servers** (HAPI, etc.) | — (no SMART login) | none | — | reference only (no connect flow) | this doc |

**Recommended first test:** **SMART Health IT** — zero setup, public client, returns `patient` in the token, supports `$everything`. It's the clean happy-path smoke test (the opposite of Blue Button's quirks).

---

## 1. SMART Health IT sandbox — easiest, no registration

Public demo FHIR server with fake patients. No account, no credentials.

| Field | Value |
|---|---|
| **FHIR base URL** | `https://launch.smarthealthit.org/v/r4/sim/eyJsYXVuY2hfdHlwZSI6InBhdGllbnQtc3RhbmRhbG9uZSJ9/fhir` |
| **Client ID** | anything (e.g. `my-client-id`) — the open sandbox ignores it |
| **Client Secret** | *(blank — public client)* |
| **Scopes** | leave the prefilled default (`launch/patient patient/*.read openid fhirUser offline_access`) |

Connect → login/patient-picker popup → pick any test patient → records import.

> ⚠️ **The long `/sim/…/fhir` path is required.** The plain `https://launch.smarthealthit.org/v/r4/fhir` returns `invalid_request — Invalid launch options`. The `/sim/<base64>/` segment is base64url of `{"launch_type":"patient-standalone"}`. Real providers never need this — it's purely a quirk of this launcher.

## 2. CMS Blue Button 2.0 — Medicare claims ✅ verified

Synthetic Medicare beneficiaries; **claims/insurance** data (ExplanationOfBenefit, Coverage, Patient). This is the one we drove to working end-to-end on 2026-06-14.

| Field | Value |
|---|---|
| **FHIR base URL** | `https://sandbox.bluebutton.cms.gov/v2/fhir` |
| **Client ID** | your **Sandbox** `client_id` (register an app at `bluebutton.cms.gov/developers`) |
| **Client Secret** | your **Sandbox** `client_secret` — Blue Button is a **confidential** client |
| **Scopes** | `openid profile launch/patient patient/Patient.read patient/Coverage.read patient/ExplanationOfBenefit.read` |
| **Login (synthetic beneficiary)** | `BBUser00000` / `PW00000!` (range `BBUser00000`–`BBUser29999`, password `PW<digits>!`) |

Blue Button quirks (all handled in code now): **no wildcard / `fhirUser` / `offline_access`** scopes (→ `invalid_scope`); the **initial token omits `patient`** so the id is read from Coverage/EOB ([#293](https://github.com/jwilleke/yourphr/issues/293)); `GET /Patient` returns **401** unless the app collects demographic data; no `$everything` (per-resource fetch, [#250](https://github.com/jwilleke/yourphr/issues/250)). **Full guide + troubleshooting: [`medicare-bluebutton.md`](medicare-bluebutton.md).**

## 3. Epic sandbox — synthetic clinical data

Standard SMART-on-FHIR; bring your own `client_id` (register a free patient-facing app at `fhir.epic.com`).

| Field | Value |
|---|---|
| **FHIR base URL** | `https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4` |
| **Client ID** | your registered Epic `client_id` (the connect form's **"Use Epic Sandbox"** button prefills the URL + scopes) |
| **Client Secret** | *(blank — public/PKCE)* |
| **Scopes** | `launch/patient patient/*.read openid fhirUser offline_access` |

Epic supports the wildcard, `fhirUser`, `offline_access`, and `$everything`. Test patients (e.g. Camila Lopez) — see Epic's docs. **Setup guide: [`vendors/epic-sandbox.md`](vendors/epic-sandbox.md).**

## 4. Veradigm / FollowMyHealth (test) — ⛔ blocked

The near-term primary target ([#53](https://github.com/jwilleke/yourphr/issues/53)). Register a **Patient / Public (PKCE)** app at `developer.veradigm.com`; connect to a **Test** org endpoint.

| Field | Value |
|---|---|
| **FHIR base URL** | `https://fhir.fhirpoint.open.allscripts.com/fhirroute/open/{OrganizationID}` (Test orgs, e.g. `76308`, `A02Test`, `10028917`) |
| **Client ID** | your registration GUID |
| **Client Secret** | *(blank — public PKCE)* |
| **Scopes** | SMART **v1** only (`.read`, not `.rs`); identity scope is lowercase **`fhiruser`**. Use the explicit read-scope list in [`FHIR/fhir-testing.md`](FHIR/fhir-testing.md) if the `patient/*.read` wildcard is rejected. |

**Status:** discovery + authorize work (Client ID recognized, redirect accepted), but after login Veradigm returns **`unauthorized_client`** — an app-level provisioning gate, **not a YourPHR bug**. Veradigm support ticket **#17849**. Don't mix v1/v2 scopes (rejects the app). **Details + reproduction: [`FHIR/fhir-testing.md`](FHIR/fhir-testing.md), [`vendors/followmyhealth.md`](vendors/followmyhealth.md).**

## 5. Raw FHIR servers (no SMART login)

For inspecting FHIR data / testing the import models directly — **not** the connect flow (no OAuth):

- **HAPI FHIR public test server** — `https://hapi.fhir.org/baseR4` — open, no auth, anyone-can-read/write; good for poking at FHIR shapes.
- **Logica Health sandbox** — `https://api.logicahealth.org` — SMART-capable, registration required.
- **Cerner / Oracle Health sandbox** — open (`fhir-open`) and SMART (`fhir-ehr`) R4 endpoints; synthetic patients.

Manual **FHIR bundle / NDJSON upload** (Medical Sources → drop a file) needs none of these — it's the zero-setup import path, and synthetic fixtures live in `frontend/src/lib/fixtures/` and `backend/pkg/database/testdata/`.

---

## Pre-flight any endpoint before connecting

The backend needs `{base}/.well-known/smart-configuration` to return the authorize/token endpoints:

```bash
curl -s "{FHIR_BASE}/.well-known/smart-configuration" | python3 -m json.tool
```

Expect HTTP 200 JSON with `authorization_endpoint`, `token_endpoint`, and `code_challenge_methods_supported` (PKCE). If `.well-known` 404s, the OAuth URIs are also in `{base}/metadata` (CapabilityStatement → `rest.security.extension`).

## Relay & config

All SMART connects route the provider redirect through the **relay** (`https://relay.nerdsbythehour.com/callback`); the redirect URI you register with each provider must match it exactly. Override with `YOURPHR_RELAY_URL` (in-cluster the backend polls `http://yourphr-relay.yourphr.svc.cluster.local:8080`). See [`deployment.md`](deployment.md) and [`FHIR/fhir-testing.md`](FHIR/fhir-testing.md).

## See also

- [`FHIR/fhir-testing.md`](FHIR/fhir-testing.md) — step-by-step connect + the relay/poll issues log
- [`medicare-bluebutton.md`](medicare-bluebutton.md) — the verified Blue Button walkthrough
- [`vendors/epic-sandbox.md`](vendors/epic-sandbox.md) · [`vendors/followmyhealth.md`](vendors/followmyhealth.md)
- [`planning/smart-on-fhir/smart-on-fhir.md`](planning/smart-on-fhir/smart-on-fhir.md) — the SMART design
