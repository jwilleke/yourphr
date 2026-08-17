# Test sandboxes & servers

*Last updated: 2026-06-15.*

Every FHIR sandbox / test server YourPHR can connect to, in one place — with the __exact__ connect values, quirks, and current status. All of these serve __synthetic data (zero real PHI)__.

> __Test-data hygiene.__ Synthetic sandbox data must never commingle with real records. Connect sandboxes under a __dedicated test login__ (or a throwaway instance), and delete the source when you're done.
>
> __How the connect flow works__ (same for all SMART sandboxes): the connect form → `/api/secure/source/authorize` (SMART discovery + PKCE URL) → provider login popup → the __relay__ catches the redirect → `/api/secure/source/connect` (token exchange) → records import. Full walkthrough: [`FHIR/fhir-testing.md`](../FHIR/fhir-testing.md).

## At a glance

| Sandbox | Client | Registration | Bulk fetch | Status | Deep-dive |
|---|---|---|---|---|---|
| __SMART Health IT__ | public (no secret) | __none__ | `$everything` | 📄 documented, not yet run live | [`vendors/smart-health-it.md`](../vendors/smart-health-it.md) |
| __CMS Blue Button 2.0__ | __confidential__ (secret) | sandbox app | per-resource (no `$everything`) | ✅ __verified working__ (2026-06-14) | [`medicare-bluebutton.md`](../medicare-bluebutton.md) |
| __Epic__ | public (PKCE) | BYO `client_id` | `$everything` | 🧪 used earlier | [`vendors/epic-sandbox.md`](../vendors/epic-sandbox.md) |
| __Veradigm / FollowMyHealth (test)__ | public (PKCE) | Veradigm app | per-resource | ⛔ __blocked__ (`unauthorized_client`, ticket #17849) | [`FHIR/fhir-testing.md`](../FHIR/fhir-testing.md) |
| __Oracle Health (Cerner)__ | public (PKCE) | code Console app (issues client_id) | per-resource search | ✅ __works__ — imports records (pinned patient-authorize override + enumerated v2 `.rs` + Offline app) | [`vendors/oracle-cerner.md`](../vendors/oracle-cerner.md) |
| __athenahealth__ | __confidential__ (secret) | Developer Portal app (gated) | per-resource | 🟡 registered; creds obtained | [`vendors/athenahealth.md`](../vendors/athenahealth.md) |
| __VA Clinical Health__ | TBD (likely public/PKCE) | self-serve sandbox app | TBD | 🔴 not started — [#370](https://github.com/jwilleke/yourphr/issues/370) | §7 below |
| __Raw FHIR servers__ (HAPI, etc.) | — (no SMART login) | none | — | reference only (no connect flow) | this doc |

__Status legend:__ 🟢 connected / verified · 🟡 partially tested · 🔴 not started · ⛔ blocked · 📄 documented only. Each sandbox below carries its own __Status / Credentials / Tracking issue / Next__ block — keep it updated as we make progress, and file a tracking issue per sandbox when we start one.

__Recommended first test:__ __SMART Health IT__ — zero setup, public client, returns `patient` in the token, supports `$everything`. It's the clean happy-path smoke test (the opposite of Blue Button's quirks).

---

## 1. SMART Health IT sandbox — easiest, no registration

- __Status:__ 📄 Documented — not yet run live
- __Credentials:__ ✅ __none needed__ — open sandbox accepts any `client_id`, no secret, no account
- __Tracking issue:__ *none yet*
- __Next:__ run a connect as the happy-path smoke test

Public demo FHIR server with fake patients. No account, no credentials.

| Field | Value |
|---|---|
| __FHIR base URL__ | `https://launch.smarthealthit.org/v/r4/sim/eyJsYXVuY2hfdHlwZSI6InBhdGllbnQtc3RhbmRhbG9uZSJ9/fhir` |
| __Client ID__ | anything (e.g. `my-client-id`) — the open sandbox ignores it. The admin __Sandbox testing__ page (`/sandbox`) has a __"Use SMART Health IT"__ button that prefills everything. |
| __Client Secret__ | *(blank — public client)* |
| __Scopes__ | leave the prefilled default (`launch/patient patient/*.read openid fhirUser offline_access`) |

Connect → login/patient-picker popup → pick any test patient → records import.

> ⚠️ __The long `/sim/…/fhir` path is required.__ The plain `https://launch.smarthealthit.org/v/r4/fhir` returns `invalid_request — Invalid launch options`. The `/sim/<base64>/` segment is base64url of `{"launch_type":"patient-standalone"}`. Real providers never need this — it's purely a quirk of this launcher.

__✅ Discovery pre-flight (2026-06-15, no relay needed):__ `…/fhir/.well-known/smart-configuration` → __200__, PKCE `S256`, capabilities include `launch-standalone` + `client-public` + `context-standalone-patient`, and `scopes_supported` includes the `patient/*.*` wildcard. Fully ready to connect.

## 2. CMS Blue Button 2.0 — Medicare claims ✅ verified

- __Status:__ 🟢 Verified working (2026-06-14, sandbox)
- __Credentials:__ ✅ __have__ sandbox `client_id` + `client_secret` (registered sandbox app) and the public synthetic login `BBUser00000` / `PW00000!`. ❌ Production credentials (real claims) not yet requested. → values in `private/secrets.md`.
- __Tracking issue:__ [#293](https://github.com/jwilleke/yourphr/issues/293) (patient-id), [#250](https://github.com/jwilleke/yourphr/issues/250) (capability fetch), [#286](https://github.com/jwilleke/yourphr/issues/286) (confidential client)
- __Next:__ request CMS production credentials; build the display classifiers [#294](https://github.com/jwilleke/yourphr/issues/294)–[#296](https://github.com/jwilleke/yourphr/issues/296)

Synthetic Medicare beneficiaries; __claims/insurance__ data (ExplanationOfBenefit, Coverage, Patient). This is the one we drove to working end-to-end on 2026-06-14.

| Field | Value |
|---|---|
| __FHIR base URL__ | `https://sandbox.bluebutton.cms.gov/v2/fhir` (the admin-only __Sandbox testing__ page at `/sandbox` has a __"Use Blue Button Sandbox"__ button that prefills this + the scopes below) |
| __Client ID__ | your __Sandbox__ `client_id` (register an app at `bluebutton.cms.gov/developers`) |
| __Client Secret__ | your __Sandbox__ `client_secret` — Blue Button is a __confidential__ client (paste it into the Client Secret field; the prefill leaves it blank) |
| __Scopes__ | `openid profile launch/patient patient/Patient.read patient/Coverage.read patient/ExplanationOfBenefit.read` |
| __Login (synthetic beneficiary)__ | `BBUser00000` / `PW00000!` (range `BBUser00000`–`BBUser29999`, password `PW<digits>!`) |

Blue Button quirks (all handled in code now): __no wildcard / `fhirUser` / `offline_access`__ scopes (→ `invalid_scope`); the __initial token omits `patient`__ so the id is read from Coverage/EOB ([#293](https://github.com/jwilleke/yourphr/issues/293)); `GET /Patient` returns __401__ unless the app collects demographic data; no `$everything` (per-resource fetch, [#250](https://github.com/jwilleke/yourphr/issues/250)). __Full guide + troubleshooting: [`medicare-bluebutton.md`](../medicare-bluebutton.md).__

## 3. Epic sandbox — synthetic clinical data

- __Status:__ 🟡 Exercised earlier — re-verify on the current build
- __Credentials:__ ❓ needs a __registered Epic `client_id`__ (public/PKCE, no secret) from `fhir.epic.com` — confirm whether one already exists; record in `private/secrets.md`
- __Tracking issue:__ *none yet* (relates to [#52](https://github.com/jwilleke/yourphr/issues/52))
- __Next:__ confirm/register an Epic client_id, then re-run a connect

Standard SMART-on-FHIR; bring your own `client_id` (register a free patient-facing app at `fhir.epic.com`).

| Field | Value |
|---|---|
| __FHIR base URL__ | `https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4` |
| __Client ID__ | your registered Epic `client_id` (the admin-only __Sandbox testing__ page at `/sandbox` has a __"Use Epic Sandbox"__ button that prefills the URL + scopes) |
| __Client Secret__ | *(blank — public/PKCE)* |
| __Scopes__ | `launch/patient patient/*.read openid fhirUser offline_access` |

Epic supports the wildcard, `fhirUser`, `offline_access`, and `$everything`. Test patients (e.g. Camila Lopez) — see Epic's docs. __Setup guide: [`vendors/epic-sandbox.md`](../vendors/epic-sandbox.md).__

__✅ Discovery pre-flight (2026-06-15, no relay needed):__ `…/FHIR/R4/.well-known/smart-configuration` → __200__, PKCE `S256`, capabilities include `launch-standalone` + `client-public` + `context-standalone-patient` + `permission-offline`. Epic's `scopes_supported` lists only a few entries (it doesn't advertise the full resource-scope set — normal for Epic; `patient/*.read` still works).

## 4. Veradigm / FollowMyHealth (test) — ⛔ blocked

- __Status:__ ⛔ Blocked — discovery + authorize work, but login returns `unauthorized_client`
- __Credentials:__ ✅ __have__ a registered `client_id` GUID (public PKCE, no secret) + Veradigm test-patient logins (in `private/secrets.md`). ❌ Blocked on Veradigm provisioning (support ticket #17849).
- __Tracking issue:__ [#53](https://github.com/jwilleke/yourphr/issues/53)
- __Next:__ Veradigm support resolution (ticket #17849)

The near-term primary target ([#53](https://github.com/jwilleke/yourphr/issues/53)). Register a __Patient / Public (PKCE)__ app at `developer.veradigm.com`; connect to a __Test__ org endpoint.

| Field | Value |
|---|---|
| __FHIR base URL__ | `https://fhir.fhirpoint.open.allscripts.com/fhirroute/open/{OrganizationID}` (Test orgs, e.g. `76308`, `A02Test`, `10028917`) |
| __Client ID__ | your registration GUID |
| __Client Secret__ | *(blank — public PKCE)* |
| __Scopes__ | SMART __v1__ only (`.read`, not `.rs`); identity scope is lowercase __`fhiruser`__. Use the explicit read-scope list in [`FHIR/fhir-testing.md`](../FHIR/fhir-testing.md) if the `patient/*.read` wildcard is rejected. |

__Status:__ discovery + authorize work (Client ID recognized, redirect accepted), but after login Veradigm returns __`unauthorized_client`__ — an app-level provisioning gate, __not a YourPHR bug__. Veradigm support ticket __#17849__. Don't mix v1/v2 scopes (rejects the app). __Details + reproduction: [`FHIR/fhir-testing.md`](../FHIR/fhir-testing.md), [`vendors/followmyhealth.md`](../vendors/followmyhealth.md).__

## 5. Oracle Health (Cerner) — Millennium sandbox

- __Status:__ ✅ __Works__ — connects and imports records ([#338](https://github.com/jwilleke/yourphr/issues/338), verified 2026-06-20). The hardest sandbox; see the full guide below.
- __Credentials:__ CernerCare account + the registered app's __Application ID__ and __`client_id`__ (public/PKCE) in `private/secrets.md`. The code Console *issued* the client_id; no "Oracle CID" was supplied.
- __The four obstacles (all solved):__ (1) patient authorize endpoint is __not discoverable__ → pinned per-entry override; (2) app is SMART v2 but only __smart-v1__ endpoints exist; (3) scopes must be __enumerated v2 `.rs`__ (Cerner drops `.read` and the wildcard); (4) app must be __Offline__ for a refresh token. __Full writeup, registration steps, conformance + data-shape notes: [`vendors/oracle-cerner.md`](../vendors/oracle-cerner.md).__

Cerner Millennium's public sandbox; YourPHR connects as a __patient-access__ SMART app.

| Field | Value |
|---|---|
| __FHIR base URL__ | __`https://fhir-ehr.cerner.com/r4/{tenant}`__ (the tenant-aware host) — NOT `fhir-myrecord.sandboxcerner.com` (its authz returns `unknown-tenant`). The public sandbox tenant is `ec2458f2-1e24-41c8-b71b-0e701af7583d`. See the guide for the authorize-endpoint override. |
| __Client ID__ | register a SMART app in the __Oracle Health code Console__ (needs a free CernerCare account). The admin __Sandbox testing__ page (`/sandbox`) has a __"Use Oracle (Cerner)"__ button that prefills the base + scopes. |
| __Client Secret__ | *(blank — public/PKCE for patient apps)* |
| __Scopes__ | enumerated v2 `patient/<Resource>.rs` (NOT `.read`, NOT a wildcard — see guide) |

__Registered app (code Console, 2026-06-15)__ — the non-secret config we enter; the issued `client_id` goes in `private/secrets.md`:

| Setting | Value |
|---|---|
| __App Type__ | Patient |
| __Client Type__ | Public (PKCE — no secret) |
| __FHIR Spec__ | R4 |
| __API product__ | subscribe the app to __"Oracle Health FHIR APIs for Millennium: FHIR R4, All"__ — required to grant R4 access (otherwise the app's FHIR Version shows `-` and FHIR calls fail) |
| __SMART Launch URI__ | *(blank — standalone / patient launch, not EHR launch)* |
| __Redirect URI__ | `https://relay.nerdsbythehour.com/callback` |
| __Scopes__ | `launch/patient openid fhirUser offline_access patient/*.read` |
| __Terms of Use URL__ | `https://yourphr.org/terms` |
| __Privacy Policy URL__ | `https://yourphr.org/privacy` |
| __App Name__ | YourPHR |
| __Description__ | Patient-facing personal health record viewer; imports your records via SMART on FHIR |
| __Support / contact__ | `https://yourphr.org` (or operator email) |

Pick a test patient in the sandbox to drive the flow. Registration + exact endpoints: [Oracle Health — Build & Test SMART on FHIR Apps](https://docs.oracle.com/en/industries/health/millennium-platform-apis/build-smart-on-fhir-apps/) and [SMART App Provisioning](https://docs.oracle.com/en/industries/health/millennium-platform-apis/smart-app-provisioning/).

__Discovery URL:__ `https://fhir-myrecord.sandboxcerner.com/r4/ec2458f2-1e24-41c8-b71b-0e701af7583d/.well-known/smart-configuration`

__✅ Discovery pre-flight (2026-06-15, no relay needed)__ — verified with a plain GET:

```bash
curl -s "https://fhir-myrecord.sandboxcerner.com/r4/ec2458f2-1e24-41c8-b71b-0e701af7583d/.well-known/smart-configuration" | python3 -m json.tool
```

→ __200__, __patient-persona__ authorize endpoint, PKCE `S256`, scopes include `launch/patient openid fhirUser offline_access profile`. Confirms the base URL above. `capabilities` include __`launch-standalone`__ + `context-standalone-patient` + `client-public` + `permission-offline` + `permission-v1`/`v2` — i.e. YourPHR's standalone-patient, public-PKCE, offline flow is fully supported. (`launch-ehr` is also listed — that's the *provider* EHR-launch mode YourPHR doesn't use; its presence is harmless.) The `fhir-ehr` host returns the __provider__ persona — don't use it for YourPHR; `fhir-open` has no SMART config (404). Remaining blockers to a full connect are external: the __relay__ must be online (catches the redirect) and the app must be __subscribed to the FHIR R4 API product__.

## 6. athenahealth — Developer Portal

- __Status:__ 🟡 Registered — `client_id` + `client_secret` obtained 2026-06-15 (in `private/secrets.md`); still need the site-specific FHIR base URL (+ any approval) before connecting.
- __Credentials:__ ✅ __have__ `client_id` + `client_secret` (confidential / Web app) in `private/secrets.md`. App-creation choices: API Access = __Certified APIs ONLY__, App Category = __3-Legged OAuth for Patients__, Application Type = __Web__, Auth = __Secret__ (see [`vendors/athenahealth.md`](../vendors/athenahealth.md)). ❌ still need the __site-specific FHIR base URL__ from the portal.
- __Tracking issue:__ *none yet*
- __Next:__ apply for athenahealth Developer Portal access

athenahealth's FHIR R4 (athenaPractice / athenaFlow). More involved than the public sandboxes — registration is __gated behind approval__, and base URLs are __site/practice-specific__.

| Field | Value |
|---|---|
| __FHIR base URL__ | __site-specific__ — get the exact base from the athenahealth Developer Portal ([base-FHIR-URLs guide](https://docs.athenahealth.com/api/guides/base-fhir-urls)). Patient-data (mydata) APIs live under `mydata.athenahealth.com`. The admin __Sandbox testing__ page (`/sandbox`) has a __"Use athenahealth"__ button that prefills scopes only — paste this base URL by hand (it is deliberately not hard-coded). |
| __Client ID / Secret__ | register an app in the __[athenahealth Developer Portal](https://docs.athenahealth.com/api/guides/overview)__ (registration + approval required) |
| __Sample patient__ | sandbox sample login `athenainterop@aol.com` |
| __Scopes__ | standard SMART patient scopes (confirm from the org's discovery doc) |

Because base URLs are site-specific and access is approval-gated, treat this as a __later__ target — verify against the portal before connecting; don't hard-code a URL.

## 7. VA Clinical Health (FHIR) — candidate (not started)

- __Status:__ 🔴 Not started — tracking [#370](https://github.com/jwilleke/yourphr/issues/370).
- __What:__ VA Lighthouse __Clinical Health API__ — FHIR R4, US-Core-aligned, SMART-on-FHIR, with a self-service sandbox of __synthetic__ test patients over a real EHR (VistA + Oracle/Cerner). <https://developer.va.gov/explore/api/clinical-health>
- __Why:__ veterans mission; a __self-serve__ sandbox (like Blue Button) → a candidate to prove a first end-to-end provider sync *without* the vendor-app-approval wall (vs Veradigm / athenahealth). Also yields a VA-shaped fixture for the test-data corpus ([`testing-and-data.md`](testing-and-data.md)).
- __Verify first:__ sandbox onboarding (self-serve key vs approval), client type (public/PKCE vs confidential), resource types exposed, and downloadable test bundles vs API-only.
- __Next:__ register a sandbox `client_id`; connect via the BYO-`client_id` SMART flow; verify a synthetic-patient sync end-to-end; capture a fixture slice. See [#370](https://github.com/jwilleke/yourphr/issues/370).

## 8. Raw FHIR servers & manual upload (no SMART login)

For inspecting FHIR data / testing the import models directly — __not__ the connect flow (no OAuth):

- __HAPI FHIR public test server__ — `https://hapi.fhir.org/baseR4` — open, no auth, anyone-can-read/write; good for poking at FHIR shapes.
- __Logica Health sandbox__ — `https://api.logicahealth.org` — SMART-capable, registration required.

Manual __FHIR bundle / NDJSON upload__ (Medical Sources → drop a file) needs none of these — it's the zero-setup import path, and synthetic fixtures live in `frontend/src/lib/fixtures/` and `backend/pkg/database/testdata/`.

---

## Pre-flight any endpoint before connecting

The backend needs `{base}/.well-known/smart-configuration` to return the authorize/token endpoints:

```bash
curl -s "{FHIR_BASE}/.well-known/smart-configuration" | python3 -m json.tool
```

Expect HTTP 200 JSON with `authorization_endpoint`, `token_endpoint`, and `code_challenge_methods_supported` (PKCE). If `.well-known` 404s, the OAuth URIs are also in `{base}/metadata` (CapabilityStatement → `rest.security.extension`).

## Relay & config

All SMART connects route the provider redirect through the __relay__; the redirect URI you register with each provider must match the relay callback exactly. Two settings, because the backend and the provider reach the relay differently ([#399](https://github.com/jwilleke/yourphr/issues/399)): `YOURPHR_RELAY_URL` is where the backend polls `/pending` (in-cluster: `http://yourphr-relay.yourphr.svc.cluster.local:8080`), while `YOURPHR_RELAY_PUBLIC_URL` is the public origin the provider redirects the browser to — `<that>/callback` is the value you register. It defaults to `YOURPHR_RELAY_URL` when that is public https, else to `https://relay.nerdsbythehour.com`. Confirm what your instance resolved with `GET /api/secure/source/relay-config`. See [`../../backend/cmd/relay/README.md`](../../backend/cmd/relay/README.md), [`deployment/README.md`](../deployment/README.md) and [`FHIR/fhir-testing.md`](../FHIR/fhir-testing.md).

## Automated tests (Playwright)

`frontend/e2e/sandbox-connect.spec.ts` exercises the connect flow for every sandbox in this doc:

- __CI-safe (default, in `make test-e2e`):__ the backend is mocked — no external network, no real credentials. It asserts the connect __form builds the correct `/source/authorize` + `/source/connect` requests__ per sandbox (FHIR base URL, scopes, and `client_secret` __only__ for confidential clients like Blue Button), opens the OAuth popup synchronously, and handles success — plus a required-fields validation guard.
- __Live (opt-in):__ a real end-to-end handshake against the SMART Health IT launcher, __skipped unless `E2E_LIVE=1`__ and pointed at a relay-configured backend. The launcher selectors are a scaffold — confirm them on the first live run.

```bash
make test-e2e                                                  # CI-safe suite (includes the sandbox payload tests)
E2E_LIVE=1 npx playwright test sandbox-connect --grep @live    # opt-in live handshake (needs a relay-configured backend)
```

Keep the `SANDBOXES` catalog in that spec in sync with the list above whenever a sandbox is added.

## See also

- [`FHIR/fhir-testing.md`](../FHIR/fhir-testing.md) — step-by-step connect + the relay/poll issues log
- [`medicare-bluebutton.md`](../medicare-bluebutton.md) — the verified Blue Button walkthrough
- [`vendors/epic-sandbox.md`](../vendors/epic-sandbox.md) · [`vendors/followmyhealth.md`](../vendors/followmyhealth.md)
- [`planning/smart-on-fhir/smart-on-fhir.md`](../planning/smart-on-fhir/smart-on-fhir.md) — the SMART design
