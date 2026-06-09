# Medications — display & reconciliation (brainstorm + decisions)

> **Status:** brainstorm / planning (2026-06-09). Not yet an implementation plan — captures the
> shape, the confirmed decisions, and the open questions. Drug names below are generic examples,
> not patient data.

## Goal

Clinicians (and patients) constantly ask for **"Current Medications."** That is **not** a single
FHIR resource — it is a **derived, reconciled, patient-facing view** assembled across several
resource types. Producing a clean, trustworthy current-meds list (that a patient can show a doctor)
is the valuable outcome.

## Architecture: the two ends

The organizing principle: keep the two concerns separate.

### Input-end (backend) — "just the facts"

Gather and organize the source data, source-faithfully. Ingest the medication resources, normalize
and index them, derive sort/title fields, and make them as conformant/complete as the source allows
— **with fallbacks, never dropping data** (per the non-US-Core stance). **No clinical interpretation
here** — the backend produces organized facts, attributed to their source.

### Output-end (frontend) — "meaning for end-users"

Present the facts meaningfully: reconcile across resources into a de-duplicated current-meds list,
infer active vs past (transparently), render dose/status/source, expand-for-details, and link to
authoritative drug references. Interpretation and UX live here.

> Boundary note: the "is this current?" reconciliation is the one piece that could live on either
> end (a backend computed endpoint vs frontend compute) — see Open Questions. The rule stays: the
> backend stays facts-only; any inference is clearly **derived** and **transparent** to the user.

## Code systems — the target vocabulary (USCDI / US Core)

This is an **Input-end** concern: "conform to what ends we can." For a SMART-on-FHIR application the target vocabulary is the one established by the **United States Core Data for Interoperability (USCDI)** and the **US Core Implementation Guide** — using these standard code systems is what lets substitutable apps interoperate with any EHR. The per-data-type targets (from research notes, "Which Data Set?"):

| Clinical data type | Target code system |
| --- | --- |
| Problems & Diagnoses | SNOMED CT (exact clinical terminology) |
| Billing & Public-health reporting | ICD (International Classification of Diseases) |
| Lab tests & Observations | LOINC (Logical Observation Identifiers Names and Codes) |
| **Medications** | **RxNorm** (clinical drugs & medication names) |

For this doc the binding row is **Medications → RxNorm** — which is exactly why RxNorm is our join/lookup key below. The other rows govern sibling resources (Condition, Observation, etc.) and belong to the wider per-profile work, noted here only for cross-reference.

**Input-end reality (detect-don't-require):** the standard is the _target_, not a guarantee. Non-US-Core sources (e.g. FollowMyHealth) frequently emit a **local/proprietary code system** instead of RxNorm (seen: `https://fhir.followmyhealth.com/id/translation` with UUID codes and only a display string). So the Input-end **maps to RxNorm where it can** (via the glossary), preserves the original local code + display, and **falls back to display text** otherwise — it never drops or rejects the medication for failing to use RxNorm.

## Confirmed decisions

- **Display the patient's data regardless of conformance.** A viewer displays, it does not validate;
  detect-don't-require; fallbacks are the mission-critical path. (Standing stance, reaffirmed.)
- **No UI conformance-flagging; no clinical advice / interaction-checking** we cannot stand behind.
  Frame meds as **"from your records,"** shown **"as of your last import."**
- **"Current Medications" is a derived, reconciled view** (de-duplicated by drug) — not a raw
  per-resource dump.
- **Two-ends separation** (input gathers facts / output displays meaning), as above.
- A per-medication **"Show all Medication details"** expander reveals the contributing
  MedicationRequest / MedicationDispense / Medication (/ MedicationStatement) with dates + provenance.
- **External drug-reference links** to DailyMed (`dailymed.nlm.nih.gov`) and MedlinePlus
  (`medlineplus.gov`) for label / side-effects / contraindications / consumer info.
- Those links are **user-clicked (explicit), not auto-fetched** — an outbound request carries the
  drug name to NLM, so it should be the patient's deliberate action (consistent with the privacy
  stance). NLM is a trusted public source; a drug name alone is not identifying.
- **RxNorm is the join/lookup key** — it is the USCDI / US Core target vocabulary for medications
  (see "Code systems" above); already resolved by the glossary. Fall back to normalized display
  text when a source uses a local/proprietary code system.

## Design sketch (mapped to the two ends)

### Input-end (facts)

- Parse all medication resource types, including **MedicationStatement** (not a US Core profile, but
  FollowMyHealth emits it for self-reported meds).
- Per resource, capture: code (RxNorm where present; preserve local code + display otherwise),
  status, the relevant date(s) (authoredOn / effective[x] / whenHandedOver / dateAsserted), dosage,
  dispense quantity + days-supply, and prescriber / pharmacy / informationSource where present.
- Derive `sort_title` / `sort_date` for each (MedicationDispense and MedicationStatement currently
  lack a `resourceSortConfig` entry — they render blank/undated).
- Filter junk template fields (e.g. empty placeholder notes like `"ProviderName -"`).
- Output: clean, source-attributed, organized resources — **no reconciliation/interpretation**.

### Output-end (meaning)

- **Reconcile / de-duplicate by RxNorm** (fallback: normalized display text) into one row per drug —
  collapsing a prescription + statement + multiple dispenses of the same drug into a single entry.
- **Active / Past split** via best-effort "current" heuristics, shown transparently ("as of import").
- Row content: drug name, dose / route / frequency (from the best source's dosageInstruction),
  status, last-activity date, source badge.
- **Expand** to the contributing resources with provenance (which portal, when).
- **Drug-info links** (DailyMed + MedlinePlus, keyed by RxCUI; name-search fallback for non-coded)
  — see "Outbound information links" below for the concrete endpoints and URL templates.
- Likely a **"Medications" dashboard widget** (fits the per-profile dashboards roadmap, #136).

## Outbound information links (Output-end)

The richest and safest way to give a patient "more information" about a medication — indications, contraindications, side effects, dosing guidance — is to **link out to authoritative public sources**, not to store or synthesize that content ourselves. RxNorm gives us drug _identity_ only; the clinical content lives in these NLM / FDA resources. Plan for two links per medication — both free, ad-free, no auth, and trustworthy:

| Link | Source | What the patient gets | URL template |
| --- | --- | --- | --- |
| **Consumer drug info** | MedlinePlus (NLM) | Plain-language: what it treats, how to take, side effects, precautions; English + Spanish | `https://connect.medlineplus.gov/application?mainSearchCriteria.v.cs=2.16.840.1.113883.6.88&mainSearchCriteria.v.c=<RxCUI>&mainSearchCriteria.v.dn=<name>&informationRecipient.languageCode.c=en` |
| **FDA label** | DailyMed (NLM / FDA) | Full structured labeling: indications, contraindications, dosage & administration, adverse reactions | `https://dailymed.nlm.nih.gov/dailymed/search.cfm?query=<name>` |

Confirmed details (verified against NLM docs, 2026-06-09):

- The RxNorm code-system OID for the MedlinePlus `mainSearchCriteria.v.cs` parameter is `2.16.840.1.113883.6.88`. Swap `informationRecipient.languageCode.c=es` for Spanish. `mainSearchCriteria.v.dn` (display name) is optional but improves the match.
- We use the MedlinePlus Connect **Web Application** endpoint (`/application`), which returns a rendered human page — not the **Web Service** endpoint (`/service`), which returns XML/JSON for machine use.
- These are **pure hrefs built on the client** — nothing is fetched until the patient clicks, and the request then carries only a drug name / RxCUI, never patient identity. This reaffirms the "user-clicked, not auto-fetched" decision.
- Render as normal links opening in a new tab with `rel="noopener noreferrer"`.

Construction strategy (detect-don't-require):

- **Have an RxCUI** → MedlinePlus Connect by code (best match), passing the display name as `v.dn` too.
- **No RxCUI** (non-US-Core / local code system) → fall back to **name-based** links: DailyMed `search.cfm?query=<name>` and a MedlinePlus name search; both accept a free-text drug name. Never a dead end.

Open questions for the links:

- MedlinePlus Connect returns a "no information available" page when an RxCUI isn't covered — decide the fallback (drop to name search vs hide the link).
- A DailyMed deep link to the _exact_ label (`drugInfo.cfm?setid=<setid>`) needs an API hop (`services/v2/spls.json?rxcui=<RxCUI>` → `setid`). Name search is fine for v1; the deep link is a later enhancement (and would be a server-side or on-click lookup, not a static href).
- Stick to **NLM / FDA sources only** — no ad-supported consumer sites (Drugs.com, WebMD). Keeps it authoritative, ad-free, and consistent with "no clinical advice we can't stand behind." Confirm.

## Open questions (to decide)

- **Where does reconciliation live?** Backend computed endpoint (precedent: `/summary`, IPS) vs
  frontend compute. The two-ends principle leans frontend (reconciliation is "meaning"), but a
  backend endpoint could serve a ready-made list. Decide.
- **"Current" heuristic specifics** — which signals and thresholds; days-supply math; how to handle
  non-US-Core data with unreliable statuses / no end dates.
- **Include MedicationStatement in the reconciled list?** (Recommend yes — it is the patient's
  self-reported current meds.)
- **Grouping granularity** — RxNorm ingredient vs clinical-drug (dose-specific).
- **Confirm** the user-clicked external-link approach is acceptable.
- **Jim's prior art:** the internal "MEW Current Medications" view — fields / grouping / links it
  settled on (to align this design).

## Related codebase state (2026-06-09)

- **MedicationRequest** — display model + card + `resourceSortConfig` + US Core Must-Support audited
  (#144). Complete.
- **Medication** — display model + card wired; no `resourceSortConfig`; not MS-audited. (Usually a
  referenced/contained resource, so "no sort" matters less.)
- **MedicationDispense** — display model exists, but its fhir-card `typeLookup` case is **commented
  out** (renders via the generic fallback); no `resourceSortConfig`. Effectively unhandled in the UI.
- **MedicationStatement** — **no frontend display model** (factory case commented out); backend
  stores/indexes it. Not a US Core profile.
- **RxNorm glossary** exists (code -> display) — the basis for grouping + the external links.
- Backend already has computed-summary precedent: `/summary` and the IPS summary endpoint.

## Suggested phasing

1. **Input-end:** parse + sort all medication types — wire the MedicationDispense card, add a
   MedicationStatement model, add `resourceSortConfig` entries, filter placeholder notes.
2. **Output-end:** the reconciled **Current Medications** view (active/past, de-dup, expand-for-details).
3. **Drug-info links** (DailyMed + MedlinePlus by RxCUI, with name-search fallback).
4. Track as an **epic / design issue** before code (the reconciliation logic + "current" heuristics
   deserve their own discussion).
