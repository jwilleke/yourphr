# Epic SMART on FHIR Sandbox

Connect YourPHR to Epic's **public SMART on FHIR sandbox** to exercise the full
patient standalone launch (authorize → login → token exchange → import) with
**synthetic patients and zero PHI**. Unlike a real provider, Epic lets you
self-register a patient-facing app and get a non-production `client_id`
immediately — **no vendor approval gate**. This makes Epic the lowest-friction
way for a new contributor to validate live SMART sync end-to-end, directly
serving the mission of immediate patient access ([#15](https://github.com/jwilleke/yourphr/issues/15)).

This work is tracked by [#257](https://github.com/jwilleke/yourphr/issues/257)
and rides on the now-complete SMART on FHIR stack ([EPIC #20](https://github.com/jwilleke/yourphr/issues/20)).

## Status at a glance

- **Is anything blocking Epic? No.** Epic's sandbox is self-service — register a
  patient-facing app, get a non-production `client_id`, run the flow. There is
  no approval gate. (That gate is Veradigm-specific, [#53](https://github.com/jwilleke/yourphr/issues/53) — see below.)
- **The SMART flow is already proven end-to-end** against the SMART Health IT
  sandbox (`launch.smarthealthit.org`): authorize → login → token exchange →
  `$everything` import all succeeded (spike [#48](https://github.com/jwilleke/yourphr/issues/48)).
  Epic reuses that exact same generic SMART-R4 client — it is just a different
  provider in the same, working code path.
- **Has *Epic specifically* been connected yet? Not yet** — no one has run a real
  authorize → token → import against `fhir.epic.com`. That is a remaining
  **task, not a blocker**: it needs a `client_id` and a run. Epic's discovery
  endpoints are confirmed reachable.
- **Supporting stack — DONE** (all closed): SMART spike
  ([#48](https://github.com/jwilleke/yourphr/issues/48)), generic Go SMART-R4
  client ([#49](https://github.com/jwilleke/yourphr/issues/49)), self-hosted
  store-and-poll relay ([#50](https://github.com/jwilleke/yourphr/issues/50),
  live at `relay.nerdsbythehour.com`), backend OAuth endpoints + token storage
  ([#51](https://github.com/jwilleke/yourphr/issues/51)), and the frontend
  connect UI ([#52](https://github.com/jwilleke/yourphr/issues/52)).
- **This change — IN REVIEW**: PR [#260](https://github.com/jwilleke/yourphr/pull/260)
  adds this doc, a one-click **"Use Epic Sandbox"** pre-fill in the connect
  modal, and Epic reference values in `.env.example`.

## Why Epic (vs. Veradigm)

- Epic's **sandbox** issues a non-production `client_id` on self-registration —
  immediate, no approval.
- Veradigm/FollowMyHealth ([#53](https://github.com/jwilleke/yourphr/issues/53))
  requires registration **and vendor approval** before issuing a `client_id`,
  which is why it is `blocked`. Epic is therefore the better *first* live target,
  even though Veradigm is the primary real-world dataset YourPHR is hardened
  against (see [`followmyhealth.md`](./followmyhealth.md)).
- Broader friction context: [`clientid-friction.md`](./clientid-friction.md).

## How the pieces fit

- YourPHR uses **per-user / bring-your-own `client_id`**: you register your own
  patient-facing app at Epic and paste its `client_id` into the connect modal.
  YourPHR never holds a shared credential.
- After login, Epic redirects the browser to a **public relay** that only
  bounces the short-lived authorization `code` (never tokens). The default is
  `https://relay.nerdsbythehour.com`; override with `YOURPHR_RELAY_URL` /
  `YOURPHR_RELAY_SECRET` (read by `backend/pkg/relay/relay.go`).
- The redirect URI registered with Epic must **exactly** match the relay
  callback: `https://relay.nerdsbythehour.com/callback` (or your own relay's
  `/callback`).

## How to connect

### Prerequisites

- A running YourPHR instance (dev: `make serve-backend` + `make serve-frontend`).
- A free Epic developer account at <https://fhir.epic.com>.
- Browser popups allowed for your YourPHR origin (login opens in a popup).

### Step 1 — Register a patient-facing app at Epic

- Sign in at <https://fhir.epic.com> and open **Build Apps → Create**.
- Choose **Patients** as the audience (patient standalone launch).
- Set the application's **Redirect URI** to your relay callback:
  - Default project relay: `https://relay.nerdsbythehour.com/callback`
  - Self-hosted relay: `https://<your-relay-host>/callback`
- Select the FHIR R4 APIs you want (e.g. Patient, AllergyIntolerance,
  Condition, MedicationRequest, Observation, DocumentReference). Sticking to
  US Core resources keeps you eligible for Automatic Client ID Distribution
  later (see [`clientid-friction.md`](./clientid-friction.md)).
- Save. Epic issues a **Non-Production Client ID** immediately — copy it.

### Step 2 — Connect from YourPHR

- Open **Medical Sources** in the app.
- Under **Connect a SMART source**, click **Use Epic Sandbox**. This pre-fills
  the FHIR base URL and scopes for Epic's sandbox.
- Paste your **Non-Production Client ID** from Step 1 into the **Client ID** field.
- Click **Connect**. A popup opens to Epic's login.

### Step 3 — Log in as a synthetic test patient

- In the popup, log in with one of Epic's published sandbox test patients.
- Epic maintains the canonical, current list (usernames, passwords, and the
  data each patient has) at:
  <https://fhir.epic.com/Documentation?docId=testpatients>
- A commonly used example is **Camila Lopez** (the same synthetic patient
  backing the `backend/pkg/database/testdata/epic_fhircamila.ndjson` fixture).
- Approve the requested scopes. The popup returns to the relay, YourPHR
  exchanges the code for tokens, and the import starts. Progress appears on the
  **Connected Sources** list.

## Reference — Epic sandbox values

These are the values the **Use Epic Sandbox** button pre-fills. They are public,
non-secret sandbox endpoints — the only thing you supply is your own `client_id`.

| Field          | Value                                                                   |
| -------------- | ----------------------------------------------------------------------- |
| FHIR base URL  | `https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4`             |
| Authorize      | `https://fhir.epic.com/interconnect-fhir-oauth/oauth2/authorize`        |
| Token          | `https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token`            |
| Scopes         | `launch/patient patient/*.read openid fhirUser offline_access`          |
| Redirect URI   | `https://relay.nerdsbythehour.com/callback` (or your self-hosted relay) |
| Client ID      | your Non-Production Client ID from Step 1 (BYO — not shared)             |

YourPHR discovers the authorize/token endpoints automatically from
`{FHIR base}/.well-known/smart-configuration`, so you only need the FHIR base
URL, scopes, and your `client_id`.

## What's next on Epic sandbox

The remaining work is the **first real connection** — code is ready, it just
hasn't been run against Epic:

- **Land PR [#260](https://github.com/jwilleke/yourphr/pull/260)** (docs + UI
  pre-fill).
- **Register a patient-facing app** at `fhir.epic.com` and capture a
  non-production `client_id` (Step 1).
- **Register the relay redirect URI** (`https://relay.nerdsbythehour.com/callback`)
  on that Epic app.
- **Run the manual E2E** (Steps 2–3) against a test patient and confirm tokens
  exchange and the bundle imports.
- **Verify US Core resources render** (Patient, Allergies, Conditions,
  Medications, Labs/Observations, DocumentReference) from the imported data;
  file display gaps separately (the non-US-Core display track was
  [#54](https://github.com/jwilleke/yourphr/issues/54), now closed).
- **Record the result here** (which test patient, which resources loaded) so the
  next contributor has a known-good baseline, then close
  [#257](https://github.com/jwilleke/yourphr/issues/257).

Deliberately **out of scope**: a fully automated CI E2E against the sandbox —
Epic's login is interactive, so automating it is brittle. This manual procedure
is the supported verification path.

## Troubleshooting

- **"Browser blocked the login popup."** Allow popups for the YourPHR origin and
  click **Connect** again (the popup is opened in the click handler, so it must
  not be blocked).
- **`redirect_uri` mismatch / invalid redirect at Epic.** The URI registered in
  Step 1 must match the relay callback **character-for-character**, including
  scheme and path. Confirm whether your instance uses the default relay or a
  self-hosted one (`YOURPHR_RELAY_URL`).
- **"Connection failed … complete the login and try again."** The backend polls
  the relay for the code for ~30s and retries up to 3 times. If login took
  longer, just retry **Connect** after finishing the Epic login.
- **No data after connecting.** Pick a test patient that actually has the
  resource types you selected in Step 1 (the test-patient page lists each
  patient's data).

## References

- Mission: [#15](https://github.com/jwilleke/yourphr/issues/15) (21st Century Cures Act — immediate patient access).
- This feature: [#257](https://github.com/jwilleke/yourphr/issues/257); PR [#260](https://github.com/jwilleke/yourphr/pull/260).
- SMART on FHIR umbrella: [EPIC #20](https://github.com/jwilleke/yourphr/issues/20) — children [#48](https://github.com/jwilleke/yourphr/issues/48), [#49](https://github.com/jwilleke/yourphr/issues/49), [#50](https://github.com/jwilleke/yourphr/issues/50), [#51](https://github.com/jwilleke/yourphr/issues/51), [#52](https://github.com/jwilleke/yourphr/issues/52), [#53](https://github.com/jwilleke/yourphr/issues/53), [#54](https://github.com/jwilleke/yourphr/issues/54).
- Design: [`../planning/smart-on-fhir/smart-on-fhir.md`](../planning/smart-on-fhir/smart-on-fhir.md), [`../planning/smart-on-fhir/oauth-gateway.md`](../planning/smart-on-fhir/oauth-gateway.md).
- Friction notes: [`clientid-friction.md`](./clientid-friction.md).
- Epic docs: SMART test patients <https://fhir.epic.com/Documentation?docId=testpatients>; OAuth2 <https://fhir.epic.com/Documentation?docId=oauth2>.
- [Epic Developer Docs](https://fhir.epic.com/Documentation?docId=developerguidelines)
