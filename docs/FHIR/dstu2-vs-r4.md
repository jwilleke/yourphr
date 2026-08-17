# FHIR DSTU2 vs R4 — why YourPHR is R4-only

When a provider/sandbox offers a choice of FHIR version (e.g. athenahealth's "FHIR DSTU2" vs "FHIR R4 SMART V1" products), __always choose R4__. DSTU2 is not "an older flavor we can mostly handle" — it is effectively a __different schema__ that YourPHR's R4 code path cannot ingest. This doc explains what actually differs and why it breaks ingestion.

## Version timeline

| FHIR version | Spec | Era / mandate |
|---|---|---|
| __DSTU2__ | `1.0.2` | 2015 — Argonaut / early Meaningful Use (legacy) |
| STU3 | `3.0.1` | 2017 — interim; many renames happened here |
| __R4__ | `4.0.1` | 2019 — __current__; mandated by the 21st Century Cures Act / USCDI / US Core |

YourPHR is built __R4 end-to-end__ (it imports FHIR R4 bundles; the models, search-parameter extraction, and display mappers all assume R4).

## 1. Resources renamed (DSTU2 → R4)

| DSTU2 | R4 | Domain |
|---|---|---|
| `MedicationOrder` | __`MedicationRequest`__ | prescriptions |
| `DiagnosticOrder` / `ProcedureRequest` / `ReferralRequest` | __`ServiceRequest`__ (merged into one) | orders / referrals |
| `DeviceUseRequest` | __`DeviceRequest`__ | device orders |
| `BodySite` | __`BodyStructure`__ | anatomy |
| `Conformance` | __`CapabilityStatement`__ | the server's capability/metadata document |
| `Order` / `OrderResponse` | removed (→ `Task`) | workflow |

A DSTU2 server hands you a `MedicationOrder`; YourPHR only knows `MedicationRequest`, so the resource is an __unknown type__ and is dropped.

## 2. Same name, different shape (fields restructured)

Resources that kept their name still changed internally:

- __`Condition`__ / __`AllergyIntolerance`__: `clinicalStatus` / `verificationStatus` went from a plain __`code`__ (DSTU2) to a __`CodeableConcept`__ (R4) — different JSON path and value sets.
- __`AllergyIntolerance`__: DSTU2 had `substance` + `status`; R4 restructured to `code` + `clinicalStatus` / `verificationStatus` + a richer `reaction`.
- __`MedicationStatement`__, __`Observation`__: field names, cardinalities, and `[x]` datatype choices shifted.

## 3. Terminology & datatype bindings changed

Required code systems, reference styles, and extension URLs differ between versions — so even a field that "looks the same" can carry values YourPHR's mappers don't expect.

## Why this breaks YourPHR

YourPHR's R4 assumptions are baked into three layers:

1. __Generated models__ (`backend/pkg/models/database/fhir_*.go`) — one struct per __R4__ resource type. Renamed DSTU2 types (`MedicationOrder`, `Conformance`) have no struct → skipped.
2. __Search-parameter extraction__ (`PopulateAndExtractSearchParameters`, FHIRPath over the resource) — paths target __R4__ field locations. Restructured fields (`Condition.clinicalStatus` as code vs CodeableConcept) sit at different paths → silently missed.
3. __Display mappers / classifiers__ — assume R4 shapes.

So DSTU2 data would need its own conversion path before any of this applies. Supporting it is a project of its own, not a config toggle.

## Practical rule

- __Choosing a sandbox/API product:__ pick __FHIR R4__ (e.g. athenahealth's "FHIR R4 SMART V1"). Never DSTU2.
- __"SMART V1 vs V2"__ is a *separate* axis — that's the scope grammar (`patient/*.read` vs `patient/*.rs`), not the FHIR version. YourPHR uses __R4 + SMART v1 scopes__.
- If a provider is __DSTU2-only__, treat it as out of scope until/unless a DSTU2→R4 conversion path is built.

## See also

- [`uscdi-vs-us-core.md`](uscdi-vs-us-core.md) — the *what vs how* axis (USCDI = the data list; US Core = the FHIR profiles) — a different distinction from FHIR version
- [`../testing-sandboxes/test-sandboxes.md`](../testing-sandboxes/test-sandboxes.md) — sandbox index (all R4)
- [`../vendors/athenahealth.md`](../vendors/athenahealth.md) — where this choice comes up (the "Scopes product" field)
- [`fhir-testing.md`](fhir-testing.md) — connect/testing guide
