# Epic SMART on FHIR Sandbox

Connect YourPHR to Epic's __public SMART on FHIR sandbox__ to exercise the full
patient standalone launch (authorize → login → token exchange → import) with
__synthetic patients and zero PHI__. Unlike a real provider, Epic lets you
self-register a patient-facing app and get a non-production `client_id`
immediately — __no vendor approval gate__. This makes Epic the lowest-friction
way for a new contributor to validate live SMART sync end-to-end, directly
serving the mission of immediate patient access ([#15](https://github.com/jwilleke/yourphr/issues/15)).

This work is tracked by [#257](https://github.com/jwilleke/yourphr/issues/257)
and rides on the now-complete SMART on FHIR stack ([EPIC #20](https://github.com/jwilleke/yourphr/issues/20)).

__Register at:__ <https://fhir.epic.com> — self-register a patient-facing app to get a non-production `client_id` (public / PKCE, no secret); no approval gate. Save it to `private/secrets.md`.

## Status at a glance

- __Is anything blocking Epic? No.__ Epic's sandbox is self-service — register a
  patient-facing app, get a non-production `client_id`, run the flow. There is
  no approval gate. (That gate is Veradigm-specific, [#53](https://github.com/jwilleke/yourphr/issues/53) — see below.)
- __Epic sandbox E2E is verified__ on production (see [Live connect log](#live-connect-log-dated) below). Same generic SMART-R4 client as SMART Health IT ([#48](https://github.com/jwilleke/yourphr/issues/48)–[#52](https://github.com/jwilleke/yourphr/issues/52)); catalog one-click path is live on `/web/sandbox`.
- __Supporting stack — DONE__: SMART spike ([#48](https://github.com/jwilleke/yourphr/issues/48)), generic client ([#49](https://github.com/jwilleke/yourphr/issues/49)), relay ([#50](https://github.com/jwilleke/yourphr/issues/50)), backend OAuth ([#51](https://github.com/jwilleke/yourphr/issues/51)), connect UI ([#52](https://github.com/jwilleke/yourphr/issues/52)), sandbox pre-fill / this guide ([#257](https://github.com/jwilleke/yourphr/issues/257) / PR [#260](https://github.com/jwilleke/yourphr/pull/260)).

### Live connect log (dated)

| Date | Host | Result |
|---|---|---|
| __2026-06-15__ | discovery only | ✅ `.well-known/smart-configuration` __200__, PKCE `S256`, `launch-standalone` + `client-public` + `context-standalone-patient` + `permission-offline` |
| __2026-06-18__ | production matrix | ✅ __works__ — imports records; skips types Epic **403/400**s (e.g. AdverseEvent 403, CarePlan “requires category” 400) |
| __2026-07-31__ | __yourphr.nerdsbythehour.com__ `/web/sandbox` | ✅ __E2E connect + import__ — authorize/connect __200__ (~11 s connect); per-resource SMART walk ~__4 min__ for first pass; Patient stored (UUID). Brief UI 500 on Patient while first pages were still writing (race); later loads __200__. |
| __2026-08-01__ | same host, Sources recheck | ✅ Patient `GET` __200__ for Epic sources; imported data still present |

#### 2026-07-31 production notes (detail)

- Catalog entry authorize `POST …/provider-catalog/fbf29bef-…/authorize` __200__ at __14:00:49Z__; connect __200__ at __14:01:00Z__ (latency ~11 s). Second Epic-path catalog connect __14:22:20Z__ also completed a short type walk.
- Import path: `no Patient/$everything` → per-resource compartment search. Many empty/403 types skipped gracefully; usable clinical types + Patient imported.
- __AuditEvent / Communication / Task:__ log noise `error upserting … Invalid resource type for model: AuditEvent` (and similar) — fetch succeeds, __DB model missing__ for those types; not fatal to the rest of the import.
- __Token refresh (ongoing after connect):__ source `bb1dbc09-…` (Epic sandbox, user `jwilleke`) logs every ~30 min:

  ```text
  token-refresh: source bb1dbc09-…: access token expired and no refresh token is available; reconnect the source
  ```

  Access token dies; __no `refresh_token` stored__. Other sources on the same host still refresh (`attempted N, refreshed M` with M≥1). Ensure the Epic app grants __offline__ / `offline_access` (scopes table below already request it) and reconnect once so a refresh token is issued — otherwise re-sync / scheduled refresh will fail until the user reconnects. Contrast Oracle Challenge 4 / Offline app type in [`oracle-cerner.md`](./oracle-cerner.md).

- __Not the multi-hour hang:__ wall clock for Epic was minutes; the long 2026-07-31 download was __Oracle__ ([#439](https://github.com/jwilleke/yourphr/issues/439)).

## Why Epic (vs. Veradigm)

- Epic's __sandbox__ issues a non-production `client_id` on self-registration —
  immediate, no approval.
- Veradigm/FollowMyHealth ([#53](https://github.com/jwilleke/yourphr/issues/53))
  requires registration __and vendor approval__ before issuing a `client_id`,
  which is why it is `blocked`. Epic is therefore the better *first* live target,
  even though Veradigm is the primary real-world dataset YourPHR is hardened
  against (see [`followmyhealth.md`](./followmyhealth.md)).
- Broader friction context: [`clientid-friction.md`](./clientid-friction.md).

## How the pieces fit

- YourPHR uses __per-user / bring-your-own `client_id`__: you register your own
  patient-facing app at Epic and paste its `client_id` into the connect modal.
  YourPHR never holds a shared credential.
- After login, Epic redirects the browser to a __public relay__ that only
  bounces the short-lived authorization `code` (never tokens). The default is
  `https://relay.nerdsbythehour.com`; override with `YOURPHR_RELAY_PUBLIC_URL`
  (the origin the provider redirects to) plus `YOURPHR_RELAY_URL` /
  `YOURPHR_RELAY_SECRET` (where the backend polls). No frontend rebuild is
  needed — see [`../../backend/cmd/relay/README.md`](../../backend/cmd/relay/README.md).
- The redirect URI registered with Epic must __exactly__ match the relay
  callback: `https://relay.nerdsbythehour.com/callback` (or your own relay's
  `/callback`).

## How to connect

### Prerequisites

- A running YourPHR instance (dev: `make serve-backend` + `make serve-frontend`).
- A free Epic developer account at <https://fhir.epic.com>.
- Browser popups allowed for your YourPHR origin (login opens in a popup).

### Step 1 — Register a patient-facing app at Epic

- Sign in at <https://fhir.epic.com> and open __Build Apps → Create__.
- Choose __Patients__ as the audience (patient standalone launch).
- Set the application's __Redirect URI__ to your relay callback:
  - Default project relay: `https://relay.nerdsbythehour.com/callback`
  - Self-hosted relay: `https://<your-relay-host>/callback`
- Select the FHIR R4 APIs you want (e.g. Patient, AllergyIntolerance,
  Condition, MedicationRequest, Observation, DocumentReference). Sticking to
  US Core resources keeps you eligible for Automatic Client ID Distribution
  later (see [`clientid-friction.md`](./clientid-friction.md)).
- Save. Epic issues a __Non-Production Client ID__ immediately — copy it.

### Step 2 — Connect from YourPHR

- Open __Medical Sources__ in the app.
- Under __Connect a SMART source__, click __Use Epic Sandbox__. This pre-fills
  the FHIR base URL and scopes for Epic's sandbox.
- Paste your __Non-Production Client ID__ from Step 1 into the __Client ID__ field.
- Click __Connect__. A popup opens to Epic's login.

### Step 3 — Log in as a synthetic test patient

- In the popup, log in with one of Epic's published sandbox test patients.
- Epic maintains the canonical, current list (usernames, passwords, and the
  data each patient has) at:
  <https://fhir.epic.com/Documentation?docId=testpatients>
- A commonly used example is __Camila Lopez__ (the same synthetic patient
  backing the `backend/pkg/database/testdata/epic_fhircamila.ndjson` fixture).
- Approve the requested scopes. The popup returns to the relay, YourPHR
  exchanges the code for tokens, and the import starts. Progress appears on the
  __Connected Sources__ list.

## Reference — Epic sandbox values

These are the values the __Use Epic Sandbox__ button pre-fills. They are public,
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

__First production E2E is done__ (see [Live connect log](#live-connect-log-dated)). Remaining polish:

- Confirm every sandbox Epic app registration includes __offline access__ so `offline_access` actually yields a refresh token (see 2026-07-31 token-refresh note).
- Optionally skip or model unsupported types that spam upsert warnings (`AuditEvent`, etc.).
- Re-verify US Core display for Camila Lopez / current test patients after import; file display gaps separately ([#54](https://github.com/jwilleke/yourphr/issues/54) closed).
- Close or update tracking [#257](https://github.com/jwilleke/yourphr/issues/257) if the original “first connection” acceptance is satisfied.

Deliberately __out of scope__: a fully automated CI E2E against the sandbox —
Epic's login is interactive, so automating it is brittle. This manual procedure
is the supported verification path.

## Troubleshooting

- __"Browser blocked the login popup."__ Allow popups for the YourPHR origin and
  click __Connect__ again (the popup is opened in the click handler, so it must
  not be blocked).
- __`redirect_uri` mismatch / invalid redirect at Epic.__ The URI registered in
  Step 1 must match the relay callback __character-for-character__, including
  scheme and path. Confirm whether your instance uses the default relay or a
  self-hosted one (`YOURPHR_RELAY_URL`).
- __"Connection failed … complete the login and try again."__ The backend polls
  the relay for the code (login wait is configurable; default is minutes, not
  30s). If login took longer, retry __Connect__ after finishing the Epic login.
- __No data after connecting.__ Pick a test patient that actually has the
  resource types you selected in Step 1 (the test-patient page lists each
  patient's data).
- __Patient 500 for a few seconds right after Connect.__ UI may request
  `Patient/{id}` before the first upsert lands — transient; refresh. (Not the
  Oracle missing-Patient case [#439](https://github.com/jwilleke/yourphr/issues/439).)
- __`token-refresh: … no refresh token is available`.__ Epic access token
  expired and no refresh was stored. Reconnect after confirming the app allows
  offline / `offline_access`. Imported FHIR data remains; only live re-sync
  needs a new login.
- __Log spam `Invalid resource type for model: AuditEvent` (etc.).__ Epic
  returned a type YourPHR has no GORM model for; those rows are dropped, other
  types continue.

## References

- Mission: [#15](https://github.com/jwilleke/yourphr/issues/15) (21st Century Cures Act — immediate patient access).
- This feature: [#257](https://github.com/jwilleke/yourphr/issues/257); PR [#260](https://github.com/jwilleke/yourphr/pull/260).
- SMART on FHIR umbrella: [EPIC #20](https://github.com/jwilleke/yourphr/issues/20) — children [#48](https://github.com/jwilleke/yourphr/issues/48), [#49](https://github.com/jwilleke/yourphr/issues/49), [#50](https://github.com/jwilleke/yourphr/issues/50), [#51](https://github.com/jwilleke/yourphr/issues/51), [#52](https://github.com/jwilleke/yourphr/issues/52), [#53](https://github.com/jwilleke/yourphr/issues/53), [#54](https://github.com/jwilleke/yourphr/issues/54).
- Design: [`../planning/smart-on-fhir/smart-on-fhir.md`](../planning/smart-on-fhir/smart-on-fhir.md), [`../planning/smart-on-fhir/oauth-gateway.md`](../planning/smart-on-fhir/oauth-gateway.md).
- Friction notes: [`clientid-friction.md`](./clientid-friction.md).
- Epic docs: SMART test patients <https://fhir.epic.com/Documentation?docId=testpatients>; OAuth2 <https://fhir.epic.com/Documentation?docId=oauth2>.
- [Epic Developer Docs](https://fhir.epic.com/Documentation?docId=developerguidelines)
