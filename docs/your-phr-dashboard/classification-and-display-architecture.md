# Data classification & display architecture

How YourPHR turns messy, vendor-specific FHIR into a patient-legible display — *regardless of source*. This is the design that underpins the dashboard's "Current Medical Concerns", the new "Patient Profile" section, and the per-resource detail cards.

> Driving north star: the [patient-legible display principle](./patient-legible-display.md) (#262) — show what each thing *is* and *why it matters*, in plain words. This doc is the structural plan for delivering that across data from any source.

## The problem (what real data exposed)

FollowMyHealth / Veradigm (the project's near-term compatibility target) exports an **EHI Bundle** (FHIR R4 JSON) via its EHI export tool. Veradigm's own [EHI Export Data Guide](#source-documents) states it *"uses extensions where internal structures don't map perfectly to standard FHIR resources or value sets"* — and it does so pervasively. The concrete symptoms on the dashboard:

- **"Current Medical Concerns" is polluted with non-clinical data.** FollowMyHealth has *two separate PHR sections* — "Health Conditions" and "Personal Health Conditions" — and collapses **both** into FHIR `Condition`, all marked `clinicalStatus: active`. So social/lifestyle/administrative items (employment, education, marital status, tobacco/alcohol/substance status, household members) surface alongside real diagnoses as if they were health problems.
- **Detail pages convey almost nothing.** Cards render raw FHIR field labels (blank `Patient`, duplicated `Onset`) and bury the meaning. Coded conditions carry rich data (ICD‑9/ICD‑10, free-text notes) that the card never surfaces.
- **No provenance.** "Who said this?" is unanswered, even when the source data contains the answer.

These are not FollowMyHealth-only problems — they are *general* "non-conformant source → legible display" problems. FollowMyHealth is just the source that surfaced them first.

## The core idea: two layers, one contract

The work splits cleanly into **two independent layers that meet at a single contract — standard FHIR.**

```
  Source data            Layer 1: SOURCE ADAPTER          Standard FHIR        Layer 2: DISPLAY MAPPER      Patient UI
  (per vendor)           vendor quirks -> standard FHIR    (uniform contract)   FHIR -> patient sections
 ┌────────────┐         ┌─────────────────────-──────┐    ┌──────────────┐     ┌────────────────────────┐   ┌──────────────┐
 │ FMH EHI    │────────▶│ HealthCondition ->         │───▶│ Condition    │────▶│ category=problem-list  │──▶│ Health       │
 │ (messy)    │         │   category=problem-list    │    │  +category   │     │   -> Health Problems   │   │ Problems     │
 │            │         │ PersonalHealthConsid. ->   │    │              │     │ category=sdoh/social   │   │ Patient      │
 │Epic/Cerner │────────▶│   category=sdoh/social     │───▶│ (all ready   │────▶│   -> Patient Profile   │──▶│ Profile      │
 │(conformant)│         │(no-op — already conformant)│    │  conformant) │     │ Observation=labs -> …  │   │ Labs, Meds…  │
 └────────────┘         └-───────────────────────────┘    └──────────────┘     └────────────────────────┘   └──────────────┘
                         per-vendor; the ONLY place        the contract           source-agnostic; ONE table
                         vendor-specific logic lives        everyone keys off
```

**Why this matters:** the display layer never knows a vendor exists. It keys only off standard FHIR. Add a new conformant source (Epic, Cerner) and its data flows through Layer 2 with **zero new display code**. All vendor weirdness is quarantined in Layer 1.

### Three "category" concepts — keep them distinct

Confusion dissolves once these are named separately:

| # | Concept | Example | Where it lives |
|---|---|---|---|
| 1 | **Vendor type** | FMH `HealthCondition` / `PersonalHealthConsideration` (in `identifier[].value`) | Layer 1 only — erased after normalization |
| 2 | **FHIR clinical category** | `Condition.category` = `problem-list-item` / `sdoh`; `Observation.category` = `laboratory` / `social-history` / `vital-signs` | The contract between layers |
| 3 | **Display category** | "Health Problems", "Patient Profile", "Lab Results" | Layer 2 output (patient sections) |

The keystone is the **FHIR clinical category (#2)**: conformant EHRs populate it natively; FollowMyHealth omits it. So Layer 1's central job is to **synthesize the standard category the source left blank** — after which everything downstream is vendor-agnostic.

## Layer 1 — Source adapter (FollowMyHealth)

Non-destructive: the raw resource is stored exactly as received (honors "report facts as they were provided", keeps the debug/raw view truthful, evolves without DB migrations). Normalization happens in a backend **reconcile view-model** at read time — the same pattern as the reconciled-medications model the [dashboard README](./README.md) crowns as the exemplar.

### Vendor detection

A resource/bundle is treated as a FollowMyHealth EHI export when it carries FollowMyHealth signals — e.g. `system` URLs under `fhir.followmyhealth.com`, the bundle `link` with relation `service-doc` pointing at the EHI export documentation. The adapter only touches data it positively identifies as FollowMyHealth, so conformant sources are never altered.

### Condition classification (the decision table)

FollowMyHealth omits `Condition.category`, so we synthesize it from explicit signals already in the record (no inference of clinical meaning):

| Signal pattern | Synthesized `Condition.category` | Display tier |
|---|---|---|
| Vendor tell `HealthCondition` **and/or** a standard terminology code (ICD‑9/ICD‑10/SNOMED/LOINC) present | `problem-list-item` | **A — clinician-coded health problem** |
| No standard code, but `code.coding[]` present (e.g. a vendor-internal display) **and** `asserter`/`recorder` = Patient | `problem-list-item` | **B — self-reported health problem** (badge: *Self-reported*) |
| Text-only (`code.text`, no `code.coding[]`), vendor tell `PersonalHealthConsideration`, no clinician recorder | `sdoh` / `health-concern` | **C — Patient Profile item** |

The two primary signals (vendor tell vs. presence of a coded diagnosis) agree strongly in observed data. The vendor tell maps directly to FollowMyHealth's own two PHR sections ("Health Conditions" vs "Personal Health Conditions"), so tiers A/C reproduce the *vendor's own categorization* — not a guess.

**Safety bias (important):** classify as Profile (tier C) only when **multiple signals agree** (text-only **and** vendor `PersonalHealthConsideration`/no-standard-code **and** no clinician recorder). When signals conflict, **default to a health item.** Burying a real diagnosis under "Profile" is worse than showing one stray profile line among health problems. Err toward over-including.

### State, resolution & verification (the end-date model)

Mirrors medications' state model. `verificationStatus` gates first (`entered-in-error` → omit entirely; `refuted` → ruled-out, not a current problem), then `clinicalStatus` is the **primary** driver of state, with `abatement[x]` as the date source (date of resolution *or* remission, per FHIR con-4) and a non-conformance safety net:

- `active` / `recurrence` / `relapse` → **Active** (Current Health Problems)
- `remission` → **Remission** — still tracked, shown under Current, badged "in remission since `<abatement>`" (not "past")
- `resolved` / `inactive`, or abatement set with no status → **Resolved** (Past Health Problems, with date range — resolved ≠ deleted)
- status absent/unrecognized → **Unknown** (shown, never assumed)

A future **patient comment** ("quit smoking 2024-03") writes an `abatement` through the same mechanism — patient input is a valid source of an end-date. Full rules + edge cases: [Phase 1 spec](./phase-1-condition-classifier-spec.md).

### Provenance resolver ("who said this?")

USCDI names Provenance as a data class; its floor is **Author + Author Time Stamp**. A generic resolver (works for any resource type) walks the chain and reports the best level it found, **labeled**, never fabricating an author:

1. `asserter` → fall back to `recorder` (lead with `asserter` = "who said it"). Resolves to a named `Practitioner`, or to the Patient → display **"Self-reported"**.
2. `Condition.encounter` → `Encounter.serviceProvider` / participant. *(Not present on FollowMyHealth `Condition`s, but valid for other resource types and vendors.)*
3. A `Provenance` resource targeting the record. *(FollowMyHealth EHI exports contain none; Epic/Cerner do.)*
4. **Floor:** the import source/connection → *"Source: FollowMyHealth"*. Never invent an originating clinic.

This shares plumbing with reference resolution (#264) — solve once.

### Reference resolution quirks

FollowMyHealth reference formats observed (the Encounter form is the trap):

| Reference type | Format | Resolution |
|---|---|---|
| Patient / Practitioner / Organization | `Type/<id>` | direct id match |
| **Encounter** | `Encounter/<patientId>_<encounterId>` (underscore-joined) | **strip the `<patientId>_` prefix, then match `Encounter.id`** |

Naive resolution searches for the whole `patientId_encounterId` blob as an id and silently finds nothing — so every Encounter-based provenance lookup fails until this is handled.

### Codes & notes (legibility inputs)

- Surface `Condition.note[]` — free-text notes are often richer than the coded display and are valuable to the patient.
- Distinguish **Started** (`onset[x]`), **Recorded** (`recordedDate`), and **Ended** (`abatement[x]`) — do not conflate them.
- Codes are for clinicians: show **standard** terminology only (ICD/SNOMED/LOINC). FollowMyHealth also emits a proprietary `fhir.followmyhealth.com/id/translation` code system whose code is an internal UUID — display its `display` text but never the UUID as a "code".

## Layer 2 — Display mapper (source-agnostic)

A single explicit table maps standard FHIR (resource type + clinical category) to a patient-facing section. Because every source has already been normalized to standard FHIR in Layer 1, this table is the same for all vendors. It is naturally a **config table** (the dashboard is config-driven).

| Display section | Fed by (FHIR resource + category) |
|---|---|
| **Health Problems** *(Current Concerns)* | `Condition` category=`problem-list-item`, active |
| **Patient Profile** | `Condition` category=`sdoh`/`health-concern` + `Observation` category=`social-history` + `Patient.maritalStatus` |
| Medications | `MedicationRequest` / `MedicationStatement` / `MedicationDispense` / `MedicationAdministration` / `Medication` |
| Lab Results | `Observation` category=`laboratory` + `DiagnosticReport` |
| Vitals | `Observation` category=`vital-signs` |
| Allergies | `AllergyIntolerance` |
| Immunizations | `Immunization` |
| Visits & Notes | `Encounter` + `DocumentReference` |
| Procedures | `Procedure` |
| Care Team | `Practitioner` / `Organization` / `CareTeam` |
| Documents | `DocumentReference` / `Media` / `Binary` |

### The "Patient Profile" section

The home for the `PersonalHealthConsideration` / social / SDOH items pulled out of "Current Medical Concerns". Named for the patient's mental model — "stuff about me", not "stuff wrong with me". Fed by FHIR category `sdoh` / `social-history`, so conformant sources' social-history data lands here automatically too.

## Conformance vs. display (deliberately scoped)

There are two distinct goals; they need different amounts of work, and they are **sequential, not either/or**:

- **Patient display (now):** route items to the right section and present them legibly. Requires only the category synthesis above — **no value-set remapping**.
- **Canonical/exportable data (later):** represent items in fully conformant US Core / USCDI form (matters for data sharing #256 and "your records in standard form").

For the conformance goal, **do not blanket-remodel** the Patient Profile bucket. Upgrade an item to a proper US Core resource only when **all three** hold: (1) a US Core profile exists, (2) the source value maps **unambiguously** to the bound value set, (3) there is USCDI / sharing payoff.

- **Smoking status** passes all three — it is a USCDI element with the US Core Smoking Status Observation profile (`Observation`, category `social-history`, LOINC `72166-2`, `valueCodeableConcept` from Smoking Status Comprehensive). Strongest candidate to remodel first.
- **Marital status** is not an Observation at all → `Patient.maritalStatus`.
- **"Job & Family Services" / "Activities"** have no clean FHIR target → stay generic Profile lines.

**No-guessing guardrail on value mapping:** when remodeling, the source-text → code translation must be **exact**. Unambiguous values map; anything ambiguous or unlisted stays as text with the coded value left absent. Faithful translation, never inference.

## Key decisions (locked)

1. **Display-time reconcile layer**, non-destructive — raw FHIR is never mutated. Mirrors reconciled-medications.
2. **Synthesize `Condition.category`** in Layer 1; all downstream logic keys off standard FHIR category → vendor-agnostic.
3. **Three condition tiers**: clinician-coded / self-reported / Patient Profile; split by `code.coding[]` presence then provenance, with a **default-to-health-item safety bias** on conflict.
4. **No dedup** — report facts as the source provided them; the patient may comment. (Related-but-separate records stay separate.)
5. **Active until explicitly ended** (`clinicalStatus` resolved/inactive/remission **or** `abatement`); patient comments can set an end-date.
6. **Provenance floor = "Source: FollowMyHealth"**; "Self-reported" for Patient-asserted; never invent a clinician.
7. **Codes for clinicians, plain language for patients**: standard codes only, displayed as supporting detail; surface `note[]`.
8. **Conformance remodeling is opt-in per item**, gated by the three-part test; smoking status first.

## Phasing

| Phase | What | Fixes |
|---|---|---|
| **0** | Capture the FollowMyHealth EHI mapping in `docs/vendors/` (findings + documented mappings + attribution; PDF stays in `private/phi/`) | knowledge loss |
| **1** | Condition classifier + synthesized category; "Current Medical Concerns" shows only active `problem-list-item`; Profile items move to **Patient Profile** | the polluted Concerns list (top complaint) |
| **2** | Generic provenance + reference resolvers; "who said this" on cards and dashboard | unanswered provenance; unblocks #264 |
| **3** | Detail-card legibility: plain name, surfaced notes, standard codes underneath, distinct onset/recorded/ended dates, suppressed empty fields | uninformative detail pages |
| **4** | Generalize resolvers to other resource types; fold into per-profile dashboards (#244 / #245); begin conformance remodeling (smoking status) | the long tail |

Each phase ships independently. Phase 1 alone removes the junk from "Current Medical Concerns".

## Testing without PHI

Build a **synthetic FollowMyHealth-shaped fixture** — real *structure* (vendor tells, the `id/translation` code system, `Encounter/<patient>_<id>` references, the three tiers) with **fake values** — and commit it under `testdata/`. The whole adapter is then testable in CI with zero real PHI. The real export stays in `private/phi/` (gitignored) as the reference to validate against by hand. See the global rule: never commit real FHIR bundles.

## Source documents

- Veradigm / FollowMyHealth EHI Export Data Guide (v2): linked from the export bundle's `service-doc` link, and published at `veradigm.com` under `/legal/onc/` (ONC-mandated EHI disclosure). The PDF is kept in `private/phi/` (not committed — its footer marks it Veradigm-proprietary). Mappings we rely on are summarized, with attribution, in `docs/vendors/` (Phase 0).
- FHIR R4: Condition, Observation, Provenance, Encounter (`hl7.org/fhir/R4/`).
- US Core: Condition Problems and Health Concerns; Smoking Status Observation; SDOH categories.

## Related issues

- #262 — patient-legible display (epic; this doc serves it)
- #264 — medication card / reference-resolution blocker (shares the reference + provenance resolver)
- #249 / #136 — US Core 9.0.0 Must-Support display gaps / support (epic)
- #244 / #245 — per-profile dashboard widgets (Layer 2 consumers)
- #256 — sharing PHR data (drives the conformance goal)
- #252 — re-import dedup hardening (intersects the no-dedup decision)
- #53 — Veradigm / FollowMyHealth integration
