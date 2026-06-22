# Data-Quality Framework (DQF)

YourPHR consumes FHIR from many vendors of varying quality. To make import, classification, display, and testing decisions *principled* rather than ad-hoc, we need two things written down:

1. **Our DQF** — what "data quality" *means* for a patient-facing PHR, and how we respond to each kind of defect.
2. **Source DQF profiles** — the quality we actually get from each data source, including what we have *not* yet characterized.

This is the conceptual backbone of [`testing-and-data.md`](./testing-and-data.md) (how we test it) and [`test-sandboxes.md`](./test-sandboxes.md) (where the data comes from).

## Part 1 — YourPHR's DQF (our doctrine)

### The three dimensions

We adopt the well-established **Kahn et al.** clinical-data-quality framework (the same one the OHDSI Data Quality Dashboard and the [PHUSE-US 2024 IBM paper](https://www.lexjansen.com/phuse-us/2024/ic/PAP_IC12.pdf) use), interpreted for a patient PHR:

| Dimension | The question | In our data |
|---|---|---|
| **Conformance** | Are values drawn from interoperable code systems / expected value sets? | Extensible/example value sets get **locally-defined codes** — e.g. Epic `Encounter.class` = `HOV` (a local code) while `type[].text` is the readable "Outpatient". |
| **Completeness** | Is a required/expected element present? | US-Core-optional fields are routinely absent; some exports omit whole resource types (a documents-only export with no `Encounter`). |
| **Plausibility** | Do values make sense, alone and across fields? | A recorded date before birth or after death or in the future; an out-of-range value. |

### The critical inversion: we *tolerate and display*, we do not *reject*

Research/pharma uses this framework to judge whether a dataset is **fit for analysis** and to **exclude** data that fails. **A patient PHR must do the opposite.** These are the patient's own records — excluding imperfect data means *hiding the patient's data from them*, which is mission failure ("Your medical records, immediately and in your hands — for free.").

So every quality failure maps to a **display behavior, not a gate**:

| Failure | Our response |
|---|---|
| **Conformance** — non-standard / local code | Prefer the human-readable `text`; show the raw code only as a detail, never as the primary label. (The HOV → "Outpatient" fix, [#262](https://github.com/jwilleke/yourphr/issues/262).) |
| **Completeness** — missing element | Show **"unknown"**. Never blank, never fabricate or infer a value. (The no-guessing display principle.) |
| **Plausibility** — impossible value | Show it **and flag it** ("recorded date precedes birth — check source"). Never silently correct or drop it. |

### Honesty principles (the spine of all three)

- **Display only what the record states.** Derive nothing the source did not assert.
- **Absence is "unknown,"** not zero, not a guess.
- **Surface provenance** — which source/record a value came from — so the patient can judge it.
- **Flag, don't fix.** We are a faithful viewer, not a data-cleaning pipeline.

### Where the DQF shows up in the app

- **Import** — skip-and-survive: never crash on a malformed or partial bundle; report honest counts.
- **Classifiers** — fall back across dimensions (e.g. `class` when `type[]` is absent) rather than assuming US-Core conformance.
- **Display** — the legibility behaviors above ([#262](https://github.com/jwilleke/yourphr/issues/262)).
- **Testing** — golden assertions organized by the three dimensions ([`testing-and-data.md`](./testing-and-data.md)).

## Part 2 — Source DQF profiles

What we know about each source's data quality. **Characterized** is honest about how much we have actually inspected — most sources are one export or not yet connected, so treat "quirks" as *observed so far*, not exhaustive.

| Source | US-Core baseline | Known quirks (observed) | Our handling | Characterized |
|---|---|---|---|---|
| **Synthea** | aligned (synthetic) | "too clean" — never reproduces vendor non-conformance | happy-path baseline | ✅ well-understood (synthetic) |
| **Epic** (sandbox) | US-Core | local codes in extensible fields (`class` = `HOV`); Epic OID code systems; `open.epic.com` extensions | prefer `type[].text` over raw `class` | 🟡 one patient (Camila) |
| **Oracle Health (Cerner)** | US-Core | the `nsmart` export is **documents-only** (~2,149 `DocumentReference`, allergies, some `DiagnosticReport`) — no `Patient`/`Encounter` | docs-only empty state; treat `DocumentReference` narrative as primary | 🟡 one export |
| **CMS Blue Button 2.0** | claims profiles | **claims only** (EOB/Coverage), no clinical resources; no `$everything`; initial token omits `patient` | claims classifiers ([#294](https://github.com/jwilleke/yourphr/issues/294)–[#296](https://github.com/jwilleke/yourphr/issues/296)) | 🟡 connected; data = claims |
| **Veradigm / FollowMyHealth** | unknown | — | — | 🔴 never pulled data (blocked at auth) |
| **VA Clinical Health** | US-Core (per docs) | — | — | 🔴 candidate, not connected ([#370](https://github.com/jwilleke/yourphr/issues/370)) |
| **athenahealth** | unknown | — | — | 🔴 registered, not connected |

A documents-only or claims-only source is itself a **completeness** fact about that vendor — not a bug in our import. Recording it here stops us re-diagnosing "no encounters showed up" as a defect each time.

## Part 3 — How we assert it

The golden-test harness in [`testing-and-data.md`](./testing-and-data.md) is where the DQF becomes executable: each fixture's assertions are tagged to a dimension (conformance / completeness / plausibility), so coverage is systematic rather than incidental. The **OHDSI Data Quality Dashboard** (Apache-2.0, OMOP-CDM-only — *not* runnable on our FHIR/SQLite stack) is useful only as a **check-type catalog** to mine: translate the display-relevant subset to FHIR, as the PHUSE paper did. We take its vocabulary, not its 4,000-check analytics scale or its reject-the-dataset framing.

## References

- Kahn MG, et al. — *A Harmonized Data Quality Assessment Terminology and Framework* (Conformance / Completeness / Plausibility).
- OHDSI Data Quality Dashboard — <https://github.com/OHDSI/DataQualityDashboard> (Apache-2.0; OMOP CDM; catalog reference only).
- Ferko S, et al. (IBM), PHUSE-US 2024 — *Data Quality Evaluation of EHR FHIR API Real World Data* — <https://www.lexjansen.com/phuse-us/2024/ic/PAP_IC12.pdf>.
- 21st Century Cures Act (2016) — the interoperable-FHIR-API mandate this project exists to fulfill.
