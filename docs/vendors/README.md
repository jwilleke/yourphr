# Vendors

Reference notes on the external health-IT vendors whose data and APIs YourPHR interoperates with. Each doc follows the same shape: **Overview · Ownership & History · Products · Contact · API & Integration · Known API Issues · Relevance to YourPHR · References**.

| Vendor | Doc | Why it matters to YourPHR |
|---|---|---|
| **FollowMyHealth** | [`followmyhealth.md`](./followmyhealth.md) | Patient portal; its FHIR R4 export is the primary real-world (non-US-Core) dataset YourPHR is hardened against. |
| **Veradigm** (formerly **Allscripts**) | [`veradigm-allscripts.md`](./veradigm-allscripts.md) | Owns FollowMyHealth and the SMART/FHIR developer program; the external gatekeeper for live sync ([#53](https://github.com/jwilleke/yourphr/issues/53)). |

Integration / topic notes (not vendor profiles): [`epic-sandbox.md`](./epic-sandbox.md) (connect to Epic's public SMART sandbox — the lowest-friction live target, [#257](https://github.com/jwilleke/yourphr/issues/257)) and [`clientid-friction.md`](./clientid-friction.md) (why obtaining a ClientID is the project's biggest blocker).

## Sandbox registration guides — where to register & what you need

How to obtain credentials for each test sandbox. The index with connect values + status is [`../test-sandboxes.md`](../test-sandboxes.md); actual credential values live in `private/secrets.md` (gitignored).

| Sandbox | Register at | What you get | Guide |
|---|---|---|---|
| **SMART Health IT** | _nothing — open sandbox_ | any `client_id`, no secret | [`smart-health-it.md`](./smart-health-it.md) |
| **CMS Blue Button 2.0** | <https://bluebutton.cms.gov/developers/> | `client_id` + `client_secret` (confidential) | [`blue-button.md`](./blue-button.md) |
| **Epic** | <https://fhir.epic.com> | `client_id` (public/PKCE) | [`epic-sandbox.md`](./epic-sandbox.md) |
| **FollowMyHealth / Veradigm** | <https://developer.veradigm.com> | `client_id` (public/PKCE) — ⛔ provisioning-gated | [`followmyhealth.md`](./followmyhealth.md) |
| **Oracle Health (Cerner)** | <https://code-console.cerner.com/> | `client_id` (public/PKCE), console-issued | [`oracle-cerner.md`](./oracle-cerner.md) |
| **athenahealth** | <https://mydata.athenahealth.com/access-the-apis> | `client_id` + `client_secret` (confidential / Web app) — approval-gated | [`athenahealth.md`](./athenahealth.md) |

See also: [`../FHIR/fhir-testing.md`](../FHIR/fhir-testing.md) (test-vs-real environments) and [`../FHIR/fhir-test-discovery-example.md`](../FHIR/fhir-test-discovery-example.md) (a captured FollowMyHealth discovery document).

## ⚠️ Everything below is SANDBOX

All credentials, endpoints, and test patients documented here and in `private/secrets.md` are **test/sandbox** — synthetic patients, no real PHI. **Production** registration for each vendor is a separate, later effort (different endpoints, real approval, real client_ids). Do not mix the two: the provider catalog separates them by `Environment` (`sandbox` vs `production`).

## How each sandbox operates + live connect status (verified 2026-06-18)

YourPHR connects to all of these the same way: a one-click button on **`/sandbox`** runs the SMART-on-FHIR flow (server-side `client_id`/secret, PKCE, our relay catches the redirect). What differs per vendor is the auth model and how gated record access is.

| Sandbox | Auth model | Test patient | Live status |
|---|---|---|---|
| **CMS Blue Button 2.0** | confidential (id+secret) | synthetic Medicare beneficiary (`…/PW00000!`) | ✅ **works** — imports claims/coverage |
| **Epic** | public / PKCE | `fhircamila` / `epicepic1` | ✅ **works** — imports records (skips types Epic 403/400s) |
| **SMART Health IT** | open (any `client_id`, no secret) | `demouser` / `Demouser1!` or pick at launcher | ✅ open launcher — connects without approval |
| **athenahealth** | confidential (id+secret) | `phrtest_preview@mailinator.com` / `Password1` (also `athenainterop@aol.com`) | 🟡 **auth works**, patient login works; record-sharing **gated** on app onboarding/provisioning in the Developer Portal |
| **Oracle Health (Cerner)** | public / PKCE | `nancysmart` / `Cerner01` | ✅ **works** — imports records; needs a pinned patient-authorize override + enumerated v2 `.rs` scopes + Offline app (see below) |

### Per-vendor operating notes

- **Blue Button** — pure OAuth2; confidential client; restricted scopes (no wildcard / `offline_access`). One synthetic beneficiary login. The most reliable sandbox. ([`blue-button.md`](./blue-button.md))
- **Epic** — public/PKCE patient app; advertises ~100 resource types but **403/400s** several (AdverseEvent 403, CarePlan "requires category" 400). YourPHR skips inaccessible types so the rest import. ([`epic-sandbox.md`](./epic-sandbox.md))
- **SMART Health IT** — open reference launcher; needs the long `/sim/<base64>/fhir` base; accepts any `client_id`; lets you pick a synthetic patient. Best smoke test. ([`smart-health-it.md`](./smart-health-it.md))
- **athenahealth** — confidential ("Web") app; **approval-gated**. OAuth + patient login succeed, but the patient record-sharing step ("Could not confirm access to additional health records") needs the app fully onboarded in the Developer Portal. Not a YourPHR bug. ([`athenahealth.md`](./athenahealth.md))
- **Oracle/Cerner** — public/PKCE, **working but the hardest sandbox**. Four obstacles, all solved: (1) the patient authorize endpoint is **not discoverable** (tenant-aware authz only advertises the _provider_ persona) → pin a per-entry authorize override; (2) the app is SMART v2 but only **smart-v1** endpoints exist; (3) scopes must be **enumerated v2 `.rs`** — Cerner silently drops `.read` and the `*.rs` wildcard; (4) the app must be **Offline** for a refresh token or long imports die. Base/`aud` = `fhir-ehr.cerner.com` (not `fhir-myrecord`). Slow/flaky sandbox (~57 s 504s). Full guide + data-shape notes: ([`oracle-cerner.md`](./oracle-cerner.md)). ([#338](https://github.com/jwilleke/yourphr/issues/338))
