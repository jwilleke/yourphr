# Vendors

Reference notes on the external health-IT vendors whose data and APIs YourPHR interoperates with. Each doc follows the same shape: __Overview · Ownership & History · Products · Contact · API & Integration · Known API Issues · Relevance to YourPHR · References__.

| Vendor | Doc | Why it matters to YourPHR |
|---|---|---|
| __FollowMyHealth__ | [`followmyhealth.md`](./followmyhealth.md) | Patient portal; its FHIR R4 export is the primary real-world (non-US-Core) dataset YourPHR is hardened against. |
| __Veradigm__ (formerly __Allscripts__) | [`veradigm-allscripts.md`](./veradigm-allscripts.md) | Owns FollowMyHealth and the SMART/FHIR developer program; the external gatekeeper for live sync ([#53](https://github.com/jwilleke/yourphr/issues/53)). |

Integration / topic notes (not vendor profiles): [`epic-sandbox.md`](./epic-sandbox.md) (connect to Epic's public SMART sandbox — the lowest-friction live target, [#257](https://github.com/jwilleke/yourphr/issues/257)) and [`clientid-friction.md`](./clientid-friction.md) (why obtaining a ClientID is the project's biggest blocker).

## Sandbox registration guides — where to register & what you need

How to obtain credentials for each test sandbox. The index with connect values + status is [`../testing-sandboxes/test-sandboxes.md`](../testing-sandboxes/test-sandboxes.md); actual credential values live in `private/secrets.md` (gitignored).

| Sandbox | Register at | What you get | Guide |
|---|---|---|---|
| __SMART Health IT__ | *nothing — open sandbox* | any `client_id`, no secret | [`smart-health-it.md`](./smart-health-it.md) |
| __CMS Blue Button 2.0__ | <https://bluebutton.cms.gov/developers/> | `client_id` + `client_secret` (confidential) | [`medicare.md`](./medicare.md) · __prod access:__ [`../cms-bluebutton-production-access.md`](../cms-bluebutton-production-access.md) |
| __Epic__ | <https://fhir.epic.com> | `client_id` (public/PKCE) | [`epic-sandbox.md`](./epic-sandbox.md) |
| __FollowMyHealth / Veradigm__ | <https://developer.veradigm.com> | `client_id` (public/PKCE) — ⛔ provisioning-gated | [`followmyhealth.md`](./followmyhealth.md) |
| __Oracle Health (Cerner)__ | <https://code-console.cerner.com/> | `client_id` (public/PKCE), console-issued | [`oracle-cerner.md`](./oracle-cerner.md) |
| __athenahealth__ | <https://mydata.athenahealth.com/access-the-apis> | `client_id` + `client_secret` (confidential / Web app) — approval-gated | [`athenahealth.md`](./athenahealth.md) |

See also: [`../FHIR/fhir-testing.md`](../FHIR/fhir-testing.md) (test-vs-real environments) and [`../FHIR/fhir-test-discovery-example.md`](../FHIR/fhir-test-discovery-example.md) (a captured FollowMyHealth discovery document).

## ⚠️ Everything below is SANDBOX

All credentials, endpoints, and test patients documented here and in `private/secrets.md` are __test/sandbox__ — synthetic patients, no real PHI. __Production__ registration for each vendor is a separate, later effort (different endpoints, real approval, real client_ids). Do not mix the two: the provider catalog separates them by `Environment` (`sandbox` vs `production`).

## How each sandbox operates + live connect status

*Last full retest of status rows: __2026-07-31__ (demo.yourphr.org + yourphr.nerdsbythehour.com). Blue Button sandbox login __reconfirmed broken 2026-08-01__ on demo v1.19.1 ([#438](https://github.com/jwilleke/yourphr/issues/438)). Prior matrix pass: 2026-06-18.*

YourPHR connects to all of these the same way: a one-click button on __`/sandbox`__ runs the SMART-on-FHIR flow (server-side `client_id`/secret, PKCE, our relay catches the redirect). What differs per vendor is the auth model and how gated record access is.

| Sandbox | Auth model | Test patient | Live status |
|---|---|---|---|
| __CMS Blue Button 2.0__ | confidential (id+secret) | synthetic Medicare beneficiary (`BBUser00000` / `PW00000!`) | ⛔ __sandbox login broken (2026-07-31, reconfirmed 2026-08-01 on demo)__ — OAuth authorize reaches CMS; synthetic login: *"We can't process your request at this time"*; no auth code (see [`medicare.md`](./medicare.md)). Was ✅ E2E 2026-06-14. |
| __Epic__ | public / PKCE | sandbox test patients (e.g. Camila Lopez) | ✅ __E2E verified 2026-07-31__ on production (also 2026-06-18); skips some 403/400 types; watch __offline refresh token__ after connect ([`epic-sandbox.md`](./epic-sandbox.md)) |
| __SMART Health IT__ | open (any `client_id`, no secret) | pick at launcher | ✅ __E2E verified 2026-07-31__ on demo.yourphr.org (~455 KB export) |
| __athenahealth__ | confidential (id+secret) | `phrtest_preview@mailinator.com` / `Password1` (also `athenainterop@aol.com`) | 🟡 __auth works__ (2026-06-18); patient login works; record-sharing __gated__ on app onboarding/provisioning in the Developer Portal |
| __Oracle Health (Cerner)__ | public / PKCE | `nancysmart` / `Cerner01` | 🟡 __partial__ — connect works; large patients can __page-cap abort__ (~1000 pages) and leave __no Patient__ → UI Failed (__2026-07-31__, [#439](https://github.com/jwilleke/yourphr/issues/439)). Needs pinned authorize + enumerated v2 `.rs` + Offline (see below) |
| __Veradigm / FollowMyHealth__ | public / PKCE | Veradigm test org | ⛔ __blocked__ (`unauthorized_client`, ticket #17849 / [#53](https://github.com/jwilleke/yourphr/issues/53)) — unchanged |

### Per-vendor operating notes

- __Blue Button__ — pure OAuth2; confidential client; restricted scopes (no wildcard / `offline_access`). __Do not treat as the reliable smoke test right now:__ as of __2026-07-31__ (reconfirmed __2026-08-01__ on demo.yourphr.org v1.19.1 during [#438](https://github.com/jwilleke/yourphr/issues/438)) the CMS sandbox beneficiary login fails on CMS's side before any auth code. Full connect guide: [`../medicare-bluebutton.md`](../medicare-bluebutton.md); registration + dated log: [`medicare.md`](./medicare.md).
- __Epic__ — public/PKCE patient app; advertises ~100 resource types but __403/400s__ several (AdverseEvent 403, CarePlan "requires category" 400). YourPHR skips inaccessible types so the rest import. ([`epic-sandbox.md`](./epic-sandbox.md))
- __SMART Health IT__ — open reference launcher; needs the long `/sim/<base64>/fhir` base; accepts any `client_id`; lets you pick a synthetic patient. __Best smoke test while Blue Button sandbox login is broken.__ Live E2E on demo 2026-07-31. ([`smart-health-it.md`](./smart-health-it.md))
- __athenahealth__ — confidential ("Web") app; __approval-gated__. OAuth + patient login succeed, but the patient record-sharing step ("Could not confirm access to additional health records") needs the app fully onboarded in the Developer Portal. Not a YourPHR bug. Live note dated __2026-06-18__. ([`athenahealth.md`](./athenahealth.md))
- __Oracle/Cerner__ — public/PKCE, __hardest sandbox__. Four auth obstacles solved ([#338](https://github.com/jwilleke/yourphr/issues/338)): (1) patient authorize not discoverable → pin override; (2) SMART v2 app / smart-v1 endpoints only; (3) enumerate v2 `.rs` scopes; (4) Offline for refresh. Base/`aud` = `fhir-ehr.cerner.com`. Slow/flaky (~57 s 504s). __Open:__ global 1000-page fetch cap aborts remaining types (incl. Patient) on large sandbox patients — UI Failed (__2026-07-31__, [#439](https://github.com/jwilleke/yourphr/issues/439)). Full guide: ([`oracle-cerner.md`](./oracle-cerner.md)).
- __Veradigm / FollowMyHealth__ — discovery + authorize start; login returns `unauthorized_client` until Veradigm provisions the app. Manual FHIR/EHI upload remains the import path. ([`followmyhealth.md`](./followmyhealth.md), [`veradigm-allscripts.md`](./veradigm-allscripts.md))
