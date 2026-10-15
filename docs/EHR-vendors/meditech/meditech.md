# MEDITECH (Expanse)

Public facts on getting a patient-facing SMART on FHIR app to production with MEDITECH. Researched 2026-10-14 and 15 from MEDITECH's developer portal (greenfield.meditech.com), plus read-only discovery checks. Not pursued. Comparison: [`../registration-comparison.md`](../registration-comparison.md).

## At a glance

| Item | Finding |
|---|---|
| Model | __No self-registration.__ "Vendors do not self-register applications." "Client registration is performed by MEDITECH on behalf of the healthcare organization" |
| Per hospital | "Access is granted per healthcare organization; approval from one organization does not extend to others." The hospital vets the app, then opens a MEDITECH case; MEDITECH reviews and registers |
| Timeline | None stated; production is "Scheduled, Not Immediate" and "capacity-managed" |
| Sandbox | Greenfield Workspace is test-only, "not… a promotion path to production" |
| Client types | Public (PKCE required, S256) or confidential |
| Token lifetimes | __Public client: access token 1 minute, refresh token 1 week__ (rotating). Confidential: 15 minutes and 90 days |
| Token storage | Access tokens in volatile memory only, not on disk |
| Reach | 455 organizations in MEDITECH's SMART User-access Brands bundle; each hospital has its own host |
| Alternative route | MEDITECH names TEFCA (via a QHIN) as an alternative path |

## Unknowns

The Greenfield EULA text and the brands bundle's terms of use; whether any fee applies to patient access; what `/oauth/register` (advertised) does; whether one public client ID and relay redirect can serve many self-hosted installs.

## Sources

- <https://greenfield.meditech.com/explorer/topic/production-deployment>
- <https://greenfield.meditech.com/explorer/topic/clientauth>
- <https://greenfield.meditech.com/explorer/topic/tokenhandling>
- <https://greenfield.meditech.com/explorer/topic/standalonelaunch>
- Endpoint directory: <https://greenfield.meditech.com/explorer/endpoints>; brands bundle: <https://fhir-apis.meditech.com/v1/brands>
- <https://home.meditech.com/en/d/restapiresources/pages/patientaccessapisfaqs.htm>
