# NextGen Healthcare (NextGen Enterprise)

Public facts on getting a patient-facing SMART on FHIR app to production with NextGen Enterprise (NGE). Researched 2026-10-14 from NextGen's own documentation, plus read-only checks of the live discovery documents. Not yet registered: [#932](https://github.com/jwilleke/yourphr/issues/932). Comparison across vendors: [`../registration-comparison.md`](../registration-comparison.md).

## At a glance

| Item | Finding |
|---|---|
| Model | __Self-service.__ NextGen "does not gate or otherwise control the progression from Development > Beta > Production for Patient Access API apps"; you notify NextGen before going live |
| Reach | __One shared endpoint__ for every customer: `https://fhir.nextgen.com/nge/prod/fhir-api-r4/fhir/r4/`. Its directory bundle lists about 4,820 organizations |
| Fees and contract | "Patient Access API Program: No Fees"; "no contracting requirements". The read-only API Terms of Service still apply |
| Practice side | No per-app approval. The practice must have NextGen's free API Suite Manager installed (NGE 5.9.0+). NextGen's Practice Search shows which do |
| Patient login | The patient's NextGen portal credentials select the practice. There is no practice picker |
| Client types (live discovery) | `client-public`, `client-confidential-symmetric`, `client-confidential-asymmetric`; PKCE S256; `permission-offline`, v1 and v2 |
| Refresh tokens | Supported; __must be exchanged within 48 hours__ of issue (2021 docs) |
| Terms to note | ToS 4.b.i: "Developer credentials may not be embedded in open source projects" |

## Registration

NextGen API Developer Portal (developer.nextgen.com): an organizational email, SMS 2FA, and the Org Admin role. Add Application: name, description, callback URL(s), FHIR R4. The 2021 documents show a confidential flow only; whether the portal now issues a public client is unconfirmed.

## Live discovery (2026-10-14)

`/.well-known/smart-configuration` on the shared endpoint: authorize, token and revoke at `https://fhir.nextgen.com/nge/prod/patient-oauth/…`; grants `authorization_code`, `client_credentials`, `refresh_token`. `/metadata`: FHIR 4.0.1, US Core R4, 28 resource types.

## Unknowns

Whether a public client can be registered today; access-token lifetime and refresh rotation; whether the 48-hour rule still holds; whether an administrator still approves "Add Application"; how many directory organizations have API Suite Manager installed. NextGen Office (NGO) is a separate stack and isn't covered here.

## Sources

- <https://www.nextgen.com/api/regulatory-nge>
- <https://www.nextgen.com/patient-access-api>
- <https://www.nextgen.com/api/terms-of-service>
- NGE Patient API Auth Guide and App Request/Config Process (PDFs, 2021): <https://www.nextgen.com/-/media/files/api/NGE-App-Request-Config-Process.pdf>
- Directory bundle: <https://services.fhir.nextgen.com/FhirServiceBaseBundle-R4>
- Practice Search: <https://www.nextgen.com/api/practice-search>
