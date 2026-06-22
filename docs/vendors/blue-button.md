# CMS Blue Button 2.0 — sandbox registration

How to get sandbox credentials for **CMS Blue Button 2.0** (Medicare claims). This is the **registration / credentials** guide; the full connect walkthrough, quirks, and troubleshooting live in [`../medicare-bluebutton.md`](../medicare-bluebutton.md) (verified working 2026-06-14).

**Register at:** <https://bluebutton.cms.gov/developers/> → **Sandbox** (free developer account; register a confidential app for a `client_id` + `client_secret`).

## What you need

| Item | How |
|---|---|
| **Developer account** | free, at `bluebutton.cms.gov/developers` → Sandbox |
| **`client_id` + `client_secret`** | issued when you register a **confidential** sandbox app |
| **Synthetic beneficiary login** | `BBUser00000` / `PW00000!` (range `BBUser00000`–`BBUser29999`, password `PW<digits>!`) |

Blue Button is a **confidential** client (unlike the others here) — you get _and must use_ a `client_secret`. Save both to `private/secrets.md`.

## Steps

1. Go to **<https://bluebutton.cms.gov/developers/>** → **Sandbox** → create a developer account.
2. **Register an application**:

   | App setting | Value |
   |---|---|
   | **OAuth Client Type** | `confidential` (gives `client_id` **and** `client_secret`) |
   | **OAuth Grant Type** | `authorization-code` |
   | **Callback / Redirect URI** | `https://relay.nerdsbythehour.com/callback` |
   | **Collect beneficiary demographic data** | Yes (else `GET /Patient` returns 401) |

3. Save the **Sandbox** `client_id` + `client_secret` to `private/secrets.md`.

## Connect values

| Field | Value |
|---|---|
| **FHIR base URL** | `https://sandbox.bluebutton.cms.gov/v2/fhir` |
| **Client ID / Secret** | your sandbox pair |
| **Scopes** | `openid profile launch/patient patient/Patient.read patient/Coverage.read patient/ExplanationOfBenefit.read` (no wildcard / `fhirUser` / `offline_access`) |

## Production (real Medicare data)

A separate CMS **production** app-review (no cost); the base becomes `https://api.bluebutton.cms.gov/v2/fhir` and you use the Production `client_id` / `client_secret`.

## See also

- **Full connect guide + troubleshooting:** [`../medicare-bluebutton.md`](../medicare-bluebutton.md)
- Index: [`../testing-sandboxes/test-sandboxes.md`](../testing-sandboxes/test-sandboxes.md)
