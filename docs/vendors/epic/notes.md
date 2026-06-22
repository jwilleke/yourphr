# Epic on FHIR — handling notes

Our-words notes on how Epic's FHIR R4 output behaves and how YourPHR handles it. Derived from Epic's public [on-FHIR specifications](https://fhir.epic.com/Specifications) and observed in the synthetic Camila Lopez sandbox export. See the data-quality doctrine in [`../../testing-sandboxes/data-quality-framework.md`](../../testing-sandboxes/data-quality-framework.md).

> The verbatim Epic spec pages (`Binary.html`, `Encounter.md`, …) are Epic's copyrighted documentation — keep them out of the committed repo (gitignored `sample-data/` or `private/`); this file is our own summary.

## Encounter

- **`class` is a *local* patient-class code, not the standard ActCode.** Epic's spec states `class` represents the ACT encounter code only for Netherlands orgs and the patient class for Denmark — i.e. in the US it's Epic's local patient class (`{code:"4", display:"HOV"}`, `{code:"3", display:"Admission"}`). It is **not** `v3-ActCode` (`AMB`/`IMP`/…), so a `legibleClass(class.code)` lookup keyed off v3 codes essentially never matches US Epic data.
- **The legible label lives in `type[].text`** ("Outpatient", "Inpatient"). Our classifier prefers `legibleClass(class.code)` (for sources that *do* send v3 codes), then falls back to `type[].text`, and only to the raw `class.display` as a last resort — so the cryptic "HOV" never surfaces as the category. Guarded by the Epic HOV golden in `backend/pkg/encounter/` + `frontend/.../encounter-model.spec.ts`.
- **`type[]` is multi-faceted** — Epic packs Contact Type, Patient Class, Appointment Visit Type, Hospital Admission Type, and Level of Service into the one array, with no discriminator for which entry is which. We take the first non-empty text; in practice that's the Patient Class ("Outpatient"/"Inpatient"), but facet order isn't guaranteed (the result stays legible either way).
- **`reasonCode` is SNOMED**; Epic raises an error (`4104`) when it can't map a value to a standard code — confirming the local-code gaps are real and known to Epic.

## Code systems

- **Clinical resources dual-code inline.** Condition/Procedure/MedicationRequest/AllergyIntolerance/DiagnosticReport carry the **standard** code (SNOMED, ICD-9/10, LOINC, CPT) *alongside* Epic's local code in the same `CodeableConcept.coding[]`. So prefer the standard entry — no Epic crosswalk needed.
- **Local-only fields** (`Encounter.class`, `Goal`) ship only Epic's proprietary code → `.text` is the only legible signal.
- **OID → URL migration (Nov 2022):** newer Epic returns standard systems as URLs (`http://snomed.info/sct`, `http://terminology.hl7.org/CodeSystem/v3-ActCode`, `hl7.org/fhir/sid/icd-10-cm`); pre-Nov-2022 exports (like the Camila slice) use the OID forms. Detect standard codings by either.
- Epic's proprietary systems sit under OID root **`1.2.840.114350.*`** (Epic Systems' registered arc) and are often site-specific — there is no public universal crosswalk; the "mapping" is the inline multi-coding above.

## Binary / generated CDAs

- **`Binary.Read` *generates* a fresh CDA** from current clinical content on each request (not a stored document), reached via `DocumentReference` → `Binary/{id}`.
- **Constraints:** ~80 CCDA calls per document per day; do **not** send `application/xml+fhir` / `json+fhir` in the `Accept` header (you want the CDA, not a FHIR wrapper); behaves differently in patient-facing contexts.
- **It's CDA (XML), not FHIR** → render via the document/CDA viewer path, not the FHIR card renderer.
- **Strip the Care-Everywhere telemetry.** Generated CDAs append a "Performance Information" table (`CPUTime`, `Globals`, block reads…) explicitly *"not part of the original document"* — a legible viewer must drop it so a patient never sees Epic's internal perf counters in their visit summary.
