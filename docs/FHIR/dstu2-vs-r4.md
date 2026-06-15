# FHIR DSTU2 vs R4 — why YourPHR is R4-only

When a provider/sandbox offers a choice of FHIR version (e.g. athenahealth's "FHIR DSTU2" vs "FHIR R4 SMART V1" products), **always choose R4**. DSTU2 is not "an older flavor we can mostly handle" — it is effectively a **different schema** that YourPHR's R4 code path cannot ingest. This doc explains what actually differs and why it breaks ingestion.

## Version timeline

| FHIR version | Spec | Era / mandate |
|---|---|---|
| **DSTU2** | `1.0.2` | 2015 — Argonaut / early Meaningful Use (legacy) |
| STU3 | `3.0.1` | 2017 — interim; many renames happened here |
| **R4** | `4.0.1` | 2019 — **current**; mandated by the 21st Century Cures Act / USCDI / US Core |

YourPHR is built **R4 end-to-end** (it imports FHIR R4 bundles; the models, search-parameter extraction, and display mappers all assume R4).

## 1. Resources renamed (DSTU2 → R4)

| DSTU2 | R4 | Domain |
|---|---|---|
| `MedicationOrder` | **`MedicationRequest`** | prescriptions |
| `DiagnosticOrder` / `ProcedureRequest` / `ReferralRequest` | **`ServiceRequest`** (merged into one) | orders / referrals |
| `DeviceUseRequest` | **`DeviceRequest`** | device orders |
| `BodySite` | **`BodyStructure`** | anatomy |
| `Conformance` | **`CapabilityStatement`** | the server's capability/metadata document |
| `Order` / `OrderResponse` | removed (→ `Task`) | workflow |

A DSTU2 server hands you a `MedicationOrder`; YourPHR only knows `MedicationRequest`, so the resource is an **unknown type** and is dropped.

## 2. Same name, different shape (fields restructured)

Resources that kept their name still changed internally:

- **`Condition`** / **`AllergyIntolerance`**: `clinicalStatus` / `verificationStatus` went from a plain **`code`** (DSTU2) to a **`CodeableConcept`** (R4) — different JSON path and value sets.
- **`AllergyIntolerance`**: DSTU2 had `substance` + `status`; R4 restructured to `code` + `clinicalStatus` / `verificationStatus` + a richer `reaction`.
- **`MedicationStatement`**, **`Observation`**: field names, cardinalities, and `[x]` datatype choices shifted.

## 3. Terminology & datatype bindings changed

Required code systems, reference styles, and extension URLs differ between versions — so even a field that "looks the same" can carry values YourPHR's mappers don't expect.

## Why this breaks YourPHR

YourPHR's R4 assumptions are baked into three layers:

1. **Generated models** (`backend/pkg/models/database/fhir_*.go`) — one struct per **R4** resource type. Renamed DSTU2 types (`MedicationOrder`, `Conformance`) have no struct → skipped.
2. **Search-parameter extraction** (`PopulateAndExtractSearchParameters`, FHIRPath over the resource) — paths target **R4** field locations. Restructured fields (`Condition.clinicalStatus` as code vs CodeableConcept) sit at different paths → silently missed.
3. **Display mappers / classifiers** — assume R4 shapes.

So DSTU2 data would need its own conversion path before any of this applies. Supporting it is a project of its own, not a config toggle.

## Practical rule

- **Choosing a sandbox/API product:** pick **FHIR R4** (e.g. athenahealth's "FHIR R4 SMART V1"). Never DSTU2.
- **"SMART V1 vs V2"** is a *separate* axis — that's the scope grammar (`patient/*.read` vs `patient/*.rs`), not the FHIR version. YourPHR uses **R4 + SMART v1 scopes**.
- If a provider is **DSTU2-only**, treat it as out of scope until/unless a DSTU2→R4 conversion path is built.

## See also

- [`../test-sandboxes.md`](../test-sandboxes.md) — sandbox index (all R4)
- [`../vendors/athenahealth.md`](../vendors/athenahealth.md) — where this choice comes up (the "Scopes product" field)
- [`fhir-testing.md`](fhir-testing.md) — connect/testing guide
