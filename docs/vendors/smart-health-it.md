# SMART Health IT sandbox (launch.smarthealthit.org)

The __public reference SMART on FHIR sandbox__ — fake patients, __zero registration, zero credentials__. Maintained by the SMART team, so it's the cleanest "does our code conform to standard SMART" check, and the fastest way for a new contributor to validate YourPHR's connect flow end-to-end.

__Register at:__ *nothing to register* — open sandbox. Launcher & test patients: <https://launch.smarthealthit.org>

## What you need

__Nothing.__ No account, no app registration, no `client_id` / secret.

- __Client ID:__ any string (e.g. `my-client-id`) — the open sandbox ignores it.
- __Client Secret:__ none — public / PKCE.
- It returns `patient` in the token, supports `$everything`, and accepts wildcard scopes — the easy happy path (the opposite of Blue Button's quirks).

## Connect values

| Field | Value |
|---|---|
| __FHIR base URL__ | `https://launch.smarthealthit.org/v/r4/sim/eyJsYXVuY2hfdHlwZSI6InBhdGllbnQtc3RhbmRhbG9uZSJ9/fhir` |
| __Client ID__ | anything |
| __Client Secret__ | *(blank)* |
| __Scopes__ | the prefilled default (`launch/patient patient/*.read openid fhirUser offline_access`) |

> ⚠️ The long `/sim/<base64>/fhir` path is __required__ — it encodes `{"launch_type":"patient-standalone"}`. The plain `/v/r4/fhir` returns `invalid_request`. Real providers never need this; it's a launcher quirk.

## How the "login" works

There is no real account. After __Connect__, the launcher shows a __patient picker__ — choose any synthetic patient, approve, and records import. You can tune the simulation (which patient/provider/encounter, auth errors, delays) from the launcher UI at <https://launch.smarthealthit.org>, which regenerates the base64 sim segment.

## Status (dated)

| Date | Host | Result |
|---|---|---|
| __2026-06-15__ | discovery only (no relay) | ✅ `.well-known/smart-configuration` __200__, PKCE `S256`, capabilities include `launch-standalone` + `client-public` + `context-standalone-patient`, scopes include `patient/*.*` |
| __2026-06-18__ | vendor matrix | ✅ open launcher — connects without approval (matrix row) |
| __2026-07-31__ | __demo.yourphr.org__ (`demo-relay.yourphr.org`) | ✅ __full E2E__ — account login → Sandbox/Sources connect → launcher patient pick → callback success → import (~__455 KB__ export). Preferred smoke test while CMS Blue Button sandbox login is broken ([`medicare.md`](./medicare.md)). |

Nothing to register — just connect. Prefer this sandbox over Blue Button for “does YourPHR’s SMART path still work?” checks until CMS restores synthetic beneficiary login.

## See also

- Index + status: [`../testing-sandboxes/test-sandboxes.md`](../testing-sandboxes/test-sandboxes.md)
- Vendor matrix: [`README.md`](./README.md)
- Step-by-step (Option A): [`../FHIR/fhir-testing.md`](../FHIR/fhir-testing.md)
