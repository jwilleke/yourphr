# CMS Blue Button 2.0 — sandbox registration

How to get sandbox credentials for __CMS Blue Button 2.0__ (Medicare claims). This is the __registration / credentials__ guide; the full connect walkthrough, quirks, and troubleshooting live in [`../medicare-bluebutton.md`](../medicare-bluebutton.md).

__Register at:__ <https://bluebutton.cms.gov/developers/> → __Sandbox__ (free developer account; register a confidential app for a `client_id` + `client_secret`).

## Live connect status (dated)

| Date | Hosts | Result |
|---|---|---|
| __2026-06-14__ | production YourPHR (nerdsbythehour) | ✅ __E2E verified__ — synthetic login `BBUser00000` / `PW00000!` → token → sync (claims/coverage) |
| __2026-06-18__ | sandbox matrix | ✅ still listed green in vendor matrix |
| __2026-07-31__ | __demo.yourphr.org__ and __yourphr.nerdsbythehour.com__ | ⛔ __sandbox beneficiary login fails on CMS side__ (see below). YourPHR OAuth start + relay poll behave as designed; no auth code is ever posted. |
| __2026-08-01__ | __demo.yourphr.org__ (`demo-relay.yourphr.org`, app __v1.19.1__) | ⛔ __same CMS failure__ during #438 acceptance: CMS page shows __"We can't process your request at this time. Try logging into your account later."__ for `BBUser00000` / `PW00000!`. Authorize page still loads from YourPHR; failure is on CMS login before any redirect to the relay. |

### Failure detail — CMS sandbox login (2026-07-31, reconfirmed 2026-08-01)

Retested the __sandbox__ Blue Button catalog entry. Same CMS-side symptoms on demo (2026-08-01) and previously on demo + prod (2026-07-31) — not a single-host config/relay bug:

| Step | What happened |
|---|---|
| Authorize | CMS authorize page loads (200); YourPHR opens the popup and polls the relay |
| Synthetic login `BBUser00000` / `PW00000!` | CMS UI: __"We can't process your request at this time. Try logging into your account later."__ (or shorter "can't process request") — never completes authorize |
| Alternate path (ID.me / medicare.gov chooser) | Fails with __patient data not found__ (synthetic sandbox has no real Medicare identity) |
| After connect wait | Connect times out / no auth code; relay has nothing to deliver |

__Interpretation:__ Our client_id, scopes, and relay callback are fine enough to reach CMS login. The __CMS sandbox synthetic login path itself is failing__ (or has changed in a way that breaks the published `BBUser`/`PW…!` credentials). Until CMS restores sandbox login (or documents a new synthetic path), use __SMART Health IT__ for E2E smoke tests ([`smart-health-it.md`](./smart-health-it.md)). Production Medicare still needs CMS production credentials ([#433](https://github.com/jwilleke/yourphr/issues/433), [#408](https://github.com/jwilleke/yourphr/issues/408)).

## What you need

| Item | How |
|---|---|
| __Developer account__ | free, at `bluebutton.cms.gov/developers` → Sandbox |
| __`client_id` + `client_secret`__ | issued when you register a __confidential__ sandbox app |
| __Synthetic beneficiary login__ | `BBUser00000` / `PW00000!` (range `BBUser00000`–`BBUser29999`, password `PW<digits>!`) — __worked 2026-06-14; failing as of 2026-07-31__ |

Blue Button is a __confidential__ client (unlike the others here) — you get *and must use* a `client_secret`. Save both to `private/secrets.md`.

## Steps

1. Go to __<https://bluebutton.cms.gov/developers/>__ → __Sandbox__ → create a developer account.
2. __Register an application__:

   | App setting | Value |
   |---|---|
   | __OAuth Client Type__ | `confidential` (gives `client_id` __and__ `client_secret`) |
   | __OAuth Grant Type__ | `authorization-code` |
   | __Callback / Redirect URI__ | this instance’s relay callback (e.g. `https://relay.nerdsbythehour.com/callback` or `https://demo-relay.yourphr.org/callback`) — __exact match__ |
   | __Collect beneficiary demographic data__ | Yes (else `GET /Patient` returns 401) |

3. Save the __Sandbox__ `client_id` + `client_secret` to `private/secrets.md`.

## Connect values

| Field | Value |
|---|---|
| __FHIR base URL__ | `https://sandbox.bluebutton.cms.gov/v2/fhir` |
| __Client ID / Secret__ | your sandbox pair |
| __Scopes__ | `openid profile launch/patient patient/Patient.read patient/Coverage.read patient/ExplanationOfBenefit.read` (no wildcard / `fhirUser` / `offline_access`) |

## Production (real Medicare data)

A separate CMS __production__ app-review (no cost); the base becomes `https://api.bluebutton.cms.gov/v2/fhir` and you use the Production `client_id` / `client_secret`.

__Operator runbook (email → form → Zoom → post-approval → enable catalog):__  
[`../cms-bluebutton-production-access.md`](../cms-bluebutton-production-access.md) ([#433](https://github.com/jwilleke/yourphr/issues/433)).

## See also

- __Full connect guide + troubleshooting:__ [`../medicare-bluebutton.md`](../medicare-bluebutton.md)
- __Production access runbook:__ [`../cms-bluebutton-production-access.md`](../cms-bluebutton-production-access.md)
- Index: [`../testing-sandboxes/test-sandboxes.md`](../testing-sandboxes/test-sandboxes.md)
- Vendor matrix: [`README.md`](./README.md)
