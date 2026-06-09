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

> Boundary note: reconciliation + the "is this current?" inference is interpretation, so by the
> two-ends principle it would sit on the Output-end. **Decided** to put it in a backend
> compute-on-request endpoint instead (single source of truth, reusable by IPS / summary / future
> clients) — see Confirmed decisions. To preserve the principle it lives as an explicit, clearly
> **derived** layer, separate from the pure-facts raw resource endpoints, and returns its evidence
> so the frontend can show _why_ a med is marked current. Raw ingestion/storage stays facts-only.

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
- **No guessing.** Do the best we can with the explicit signals the record actually states; never
  fabricate or infer. In particular: **no days-supply extrapolation** to decide a med was stopped,
  and **no inferring "Purpose" from drug class**. When a signal is absent, we say so — we do not
  invent a value.
- **Absent data shows a common "Data Not Provided" marker** (app-wide convention, not meds-only).
  When an expected field is missing from the imported record, render a muted **"Data Not Provided"**
  with an explanation (tooltip + glossary link) that the data was not in the source — distinct from
  a value of zero/none and from an app error. One shared component / one glossary term, reused
  everywhere (see "Missing-data convention" below).
- **"Current Medications" is a derived, reconciled view** (de-duplicated by drug) — not a raw
  per-resource dump.
- **Include MedicationStatement in the reconciled list.** OTC drugs and supplements (and other
  self-reported meds) almost always arrive as MedicationStatement, not MedicationRequest — omitting
  it would drop a large share of a real patient's actual current meds.
- **De-dup at the clinical-drug (dose-specific) level, not ingredient.** "Same drug" for collapsing
  a row means same ingredient **+ strength + form** (RxNorm Clinical Drug, e.g. `Lisinopril 40 MG
  Oral Tablet`) — so Lisinopril 40 mg and Lisinopril 10 mg are **two rows**, not one. This keeps the
  Dose column unambiguous (no guessing which strength to show), makes a dose change visible (old
  strength → Past, new → Active), and matches the non-US-Core fallback path, where the display
  string already encodes the strength. It does **not** weaken the main de-dup: one strength's
  prescription + its dispenses + a matching statement still collapse into a single row.
- **Two-ends separation** (input gathers facts / output displays meaning), as above.
- **Reconciliation lives in a backend compute-on-request endpoint.** One source of truth for the
  reconciliation + active/past logic (not duplicated in TypeScript), reusable by IPS / `/summary` /
  future clients. It is a stateless derivation over the stored resources (like `/summary` and IPS)
  — **never a materialized "current_medications" table** (that would go stale on every import and
  duplicate PHI). Per-patient compute is cheap (ms), so the win is single-source-of-truth +
  reuse + testability, not raw performance.
- **The endpoint is an explicit derived layer, and returns its evidence.** Reconciliation/active-past
  is interpretation, so it stays separate from the pure-facts raw resource endpoints and is clearly
  labelled derived. It returns the inputs it reasoned from (status, explicit end dates, last
  activity) so the frontend can show _why_ a med is in a given state; the frontend still owns
  presentation (active/past UI,
  expanders, outbound links, the "as of your last import" framing).
- **Endpoint contract is vendor-agnostic and RxNorm-keyed — but preserves original codings.** Logic
  works on standard FHIR fields with fallbacks (no FollowMyHealth special-casing); the API shape
  exposes no proprietary structures and groups on RxNorm where present. It still **passes through
  the original `coding` + display text** as fidelity fields — "no proprietary data" means none in
  the contract/keying, _not_ dropping non-US-Core meds that lack an RxNorm code.
- A per-medication **"Show all Medication details"** expander reveals the contributing
  MedicationRequest / MedicationDispense / Medication (/ MedicationStatement) with dates + provenance.
- **External drug-reference links** to DailyMed (`dailymed.nlm.nih.gov`) and MedlinePlus
  (`medlineplus.gov`) for label / side-effects / contraindications / consumer info.
- **NLM / FDA sources only** for outbound drug info — no ad-supported consumer sites (Drugs.com,
  WebMD). Keeps it authoritative, ad-free, and consistent with "no clinical advice we can't stand
  behind."
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
- Per resource, capture the US Core **Must-Support** elements (capture where present, fall back where
  not — never require):
  - **Common:** code (RxNorm where present; preserve local code + display otherwise); status; the
    `reported[x]` / `informationSource` flag (signals a secondary source such as the patient); the
    SIG (free-text `dosageInstruction.text`); timing (when to administer); route; dose & rate.
  - **MedicationRequest:** `category` (e.g. Discharge Medication); `requester` (prescriber);
    `authoredOn` (date written); encounter; `dispenseRequest` quantity + number of refills.
  - **MedicationDispense:** `performer` (who dispensed); `authorizingPrescription`; `type` (e.g.
    partially dispensed); `quantity`; `whenHandedOver` (date dispensed); encounter.
  - **MedicationStatement:** `effective[x]` / `dateAsserted`; `informationSource`.
- Derive `sort_title` / `sort_date` for each (MedicationDispense and MedicationStatement currently
  lack a `resourceSortConfig` entry — they render blank/undated).
- Filter junk template fields (e.g. empty placeholder notes like `"ProviderName -"`).
- Output: clean, source-attributed, organized resources — **no reconciliation/interpretation**.

### Derived layer (backend compute-on-request endpoint)

The reconciliation sits between the two ends as an explicit derived layer — `GET
/api/secure/medications/reconciled` (or folded into the existing summary). Stateless, computed per
request from the stored resources; never materialized. See Confirmed decisions for the rationale.

- **Reconcile / de-duplicate by RxNorm at the clinical-drug (dose-specific) level** (fallback:
  normalized display text) into one entry per drug+strength+form — collapsing a prescription +
  statement + multiple dispenses of that same clinical drug into a single entry. Different strengths
  of the same ingredient remain separate rows (see Confirmed decisions).
- **De-dup when there is no RxNorm code** (decided): first try to resolve the display text → RxNorm
  via the glossary; if that fails, **exact normalized-string match only** (lowercase / trim /
  collapse whitespace) — **never fuzzy**. Under-merging (two rows that are really one) is honest;
  wrong-merging two different drugs is dangerous and is itself guessing.
- **Field precedence when several resources feed one row** (decided): Dose / Frequency / SIG →
  MedicationRequest (prescribed) > MedicationStatement (self-reported) > MedicationDispense;
  prescriber → `MedicationRequest.requester`; last-activity → max relevant date across contributors;
  name/code → most specific RxNorm clinical drug. **Always expose every contributor in the
  expander** — nothing is dropped.
- **Status-conflict resolution** (decided): dose-specific de-dup already removes most conflicts. For
  a genuine conflict on the _same_ clinical drug (e.g. active request + completed statement), the
  most-recently-dated authoritative status drives the badge, but the row shows a **"conflicting
  records — see details"** affordance and the expander lists each contributor's status. Expose the
  conflict; never fabricate a clean winner.
- **List sort order** (decided): **default newest on top** — last-activity date, descending — but
  the table is **user-sortable on the frontend**: clickable column headers re-sort client-side
  (Medication name, Status, date; others as useful). This is pure presentation (Output-end) and
  needs no backend change — the endpoint just returns the default order plus the date fields to sort
  on. Rows with no usable date (Unknown / undated) sort to the bottom regardless of direction; we do
  not invent a date to place them (no guessing). The "Active only / All" toggle filters before
  sorting.
- **Classify state from explicit signals only** (no guessing — see below), with the **evidence**
  attached (status, explicit end dates, last activity) so the frontend can show _why_.
- Resolve `medicationReference` → Medication; key/group on RxNorm; **pass through original `coding` +
  display** as fidelity fields. Vendor-agnostic logic, no proprietary structures in the contract.
- Reads MedicationRequest / MedicationStatement / MedicationDispense / Medication via
  `DatabaseRepository`. Go service + fixture tests, including a non-US-Core fixture.

#### Active / Past classification (no guessing)

State is decided from explicit, record-stated signals only — never inferred from age or
days-supply. Priority order:

| Explicit signal | State |
| --- | --- |
| `status = active` (MedicationRequest / MedicationStatement) | **Active** |
| `status = on-hold` | **Suspended** |
| `status = stopped / cancelled / completed` (or MedicationStatement `not-taken`) | **Past** |
| `effectivePeriod.end` in the past (record _states_ it ended) | **Past** |
| `status = unknown` / missing / `draft` / `intended` | **Unknown** |
| `status = entered-in-error` | excluded |

- "Best we can, no guessing": an old `status = active` with no recent dispense **stays Active** —
  we surface "last activity: \<date\>" beside it and let the human judge; we never silently downgrade.
- Non-US-Core data with no/garbage status lands in **Unknown** — shown, never assumed active.
- Days-supply / last-dispense are shown as _information_ only; they never drive the classification.

### Output-end (presentation)

Target layout, from Jim's "MEW Current Medications" prior art — columns
**Medication · Dose · Frequency · Purpose · Comments**, plus an explicit **Status** badge. Mapped
to FHIR sources (and an honest note on what FHIR usually omits):

| Column | FHIR source | Reality |
| --- | --- | --- |
| **Medication** | `medication[CodeableConcept\|Reference]` → RxNorm display, else original text | Always present |
| **Dose** | `dosageInstruction.doseAndRate` / `dosage.text` | Usually present |
| **Frequency** | `dosageInstruction.timing` (+ `asNeeded` → PRN) / text | Often free-text; PRN detectable |
| **Purpose** | `reasonCode` / `reasonReference` → Condition | **Sparse** — show if stated, else "Data Not Provided"; never inferred from drug class |
| **Comments** | `requester` / `informationSource` (prescriber), `note[]`, status annotations | Partial |
| **Status** | the classification above (Active / Suspended / Past / Unknown) | Always shown |

- **Purpose is the weak column.** Jim's hand-curated table has rich purposes ("ACE inhibitor for
  blood pressure"); FHIR `reasonCode` is frequently empty, and inferring purpose from drug class is
  both guessing and clinical advice — so it shows the **"Data Not Provided"** marker unless the
  record states it. (A future _authoritative_ option is RxClass `may_treat`, but that is the parked
  RxClass build.)

#### Missing-data convention ("Data Not Provided") — app-wide

This is **not medications-specific** — it is the visible expression of "no guessing" and should be a
shared building block used by every resource view.

- **One shared component** (e.g. `<app-missing-data>` / a small pipe) renders a muted **"Data Not
  Provided"** in place of an absent expected field. The wording, styling, tooltip, and glossary link
  live in that one place — mirrors how `resolveStatus` is shared.
- **Explanation** (tooltip + a glossary term): _"This information was not included in the record
  imported from your provider. YourPHR shows only what the source supplied — it never fills in or
  guesses missing values."_ The glossary already exists (`/api/glossary`), so the long-form text is
  a natural glossary entry.
- **Use it for prominent/expected fields only** (Purpose, Dose, Frequency, prescriber…). Do **not**
  render it for every minor optional field — a sparse non-US-Core record would otherwise become a
  wall of placeholders. Silently omit truly-minor fields.
- **Distinct from** a real zero/none value and from an app/render error — the marker means
  specifically "absent in the source record."
- Because it is app-wide, build the shared component under its **own issue**, and have the
  Medications view be its first consumer.
- **Consume the reconciled list** from the endpoint and render it — the frontend does not re-derive.
- **Show everything with a Status badge; never hide by guessing.** Default can emphasise Active, with
  an "Active only / All" toggle — completed/suspended/unknown meds stay visible (e.g. a recent
  completed antibiotic, a suspended statin), annotated, not dropped.
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

Parked for v1 (decided):

- **MedlinePlus "no information" page** — when an RxCUI isn't covered, Connect shows its own "no information available" page. v1 accepts that and always _also_ renders the DailyMed name-search link, so there is never a dead end. A nicer "drop to name search" fallback is a v2 polish, not a v1 blocker.
- **DailyMed deep link** to the _exact_ label (`drugInfo.cfm?setid=<setid>`) needs an API hop (`services/v2/spls.json?rxcui=<RxCUI>` → `setid`). v1 uses the name-search link; the deep link is a v2 enhancement (a server-side or on-click lookup, not a static href).

## Open questions (to decide)

_All resolved as of 2026-06-09 — see Confirmed decisions and the Derived-layer section._

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
2. **Derived layer:** the `GET /api/secure/medications/reconciled` endpoint — de-dup by RxNorm,
   suggested active/past + evidence, original codings preserved; Go service + fixture tests.
3. **Output-end:** the **Current Medications** view consuming the endpoint (active/past,
   expand-for-details), plus the dashboard widget.
4. **Drug-info links** (DailyMed + MedlinePlus by RxCUI, with name-search fallback).
5. Track as an **epic / design issue** before code (the "current" heuristic deserves its own
   discussion).
