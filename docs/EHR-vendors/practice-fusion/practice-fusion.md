# Practice Fusion

Public facts on getting a patient-facing SMART on FHIR app to production with Practice Fusion (owned by Veradigm, but with its own developer program). Researched 2026-10-14 from Practice Fusion's documentation, plus read-only discovery checks. Not pursued. Comparison: [`../registration-comparison.md`](../registration-comparison.md).

## At a glance

| Item | Finding |
|---|---|
| Program | Practice Fusion's own PDS API program, not Veradigm Connect |
| Model | __Gated:__ a partner registration form, then approval of the developer account; the app must be "approved and available in the Practice Fusion App Marketplace" |
| Per-practice | Practices "manage FHIR connections in the EHR, choosing what data is shared"; whether that's opt-in for patient apps is unclear |
| Fees | "Practice Fusion does not charge API fees" for development, deployment or usage (May 2024 fee sheet) |
| Client types | Public stand-alone launch apps supported; PKCE S256 |
| Tokens | Access token 300 s; refresh token with `offline_access` (lifetime not stated) |
| SMART version | App Launch v2.0.0; v1 and v2 scopes; FHIR R4, US Core 6.1.0 |
| Reach | 3,510 patient-access endpoints: about 56% sign in through FollowMyHealth (`muauthentication.followmyhealth.com`), the rest through Patient Fusion. "Separate app registrations are required for each patient portal" |

## Unknowns

Review time; practice opt-in; refresh-token lifetime; whether a Practice Fusion-issued FollowMyHealth client ID would work where yourPHR's Veradigm registration fails.

## Sources

- <https://www.practicefusion.com/fhir/get-started/>
- <https://www.practicefusion.com/fhir/api-specifications/>
- <https://www.practicefusion.com/fhir/api-specifications/sandbox-documentation/>
- <https://www.practicefusion.com/pds-api/termsofservice/>
- Endpoint bundle: <https://www.practicefusion.com/assets/static_files/ServiceBaseURLs.json>
