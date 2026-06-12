# The YourPHR dashboard

The dashboard is the patient's **home view of their own health** — the first screen that should answer "what's going on with me?" in plain language. It is the primary surface where the [patient-legible display north star](../patient-legible-display.md) (#262) is proven or fails.

> Mission: **Your medical records, immediately and in your hands — for free.** The dashboard is where "in your hands" has to mean *understandable*, not just *present*.

## Design principles

The dashboard inherits the [patient-legible north star](../patient-legible-display.md) (#262):

- **Meaning first** — show what each thing *is* and *why it matters*, in plain words; demote FHIR resource types, statuses, IDs, and references.
- **Organize by the patient's mental model** — "My medications / conditions / recent results", not FHIR resource types.
- **Translate codes** — never show a raw code to a patient.
- **Complete on demand** — the legible summary is the default; the full technical record stays one click away (the per-resource `fhir-card` "details" view).

## Architecture

The dashboard is **config-driven**:

- `frontend/src/app/pages/dashboard/` — the dashboard page that lays out widgets.
- `frontend/src/app/models/widget/dashboard-config.ts` + `dashboard-widget-config.ts` — the config model: which widgets render, in what order, with what query/config.
- `frontend/src/app/widgets/` — the widget components (one per visualization), each implementing `dashboard-widget-component-interface.ts`.

### Default layout (decided in #244)

- **A compact default dashboard scoped to the Cures-Act core** — Problems, Medications, Allergies, Labs, Vitals, Clinical Notes — the categories a person most needs.
- **A separate "All categories" view** for the long tail.
- A **generic `profile-summary-widget`** (config row per profile group, #245) covers list-style profiles, reusing the #136 `fhir-card`s for detail — plus a few **bespoke** widgets only where a summary line isn't enough (vitals trends, blood pressure, status values). Not ~17 bespoke widgets.

Full rationale and decisions: [`docs/planning/per-profile-dashboards-brainstorm.md`](../planning/per-profile-dashboards-brainstorm.md) and epic #244.

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

The **medications-widget** and **Current Medications page** use the backend *reconciled* model (`GET /api/secure/medications/reconciled`, `backend/pkg/medication`) rather than rendering raw FHIR. That model is the pattern the rest of the dashboard should follow — it derives a single legible row per drug with `title`, plain `state` (Active/Past), `dose`, `frequency`, `sig`, **`purpose`** (what it's for), and `prescriber`, merging evidence from `MedicationStatement`/`Request`/`Dispense` + the referenced `Medication`.

This is the difference between "MedicationStatement / unknown / active" and "Lisinopril — a blood-pressure medicine, 1 tablet daily."

## Known gaps

- **Medication card display gaps + reference-resolution blocker** — #264. (The reconciled list resolves the drug name from a separate `Medication` resource; the raw per-resource card does not yet, and cards have no related-resource plumbing.)
- The broader Must-Support display gaps — #249; the US Core display end-state — #136.

## Canonical sources

- North star: [`docs/patient-legible-display.md`](../patient-legible-display.md) (#262)
- Dashboard design + decisions: [`docs/planning/per-profile-dashboards-brainstorm.md`](../planning/per-profile-dashboards-brainstorm.md) (#244)
- Profile-summary widget: #245
- US Core display: #136 / #249
