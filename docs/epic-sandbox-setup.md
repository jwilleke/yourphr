# Epic SMART on FHIR Sandbox — setup

Connect YourPHR to Epic's **public SMART on FHIR sandbox** to test the full
patient standalone launch (authorize → login → token exchange → import) with
**synthetic patients and zero PHI**. No vendor approval is required — unlike a
real provider, Epic lets you self-register a patient-facing app and get a
non-production `client_id` immediately.

This is the low-friction path described in [`vendors/clientid-friction.md`](vendors/clientid-friction.md),
and it exercises the same code paths as a real connection (see the SMART master
plan in [`planning/smart-on-fhir/smart-on-fhir.md`](planning/smart-on-fhir/smart-on-fhir.md)).

> **Goal:** a developer can go from zero to a connected Epic sandbox in under 10 minutes.

## How the pieces fit

- YourPHR uses **per-user / bring-your-own `client_id`**: you register your own
  patient-facing app at Epic and paste its `client_id` into the connect modal.
  YourPHR never holds a shared credential.
- Epic redirects the browser back to a **public relay** after login. YourPHR
  ships with a default relay at `https://relay.nerdsbythehour.com`; the relay
  only bounces the short-lived authorization `code` — it never sees your tokens.
- The redirect URI you register with Epic must **exactly** match the relay
  callback: `https://relay.nerdsbythehour.com/callback` (or your own relay's
  `/callback` if you self-host one).

## Prerequisites

- A running YourPHR instance (dev: `make serve-backend` + `make serve-frontend`).
- A free Epic developer account at <https://fhir.epic.com>.
- Browser popups allowed for your YourPHR origin (the login opens in a popup).

## Step 1 — Register a patient-facing app at Epic

- Sign in at <https://fhir.epic.com> and open **Build Apps → Create**.
- Choose **Patients** as the audience (patient standalone launch).
- Set the application's **Redirect URI** to your relay callback:
  - Default project relay: `https://relay.nerdsbythehour.com/callback`
  - Self-hosted relay: `https://<your-relay-host>/callback`
- Select the FHIR R4 APIs you want (e.g. Patient, AllergyIntolerance,
  Condition, MedicationRequest, Observation, DocumentReference). Sticking to
  US Core resources keeps you eligible for Automatic Client ID Distribution
  later — see [`vendors/clientid-friction.md`](vendors/clientid-friction.md).
- Save. Epic issues a **Non-Production Client ID** immediately — copy it.

## Step 2 — Connect from YourPHR

- Open **Medical Sources** in the app.
- Under **Connect a SMART source**, click **Use Epic Sandbox**. This pre-fills
  the FHIR base URL and scopes for Epic's sandbox.
- Paste your **Non-Production Client ID** from Step 1 into the **Client ID** field.
- Click **Connect**. A popup opens to Epic's login.

## Step 3 — Log in as a synthetic test patient

- In the popup, log in with one of Epic's published sandbox test patients.
- Epic maintains the canonical, current list (usernames, passwords, and the
  data each patient has) at:
  <https://fhir.epic.com/Documentation?docId=testpatients>
- A commonly used example is patient **Camila Lopez** (the same synthetic
  patient backing the `epic_fhircamila.ndjson` test fixture in this repo).
- Approve the requested scopes. The popup returns to the relay, YourPHR
  exchanges the code for tokens, and the import starts. Progress appears on the
  **Connected Sources** list.

## Reference — Epic sandbox values

These are the values the **Use Epic Sandbox** button pre-fills. They are public,
non-secret sandbox endpoints — the only thing you supply is your own `client_id`.

| Field          | Value                                                                 |
| -------------- | --------------------------------------------------------------------- |
| FHIR base URL  | `https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4`           |
| Authorize      | `https://fhir.epic.com/interconnect-fhir-oauth/oauth2/authorize`      |
| Token          | `https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token`          |
| Scopes         | `launch/patient patient/*.read openid fhirUser offline_access`        |
| Redirect URI   | `https://relay.nerdsbythehour.com/callback` (or your self-hosted relay) |
| Client ID      | your Non-Production Client ID from Step 1 (BYO — not shared)           |

YourPHR discovers the authorize/token endpoints automatically from
`{FHIR base}/.well-known/smart-configuration`, so you only need the FHIR base
URL, scopes, and your `client_id`.

## Troubleshooting

- **"Browser blocked the login popup."** Allow popups for the YourPHR origin
  and click **Connect** again. The popup is opened in the click handler, so it
  must not be blocked.
- **`redirect_uri` mismatch / invalid redirect at Epic.** The URI registered in
  Step 1 must match the relay callback **character-for-character**, including
  scheme and trailing path. Confirm whether your instance uses the default
  relay or a self-hosted one (`YOURPHR_RELAY_URL`).
- **"Connection failed … complete the login and try again."** The backend polls
  the relay for the code for ~30s and retries up to 3 times. If login took
  longer, just retry **Connect** after finishing the Epic login.
- **No data after connecting.** Pick a test patient that actually has the
  resource types you selected in Step 1 (the test-patient page lists each
  patient's data).

## Scope of this guide

This covers the **sandbox** only. Moving to real Epic organizations requires
Epic's **Automatic Client ID Distribution** (register once, meet the
patient-facing/US-Core criteria, and Epic pushes your client ID to participating
organizations). That path and its friction are documented in
[`vendors/clientid-friction.md`](vendors/clientid-friction.md) and tracked under
[EPIC #20](https://github.com/jwilleke/yourphr/issues/20).
