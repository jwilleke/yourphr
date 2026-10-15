# Greenway Health (Intergy, Prime Suite)

Public facts on getting a patient-facing SMART on FHIR app to production with Greenway. Researched 2026-10-14 from Greenway's developer documentation, plus read-only discovery checks. Not yet registered: [#934](https://github.com/jwilleke/yourphr/issues/934). Comparison: [`../registration-comparison.md`](../registration-comparison.md).

## At a glance

| Item | Finding |
|---|---|
| Model | __Self-service, one review by Greenway__ ("Submit for Review"); once approved the app is published in the App Gallery |
| Per-practice step | None documented for patient apps (only Backend Services apps need written site permission) |
| Fees | "There are currently no fees for the use of the Greenway Health FHIR API, Developer Platform, and Application Gallery" |
| Reach | About 1,400 practice bases on `https://fhir-api.fhirprod.aws.greenwayhealth.com/fhir/R4/{tenant-OID}`, one auth server (`https://auth-api.login.greenwayhealth.com/oauth2`) |
| Client types | Public or confidential |
| PKCE | Mandatory since 2025-10-20, S256 only |
| Refresh tokens | `offline_access` supported; refresh tokens rotate |
| Scopes | SMART v1 `.read` and v2 `.rs`, read-only. Appointment and Consent return `invalid_scope` |
| Patient login | Greenway Patient Portal or SmartHub credentials |

## Unknowns

How long the review takes; refresh-token lifetime; whether a practice can block an approved patient app; whether a non-commercial, self-hosted app is approved.

## Sources

- <https://developers.greenwayhealth.com/developer-platform/docs/how-to-create-and-publish-smart-on-fhir-apps>
- <https://developers.greenwayhealth.com/developer-platform/page/fees>
- <https://developers.greenwayhealth.com/developer-platform/page/fhir-base-urls>
- <https://developers.greenwayhealth.com/developer-platform/docs/hti1-updates>
- <https://developers.greenwayhealth.com/developer-platform/docs/frequently-asked-questions-for-developers>
