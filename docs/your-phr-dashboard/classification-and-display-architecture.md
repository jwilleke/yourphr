# Data classification & display architecture

How YourPHR turns messy, vendor-specific FHIR into a patient-legible display — *regardless of source*. This is the design that underpins the dashboard's "Current Medical Concerns", the new "Patient Profile" section, and the per-resource detail cards.

> Driving north star: the [patient-legible display principle](./patient-legible-display.md) (#262) — show what each thing *is* and *why it matters*, in plain words. This doc is the structural plan for delivering that across data from any source. The data-quality *doctrine* behind it — why we tolerate, flag, and never reject the patient's own data — plus per-source quality profiles, lives in [`../testing-sandboxes/data-quality-framework.md`](../testing-sandboxes/data-quality-framework.md).

## The problem (what real data exposed)

FollowMyHealth / Veradigm (the project's near-term compatibility target) exports an __EHI Bundle__ (FHIR R4 JSON) via its EHI export tool. Veradigm's own [EHI Export Data Guide](#source-documents) states it *"uses extensions where internal structures don't map perfectly to standard FHIR resources or value sets"* — and it does so pervasively. The concrete symptoms on the dashboard:

- __"Current Medical Concerns" is polluted with non-clinical data.__ FollowMyHealth has *two separate PHR sections* — "Health Conditions" and "Personal Health Conditions" — and collapses __both__ into FHIR `Condition`, all marked `clinicalStatus: active`. So social/lifestyle/administrative items (employment, education, marital status, tobacco/alcohol/substance status, household members) surface alongside real diagnoses as if they were health problems.
- __Detail pages convey almost nothing.__ Cards render raw FHIR field labels (blank `Patient`, duplicated `Onset`) and bury the meaning. Coded conditions carry rich data (ICD‑9/ICD‑10, free-text notes) that the card never surfaces.
- __No provenance.__ "Who said this?" is unanswered, even when the source data contains the answer.

These are not FollowMyHealth-only problems — they are *general* "non-conformant source → legible display" problems. FollowMyHealth is just the source that surfaced them first.

## The core idea: two layers, one contract

The work splits cleanly into __two independent layers that meet at a single contract — standard FHIR.__

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

__Why this matters:__ the display layer never knows a vendor exists. It keys only off standard FHIR. Add a new conformant source (Epic, Cerner) and its data flows through Layer 2 with __zero new display code__. All vendor weirdness is quarantined in Layer 1.

### Three "category" concepts — keep them distinct

Confusion dissolves once these are named separately:

| # | Concept | Example | Where it lives |
|---|---|---|---|
| 1 | __Vendor type__ | FMH `HealthCondition` / `PersonalHealthConsideration` (in `identifier[].value`) | Layer 1 only — erased after normalization |
| 2 | __FHIR clinical category__ | `Condition.category` = `problem-list-item` / `sdoh`; `Observation.category` = `laboratory` / `social-history` / `vital-signs` | The contract between layers |
| 3 | __Display category__ | "Health Problems", "Patient Profile", "Lab Results" | Layer 2 output (patient sections) |

The keystone is the __FHIR clinical category (#2)__: conformant EHRs populate it natively; FollowMyHealth omits it. So Layer 1's central job is to __synthesize the standard category the source left blank__ — after which everything downstream is vendor-agnostic.

## Layer 1 — Source adapter (FollowMyHealth)

Non-destructive: the raw resource is stored exactly as received (honors "report facts as they were provided", keeps the debug/raw view truthful, evolves without DB migrations). Normalization happens in a backend __reconcile view-model__ at read time — the same pattern as the reconciled-medications model the [dashboard README](./README.md) crowns as the exemplar.

### Vendor detection

A resource/bundle is treated as a FollowMyHealth EHI export when it carries FollowMyHealth signals — e.g. `system` URLs under `fhir.followmyhealth.com`, the bundle `link` with relation `service-doc` pointing at the EHI export documentation. The adapter only touches data it positively identifies as FollowMyHealth, so conformant sources are never altered.

### Condition classification (the decision table)

FollowMyHealth omits `Condition.category`, so we synthesize it from explicit signals already in the record (no inference of clinical meaning):

| Signal pattern | Synthesized `Condition.category` | Display tier |
|---|---|---|
| Vendor tell `HealthCondition` __and/or__ a standard terminology code (ICD‑9/ICD‑10/SNOMED/LOINC) present | `problem-list-item` | __A — clinician-coded health problem__ |
| No standard code, but `code.coding[]` present (e.g. a vendor-internal display) __and__ `asserter`/`recorder` = Patient | `problem-list-item` | __B — self-reported health problem__ (badge: *Self-reported*) |
| Text-only (`code.text`, no `code.coding[]`), vendor tell `PersonalHealthConsideration`, no clinician recorder | `sdoh` / `health-concern` | __C — Patient Profile item__ |

The two primary signals (vendor tell vs. presence of a coded diagnosis) agree strongly in observed data. The vendor tell maps directly to FollowMyHealth's own two PHR sections ("Health Conditions" vs "Personal Health Conditions"), so tiers A/C reproduce the *vendor's own categorization* — not a guess.

__Safety bias (important):__ classify as Profile (tier C) only when __multiple signals agree__ (text-only __and__ vendor `PersonalHealthConsideration`/no-standard-code __and__ no clinician recorder). When signals conflict, __default to a health item.__ Burying a real diagnosis under "Profile" is worse than showing one stray profile line among health problems. Err toward over-including.

### State, resolution & verification (the end-date model)

Mirrors medications' state model. `verificationStatus` gates first (`entered-in-error` → omit entirely; `refuted` → ruled-out, not a current problem), then `clinicalStatus` is the __primary__ driver of state, with `abatement[x]` as the date source (date of resolution *or* remission, per FHIR con-4) and a non-conformance safety net:

- `active` / `recurrence` / `relapse` → __Active__ (Current Health Problems)
- `remission` → __Remission__ — still tracked, shown under Current, badged "in remission since `<abatement>`" (not "past")
- `resolved` / `inactive`, or abatement set with no status → __Resolved__ (Past Health Problems, with date range — resolved ≠ deleted)
- status absent/unrecognized → __Unknown__ (shown, never assumed)

A future __patient comment__ ("quit smoking 2024-03") writes an `abatement` through the same mechanism — patient input is a valid source of an end-date. Full rules + edge cases: [Phase 1 spec](./phase-1-condition-classifier-spec.md).

### Provenance resolver ("who said this?")

USCDI names Provenance as a data class; its floor is __Author + Author Time Stamp__. A generic resolver (`backend/pkg/provenance`, works for any resource type) walks the chain and reports the best level it found, __labeled__, never fabricating an author:

1. Author references, in priority order: `asserter` → `recorder` → `requester` → `informationSource` → __`performer`__ → `author[]`. Resolves to a named `Practitioner`/`Organization` (following `PractitionerRole`), or to the Patient/RelatedPerson → display __"Self-reported"__. `performer` covers both shapes — a plain `performer[]` reference (DiagnosticReport, Observation) and a BackboneElement `performer[].actor` (Procedure, Immunization) — so performed/administered records resolve "who did it" (#309).
2. `encounter` → `Encounter.serviceProvider` / participant. *(Not present on FollowMyHealth `Condition`s, but valid for other resource types and vendors.)*
3. A `Provenance` resource targeting the record. *(FollowMyHealth EHI exports contain none; Epic/Cerner do.)*
4. __Floor:__ the import source/connection → *"Source: FollowMyHealth"*. Never invent an originating clinic.

`provenance.ExtractRequest` builds this query from any resource's raw JSON (one call works for all ~70 types). It shares plumbing with reference resolution (#264) — solve once. The resolved `Provenance` is attached to __every__ resource on the generic read path (handler `attachProvenance` → `ResourceBase.Provenance`), so it is the single source of "who" for the whole app: the detail-card "Reported by" (#308) and the `/medical-history` group-by-Provider/Place dimension (#351) both read it — neither re-extracts authors itself.

### Reference resolution quirks

FollowMyHealth reference formats observed (the Encounter form is the trap):

| Reference type | Format | Resolution |
|---|---|---|
| Patient / Practitioner / Organization | `Type/<id>` | direct id match |
| __Encounter__ | `Encounter/<patientId>_<encounterId>` (underscore-joined) | __strip the `<patientId>_` prefix, then match `Encounter.id`__ |

Naive resolution searches for the whole `patientId_encounterId` blob as an id and silently finds nothing — so every Encounter-based provenance lookup fails until this is handled.

### Codes & notes (legibility inputs)

- Surface `Condition.note[]` — free-text notes are often richer than the coded display and are valuable to the patient.
- Distinguish __Started__ (`onset[x]`), __Recorded__ (`recordedDate`), and __Ended__ (`abatement[x]`) — do not conflate them.
- Codes are for clinicians: show __standard__ terminology only (ICD/SNOMED/LOINC). FollowMyHealth also emits a proprietary `fhir.followmyhealth.com/id/translation` code system whose code is an internal UUID — display its `display` text but never the UUID as a "code".

### Layer-1 classifier inventory

Each clinical type has a pure, stateless package under `backend/pkg/<type>` exposing a `Classify`/`Reconcile`/`Recognize` function (no DB, no HTTP; fixture-tested) and a compute-on-request endpoint. All synthesize a legible state/category from explicit signals only (absent → empty/Unknown, never inferred), drop `entered-in-error`, and resolve provenance via the shared resolver above.

| Resource | Package | Endpoint | Synthesizes |
|---|---|---|---|
| Condition | `condition` | `/conditions/classified` | category (problem/SDOH/health-concern) + tier + state |
| Medication* | `medication` | `/medications/reconciled` | reconciled "current medications" + state (deduped) |
| Observation (vitals) | `observation` | `/vitals/recognized` | vital-sign LOINC display + unit validation |
| DocumentReference | `document` | `/documents/classified` | clinical-document vs activity/wearable note |
| Coverage | `coverage` | `/coverages/classified` | plain plan name + display period |
| ExplanationOfBenefit | `explanationofbenefit` | `/claims/classified` | plain claim category + costs (as stated) |
| AllergyIntolerance | `allergyintolerance` | `/allergies/classified` | verification (Confirmed/Presumed/Unconfirmed/Refuted) + state + reactions |
| Immunization | `immunization` | `/immunizations/classified` | state + `primarySource` attribution (Recorded-by-provider/Reported) |
| Procedure | `procedure` | `/procedures/classified` | state (Completed/NotDone/Stopped/…) + body sites + outcome |
| DiagnosticReport | `diagnosticreport` | `/diagnostic-reports/classified` | state + service category (Laboratory/Imaging/Pathology) |
| Encounter | `encounter` | `/encounters/classified` | state + class category (Office visit/Inpatient/Emergency/Telehealth/…) |
| CarePlan | `careplan` | `/care-plans/classified` | state (Active/Draft/Revoked/…) + intent/category |

\* Medication rolls up MedicationRequest/Statement/Dispense/Medication into one row per drug (the only classifier that dedups; the rest emit one row per input).

Out of scope (raw rendering acceptable — no vendor non-conformance signal): Device, Goal, ServiceRequest, CareTeam.

## Layer 2 — Display mapper (source-agnostic)

A single explicit table maps standard FHIR (resource type + clinical category) to a patient-facing section. Because every source has already been normalized to standard FHIR in Layer 1, this table is the same for all vendors. It is naturally a __config table__ (the dashboard is config-driven).

| Display section | Fed by (FHIR resource + category) |
|---|---|
| __Health Problems__ *(Current Concerns)* | `Condition` category=`problem-list-item`, active |
| __Patient Profile__ | `Condition` category=`sdoh`/`health-concern` + `Observation` category=`social-history` + `Patient.maritalStatus` |
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

### Surfacing gate for low-value series (activity / tracker data)

Some sources relay __consumer wearable/tracker data__ (step counts, exercise logs) that is technically valid FHIR but often stale, sparse, or abandoned. Shown raw it misleads — a years-old, mostly-zero step series read as a daily chart implies "inactive patient" when it really means "device not worn." A __usability gate__ decides *at what resolution* such a series is shown. It never alters or drops data — __no-discard holds__: every point stays stored and queryable; the gate only chooses how to present it.

The gate is a __Layer 2 (display) policy, not Layer 1.__ Layer 1 classifies every resource faithfully (every day carried, zeros included). Layer 2 evaluates the already-classified series:

- __A — Structured & coded (hard floor):__ an `Observation` with `category = activity`, a recognized code (e.g. LOINC), and a numeric `value[x]`. Fail A → not a usable series at all — there is nothing to plot or summarize (e.g. FollowMyHealth's `text/plain` "Exercise" `DocumentReference`s carry no numeric value).
- __B — Real signal:__ at least __N non-zero__ data points (default __N = 14__). A `0` typically means *device not worn / not synced*, not a measured zero.
- __C — Recent enough:__ at least one non-zero point within the last __M months__ (default __M = 18__) of `now` / latest import. Disqualifies frozen, years-old snapshots.

__Passing B *and* C → live daily view. Failing B or C does NOT hide the series — it collapses to an honest per-year rollup__ (a compact historical archive instead of a misleading daily chart). Thresholds __N / M are config__ (the dashboard is config-driven), not hardcoded — they are policy, not derivable from the record. The gate is __source-agnostic__ — a current, populated feed from *any* source passes B/C and gets the daily view; the collapse reflects __data quality, not vendor__ (it does not depend on FollowMyHealth detection).

#### The per-year rollup — never a bare calendar average

A single "average steps per 24h by year" is a __forbidden, misleading statistic__: averaging over *all* calendar days drags the no-wear zeros into the mean, turning "stopped wearing the tracker" into a false story of "became sedentary" (observed: a year where the device was barely worn shows an all-days average an *order of magnitude below* its average on worn days — the tracker was idle, not the patient). Instead, each year reports __three faithful, explicitly-labeled stats over the `value > 0` subset__:

> __On days with recorded steps:__ *N* active days · avg *X* · peak *Y*

This respects no-guessing: it does __not__ treat `0` as missing data; it reports statistics over an explicitly-defined subset __and discloses the active-day count__, so sparsity is visible rather than hidden (the active-day count *is* the honesty — "85 active days, avg X" tells the whole truth; "avg X" alone does not). Same posture as the daily view: Layer 1 stays faithful; Layer 2 chooses the resolution.

## Conformance vs. display (deliberately scoped)

There are two distinct goals; they need different amounts of work, and they are __sequential, not either/or__:

- __Patient display (now):__ route items to the right section and present them legibly. Requires only the category synthesis above — __no value-set remapping__.
- __Canonical/exportable data (later):__ represent items in fully conformant US Core / USCDI form (matters for data sharing #256 and "your records in standard form").

For the conformance goal, __do not blanket-remodel__ the Patient Profile bucket. Upgrade an item to a proper US Core resource only when __all three__ hold: (1) a US Core profile exists, (2) the source value maps __unambiguously__ to the bound value set, (3) there is USCDI / sharing payoff.

- __Smoking status__ passes all three — it is a USCDI element with the US Core Smoking Status Observation profile (`Observation`, category `social-history`, LOINC `72166-2`, `valueCodeableConcept` from Smoking Status Comprehensive). Strongest candidate to remodel first.
- __Marital status__ is not an Observation at all → `Patient.maritalStatus`.
- __"Job & Family Services" / "Activities"__ have no clean FHIR target → stay generic Profile lines.

__No-guessing guardrail on value mapping:__ when remodeling, the source-text → code translation must be __exact__. Unambiguous values map; anything ambiguous or unlisted stays as text with the coded value left absent. Faithful translation, never inference.

## Key decisions (locked)

1. __Display-time reconcile layer__, non-destructive — raw FHIR is never mutated. Mirrors reconciled-medications.
2. __Synthesize `Condition.category`__ in Layer 1; all downstream logic keys off standard FHIR category → vendor-agnostic.
3. __Three condition tiers__: clinician-coded / self-reported / Patient Profile; split by `code.coding[]` presence then provenance, with a __default-to-health-item safety bias__ on conflict.
4. __No dedup__ — report facts as the source provided them; the patient may comment. (Related-but-separate records stay separate.)
5. __Active until explicitly ended__ (`clinicalStatus` resolved/inactive/remission __or__ `abatement`); patient comments can set an end-date.
6. __Provenance floor = "Source: FollowMyHealth"__; "Self-reported" for Patient-asserted; never invent a clinician.
7. __Codes for clinicians, plain language for patients__: standard codes only, displayed as supporting detail; surface `note[]`.
8. __Conformance remodeling is opt-in per item__, gated by the three-part test; smoking status first.
9. __Usability gate for tracker/activity series__ (Layer 2 display policy): structured + numeric value (floor A) is required to be a usable series at all. Passing recency/signal (B/C, configurable) → live daily view; __failing → collapse to an honest per-year rollup `{active days, avg-on-active, peak}` — never a bare calendar average, and never hidden__ (no-discard holds). Faithful to no-guessing (`0` ≠ missing; active-day count disclosed); source-agnostic — keys off data quality, not vendor.

## Phasing

| Phase | What | Fixes |
|---|---|---|
| __0__ | Capture the FollowMyHealth EHI mapping in `docs/vendors/` (findings + documented mappings + attribution; PDF stays in `private/phi/`) | knowledge loss |
| __1__ | Condition classifier + synthesized category; "Current Medical Concerns" shows only active `problem-list-item`; Profile items move to __Patient Profile__ | the polluted Concerns list (top complaint) |
| __2__ | Generic provenance + reference resolvers; "who said this" on cards and dashboard | unanswered provenance; unblocks #264 |
| __3__ | Detail-card legibility: plain name, surfaced notes, standard codes underneath, distinct onset/recorded/ended dates, suppressed empty fields | uninformative detail pages |
| __4__ | Generalize resolvers to other resource types; fold into per-profile dashboards (#244 / #245); begin conformance remodeling (smoking status) | the long tail |

Each phase ships independently. Phase 1 alone removes the junk from "Current Medical Concerns".

## Testing without PHI

Build a __synthetic FollowMyHealth-shaped fixture__ — real *structure* (vendor tells, the `id/translation` code system, `Encounter/<patient>_<id>` references, the three tiers) with __fake values__ — and commit it under `testdata/`. The whole adapter is then testable in CI with zero real PHI. The real export stays in `private/phi/` (gitignored) as the reference to validate against by hand. See the global rule: never commit real FHIR bundles.

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
