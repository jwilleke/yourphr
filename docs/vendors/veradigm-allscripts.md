# Veradigm (formerly Allscripts)

Vendor reference for __Veradigm Inc.__ — the company formerly known as __Allscripts Healthcare Solutions__ — and the owner of [FollowMyHealth](./followmyhealth.md), the patient portal whose exports YourPHR consumes.

## Overview

__Veradigm__ is a US health-IT company providing electronic health records, health data and analytics, payer/life-sciences solutions, and patient engagement. For YourPHR it matters as the __owner and gatekeeper of FollowMyHealth__ and of the SMART on FHIR APIs and developer/partner program that govern live sync.

Like FollowMyHealth, Veradigm's products are __proprietary and closed-source.__

## Ownership & History

- __Allscripts__ was founded in 1986 and grew into one of the largest US EHR / health-IT vendors (HQ Chicago). It expanded heavily by acquisition — including __Eclipsys (2010)__, __dbMotion__, __Jardogs / FollowMyHealth (2013)__, and __Practice Fusion (2018)__.
- __2022:__ Allscripts __sold its hospital and large-physician-practice EHR business__ (Sunrise, TouchWorks, and related products) to __Constellation Software / N. Harris Computer Corp__; that business was renamed __Altera Digital Health__.
- __2023:__ the remaining company — data/analytics, payer & life-sciences, ambulatory EHR (Professional EHR, Practice Fusion), and patient engagement (FollowMyHealth) — __rebranded as Veradigm Inc.__
- __2024 onward:__ Veradigm faced __Nasdaq listing-compliance problems__ stemming from delayed financial filings (a previously disclosed software issue affecting revenue reporting). Treat the company's current listing/financial status as something to __verify against a current source__ rather than rely on this doc — it is the kind of fact that ages quickly.

> __Note on identifiers (this repo):__ YourPHR keeps upstream technical identifiers tied to the original project (e.g. `fasten-sources`). The "Veradigm" / "Allscripts" / "FollowMyHealth" names here refer to the external vendor, not to anything we rename in code.

## Products

Relevant to YourPHR:

- __FollowMyHealth__ — patient portal / PHR; see [`followmyhealth.md`](./followmyhealth.md).
- __Professional EHR__ and __Practice Fusion__ — ambulatory EHRs that can be upstream sources of the data surfaced in FollowMyHealth.
- __Veradigm Connect__ — the developer program / portal that issues API credentials and grants production access.

(The former Sunrise/TouchWorks hospital EHRs now belong to __Altera Digital Health__ and are out of scope here.)

## Contact

| Purpose | Where |
|---|---|
| Developer program / API support | `VeradigmConnect@veradigm.com` |
| Developer portal | `https://developer.veradigm.com` |
| Partner / production-access request | `https://developer.veradigm.com/Account/PartnerRequest` |
| This project's open ticket | __#17849__ (`unauthorized_client` on connect) — see [`../FHIR/fhir-testing.md`](../FHIR/fhir-testing.md) and [#53](https://github.com/jwilleke/yourphr/issues/53) |

## API & Integration

- __SMART on FHIR:__ Veradigm exposes SMART-on-FHIR endpoints (FollowMyHealth's are under `fhir.followmyhealth.com` with auth at `muauthentication.followmyhealth.com`). Authorization is authorization-code + PKCE.
- __Test vs. production:__ registered apps start __Test Only__ and can reach only Veradigm __test__ organizations (synthetic patients, no PHI). Production access is granted per-app via a __partner request__ with a multi-day review. The full test-vs-real breakdown is in [`../FHIR/fhir-testing.md`](../FHIR/fhir-testing.md).
- __App types:__ Veradigm's discovery advertises both public and confidential client capabilities; in practice the published metadata is __inconsistent__ (see Known API Issues).

## Known API Issues

1. __`unauthorized_client` blocks the connect flow (first logged 2026-06-05; still open as of 2026-07-31).__ A registered app cannot complete authorization against FollowMyHealth; the flow never reaches token exchange. This requires Veradigm to authorize the app (ticket __#17849__). Tracked in [#53](https://github.com/jwilleke/yourphr/issues/53). __YourPHR cannot resolve this unilaterally__ — it depends on Veradigm granting access.
2. __Contradictory discovery metadata.__ The discovery document advertises a `client-public` capability *and* confidential-only token-endpoint auth methods (`client-confidential-symmetric`/`-asymmetric`). Because the handshake never reaches token exchange, it is __not__ yet confirmed whether a confidential client is actually required — so YourPHR has deliberately __not__ built confidential-client support speculatively.
3. __`fasten-sources` is stubbed in this fork.__ The upstream provider-client package went private; this repo replaces it with a local stub that has no real OAuth clients. Combined with (1), __live provider sync is non-functional__ here, and __manual FHIR bundle upload is the supported import path.__ Implementing a real SMART client for Veradigm/FollowMyHealth is a roadmap item.
4. __Data-shape issues__ (non-US-Core Encounters, compound reference ids, document titles/bodies, text-only concepts) live with the data itself — see the Known API Issues in [`followmyhealth.md`](./followmyhealth.md).

## Relevance to YourPHR

Veradigm is the __external dependency__ standing between YourPHR and live FollowMyHealth sync. Everything we can do without Veradigm's cooperation — faithfully importing and displaying the patient-initiated export — is in scope and actively worked (EPIC [#2](https://github.com/jwilleke/yourphr/issues/2)). Everything that requires Veradigm to authorize an app ([#53](https://github.com/jwilleke/yourphr/issues/53)) is __blocked on the vendor__, not on us.

## References / Related issues

- Internal: [`followmyhealth.md`](./followmyhealth.md), [`../FHIR/fhir-testing.md`](../FHIR/fhir-testing.md), [`../FHIR/fhir-test-discovery-example.md`](../FHIR/fhir-test-discovery-example.md), [`../Roadmap.md`](../Roadmap.md)
- Issues: [#2](https://github.com/jwilleke/yourphr/issues/2) (standalone EPIC), [#53](https://github.com/jwilleke/yourphr/issues/53) (SMART sync, blocked), [#54](https://github.com/jwilleke/yourphr/issues/54) (display)
- External: `https://veradigm.com`, `https://developer.veradigm.com`, `https://developer.veradigm.com/Account/PartnerRequest`
