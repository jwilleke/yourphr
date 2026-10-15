# Oracle Health code Console — the YourPHR application

The registration of yourPHR's patient app in Oracle Health's code Console (<https://code-console.cerner.com>), as configured on 2026-10-14. This is the app that real Oracle hospitals already recognise with no per-hospital activation ([#926](https://github.com/jwilleke/yourphr/issues/926), [`../registration-comparison.md`](../registration-comparison.md)). Client and application IDs are public identifiers, not secrets. This app is a public client and has no secret.

## Application information

| Field | Value |
|---|---|
| Application name | YourPHR |
| Application owner | Jim Willeke |
| Application ID | `865ab3c7-55ed-47bf-96ab-17a2bc220131` |
| Client ID | `c330e3c6-3ebe-49f3-a3a3-52dd7764d745` |
| Application type | Patient |
| Type of access | Offline (refresh tokens) |
| Application privacy | Public (no client secret; PKCE) |
| SMART version | SMART v2 |
| Intended users | Individual/Caregiver |
| Intended purposes | Individuals' Access to their EHI |
| Redirect URI | <https://relay.nerdsbythehour.com/callback> |
| SMART launch URI | — (standalone launch only) |
| Privacy policy URI | <https://yourphr.org/privacy.html> |
| Terms of service URI | <https://yourphr.org/terms.html> |
| Technical support contact URI | — |
| Technical support email | <jim@willeke.com> |
| Technical support phone | — |

## Products

| Product family | Product |
|---|---|
| Millennium | Oracle Health FHIR APIs for Millennium: FHIR R4, All |

## Standard capabilities

`launch`, `profile`, `fhirUser`, `openid`, `launch/patient`

## API access

The console shows two product lists. A patient-facing app uses the __Patient Product APIs__. The User Product APIs (for clinician and staff users) are listed for comparison.

| Resource | Patient product | User product |
|---|---|---|
| AllergyIntolerance | read, search | read, search |
| Appointment | read, search | read, search |
| Binary | read | read |
| CarePlan | read, search | read, search |
| CareTeam | read, search | read, search |
| Condition | read, search | read, search |
| Consent | read, search | read, search |
| Coverage | read, search | read, search |
| Device | read, search | read, search |
| DiagnosticReport | read, search | read, search |
| DocumentReference | read, search | read, search |
| Encounter | read, search | read, search |
| FamilyMemberHistory | read, search | read, search |
| Goal | read, search | read, search |
| Immunization | read, search | read, search |
| InsurancePlan | read, search | read, search |
| Location | — | read, search |
| Media | read | read |
| MedicationAdministration | read, search | read, search |
| MedicationDispense | read, search | read, search |
| MedicationRequest | read, search | read, search |
| NutritionOrder | read, search | read, search |
| Observation | read, search | read, search |
| Organization | — | read, search |
| Patient | read, search | read, search |
| Person | read, search | read, search |
| Practitioner | — | read, search |
| Procedure | read, search | read, search |
| Provenance | read, search | read, search |
| Questionnaire | read, search | read, search |
| QuestionnaireResponse | read, search | read, search |
| RelatedPerson | read, search | read, search |
| Schedule | read, search | read, search |
| ServiceRequest | read, search | read, search |
| Slot | read, search | read, search |
| Specimen | read, search | read, search |

## Review notes

- __Patients can't read Location, Organization or Practitioner.__ These three are on the User product only. Records from Oracle will reference practitioners and organizations yourPHR can't fetch by itself, so the address book ([#683](https://github.com/jwilleke/yourphr/issues/683)) and "who/where" displays fall back to the names inside each record, such as `display` text on references. Worth checking against a real import.
- __`offline_access` isn't in the standard capabilities list.__ Offline access comes from "Type of access: Offline" instead. yourPHR still has to request `offline_access` in its scopes to receive a refresh token.
- __Scopes must be listed one by one.__ Oracle silently drops wildcards (sandbox frictions, [`../oracle-cerner.md`](./oracle-cerner.md)). The catalog entry for Oracle production should list each `patient/<Resource>.rs` for the Patient product resources above, plus `openid fhirUser launch/patient offline_access`.
- __Write-capable or scheduling resources__ (Appointment, Schedule, Slot, Consent, NutritionOrder) are enabled read-only. yourPHR doesn't need them yet. Removing unused ones keeps the consent screen shorter for patients.
- __Hygiene still to do__ ([#926](https://github.com/jwilleke/yourphr/issues/926)): put the client ID in a DNS TXT record on `nerdsbythehour.com`, so Oracle's consent screen doesn't show "Unknown Application".
- __The support email is a personal address__ in a public repository. It's already shown to patients by Oracle; consider a project address such as one on yourphr.org.
