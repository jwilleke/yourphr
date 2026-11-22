# The YourPHR dashboard

The dashboard is the patient's __home view of their own health__ — the first screen that should answer "what's going on with me?" in plain language. It is the primary surface where the [patient-legible display north star](./patient-legible-display.md) (#262) is proven or fails.

> Mission: __Your medical records, immediately and in your hands — for free.__ The dashboard is where "in your hands" has to mean *understandable*, not just *present*.

## Design principles

The dashboard inherits the [patient-legible north star](./patient-legible-display.md) (#262):

- __Meaning first__ — show what each thing *is* and *why it matters*, in plain words; demote FHIR resource types, statuses, IDs, and references.
- __Organize by the patient's mental model__ — "My medications / conditions / recent results", not FHIR resource types.
- __Translate codes__ — never show a raw code to a patient.
- __Complete on demand__ — the legible summary is the default; the full technical record stays one click away (the per-resource `fhir-card` "details" view).

## Architecture

The dashboard is __config-driven__:

- `frontend/src/app/pages/dashboard/` — the dashboard page that lays out widgets.
- `frontend/src/app/models/widget/dashboard-config.ts` + `dashboard-widget-config.ts` — the config model: which widgets render, in what order, with what query/config.
- `frontend/src/app/widgets/` — the widget components (one per visualization), each implementing `dashboard-widget-component-interface.ts`.

### The Patient Dashboard (current default)

`backend/pkg/web/handler/dashboard/default.json` is the single dominant __Patient Dashboard__. It leads with the Cures-Act core in the order a person cares about, and carries __no demo/placeholder data__:

1. Medications · 2. Problems · 3. Allergies · 4. Immunizations · 5. Procedures · 6. Clinical Notes · 7. Patient Vitals · 8. Blood Pressure · 9. Weight · 10. Height · 11. Recent Encounters · 12. Care Team

The earlier upstream "Example Dashboard" (which led with fake "Records Summary"/"Compliance" demo widgets) and the demo-only "Secondary Dashboard" were removed — see #262/#244. The handler embeds and lists `dashboard/*.json`, so a config file *is* a dashboard.

A __generic `profile-summary-widget`__ (config row per profile group, #245) covers list-style profiles, reusing the #136 `fhir-card`s for detail — plus a few __bespoke__ widgets where a summary line isn't enough (vitals trends, blood pressure). Future long-tail categories can go in a separate "All categories" dashboard (just add another `dashboard/*.json`), per #244.

Full rationale and decisions: `docs/your-phr-dashboard/per-profile-dashboards-brainstorm.md` and epic #244.

## Widget catalog (current)

| Widget | Purpose |
| --- | --- |
| `profile-summary-widget` | Generic per-profile summary list (the workhorse, #245) |
| `medications-widget` | Current Medications (uses the reconciled-medications model — the legible exemplar) |
| `patient-vitals-widget` | Vital signs |
| `records-summary-widget` | High-level counts / overview |
| `complex-line-widget`, `simple-line-chart-widget`, `grouped-bar-chart-widget`, `donut-chart-widget`, `dual-gauges-widget` | Trends / charts |
| `table-widget`, `image-list-group-widget` | Tabular / image-list displays |
| `empty-widget`, `loading-widget` | Empty / loading states |

## The legible exemplar: medications

The __medications-widget__ and __Current Medications page__ use the backend *reconciled* model (`GET /api/secure/medications/reconciled`, `src/medication/index.ts`) rather than rendering raw FHIR. That model is the pattern the rest of the dashboard should follow — it derives a single legible row per drug, merging evidence from `MedicationStatement`/`Request`/`Dispense`. The route sends each row through `toWireMedication()`, the one place the server shape is mapped to the page's contract (`frontend/src/app/models/fasten/reconciled-medication.ts`): a unique `key`, `title`, plain `state` (Active/Suspended/Past/Unknown), `dose`, `lastActivity` (latest contributor date) and `contributors[].sourceResourceId` (yourphr#1025). The Go-era detail fields are mapped from FHIR in `src/medication/details.ts`, each as a legible line plus its coded companion with codings kept exactly as recorded (no code, UCUM system or display is ever added):

| Wire field | FHIR source | Coded companion |
| --- | --- | --- |
| `frequency` | `dosageInstruction[]` / `dosage[]`: `timing.code` (text/display, e.g. GTS `BID`), else `timing.repeat` (frequency/period/periodUnit, `when`, `dayOfWeek`, `timeOfDay`), plus `asNeeded[x]` / R5 `asNeededFor` — every instruction, joined with semicolons | `dosageInstruction[]` (timing code + repeat, route, site, method, `doseAndRate` Quantities) |
| `sig` | `Dosage.text` and `patientInstruction`; with neither, the coded dose, route and frequency read back | `dosageInstruction[]` |
| `purpose` | `reasonCode[]` text/display; `reasonReference[]` → the referenced Condition's `code`, else the reference `display`; R5 `reason[]` | `reasons[]` (`concept` with SNOMED/ICD-10 codings, `reference`) |
| `prescriber` | `MedicationRequest.requester` / `MedicationStatement.informationSource` → Practitioner name, Organization name, PractitionerRole display, else the reference `display`. A Patient/RelatedPerson is never a prescriber | `prescriberReference` (reference, type, display, NPI identifier) |
| `strength` | `Medication.ingredient[].strength` (R4 Ratio; R5 `strengthRatio`/`strengthQuantity`/`strengthCodeableConcept`) of the contained (`#id`) or referenced Medication, active ingredients; last resort read off the RxNorm-style name (text only) | `ingredients[]` (item concept, Ratio/Quantity with UCUM system/code as recorded) |
| `originalCodings` | every coding of the drug concept across contributors (RxNorm, NDC, SNOMED…) | — |

The drug concept is `medicationCodeableConcept` (R5 `medication.concept`), else the resolved Medication's `code`, else the reference display — so a `medicationReference`-only record now has a name and dedups on its RxNorm code. Row-level details follow the dose precedence (Request > Statement > Dispense: the first contributor that states it) and the coded companion comes from that same contributor; each contributor carries its own lines and FHIR too. References resolve only within the record's own source and only from chart records (not ones awaiting review); unresolved, the reference's `display` is used. Every field is omitted when the records are silent. `patientDisplay` (RxTerms) and `provenance` still have no source and are absent; the page falls back.

This is the difference between "MedicationStatement / unknown / active" and "Lisinopril — a blood-pressure medicine, 1 tablet daily."

## Known gaps

- __Medication card display gaps + reference-resolution blocker__ — #264. (The reconciled list resolves the drug name from a separate `Medication` resource; the raw per-resource card does not yet, and cards have no related-resource plumbing.)
- The broader Must-Support display gaps — #249; the US Core display end-state — #136.

## Canonical sources

- North star: [`docs/your-phr-dashboard/patient-legible-display.md`](./patient-legible-display.md) (#262)
- Dashboard design + decisions: `docs/your-phr-dashboard/per-profile-dashboards-brainstorm.md` (#244)
- Profile-summary widget: #245
- US Core display: #136 / #249
