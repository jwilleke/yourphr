# Patient-app registration, vendor by vendor

How a free, patient-facing, read-only SMART on FHIR app (yourPHR: public client with PKCE, standalone launch, the relay redirect `https://relay.nerdsbythehour.com/callback`, wanting `offline_access`) gets to production at each EHR vendor's customers. Researched 2026-10-14 and 15 from each vendor's own developer documentation. Each vendor's live `/.well-known/smart-configuration` was read-only checked at one or two real customer endpoints. Nothing was registered or signed up for.

Endpoint counts come from each vendor's own published list. ONC's Lantern counts ([`lantern-back-end`](https://github.com/onc-healthit/lantern-back-end), data as of 2026-09-17) differ, sometimes a lot, because some vendor lists are stale or mix patient and provider endpoints. An endpoint can be one small practice or one large health system, so the counts show breadth, not patients.

## Summary

Per-vendor detail is in each vendor's folder: [`nextgen/`](./nextgen/nextgen.md), [`eclinicalworks/`](./eclinicalworks/eclinicalworks.md), [`greenway/`](./greenway/greenway.md), [`meditech/`](./meditech/meditech.md), [`altera/`](./altera/altera.md), [`practice-fusion/`](./practice-fusion/practice-fusion.md), [`oracle/`](./oracle/oracle-application.md), [`epic/`](./epic/epic.md).

| Vendor | Model | Customers (own list) | Refresh tokens for a public client | Tracking |
|---|---|---|---|---|
| __Oracle Health (Cerner)__ | Self-service, auto-provisioned, no review. __Confirmed working__ at real hospitals 2026-10-14 | 1,319 organizations | Yes (offline access) | [#926](https://github.com/jwilleke/yourphr/issues/926), [#925](https://github.com/jwilleke/yourphr/issues/925) |
| __NextGen Enterprise__ | Self-service, no fee or contract, "does not gate" production; one notice email | about 4,820 organizations on __one shared endpoint__ | Refresh must happen within 48 h; public client advertised but unconfirmed | [#932](https://github.com/jwilleke/yourphr/issues/932) |
| __eClinicalWorks (healow)__ | Self-service; terms say "automatically approved"; live at every practice with Patient APIs on | about 17,000 practice bases, one auth server | __No__: confidential client only (`private_key_jwt` preferred), 90-day single-use refresh | [#933](https://github.com/jwilleke/yourphr/issues/933) |
| __Greenway__ | Self-service, free, __one review__ by Greenway, no per-practice step for patient apps | about 1,400 practice bases, one auth server | Yes, rotating | [#934](https://github.com/jwilleke/yourphr/issues/934) |
| __Epic__ | Self-service, then __per-organization activation__ for a refresh-token app | 522 requests for app 62263 | No: confidential client needed, then a credential per organization | [#863](https://github.com/jwilleke/yourphr/issues/863), [#924](https://github.com/jwilleke/yourphr/issues/924) |
| __Altera__ (Sunrise, Paragon, TouchWorks) | Self-service sign-up, Altera approval, then __each hospital licenses__ the app; patient login through FollowMyHealth | 248 R4 patient endpoints | Offline access available; secret-based token auth only | not started |
| __Practice Fusion__ | Own program (not Veradigm Connect); developer and app approved; about 56% of practices sign in through FollowMyHealth | 3,510 patient endpoints | Yes (300 s access token) | not started |
| __MEDITECH__ | __No self-registration.__ Each hospital vets the app and opens a MEDITECH case; MEDITECH registers the client per hospital; "capacity-managed", no timeline | 455 organizations | Public client: 1-minute access token, 1-week rotating refresh | not started |
| __athenahealth__ | Record sharing gated behind portal onboarding | — | — | [#339](https://github.com/jwilleke/yourphr/issues/339) |
| __Veradigm / FollowMyHealth__ | `unauthorized_client` for months | — | — | [#53](https://github.com/jwilleke/yourphr/issues/53) |

## What it means for yourPHR

- __Next vendors:__ Oracle, NextGen and Greenway are the clearest routes to real patients with today's public-client design.
- __A shared piece of work:__ key-based client authentication (`private_key_jwt`) held by the relay. eClinicalWorks needs it for refresh tokens, and it may be Epic's route at scale ([#924](https://github.com/jwilleke/yourphr/issues/924)). The code path exists but is dormant ([`clientid-friction.md`](./clientid-friction.md)).
- __FollowMyHealth sits behind three vendors__ (Veradigm, Altera's patient login, part of Practice Fusion), so its `unauthorized_client` problem is likely to repeat there until resolved.
- __MEDITECH is a per-hospital, on-request target.__ TEFCA (for example, through a QHIN) may be the only route that scales there.
- __Directories everywhere:__ every vendor publishes its endpoint list, and several publish SMART User-access Brands bundles (MEDITECH: `https://fhir-apis.meditech.com/v1/brands`). One searchable directory, re-imported on a schedule, serves all of them ([#925](https://github.com/jwilleke/yourphr/issues/925)).

## Sources

- __Oracle:__ <https://github.com/oracle-samples/ignite-endpoints>, <https://docs.oracle.com/en/industries/health/millennium-platform-apis/fhir-app-provisioning/>
- __NextGen:__ <https://www.nextgen.com/api/regulatory-nge>, <https://www.nextgen.com/patient-access-api>, <https://www.nextgen.com/api/terms-of-service>, <https://services.fhir.nextgen.com/FhirServiceBaseBundle-R4>
- __eClinicalWorks / healow:__ <https://connect4.healow.com/apps/jsp/dev/r4/gettingStarted.jsp>, <https://connect4.healow.com/apps/jsp/dev/r4/apiDocumentation.jsp>, <https://connect4.healow.com/apps/api/v1/fhir/activated_clinical_endpoints>
- __Greenway:__ <https://developers.greenwayhealth.com/developer-platform/docs/how-to-create-and-publish-smart-on-fhir-apps>, <https://developers.greenwayhealth.com/developer-platform/page/fees>, <https://developers.greenwayhealth.com/developer-platform/page/fhir-base-urls>
- __Epic:__ <https://fhir.epic.com/Documentation?docId=epiccommunitymemberenabledapps>, <https://fhir.epic.com/Documentation?docId=patientfacingfhirapps>
- __Altera:__ <https://developer.adp.ahcentral.com/Fhir/ProcessOverview>, <https://main.open.ahcentral.com/fhirendpoints>
- __Practice Fusion:__ <https://www.practicefusion.com/fhir/get-started/>, <https://www.practicefusion.com/fhir/api-specifications/>
- __MEDITECH:__ <https://greenfield.meditech.com/explorer/topic/production-deployment>, <https://greenfield.meditech.com/explorer/topic/clientauth>, <https://greenfield.meditech.com/explorer/topic/tokenhandling>
