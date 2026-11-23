---
name: FHIR records developer guide
description: How records arrive, how they are stored, and how they become what a patient reads — the no-guessing rules, FHIR coding as the source gave it, and medications in particular
dateModified: 2026-11-23
category: guides
relatedModules: [RecordsManager, SourcesManager, SqliteFhirRepository, medication, conditions, classify, provenance, ips, patient-entry, upload]
---

# FHIR records developer guide

How a FHIR record gets into yourPHR, how it is kept, and how it becomes something a patient can read. yourPHR is a display-only client of __FHIR R4__ (types from `@medplum/fhirtypes`, FHIRPath from `fhirpath`), not a FHIR server and not an EHR. The display principles and their history are in [your-phr-dashboard/](../your-phr-dashboard/README.md); this page is the code map and the rules a change must keep.

## Standing rules

- __Raw FHIR is stored as received and never rewritten.__ Everything a page shows is derived at read time. A fix for a vendor quirk is a read-time fallback, not an edit to the stored record.
- __No guessing.__ Display only what the record states. An unstated status is `Unknown` (shown, never assumed `Active`); a nameless record is an honest "Unnamed …"; a missing value is omitted, never `null` or a placeholder.
- __Meaning first.__ The label a person reads is the record's own display text or a legible word for a known code, never a raw vendor code (`src/classify/index.ts`; the canonical case is Epic's `Encounter.class` "HOV").
- __Entered-in-error is excluded__ from every view.
- __Codings are kept exactly as the source sent them.__ Never invent a code, never add a `system` to a coding or a UCUM system to a `Quantity` that lacked one, never translate one code system into another in the stored record. Derived views carry the original codings alongside the legible text.
- __Use the canonical system URIs__ when code compares or writes a coding: RxNorm `http://www.nlm.nih.gov/research/umls/rxnorm` (`RXNORM`, `src/medication/index.ts`), LOINC `http://loinc.org`, UCUM `http://unitsofmeasure.org`, SNOMED CT `http://snomed.info/sct`, NPI `http://hl7.org/fhir/sid/us-npi`, NDC `http://hl7.org/fhir/sid/ndc`. Import the constant where one exists rather than retyping the string.
- __Every record belongs to one account and one source.__ The store keys on resource type, id, account and source; a record already held from a __different__ source is refused (`SqliteFhirRepository.COLLISION`), never overwritten.
- __Identity is asserted, never inferred.__ yourPHR holds one `Patient` per source; the person confirms which are them (`src/app/managers/identity.ts`, `RecordsManager.assertIdentity`).
- __Patient-generated data says so.__ Anything the patient or a device enters carries the PGHD tag (`PGHD_TAG`, system `https://yourphr.org/fhir/CodeSystem/record-origin`, code `pghd`; `withPghdTag` in `src/patient-entry/shared.ts`) and is filed under the person's own manual source or the device's own source, never mixed with what a clinician recorded. A typed entry also carries `meta.source` `yourphr://patient-ui`; a device Observation names the device.

## How records arrive

All writes go through `RecordsManager` (directly, or through the writer `RecordsManager.writer` hands to a source), so every path is as idempotent as a re-sync.

| Path | Code | Route |
| --- | --- | --- |
| File upload: a Bundle (`urn:uuid:` references rewritten to `Type/id`), a `List` with `contained` resources, a single resource, or NDJSON; a portal's zip (IHE XDM) | `src/upload/index.ts`, `src/upload/zip.ts`, `SourcesManager.startUpload` | `POST /api/secure/source/manual` |
| C-CDA (XML), converted to a FHIR Bundle first by the converter sidecar (`yourphr.cda-converter.*`) | `CdaSidecarConverterProvider` | the same upload route; see [import/c-cda.md](../import/c-cda.md) |
| SMART on FHIR sync from a catalog provider | `src/sources/` (fetch, query plan, US Core search), `src/sync/index.ts` (store), `SourcesManager.syncNow`, `SmartSourceClientProvider` | `POST /api/secure/provider-catalog/:id/authorize` and `…/connect`, `POST /api/secure/source/:id/sync` |
| A record the patient types (a home vital, an allergy, a medication) | `src/patient-entry/`, `RecordsManager.savePatientRecord` | `POST /api/secure/resource/patient-entry` |
| A connected device's daily and spot Observations | `HealthManager`, `RecordsManager.saveDeviceRecord` | `POST /api/secure/health/samples`; see [devices-developer-guide.md](devices-developer-guide.md) |
| A Go v1/v2 instance | `src/migrate/` | `yourphr migrate` |

Sync budgets: `yourphr.sync.max-pages` per resource type, `yourphr.sync.max-pages-per-sync` per source, `yourphr.sync.interval-seconds` for the worker.

## How records are kept

`records.db`, through `SqliteRecordsProvider` over `SqliteFhirRepository`: the raw resource, a version in `resource_history` each time it changes, and a generic search index built by evaluating every FHIR-defined `SearchParameter`'s FHIRPath expression. Chained parameters, `_include`/`_revInclude` and composite parameters throw rather than return a partial answer. Details: [storage-developer-guide.md](storage-developer-guide.md).

## How records are read

Each view is a pure derivation over raw FHIR, reached through a `RecordsManager` method (so it is behind the door and the access log):

| View | Code | Route | Access category |
| --- | --- | --- | --- |
| Conditions: tier, category and state; duplicates across sources collapse on SNOMED, then ICD, then title | `src/conditions/index.ts` | `GET /api/secure/conditions/reconciled` | Conditions |
| Allergies, immunizations, classified | `src/allergies/`, `src/immunizations/` | `GET /api/secure/allergies/classified`, `GET /api/secure/immunizations/classified` | Allergies, Immunizations |
| Medications, reconciled across sources | `src/medication/` | `GET /api/secure/medications/reconciled` | Medications |
| International Patient Summary (a FHIR `document` Bundle) | `src/ips/` | `GET /api/secure/summary/ips` | Summary (IPS) |
| Where a record came from | `src/provenance/` | `GET /api/secure/resource/provenance/:type/:id` | Records (FHIR) |
| One record, a list of a type | `RecordsManager.detail`, `RecordsManager.list` | `GET /api/secure/resource/fhir/:sourceId/:resourceId`, `GET /api/secure/resource/fhir?sourceResourceType=…` | Records (FHIR) |
| Words across every record | `RecordsManager.searchText` | `GET /api/secure/resources/search` | Record search |

## Medications and their coding

`reconcile()` in `src/medication/index.ts` collapses `MedicationRequest`, `MedicationStatement` and `MedicationDispense` (and referenced `Medication`) into one current-medications list:

- __State__ comes only from an explicit `status` (`active` → Active, `on-hold` → Suspended, `completed`/`stopped`/`cancelled`/`not-taken` → Past) or an explicit past end date; anything else is Unknown.
- __Dedup__ is at the clinical-drug level: the __RxNorm__ code when a coding with the RxNorm system has one (key `rxnorm:<code>`), else the exact normalized display text (`text:<name>`), else the record itself (`self:<type>/<id>`). Never fuzzy: under-merging is safe, wrong-merging is not.
- __Precedence__: prescribed (Request) over self-reported (Statement) over dispensed.
- __Conflicts are surfaced__: when sources disagree on state, the row is flagged, the badge follows the most recently dated stated contributor, and every contributor stays visible.
- __Codings travel intact.__ Each row carries `rxNormCode` and `originalCodings` (every coding the contributors gave: RxNorm, NDC, SNOMED, as recorded). Each contributor carries `medicationDetails()` from `src/medication/details.ts`: frequency, sig, purpose, prescriber and strength as legible strings __and__ the FHIR behind them (`dosageInstruction`, `reasons`, `prescriberReference`, `ingredients`, `medication`), with timing codes in their own system (`GTS_ABBREVIATION`), quantities in UCUM only where the record said so, and prescribers' NPI identifiers. R4 shapes first; R5 shapes (`medication` as a CodeableReference, `reason[]`, `ingredient.item`) are accepted.
- The wire shape is mapped in one place, `toWireMedication`, called by the route. `src/medication/__tests__/wire-contract.test.ts` and `npm run medication` are its contract tests.

A medication the patient adds (`buildPatientMedication`, `src/patient-entry/medication.ts`) is a `MedicationStatement` with `medicationCodeableConcept.text` exactly as typed and __no coding__, `status` from the form or `unknown`, `subject` and `informationSource` the person, the PGHD tag, and a `needs-review` tag explaining that nothing has matched the name to a known medication.

## How to change a view

1. Change the pure function and its unit test first; keep it free of store and network access.
2. Keep every rule above: nothing guessed, codings intact, entered-in-error excluded.
3. Change the wire mapping only at the route's mapper (`toWireMedication`, `toResourceFhir`), and check the Angular page that reads it.
4. Add a synthetic fixture for the quirk you handle, never a real export.

## How you know you are done

- The module's unit tests, its harness (`npm run medication`, `npm run ips`, `npm run provenance`, `npm run classify`, `npm run records`), and `npm run check:routes` pass.
- A new vendor quirk has a synthetic fixture and a human-written expected output.

## See also

- [your-phr-dashboard/classification-and-display-architecture.md](../your-phr-dashboard/classification-and-display-architecture.md), [patient-legible-display.md](../your-phr-dashboard/patient-legible-display.md): the display model
- [us-core/README.md](../us-core/README.md), [FHIR/](../FHIR/): conformance and FHIR edge cases
- [planning/medications-brainstorm-session.md](../planning/medications-brainstorm-session.md): medication design notes

## Known gaps

- __Patient-entered medications carry no RxNorm coding__ ([#763](https://github.com/jwilleke/yourphr/issues/763) put coding out of scope), so they dedup only by exact name and never merge with a coded prescription for the same drug. Patient-entered allergies likewise carry no substance coding. Home vitals are coded (LOINC, UCUM).
- The Angular app has an RxTerms typeahead (`NlmClinicalTableSearchService.searchMedication`) that would code a medication as `http://hl7.org/fhir/sid/rxnorm`, which is not RxNorm's canonical system URI; `reconcile()` would not recognise it. No page uses that typeahead today.
- `src/patient-entry/index.ts`'s header still says patient entries are tagged `patient-reported`; `shared.ts` replaced that tag with the PGHD tag.
- [development/testing-and-data.md](../development/testing-and-data.md) tells you to commit fixtures under `backend/pkg/database/testdata/`, which no longer exists.
- Provenance's clinician attribution (the Go resolver) is not ported to the conditions view.
