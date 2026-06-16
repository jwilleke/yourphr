# Test sandboxes & servers

_Last updated: 2026-06-15._

Every FHIR sandbox / test server YourPHR can connect to, in one place — with the **exact** connect values, quirks, and current status. All of these serve **synthetic data (zero real PHI)**.

> **Test-data hygiene.** Synthetic sandbox data must never commingle with real records. Connect sandboxes under a **dedicated test login** (or a throwaway instance), and delete the source when you're done.
>
> **How the connect flow works** (same for all SMART sandboxes): the connect form → `/api/secure/source/authorize` (SMART discovery + PKCE URL) → provider login popup → the **relay** catches the redirect → `/api/secure/source/connect` (token exchange) → records import. Full walkthrough: [`FHIR/fhir-testing.md`](FHIR/fhir-testing.md).

## At a glance

| Sandbox | Client | Registration | Bulk fetch | Status | Deep-dive |
|---|---|---|---|---|---|
| **SMART Health IT** | public (no secret) | **none** | `$everything` | 📄 documented, not yet run live | [`vendors/smart-health-it.md`](vendors/smart-health-it.md) |
| **CMS Blue Button 2.0** | **confidential** (secret) | sandbox app | per-resource (no `$everything`) | ✅ **verified working** (2026-06-14) | [`medicare-bluebutton.md`](medicare-bluebutton.md) |
| **Epic** | public (PKCE) | BYO `client_id` | `$everything` | 🧪 used earlier | [`vendors/epic-sandbox.md`](vendors/epic-sandbox.md) |
| **Veradigm / FollowMyHealth (test)** | public (PKCE) | Veradigm app | per-resource | ⛔ **blocked** (`unauthorized_client`, ticket #17849) | [`FHIR/fhir-testing.md`](FHIR/fhir-testing.md) |
| **Oracle Health (Cerner)** | public (PKCE) | code Console app (issues client_id) | `$everything` | 🟡 registered; ready to connect | [`vendors/oracle-cerner.md`](vendors/oracle-cerner.md) |
| **athenahealth** | **confidential** (secret) | Developer Portal app (gated) | per-resource | 🟡 registered; creds obtained | [`vendors/athenahealth.md`](vendors/athenahealth.md) |
| **Raw FHIR servers** (HAPI, etc.) | — (no SMART login) | none | — | reference only (no connect flow) | this doc |

**Status legend:** 🟢 connected / verified · 🟡 partially tested · 🔴 not started · ⛔ blocked · 📄 documented only. Each sandbox below carries its own **Status / Credentials / Tracking issue / Next** block — keep it updated as we make progress, and file a tracking issue per sandbox when we start one.

**Recommended first test:** **SMART Health IT** — zero setup, public client, returns `patient` in the token, supports `$everything`. It's the clean happy-path smoke test (the opposite of Blue Button's quirks).

---

## 1. SMART Health IT sandbox — easiest, no registration

- **Status:** 📄 Documented — not yet run live
- **Credentials:** ✅ **none needed** — open sandbox accepts any `client_id`, no secret, no account
- **Tracking issue:** _none yet_
- **Next:** run a connect as the happy-path smoke test

Public demo FHIR server with fake patients. No account, no credentials.

| Field | Value |
|---|---|
| **FHIR base URL** | `https://launch.smarthealthit.org/v/r4/sim/eyJsYXVuY2hfdHlwZSI6InBhdGllbnQtc3RhbmRhbG9uZSJ9/fhir` |
| **Client ID** | anything (e.g. `my-client-id`) — the open sandbox ignores it |
| **Client Secret** | _(blank — public client)_ |
| **Scopes** | leave the prefilled default (`launch/patient patient/*.read openid fhirUser offline_access`) |

Connect → login/patient-picker popup → pick any test patient → records import.

> ⚠️ **The long `/sim/…/fhir` path is required.** The plain `https://launch.smarthealthit.org/v/r4/fhir` returns `invalid_request — Invalid launch options`. The `/sim/<base64>/` segment is base64url of `{"launch_type":"patient-standalone"}`. Real providers never need this — it's purely a quirk of this launcher.

**✅ Discovery pre-flight (2026-06-15, no relay needed):** `…/fhir/.well-known/smart-configuration` → **200**, PKCE `S256`, capabilities include `launch-standalone` + `client-public` + `context-standalone-patient`, and `scopes_supported` includes the `patient/*.*` wildcard. Fully ready to connect.

## 2. CMS Blue Button 2.0 — Medicare claims ✅ verified

- **Status:** 🟢 Verified working (2026-06-14, sandbox)
- **Credentials:** ✅ **have** sandbox `client_id` + `client_secret` (registered sandbox app) and the public synthetic login `BBUser00000` / `PW00000!`. ❌ Production credentials (real claims) not yet requested. → values in `private/secrets.md`.
- **Tracking issue:** [#293](https://github.com/jwilleke/yourphr/issues/293) (patient-id), [#250](https://github.com/jwilleke/yourphr/issues/250) (capability fetch), [#286](https://github.com/jwilleke/yourphr/issues/286) (confidential client)
- **Next:** request CMS production credentials; build the display classifiers [#294](https://github.com/jwilleke/yourphr/issues/294)–[#296](https://github.com/jwilleke/yourphr/issues/296)

Synthetic Medicare beneficiaries; **claims/insurance** data (ExplanationOfBenefit, Coverage, Patient). This is the one we drove to working end-to-end on 2026-06-14.

| Field | Value |
|---|---|
| **FHIR base URL** | `https://sandbox.bluebutton.cms.gov/v2/fhir` (the admin-only **Sandbox testing** page at `/sandbox` has a **"Use Blue Button Sandbox"** button that prefills this + the scopes below) |
| **Client ID** | your **Sandbox** `client_id` (register an app at `bluebutton.cms.gov/developers`) |
| **Client Secret** | your **Sandbox** `client_secret` — Blue Button is a **confidential** client (paste it into the Client Secret field; the prefill leaves it blank) |
| **Scopes** | `openid profile launch/patient patient/Patient.read patient/Coverage.read patient/ExplanationOfBenefit.read` |
| **Login (synthetic beneficiary)** | `BBUser00000` / `PW00000!` (range `BBUser00000`–`BBUser29999`, password `PW<digits>!`) |

Blue Button quirks (all handled in code now): **no wildcard / `fhirUser` / `offline_access`** scopes (→ `invalid_scope`); the **initial token omits `patient`** so the id is read from Coverage/EOB ([#293](https://github.com/jwilleke/yourphr/issues/293)); `GET /Patient` returns **401** unless the app collects demographic data; no `$everything` (per-resource fetch, [#250](https://github.com/jwilleke/yourphr/issues/250)). **Full guide + troubleshooting: [`medicare-bluebutton.md`](medicare-bluebutton.md).**

## 3. Epic sandbox — synthetic clinical data

- **Status:** 🟡 Exercised earlier — re-verify on the current build
- **Credentials:** ❓ needs a **registered Epic `client_id`** (public/PKCE, no secret) from `fhir.epic.com` — confirm whether one already exists; record in `private/secrets.md`
- **Tracking issue:** _none yet_ (relates to [#52](https://github.com/jwilleke/yourphr/issues/52))
- **Next:** confirm/register an Epic client_id, then re-run a connect

Standard SMART-on-FHIR; bring your own `client_id` (register a free patient-facing app at `fhir.epic.com`).

| Field | Value |
|---|---|
| **FHIR base URL** | `https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4` |
| **Client ID** | your registered Epic `client_id` (the admin-only **Sandbox testing** page at `/sandbox` has a **"Use Epic Sandbox"** button that prefills the URL + scopes) |
| **Client Secret** | _(blank — public/PKCE)_ |
| **Scopes** | `launch/patient patient/*.read openid fhirUser offline_access` |

Epic supports the wildcard, `fhirUser`, `offline_access`, and `$everything`. Test patients (e.g. Camila Lopez) — see Epic's docs. **Setup guide: [`vendors/epic-sandbox.md`](vendors/epic-sandbox.md).**

**✅ Discovery pre-flight (2026-06-15, no relay needed):** `…/FHIR/R4/.well-known/smart-configuration` → **200**, PKCE `S256`, capabilities include `launch-standalone` + `client-public` + `context-standalone-patient` + `permission-offline`. Epic's `scopes_supported` lists only a few entries (it doesn't advertise the full resource-scope set — normal for Epic; `patient/*.read` still works).

## 4. Veradigm / FollowMyHealth (test) — ⛔ blocked

- **Status:** ⛔ Blocked — discovery + authorize work, but login returns `unauthorized_client`
- **Credentials:** ✅ **have** a registered `client_id` GUID (public PKCE, no secret) + Veradigm test-patient logins (in `private/secrets.md`). ❌ Blocked on Veradigm provisioning (support ticket #17849).
- **Tracking issue:** [#53](https://github.com/jwilleke/yourphr/issues/53)
- **Next:** Veradigm support resolution (ticket #17849)

The near-term primary target ([#53](https://github.com/jwilleke/yourphr/issues/53)). Register a **Patient / Public (PKCE)** app at `developer.veradigm.com`; connect to a **Test** org endpoint.

| Field | Value |
|---|---|
| **FHIR base URL** | `https://fhir.fhirpoint.open.allscripts.com/fhirroute/open/{OrganizationID}` (Test orgs, e.g. `76308`, `A02Test`, `10028917`) |
| **Client ID** | your registration GUID |
| **Client Secret** | _(blank — public PKCE)_ |
| **Scopes** | SMART **v1** only (`.read`, not `.rs`); identity scope is lowercase **`fhiruser`**. Use the explicit read-scope list in [`FHIR/fhir-testing.md`](FHIR/fhir-testing.md) if the `patient/*.read` wildcard is rejected. |

**Status:** discovery + authorize work (Client ID recognized, redirect accepted), but after login Veradigm returns **`unauthorized_client`** — an app-level provisioning gate, **not a YourPHR bug**. Veradigm support ticket **#17849**. Don't mix v1/v2 scopes (rejects the app). **Details + reproduction: [`FHIR/fhir-testing.md`](FHIR/fhir-testing.md), [`vendors/followmyhealth.md`](vendors/followmyhealth.md).**

## 5. Oracle Health (Cerner) — Millennium sandbox

- **Status:** 🟡 Registered — app created + `client_id` obtained 2026-06-15; **ready to connect** (not yet run).
- **Credentials:** ✅ **have** the CernerCare account + the registered app's **Application ID** and **`client_id`** (public/PKCE) — values in `private/secrets.md`. The code Console _issued_ the client_id; no "Oracle CID" was supplied (the org/Client-Number prompts were from the CernerCare profile, not app registration).
- **Tracking issue:** _none yet_
- **Next:** in code Console, **subscribe the app to the "Oracle Health FHIR APIs for Millennium: FHIR R4, All" API product** (grants R4 — fixes the FHIR Version `-`), then connect in YourPHR with the sandbox base URL below + the `client_id` from `private/secrets.md`.

Cerner Millennium's public sandbox; YourPHR connects as a **patient-access** SMART app.

| Field | Value |
|---|---|
| **FHIR base URL** | sandbox pattern `https://fhir-myrecord.sandboxcerner.com/r4/{tenant}` (patient access). Provider/EHR-launch is `fhir-ehr.sandboxcerner.com`; an **open / no-auth** POC endpoint is `fhir-open.sandboxcerner.com`. The common public sandbox tenant is `ec2458f2-1e24-41c8-b71b-0e701af7583d` — **confirm the exact Service Root URL in code Console.** |
| **Client ID** | register a SMART app in the **Oracle Health code Console** (needs a free CernerCare account) |
| **Client Secret** | _(blank — public/PKCE for patient apps)_ |
| **Scopes** | standard SMART patient scopes; supports `$everything` |

**Registered app (code Console, 2026-06-15)** — the non-secret config we enter; the issued `client_id` goes in `private/secrets.md`:

| Setting | Value |
|---|---|
| **App Type** | Patient |
| **Client Type** | Public (PKCE — no secret) |
| **FHIR Spec** | R4 |
| **API product** | subscribe the app to **"Oracle Health FHIR APIs for Millennium: FHIR R4, All"** — required to grant R4 access (otherwise the app's FHIR Version shows `-` and FHIR calls fail) |
| **SMART Launch URI** | _(blank — standalone / patient launch, not EHR launch)_ |
| **Redirect URI** | `https://relay.nerdsbythehour.com/callback` |
| **Scopes** | `launch/patient openid fhirUser offline_access patient/*.read` |
| **Terms of Use URL** | `https://yourphr.org/terms` |
| **Privacy Policy URL** | `https://yourphr.org/privacy` |
| **App Name** | YourPHR |
| **Description** | Patient-facing personal health record viewer; imports your records via SMART on FHIR |
| **Support / contact** | `https://yourphr.org` (or operator email) |

Pick a test patient in the sandbox to drive the flow. Registration + exact endpoints: [Oracle Health — Build & Test SMART on FHIR Apps](https://docs.oracle.com/en/industries/health/millennium-platform-apis/build-smart-on-fhir-apps/) and [SMART App Provisioning](https://docs.oracle.com/en/industries/health/millennium-platform-apis/smart-app-provisioning/).

**Discovery URL:** `https://fhir-myrecord.sandboxcerner.com/r4/ec2458f2-1e24-41c8-b71b-0e701af7583d/.well-known/smart-configuration`

**✅ Discovery pre-flight (2026-06-15, no relay needed)** — verified with a plain GET:

```bash
curl -s "https://fhir-myrecord.sandboxcerner.com/r4/ec2458f2-1e24-41c8-b71b-0e701af7583d/.well-known/smart-configuration" | python3 -m json.tool
```

→ **200**, **patient-persona** authorize endpoint, PKCE `S256`, scopes include `launch/patient openid fhirUser offline_access profile`. Confirms the base URL above. `capabilities` include **`launch-standalone`** + `context-standalone-patient` + `client-public` + `permission-offline` + `permission-v1`/`v2` — i.e. YourPHR's standalone-patient, public-PKCE, offline flow is fully supported. (`launch-ehr` is also listed — that's the _provider_ EHR-launch mode YourPHR doesn't use; its presence is harmless.) The `fhir-ehr` host returns the **provider** persona — don't use it for YourPHR; `fhir-open` has no SMART config (404). Remaining blockers to a full connect are external: the **relay** must be online (catches the redirect) and the app must be **subscribed to the FHIR R4 API product**.

## 6. athenahealth — Developer Portal

- **Status:** 🟡 Registered — `client_id` + `client_secret` obtained 2026-06-15 (in `private/secrets.md`); still need the site-specific FHIR base URL (+ any approval) before connecting.
- **Credentials:** ✅ **have** `client_id` + `client_secret` (confidential / Web app) in `private/secrets.md`. App-creation choices: API Access = **Certified APIs ONLY**, App Category = **3-Legged OAuth for Patients**, Application Type = **Web**, Auth = **Secret** (see [`vendors/athenahealth.md`](vendors/athenahealth.md)). ❌ still need the **site-specific FHIR base URL** from the portal.
- **Tracking issue:** _none yet_
- **Next:** apply for athenahealth Developer Portal access

athenahealth's FHIR R4 (athenaPractice / athenaFlow). More involved than the public sandboxes — registration is **gated behind approval**, and base URLs are **site/practice-specific**.

| Field | Value |
|---|---|
| **FHIR base URL** | **site-specific** — get the exact base from the athenahealth Developer Portal ([base-FHIR-URLs guide](https://docs.athenahealth.com/api/guides/base-fhir-urls)). Patient-data (mydata) APIs live under `mydata.athenahealth.com`. |
| **Client ID / Secret** | register an app in the **[athenahealth Developer Portal](https://docs.athenahealth.com/api/guides/overview)** (registration + approval required) |
| **Sample patient** | sandbox sample login `athenainterop@aol.com` |
| **Scopes** | standard SMART patient scopes (confirm from the org's discovery doc) |

Because base URLs are site-specific and access is approval-gated, treat this as a **later** target — verify against the portal before connecting; don't hard-code a URL.

## 7. Raw FHIR servers & manual upload (no SMART login)

For inspecting FHIR data / testing the import models directly — **not** the connect flow (no OAuth):

- **HAPI FHIR public test server** — `https://hapi.fhir.org/baseR4` — open, no auth, anyone-can-read/write; good for poking at FHIR shapes.
- **Logica Health sandbox** — `https://api.logicahealth.org` — SMART-capable, registration required.

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

## Automated tests (Playwright)

`frontend/e2e/sandbox-connect.spec.ts` exercises the connect flow for every sandbox in this doc:

- **CI-safe (default, in `make test-e2e`):** the backend is mocked — no external network, no real credentials. It asserts the connect **form builds the correct `/source/authorize` + `/source/connect` requests** per sandbox (FHIR base URL, scopes, and `client_secret` **only** for confidential clients like Blue Button), opens the OAuth popup synchronously, and handles success — plus a required-fields validation guard.
- **Live (opt-in):** a real end-to-end handshake against the SMART Health IT launcher, **skipped unless `E2E_LIVE=1`** and pointed at a relay-configured backend. The launcher selectors are a scaffold — confirm them on the first live run.

```bash
make test-e2e                                                  # CI-safe suite (includes the sandbox payload tests)
E2E_LIVE=1 npx playwright test sandbox-connect --grep @live    # opt-in live handshake (needs a relay-configured backend)
```

Keep the `SANDBOXES` catalog in that spec in sync with the list above whenever a sandbox is added.

## See also

- [`FHIR/fhir-testing.md`](FHIR/fhir-testing.md) — step-by-step connect + the relay/poll issues log
- [`medicare-bluebutton.md`](medicare-bluebutton.md) — the verified Blue Button walkthrough
- [`vendors/epic-sandbox.md`](vendors/epic-sandbox.md) · [`vendors/followmyhealth.md`](vendors/followmyhealth.md)
- [`planning/smart-on-fhir/smart-on-fhir.md`](planning/smart-on-fhir/smart-on-fhir.md) — the SMART design
