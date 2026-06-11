# Per-profile dashboard widgets — brainstorm & scoping

Status: brainstorm (not a committed plan). Captures options, a recommendation, and the open decisions to confirm before turning this into an EPIC + sub-issues (the [#136](https://github.com/jwilleke/yourphr/issues/136) display end-state).

## Goal

Per `docs/us-core/README.md`: a patient should land on a **familiar, purpose-built view per data category** (problems, medications, allergies, labs, vitals, clinical notes, …) — one widget per US Core profile group — instead of a generic resource table. Each widget renders that profile's Must-Support elements and degrades gracefully for non-conformant data ([#54](https://github.com/jwilleke/yourphr/issues/54)). This is the **display end-state of the [#136](https://github.com/jwilleke/yourphr/issues/136) audit**: as each profile's Must-Support display landed (this session: 15 profiles + Encounter/Observation depth), the dashboard widget is what surfaces it to the patient.

## What already exists (reuse inventory — don't rebuild)

- **Widget framework:** `DashboardWidgetConfig` (item_type, title, `queries[]`, grid `width/height/x/y`, `parsing`) + `DashboardWidgetQuery` (declarative `select/from/where` + `aggregations` count_by/group_by/order_by) → widgets are **config-driven**, not hand-wired. Backend serves layouts from `dashboard/default.json` + `secondary.json`.
- **Existing widget types:** `records-summary-widget`, `patient-vitals-widget`, `table-widget`, `medications-widget` (built this session, #185), chart widgets (`simple-line-chart`, `complex-line`, `grouped-bar`, `donut`, `dual-gauges`, `image-list-group`).
- **Default dashboard today:** Records Summary · Patient Vitals · Observations-by-Type (donut) · Weight + Height (line) · Blood Pressure (grouped-bar) · Compliance (gauge) · Recent Encounters (table) · Medications. So **vitals + meds are already partly covered**; most other profiles are not.
- **Per-resource display models + fhir-cards** for ~all US Core resources (the #136 work) — every widget's "detail" view already exists; widgets mostly need a **summary/landing** layer on top.
- **Observation profile registry** (`observation-profile-registry.ts`) — classifies every Observation into a sub-profile kind (lab / vital-signs / blood-pressure / social-history / …), declared or inferred ([#243](https://github.com/jwilleke/yourphr/issues/243)). This is the routing key for the Observation widgets.
- **Cross-cutting primitives:** `<app-missing-data>` "Data Not Provided" ([#178](https://github.com/jwilleke/yourphr/issues/178)), "No result recorded" for valueless obs ([#242](https://github.com/jwilleke/yourphr/issues/242)), the medications **compute-on-request** reconciliation endpoint pattern (#175).

## Core design decision (the big one)

US Core 9.0.0 has **~17 profile groups** (ToC 1.5.1–1.5.17) **+ ~24 Observation sub-profiles**. Hand-crafting a bespoke widget for each is a huge, low-leverage surface.

**Recommendation: one generic, config-driven "Profile summary" widget covering the list-style profiles, plus a small number of bespoke widgets where a list genuinely won't do (vitals trends, status).** Most profiles are "show the recent N, a total count, and link each to its existing fhir-card" — that's _one_ component parameterised by config, not N components. Reserve bespoke effort for the few categories with a real visualization need.

## Two-ends framing (carried over from the medications brainstorm)

- **Input-end (backend / query):** gather + conform. Reuse `DashboardWidgetQuery` (select/from/where/order_by) against the indexed resource store; for anything needing cross-resource logic (e.g. "current medications", "active problems"), a **compute-on-request endpoint** like the medications reconciliation (#175) rather than client-side joins.
- **Output-end (frontend / widget):** display meaning. The generic Profile widget renders the query result as a titled list of that profile's Must-Support summary line + a count + "view all" → the existing card for detail. No business logic in the widget.

## Widget archetypes (map every profile to one of four)

1. **List / summary** (the majority) — recent N + count + per-item summary line, each linking to its fhir-card. Covers: Problems (Condition), Medications✓, Allergies, Immunizations, Procedures, Clinical Notes (DocumentReference), Care Team, Goals, Devices (implantable), Encounters, Diagnostic Reports, Service Requests, Coverage, Family History, Provenance. → **the generic Profile widget.**
2. **Trend / chart** — time series. Vital Signs (weight, height, BMI, heart rate, resp rate, temp, O2 sat), Blood Pressure (two-series), Laboratory Results (per-analyte trend). → reuse `simple-line-chart` / `grouped-bar` / `patient-vitals-widget`, routed by the **observation profile registry** kind.
3. **Status / current-value** — a single latest value. Smoking Status, Pregnancy Status/Intent, Sexual Orientation, Occupation. → a small "latest observation" widget (value + date + "(inferred)" handling from #243).
4. **Narrative / document** — Clinical Notes & DiagnosticReport-note (the title/metadata-only display from #198; bodies aren't in the bundle). → list archetype, but flagged because content is external.

## The generic "Profile summary" widget (Phase 1 — biggest coverage, least code)

- **One component** (`profile-summary-widget`) + **one config entry per profile** in `dashboard/default.json`:
  - `from` (resourceType), `title_text`, `order_by` (sort_date desc), `limit` (e.g. 5), and a small `summary` field-map (which model fields form the one-line summary — reuse each model's existing `sort_title`/display).
  - Renders: title + total count + the recent N as summary lines (status badge where present) + "View all →" to the resource list/explore.
- **No-guessing baked in:** empty category → the `<app-missing-data>` marker, not a hidden/empty card.
- This single widget + ~12 config rows replaces "12 bespoke widgets."

## Decisions (2026-06-11, confirmed with Jim)

1. **Architecture — DECIDED: generic config-driven "Profile summary" widget + a few bespoke** (vitals-trend, blood pressure, status values). Not ~17+ bespoke widgets.
2. **Layout — DECIDED: a compact default dashboard (Cures-Act core) + a separate "All categories" view** for the rest. Not a single dense grid, not tabs.

## Open questions / decisions still to confirm

3. **v1 scope — which profiles ship widgets first?** Recommend the **Cures-Act core**: Problems, Medications✓, Allergies, Labs, Vitals (have some), Clinical Notes — matching #136's first slice.
4. **Query path:** reuse the client `DashboardWidgetQuery` engine, or add compute-on-request endpoints (like medications #175) for the categories needing cross-resource logic (active problems, current meds)? (Recommend: query engine for simple lists; endpoint only where logic is real.)
5. **Counts:** show a total count per category (needs a count query / `count_by`) — confirm the query engine supports an efficient count.
6. **Editability/layout:** the dashboard grid is user-arrangeable (x/y/width/height). Do per-profile widgets ship in the default layout, or as an opt-in widget palette? (Decision needed.)

## Suggested phasing (turn into EPIC + sub-issues once decisions land)

- **Phase 0** — this doc + decisions above.
- **Phase 1** — the generic `profile-summary-widget` + config for the Cures-Act core categories (Problems, Allergies, Immunizations, Procedures, Clinical Notes). Meds + vitals already have widgets.
- **Phase 2** — Observation trend widgets routed by the profile registry (per-analyte lab trends; round out vital-signs beyond weight/height/BP).
- **Phase 3** — status/one-off widgets (Smoking Status, Pregnancy Status).
- **Phase 4** — dashboard layout decision (single vs per-category/tabs) + ship the default per-profile layout; wire "view all" deep-links.
- **Phase 5** — fold into the [#136](https://github.com/jwilleke/yourphr/issues/136) conformance story; revisit alongside the Inferno verification gate.

## Relationships

- Display end-state of [#136](https://github.com/jwilleke/yourphr/issues/136) (US Core). Complements [#54](https://github.com/jwilleke/yourphr/issues/54) (non-US-Core fallbacks). Reuses the medications-widget (#185) + reconciliation (#175) patterns. The `<app-missing-data>` (#178) marker and the Observation classification (#243) are load-bearing.
