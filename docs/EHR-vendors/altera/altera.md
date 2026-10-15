# Altera Digital Health (Sunrise, Paragon, TouchWorks)

Public facts on getting a patient-facing SMART on FHIR app to production with Altera. Researched 2026-10-14 from the Altera Developer Program, plus read-only discovery checks. Not pursued. Comparison: [`../registration-comparison.md`](../registration-comparison.md).

## At a glance

| Item | Finding |
|---|---|
| Program | Altera Developer Program (ADP), separate from Veradigm's since the split |
| Model | Self-service sign-up; test-only until "Request Production Access" is approved by Altera; then __each customer must license the app__ in its License Management Portal ("Integrators cannot license their applications for clients") |
| Patient login | Through FollowMyHealth (`muauthentication.followmyhealth.com`), the same sign-in server used by Veradigm ([`../veradigm/veradigm-allscripts.md`](../veradigm/veradigm-allscripts.md)) |
| Client types | Confidential or public offered; discovery lists only secret-based token auth |
| Refresh tokens | Request `offline_access`; lifetime set by each customer |
| SMART version | v1 and v2 (v2 needs Altera FHIR R4 25.4+); patient apps use `patient/…` scopes |
| Reach | 248 R4 patient endpoints in Altera's current directory |

## Unknowns

Review time; what the self-attestation requires; whether a public client works in practice; whether individual or open-source developers are accepted; fees.

## Sources

- <https://developer.adp.ahcentral.com/Fhir/ProcessOverview>
- <https://developer.adp.ahcentral.com/Fhir/Introduction>
- <https://developer.adp.ahcentral.com/Fhir/SMARTonFHIR>
- Endpoint directory: <https://main.open.ahcentral.com/fhirendpoints>
