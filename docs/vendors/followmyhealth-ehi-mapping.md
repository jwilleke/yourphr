# FollowMyHealth / Veradigm EHI export — mapping notes

Practical notes for handling FollowMyHealth (Veradigm, formerly Allscripts) **EHI export** bundles in YourPHR. These are the source-specific facts the [classification & display architecture](../your-phr-dashboard/classification-and-display-architecture.md) Layer 1 adapter relies on.

> **Attribution.** Mappings below are derived from Veradigm's *FollowMyHealth EHI Export Data Guide* (v2, Feb 2024) plus analysis of a real export. The guide is published at `veradigm.com` under `/img/legal/onc/VeradigmFMH_EHI_Export_Data_Guide_v2.pdf` (an ONC-mandated EHI disclosure) and is also linked from each export bundle's `link` with relation `service-doc`. The PDF is **not committed** (its footer marks it Veradigm-proprietary); it is kept under `private/phi/` for reference. This file paraphrases only the interoperability facts we implement.

## What the export is

- A **FHIR R4 `Bundle`** (`type: collection`) in JSON, produced by FollowMyHealth's **EHI export** tool (patient-initiated "export all my data"). Accompanied by document/image files in the same `.zip`.
- **Not** a SMART/Bulk Data API pull. YourPHR ingests it via the manual-upload path.
- Veradigm states it *"uses extensions where internal structures don't map perfectly to standard FHIR resources or value sets"* — and does so pervasively. FollowMyHealth is a **PHR, not an EHR**; the export is a best-effort capture of data from upstream EHR/PM systems.

## Detection signals

Treat a bundle/resource as a FollowMyHealth EHI export when any of:

- the bundle `link[]` has relation `service-doc` with a `fhir.followmyhealth.com` URL;
- resource `identifier[].system` / `code.coding[].system` URLs under `fhir.followmyhealth.com` (e.g. `…/id/global`, `…/id/interface`, `…/id/translation`);
- `identifier[].assigner.display == "FollowMyHealth"`.

## Condition — the big one

FollowMyHealth has **two distinct PHR sections** that it both exports as FHIR `Condition`:

- **My Health > Conditions > Health Conditions** → real medical problems.
- **My Health > Conditions > Personal Health Conditions** → social / lifestyle / administrative items (employment, education, marital status, tobacco/alcohol/substance use, household, etc.).

The guide provides **no** `Condition.category` and no standard mapping for the distinction — the only discriminator is a proprietary identifier. So Layer 1 **synthesizes** the standard `Condition.category` that conformant EHRs already populate.

### Discriminating signals (observed)

| Signal | "Health Condition" (real problem) | "Personal Health Condition" (profile) |
|---|---|---|
| `identifier[].value` interface tell | `…:HealthCondition,<n>` | `…:PersonalHealthConsideration,<n>` |
| `code.coding[]` | standard terminology (ICD‑9/ICD‑10/SNOMED) present | **none** — `code.text` only |
| `recorder` / `asserter` | often a `Practitioner` (sometimes `Patient` = self-reported) | absent |

Presence of a **coded diagnosis** is the most reliable separator (it also catches patient self-reported items the interface tell misses); the interface tell is a strong secondary confirmation. Synthesis rule (see the [Phase 1 spec](../your-phr-dashboard/phase-1-condition-classifier-spec.md) for the exact decision table):

- standard code or `HealthCondition` tell → `category = problem-list-item` (tier clinician)
- coded but patient-asserted, no standard code → `problem-list-item` (tier self-reported)
- text-only + `PersonalHealthConsideration` + no clinician recorder → `category = sdoh` (Patient Profile)
- ambiguous → default to a health problem (never bury a possible diagnosis)

### clinicalStatus / abatement / verificationStatus

- All exported conditions tend to be `clinicalStatus: active` regardless of section — so status alone cannot separate real problems from profile items.
- `abatement[x]` **is** populated for ended conditions (e.g. `abatementDateTime`) and is the native "until"/end-date signal (FHIR con-4: an abated condition's status should be inactive/resolved/remission).
- Honor `verificationStatus`: `entered-in-error` → omit; `refuted` → ruled out.

### Codes

- Real problems carry **ICD‑9 (`…/icd9cm`)** + **ICD‑10 (`hl7.org/fhir/sid/icd-10-cm`)** codings, plus a bare `display`-only coding.
- FollowMyHealth also emits a **proprietary code system** `https://fhir.followmyhealth.com/id/translation` whose `code` is an internal **UUID** (not a real terminology code). Show its `display`; never present the UUID as a "code". Filter `standardCodings` to recognized systems only.

## Observation — categorized, but two very different populations

Unlike `Condition`, FollowMyHealth **does populate `Observation.category`** with standard `http://terminology.hl7.org/CodeSystem/observation-category` codes — so there is *no missing category to synthesize*. The Observation issues are legibility (missing display labels) and a large volume of non-clinical wearable/activity data. Observed populations (from analysis of a real export):

- **Vital signs** (`category = vital-signs`): clinically conformant. Every one carries a **US Core Vital Signs LOINC code** — Body Height `8302-2`, Body Weight `29463-7`, BMI `39156-5`, Heart Rate `8867-4`, Respiratory Rate `9279-1`, Body Temperature `8310-5`, Oxygen Saturation `2708-6`, Blood Pressure panel `85354-9`. Blood pressure is correctly modeled as a panel with components `8480-6` (systolic) + `8462-4` (diastolic); value-bearing vitals carry a UCUM unit on `valueQuantity`. **Gap:** `code.coding[].display` is empty on every vital — the LOINC code is present but there is no human label, so display must supply the name from the code (a definitional lookup, not inference).
- **Activity / steps** (`category = activity`): daily step counts, LOINC `41950-7` ("Number of steps in 24 hour"), one Observation per day. **Non-conformant representation:** the count is a bare **`valueInteger`** with **no unit** (no `valueQuantity`, no UCUM), empty `code.coding[].display`, **no `subject`**, no `issued`, `performer` → `Patient`, and a **date-only** `effectiveDateTime`.
- **No laboratory Observations** were present in the analyzed export (labs would normally be `category = laboratory` and/or `DiagnosticReport`; this export contained none — worth confirming whether lab data lives elsewhere or is simply absent for a given patient).

Activity-data shape (the step series, genericized — actual values/dates are PHI and stay in `private/phi/`):

- The series is **heavily zero-inflated**: most days are `0`, representing *device not worn / not synced* rather than a measured zero. The record states `0`, so Layer 1 carries it faithfully; zero-suppression is a **display** decision, not a Layer-1 reinterpretation.
- A minority of days carry genuine, varied counts in a normal human range (up to ~10k steps/day) — a real signal, not a stuck value.
- Tracking is typically **front-loaded**: a burst of active days followed by a long tail of zero days (the classic "wore a tracker briefly, then stopped" pattern).

**Conformance-remodel boundary** (the rule for transforming activity/vitals toward canonical form): a Layer-1 remodel may fill **definitional** values (the unit/label a LOINC code implies — e.g. `valueInteger` → `valueQuantity { value, unit "steps", code "{steps}" }`, attaching the vital/step name from the code) and **known-context** values (the patient `subject` from the import connection). It must **never fabricate observed precision**: a date-only `effectiveDateTime` stays date-only (do not invent a time-of-day or timezone), and a missing `issued` stays absent (do not stamp a clock). UCUM for steps is the dimensionless annotation `{steps}`, **not** a per-day rate (`{/d}`) — the 24-hour window is already baked into the code.

US Core does **not** profile step counts; the standard home for physical-activity data is the HL7 **Physical Activity IG** (`build.fhir.org/ig/HL7/physical-activity/`), still **draft** (STU/ballot). So activity data is routed by the `category = activity` FMH already provides now, with PA IG conformance as a deliberate later opt-in (per the architecture doc's gated conformance test).

**Usability gate (why FMH activity is consolidated, not shown as a daily chart):** the observed step series is stale (its activity ends years before the import) and zero-inflated (most days `0` = device not worn). Shown as a daily chart it would mislead, and a naive "average steps per 24h" would mislead worse — averaging over all calendar days buries the no-wear zeros (observed: a year whose all-days average is an *order of magnitude below* its average on worn days — the device was barely worn, not the patient barely moving). Per the architecture doc's [surfacing gate for low-value series](../your-phr-dashboard/classification-and-display-architecture.md#surfacing-gate-for-low-value-series-activity--tracker-data): the step series clears floor **A** (structured, LOINC-coded, numeric `valueInteger`) but fails **recency (C)**, so it is **retained (no-discard) and collapsed to an honest per-year rollup** — `{active days, avg on active days, peak}`, explicitly labeled, **never a bare calendar average**. The `text/plain` "Exercise" `DocumentReference`s fail floor **A** outright (no numeric value). The gate is **source-agnostic** — a live, current tracker feed would pass B/C and get the daily view automatically, with no FMH-specific code.

## DocumentReference — the volume problem (clinical docs buried under wearable "Notes")

`DocumentReference` is by far the **largest resource type** in a FollowMyHealth EHI export (the analyzed export was ~85% DocumentReference). FollowMyHealth uses it as a catch-all mixing a handful of real clinical documents with a flood of wearable/lifestyle entries, and provides **no `DocumentReference.category` and no coded `type`** — only free-text `type.coding[].display`. Two populations, cleanly separable by explicit signals:

| Population | MIME (`content.attachment.contentType`) | Interface tell | `type.display` examples |
|---|---|---|---|
| **Wearable / lifestyle "Notes"** (the flood) | `text/plain` | `identifier` value `…:Note,<n>` (system `…/id/interface`) | "Exercise: Walking", "Exercise: Biking", "Sleep Session", "Food and Drink" |
| **Real clinical documents** | `application/xml` (C-CDA) + `text/html` | **no `Note` tell** | "… Continuity of Care Document", "Health History", "Contact Information" |

Discriminating signals for synthesizing a `DocumentReference.category` (route the flood out of the clinical-document view — do **not** discard it; no-dedup/report-as-given still holds):

- **MIME type** is the cleanest separator: `application/xml` / `text/html` → real clinical document; `text/plain` → wearable "Note".
- **Interface tell:** the wearable Notes carry `…:Note,<n>`; the real clinical docs do not.
- All attachments are `url` references (no inline `data`).

The wearable "Exercise" / "Sleep" DocumentReferences are largely the **same physical-activity feed** represented a second time alongside the `category = activity` step Observations. Per the no-dedup decision both are kept; both need a synthesized category so a clinical view can exclude them and an "Activity" view can include them.

## Reference formats (resolution quirk)

| Reference type | Format | Resolution |
|---|---|---|
| Patient / Practitioner / Organization | `Type/<id>` | direct id match |
| **Encounter** | `Encounter/<patientId>_<encounterId>` (underscore-joined) | **strip the `<patientId>_` prefix, then match `Encounter.id`** |

Naive resolution searches for the whole `patientId_encounterId` blob as an id and silently finds nothing. The `fullUrl` of every resource is also patient-scoped: `…/api/<ResourceType>/<patientId>/<resourceId>` — the middle segment is always the patient, **not** a provider.

## Provenance ("who said this")

- FollowMyHealth EHI exports contain **no `Provenance` resources**, and `Condition`s do **not** link to an `Encounter`.
- But many real conditions carry `recorder`/`asserter` → a `Practitioner` reference that **resolves** to a named `Practitioner` in the bundle, or → `Patient` (self-reported).
- So the provenance chain for FollowMyHealth is: `asserter`/`recorder` → named Practitioner or "Self-reported"; floor = "Source: FollowMyHealth" (the aggregator — never invent an originating clinic).

## Other documented quirks (long tail — handle on demand)

- **Encounter:** not visible in the PHR; `status` always `Unknown` (FollowMyHealth has no encounter-status concept).
- **DiagnosticReport / Observation:** custom extensions `…/ObservationExtension/CollectedOnDate` and `…/OrderedOnDate` carry dates FHIR R4 lacks fields for. (See the **Observation** section above for the category/representation findings.)
- **FamilyMemberHistory:** relationship "all family" has no FHIR code-system equivalent → emitted as `Display` only; custom `FamilyMemberHistoryExtension`.
- **Immunization:** statuses without a clean FHIR mapping are coerced to the nearest value with the original in `StatusReason`.
- **Document Reference:** `Note`-type docs are `text/plain`; `TransitionOfCare` docs are `application/xml` (C-CDA) — candidates for the C-CDA converter (#254), though re-importing them risks double-reporting (no-dedup decision).

## See also

- Architecture: [`docs/your-phr-dashboard/classification-and-display-architecture.md`](../your-phr-dashboard/classification-and-display-architecture.md)
- Phase 1 spec: [`docs/your-phr-dashboard/phase-1-condition-classifier-spec.md`](../your-phr-dashboard/phase-1-condition-classifier-spec.md)
- Related issues: #262 (legible display), #264 (reference resolution), #53 (Veradigm/FollowMyHealth), #254 (C-CDA import)
