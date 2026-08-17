# FollowMyHealth

Vendor reference for __FollowMyHealth__, the patient portal whose FHIR R4 exports are the primary real-world data YourPHR is being hardened against.

## Overview

__FollowMyHealth__ (FMH) is a patient-engagement platform and personal health record (PHR) portal. It gives patients a single account to view records pulled from their providers' EHRs, message care teams, request prescription refills, schedule appointments, and download/export their data. It is __not__ an EHR itself — it is a patient-facing aggregation layer that connects to provider systems and presents the patient's longitudinal record.

It is __proprietary, closed-source, vendor-hosted software.__ There is no open-source implementation, and patients/developers cannot self-host it. YourPHR's relationship to FollowMyHealth is one-directional: we consume the __patient-initiated data export__ (a FHIR R4 bundle) that FMH lets patients download.

## Ownership & History

- __Jardogs LLC__ (Bloomington, Illinois; founded ~2009) built FollowMyHealth.
- __Allscripts acquired Jardogs in 2013__ and operated FollowMyHealth as its patient-engagement product.
- Allscripts __rebranded to Veradigm in 2023__, so FollowMyHealth is today a __Veradigm__ product. See [`veradigm-allscripts.md`](./veradigm-allscripts.md) for the corporate lineage and developer/partner access details.

## Products

FollowMyHealth is itself a suite (patient web portal, mobile apps, and the provider-/payer-facing engagement tooling). For YourPHR only two things matter:

- The __patient data export__ — a downloadable archive containing a FHIR R4 JSON bundle plus the document files it references.
- The __SMART on FHIR API__ — for live sync (see Known API Issues; not currently usable in this fork).

## Contact

| Purpose | Where |
|---|---|
| Patient support | Through the FollowMyHealth portal / the patient's provider |
| Developer / API support | `VeradigmConnect@veradigm.com` (Veradigm Connect program) |
| Developer portal | `https://developer.veradigm.com` |
| Partner / production-access request | `https://developer.veradigm.com/Account/PartnerRequest` |
| Open support ticket (this project) | __#17849__ — Veradigm `unauthorized_client` on connect; steps to reproduce are in [`../FHIR/fhir-testing.md`](../FHIR/fhir-testing.md) and mirrored on [#53](https://github.com/jwilleke/yourphr/issues/53) |

## API & Integration

- __FHIR base / discovery:__ FollowMyHealth advertises SMART endpoints under `fhir.followmyhealth.com` with authorization at `muauthentication.followmyhealth.com` (`/api/access` token endpoint, `/api/jwks`). A captured discovery document is in [`../FHIR/fhir-test-discovery-example.md`](../FHIR/fhir-test-discovery-example.md).
- __Access model:__ a registered app is __"Test Only"__ by default and reaches only Veradigm __test__ organizations (synthetic patients, no PHI). Reaching real patient data requires Veradigm to grant __production__ access — a partner request with a multi-day review. See the test-vs-real matrix in [`../FHIR/fhir-testing.md`](../FHIR/fhir-testing.md).
- __Auth:__ authorization-code + PKCE. The discovery is internally __contradictory__ — it advertises a `client-public` capability *and* confidential-only token-endpoint auth methods (`client-confidential-symmetric`/`-asymmetric`), which is part of why the connect flow stalls (see below).

## Importing & re-importing

Since live sync is blocked (see Known API Issues), the supported path is __manual upload of the patient-initiated export__.

__Which file?__ The __FHIR R4 JSON bundle only__ (the `…AllPatientData.json` in the export archive). The sibling document files (`.txt`/`.jpg`/`.xml`/`.html`) are __not__ read by the importer — they are referenced only by relative `./…` URLs that YourPHR never fetches (see Known API Issues #5).

__To import:__ add a manual source and upload the JSON bundle.

__To re-import__ (e.g. to pick up the link-repair [#196](https://github.com/jwilleke/yourphr/issues/196) and document-title [#201](https://github.com/jwilleke/yourphr/issues/201) fixes, which are computed __at import time__ and so do not apply to already-stored records): just __upload the same JSON again.__ Re-import is safe and idempotent:

- The manual source is matched by patient id (`CreateSource` does a `FirstOrCreate` on `(user, endpoint, patient)`; a manual upload has no endpoint, and the patient id comes from the bundle), so re-uploading the __same__ export __reuses the existing source__ rather than creating a second one.
- Each resource is __upserted in place__ by its id and re-run through search-parameter extraction (new `sort_title`) and association building (the corrected reference links) — __no duplicate records.__
- Stale association edges from the first import linger but are __harmless__ (they point at ids no resource has); the re-import adds the correct links alongside them.

__Optional clean slate:__ delete the existing FollowMyHealth source first, then upload — this drops the old records and stale edges and rebuilds everything fresh. Not required, just tidier.

> __Caveat:__ this assumes the patient id in the bundle is unchanged between imports (it is, for the same export). If it ever differed you would get a second source — in which case delete the duplicate.

## Known API Issues

These are the concrete problems YourPHR has hit with real FollowMyHealth data and APIs. Most have been mitigated on the __import/display__ side; live sync remains externally blocked.

1. __Live sync is blocked at authorization (first logged 2026-06-05; still open as of 2026-07-31).__ Connecting a FollowMyHealth source fails with `unauthorized_client`; the flow never reaches token exchange. This needs Veradigm to authorize the app (ticket __#17849__). Tracked in [#53](https://github.com/jwilleke/yourphr/issues/53). Because `fasten-sources` is stubbed in this fork, __manual bundle upload is the supported import path.__
2. __Compound reference ids break resource links.__ FMH references resources as `Type/{patientId}_{resourceId}` but stores each resource under the bare `{resourceId}`, so links (e.g. Procedure → Encounter) dangle. Fixed in [#196](https://github.com/jwilleke/yourphr/issues/196) by associating the stripped suffix as well. __Existing imports must be re-imported__ for the corrected links.
3. __Non-US-Core Encounters.__ Often no `type[]`, a `class` with a `system` but no `code`/`display`, and only a `location`. The card now falls back through `type` → `serviceType` → `class` → `location` rather than rendering blank ([#54](https://github.com/jwilleke/yourphr/issues/54) follow-up).
4. __DocumentReference titles.__ Documents carry a generic `type.text` (e.g. `"HIPAA"`) and put the real name in `description` / `type.coding[0].display` / `content[0].attachment.title`. Titling off `type.text` labelled thousands of distinct documents identically — fixed in the card ([#198](https://github.com/jwilleke/yourphr/issues/198)) and the backend sort_title ([#201](https://github.com/jwilleke/yourphr/issues/201)).
5. __Document bodies are not in the bundle.__ Each DocumentReference's `content[0].attachment.url` is a __relative path__ (`./…`) to a sibling file (`.txt`/`.jpg`/`.xml`/`.html`) in the export archive — *not* inline data. A single JSON-bundle upload therefore carries __metadata only__; rendering the bodies would require a separate file-upload import path. (In one real export, 5,562 such files backed 5,564 DocumentReferences.)
6. __Text-only CodeableConcepts and local code systems.__ Many coded fields have `text` but no `coding[]`, or use local systems (e.g. `https://fhir.followmyhealth.com/id/translation`). Search-parameter extraction now indexes text-only concepts ([#171](https://github.com/jwilleke/yourphr/issues/171)).
7. __Encounter dates are usually — but not always — real.__ `period.start` is the genuine visit date for ~95% of encounters; a small number of "catch-all" encounters carry the record-creation date instead. YourPHR displays the record-stated `period`, and deliberately does __not__ infer a date from linked resources (that would fabricate data).

## Relevance to YourPHR

FollowMyHealth is the __reference non-US-Core dataset__ for this fork. The project's near-term mission — immediate, complete patient access to records — depends on rendering FMH exports faithfully even though they diverge from strict US Core. When fixing display issues, prefer graceful fallbacks for missing US-Core fields over assuming conformance. The fixes above (and the broader effort under EPIC [#2](https://github.com/jwilleke/yourphr/issues/2)) come directly from analyzing real FMH exports.

## References / Related issues

- Internal: [`../FHIR/fhir-testing.md`](../FHIR/fhir-testing.md), [`../FHIR/fhir-test-discovery-example.md`](../FHIR/fhir-test-discovery-example.md), [`veradigm-allscripts.md`](./veradigm-allscripts.md), [`../Roadmap.md`](../Roadmap.md)
- Issues: [#2](https://github.com/jwilleke/yourphr/issues/2) (standalone EPIC), [#53](https://github.com/jwilleke/yourphr/issues/53) (SMART sync, blocked), [#54](https://github.com/jwilleke/yourphr/issues/54) (display), [#171](https://github.com/jwilleke/yourphr/issues/171) (search extraction), [#196](https://github.com/jwilleke/yourphr/issues/196) (compound refs), [#198](https://github.com/jwilleke/yourphr/issues/198) / [#201](https://github.com/jwilleke/yourphr/issues/201) (document titles)
- External: `https://www.followmyhealth.com`, `https://developer.veradigm.com`
