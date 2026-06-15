# SMART Health IT sandbox (launch.smarthealthit.org)

The **public reference SMART on FHIR sandbox** — fake patients, **zero registration, zero credentials**. Maintained by the SMART team, so it's the cleanest "does our code conform to standard SMART" check, and the fastest way for a new contributor to validate YourPHR's connect flow end-to-end.

**Register at:** _nothing to register_ — open sandbox. Launcher & test patients: <https://launch.smarthealthit.org>

## What you need

**Nothing.** No account, no app registration, no `client_id` / secret.

- **Client ID:** any string (e.g. `my-client-id`) — the open sandbox ignores it.
- **Client Secret:** none — public / PKCE.
- It returns `patient` in the token, supports `$everything`, and accepts wildcard scopes — the easy happy path (the opposite of Blue Button's quirks).

## Connect values

| Field | Value |
|---|---|
| **FHIR base URL** | `https://launch.smarthealthit.org/v/r4/sim/eyJsYXVuY2hfdHlwZSI6InBhdGllbnQtc3RhbmRhbG9uZSJ9/fhir` |
| **Client ID** | anything |
| **Client Secret** | _(blank)_ |
| **Scopes** | the prefilled default (`launch/patient patient/*.read openid fhirUser offline_access`) |

> ⚠️ The long `/sim/<base64>/fhir` path is **required** — it encodes `{"launch_type":"patient-standalone"}`. The plain `/v/r4/fhir` returns `invalid_request`. Real providers never need this; it's a launcher quirk.

## How the "login" works

There is no real account. After **Connect**, the launcher shows a **patient picker** — choose any synthetic patient, approve, and records import. You can tune the simulation (which patient/provider/encounter, auth errors, delays) from the launcher UI at <https://launch.smarthealthit.org>, which regenerates the base64 sim segment.

## Status

- ✅ Discovery pre-flight verified (2026-06-15, no relay needed): **200**, PKCE `S256`, capabilities include `launch-standalone` + `client-public` + `context-standalone-patient`, scopes include `patient/*.*`.
- Nothing to register — just connect.

## See also

- Index + status: [`../test-sandboxes.md`](../test-sandboxes.md)
- Step-by-step (Option A): [`../FHIR/fhir-testing.md`](../FHIR/fhir-testing.md)
