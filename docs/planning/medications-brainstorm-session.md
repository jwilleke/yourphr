# Medications — display & reconciliation (brainstorm + decisions)

> __Status:__ brainstorm / planning (2026-06-09). Not yet an implementation plan — captures the
> shape, the confirmed decisions, and the open questions. Drug names below are generic examples,
> not patient data.

## Goal

Clinicians (and patients) constantly ask for __"Current Medications."__ That is __not__ a single
FHIR resource — it is a __derived, reconciled, patient-facing view__ assembled across several
resource types. Producing a clean, trustworthy current-meds list (that a patient can show a doctor)
is the valuable outcome.

## Architecture: the two ends

The organizing principle: keep the two concerns separate.

### Input-end (backend) — "just the facts"

Gather and organize the source data, source-faithfully. Ingest the medication resources, normalize
and index them, derive sort/title fields, and make them as conformant/complete as the source allows
— __with fallbacks, never dropping data__ (per the non-US-Core stance). __No clinical interpretation
here__ — the backend produces organized facts, attributed to their source.

### Output-end (frontend) — "meaning for end-users"

Present the facts meaningfully: reconcile across resources into a de-duplicated current-meds list,
infer active vs past (transparently), render dose/status/source, expand-for-details, and link to
authoritative drug references. Interpretation and UX live here.

> Boundary note: reconciliation + the "is this current?" inference is interpretation, so by the
> two-ends principle it would sit on the Output-end. __Decided__ to put it in a backend
> compute-on-request endpoint instead (single source of truth, reusable by IPS / summary / future
> clients) — see Confirmed decisions. To preserve the principle it lives as an explicit, clearly
> __derived__ layer, separate from the pure-facts raw resource endpoints, and returns its evidence
> so the frontend can show *why* a med is marked current. Raw ingestion/storage stays facts-only.

## Code systems — the target vocabulary (USCDI / US Core)

This is an __Input-end__ concern: "conform to what ends we can." For a SMART-on-FHIR application the target vocabulary is the one established by the __United States Core Data for Interoperability (USCDI)__ and the __US Core Implementation Guide__ — using these standard code systems is what lets substitutable apps interoperate with any EHR. The per-data-type targets (from research notes, "Which Data Set?"):

| Clinical data type | Target code system |
| --- | --- |
| Problems & Diagnoses | SNOMED CT (exact clinical terminology) |
| Billing & Public-health reporting | ICD (International Classification of Diseases) |
| Lab tests & Observations | LOINC (Logical Observation Identifiers Names and Codes) |
| __Medications__ | __RxNorm__ (clinical drugs & medication names) |

For this doc the binding row is __Medications → RxNorm__ — which is exactly why RxNorm is our join/lookup key below. The other rows govern sibling resources (Condition, Observation, etc.) and belong to the wider per-profile work, noted here only for cross-reference.

__Input-end reality (detect-don't-require):__ the standard is the *target*, not a guarantee. Non-US-Core sources (e.g. FollowMyHealth) frequently emit a __local/proprietary code system__ instead of RxNorm (seen: `https://fhir.followmyhealth.com/id/translation` with UUID codes and only a display string). So the Input-end __maps to RxNorm where it can__ (via the glossary), preserves the original local code + display, and __falls back to display text__ otherwise — it never drops or rejects the medication for failing to use RxNorm.

## Confirmed decisions

- __Display the patient's data regardless of conformance.__ A viewer displays, it does not validate;
  detect-don't-require; fallbacks are the mission-critical path. (Standing stance, reaffirmed.)
- __No UI conformance-flagging; no clinical advice / interaction-checking__ we cannot stand behind.
  Frame meds as __"from your records,"__ shown __"as of your last import."__
- __No guessing.__ Do the best we can with the explicit signals the record actually states; never
  fabricate or infer. In particular: __no days-supply extrapolation__ to decide a med was stopped,
  and __no inferring "Purpose" from drug class__. When a signal is absent, we say so — we do not
  invent a value.
- __Absent data shows a common "Data Not Provided" marker__ (app-wide convention, not meds-only).
  When an expected field is missing from the imported record, render a muted __"Data Not Provided"__
  with an explanation (tooltip + glossary link) that the data was not in the source — distinct from
  a value of zero/none and from an app error. One shared component / one glossary term, reused
  everywhere (see "Missing-data convention" below).
- __"Current Medications" is a derived, reconciled view__ (de-duplicated by drug) — not a raw
  per-resource dump.
- __Include MedicationStatement in the reconciled list.__ OTC drugs and supplements (and other
  self-reported meds) almost always arrive as MedicationStatement, not MedicationRequest — omitting
  it would drop a large share of a real patient's actual current meds.
- __De-dup at the clinical-drug (dose-specific) level, not ingredient.__ "Same drug" for collapsing
  a row means same ingredient __+ strength + form__ (RxNorm Clinical Drug, e.g. `Lisinopril 40 MG
  Oral Tablet`) — so Lisinopril 40 mg and Lisinopril 10 mg are __two rows__, not one. This keeps the
  Dose column unambiguous (no guessing which strength to show), makes a dose change visible (old
  strength → Past, new → Active), and matches the non-US-Core fallback path, where the display
  string already encodes the strength. It does __not__ weaken the main de-dup: one strength's
  prescription + its dispenses + a matching statement still collapse into a single row.
- __Two-ends separation__ (input gathers facts / output displays meaning), as above.
- __Reconciliation lives in a backend compute-on-request endpoint.__ One source of truth for the
  reconciliation + active/past logic (not duplicated in TypeScript), reusable by IPS / `/summary` /
  future clients. It is a stateless derivation over the stored resources (like `/summary` and IPS)
  — __never a materialized "current_medications" table__ (that would go stale on every import and
  duplicate PHI). Per-patient compute is cheap (ms), so the win is single-source-of-truth +
  reuse + testability, not raw performance.
- __The endpoint is an explicit derived layer, and returns its evidence.__ Reconciliation/active-past
  is interpretation, so it stays separate from the pure-facts raw resource endpoints and is clearly
  labelled derived. It returns the inputs it reasoned from (status, explicit end dates, last
  activity) so the frontend can show *why* a med is in a given state; the frontend still owns
  presentation (active/past UI,
  expanders, outbound links, the "as of your last import" framing).
- __Endpoint contract is vendor-agnostic and RxNorm-keyed — but preserves original codings.__ Logic
  works on standard FHIR fields with fallbacks (no FollowMyHealth special-casing); the API shape
  exposes no proprietary structures and groups on RxNorm where present. It still __passes through
  the original `coding` + display text__ as fidelity fields — "no proprietary data" means none in
  the contract/keying, *not* dropping non-US-Core meds that lack an RxNorm code.
- A per-medication __"Show all Medication details"__ expander reveals the contributing
  MedicationRequest / MedicationDispense / Medication (/ MedicationStatement) with dates + provenance.
- __External drug-reference links__ to DailyMed (`dailymed.nlm.nih.gov`) and MedlinePlus
  (`medlineplus.gov`) for label / side-effects / contraindications / consumer info.
- __NLM / FDA sources only__ for outbound drug info — no ad-supported consumer sites (Drugs.com,
  WebMD). Keeps it authoritative, ad-free, and consistent with "no clinical advice we can't stand
  behind."
- Those links are __user-clicked (explicit), not auto-fetched__ — an outbound request carries the
  drug name to NLM, so it should be the patient's deliberate action (consistent with the privacy
  stance). NLM is a trusted public source; a drug name alone is not identifying.
- __RxNorm is the join/lookup key__ — it is the USCDI / US Core target vocabulary for medications
  (see "Code systems" above); already resolved by the glossary. Fall back to normalized display
  text when a source uses a local/proprietary code system.

## Design sketch (mapped to the two ends)

### Input-end (facts)

- Parse all medication resource types, including __MedicationStatement__ (not a US Core profile, but
  FollowMyHealth emits it for self-reported meds).
- Per resource, capture the US Core __Must-Support__ elements (capture where present, fall back where
  not — never require):
  - __Common:__ code (RxNorm where present; preserve local code + display otherwise); status; the
    `reported[x]` / `informationSource` flag (signals a secondary source such as the patient); the
    SIG (free-text `dosageInstruction.text`); timing (when to administer); route; dose & rate.
  - __MedicationRequest:__ `category` (e.g. Discharge Medication); `requester` (prescriber);
    `authoredOn` (date written); encounter; `dispenseRequest` quantity + number of refills.
  - __MedicationDispense:__ `performer` (who dispensed); `authorizingPrescription`; `type` (e.g.
    partially dispensed); `quantity`; `whenHandedOver` (date dispensed); encounter.
  - __MedicationStatement:__ `effective[x]` / `dateAsserted`; `informationSource`.
- Derive `sort_title` / `sort_date` for each (MedicationDispense and MedicationStatement currently
  lack a `resourceSortConfig` entry — they render blank/undated).
- Filter junk template fields (e.g. empty placeholder notes like `"ProviderName -"`).
- Output: clean, source-attributed, organized resources — __no reconciliation/interpretation__.

### Derived layer (backend compute-on-request endpoint)

The reconciliation sits between the two ends as an explicit derived layer — `GET
/api/secure/medications/reconciled` (or folded into the existing summary). Stateless, computed per
request from the stored resources; never materialized. See Confirmed decisions for the rationale.

- __Reconcile / de-duplicate by RxNorm at the clinical-drug (dose-specific) level__ (fallback:
  normalized display text) into one entry per drug+strength+form — collapsing a prescription +
  statement + multiple dispenses of that same clinical drug into a single entry. Different strengths
  of the same ingredient remain separate rows (see Confirmed decisions).
- __De-dup when there is no RxNorm code__ (decided): first try to resolve the display text → RxNorm
  via the glossary; if that fails, __exact normalized-string match only__ (lowercase / trim /
  collapse whitespace) — __never fuzzy__. Under-merging (two rows that are really one) is honest;
  wrong-merging two different drugs is dangerous and is itself guessing.
- __Field precedence when several resources feed one row__ (decided): Dose / Frequency / SIG →
  MedicationRequest (prescribed) > MedicationStatement (self-reported) > MedicationDispense;
  prescriber → `MedicationRequest.requester`; last-activity → max relevant date across contributors;
  name/code → most specific RxNorm clinical drug. __Always expose every contributor in the
  expander__ — nothing is dropped.
- __Status-conflict resolution__ (decided): dose-specific de-dup already removes most conflicts. For
  a genuine conflict on the *same* clinical drug (e.g. active request + completed statement), the
  most-recently-dated authoritative status drives the badge, but the row shows a __"conflicting
  records — see details"__ affordance and the expander lists each contributor's status. Expose the
  conflict; never fabricate a clean winner.
- __List sort order__ (decided): __default newest on top__ — last-activity date, descending — but
  the table is __user-sortable on the frontend__: clickable column headers re-sort client-side
  (Medication name, Status, date; others as useful). This is pure presentation (Output-end) and
  needs no backend change — the endpoint just returns the default order plus the date fields to sort
  on. Rows with no usable date (Unknown / undated) sort to the bottom regardless of direction; we do
  not invent a date to place them (no guessing). The "Active only / All" toggle filters before
  sorting.
- __Classify state from explicit signals only__ (no guessing — see below), with the __evidence__
  attached (status, explicit end dates, last activity) so the frontend can show *why*.
- Resolve `medicationReference` → Medication; key/group on RxNorm; __pass through original `coding` +
  display__ as fidelity fields. Vendor-agnostic logic, no proprietary structures in the contract.
- Reads MedicationRequest / MedicationStatement / MedicationDispense / Medication via
  `DatabaseRepository`. Go service + fixture tests, including a non-US-Core fixture.

#### Active / Past classification (no guessing)

State is decided from explicit, record-stated signals only — never inferred from age or
days-supply. Priority order:

| Explicit signal | State |
| --- | --- |
| `status = active` (MedicationRequest / MedicationStatement) | __Active__ |
| `status = on-hold` | __Suspended__ |
| `status = stopped / cancelled / completed` (or MedicationStatement `not-taken`) | __Past__ |
| `effectivePeriod.end` in the past (record *states* it ended) | __Past__ |
| `status = unknown` / missing / `draft` / `intended` | __Unknown__ |
| `status = entered-in-error` | excluded |

- "Best we can, no guessing": an old `status = active` with no recent dispense __stays Active__ —
  we surface "last activity: \<date\>" beside it and let the human judge; we never silently downgrade.
- Non-US-Core data with no/garbage status lands in __Unknown__ — shown, never assumed active.
- Days-supply / last-dispense are shown as *information* only; they never drive the classification.

### Output-end (presentation)

Target layout, from Jim's "MEW Current Medications" prior art — columns
__Medication · Dose · Frequency · Purpose · Comments__, plus an explicit __Status__ badge. Mapped
to FHIR sources (and an honest note on what FHIR usually omits):

| Column | FHIR source | Reality |
| --- | --- | --- |
| __Medication__ | `medication[CodeableConcept\|Reference]` → RxNorm display, else original text | Always present |
| __Dose__ | `dosageInstruction.doseAndRate` / `dosage.text` | Usually present |
| __Frequency__ | `dosageInstruction.timing` (+ `asNeeded` → PRN) / text | Often free-text; PRN detectable |
| __Purpose__ | `reasonCode` / `reasonReference` → Condition | __Sparse__ — show if stated, else "Data Not Provided"; never inferred from drug class |
| __Comments__ | `requester` / `informationSource` (prescriber), `note[]`, status annotations | Partial |
| __Status__ | the classification above (Active / Suspended / Past / Unknown) | Always shown |

- __Purpose is the weak column.__ Jim's hand-curated table has rich purposes ("ACE inhibitor for
  blood pressure"); FHIR `reasonCode` is frequently empty, and inferring purpose from drug class is
  both guessing and clinical advice — so it shows the __"Data Not Provided"__ marker unless the
  record states it. (A future *authoritative* option is RxClass `may_treat`, but that is the parked
  RxClass build.)

#### Missing-data convention ("Data Not Provided") — app-wide

This is __not medications-specific__ — it is the visible expression of "no guessing" and should be a
shared building block used by every resource view.

- __One shared component__ (e.g. `<app-missing-data>` / a small pipe) renders a muted __"Data Not
  Provided"__ in place of an absent expected field. The wording, styling, tooltip, and glossary link
  live in that one place — mirrors how `resolveStatus` is shared.
- __Explanation__ (tooltip + a glossary term): *"This information was not included in the record
  imported from your provider. YourPHR shows only what the source supplied — it never fills in or
  guesses missing values."* The glossary already exists (`/api/glossary`), so the long-form text is
  a natural glossary entry.
- __Use it for prominent/expected fields only__ (Purpose, Dose, Frequency, prescriber…). Do __not__
  render it for every minor optional field — a sparse non-US-Core record would otherwise become a
  wall of placeholders. Silently omit truly-minor fields.
- __Distinct from__ a real zero/none value and from an app/render error — the marker means
  specifically "absent in the source record."
- Because it is app-wide, build the shared component under its __own issue__, and have the
  Medications view be its first consumer.
- __Consume the reconciled list__ from the endpoint and render it — the frontend does not re-derive.
- __Show everything with a Status badge; never hide by guessing.__ Default can emphasise Active, with
  an "Active only / All" toggle — completed/suspended/unknown meds stay visible (e.g. a recent
  completed antibiotic, a suspended statin), annotated, not dropped.
- __Expand__ to the contributing resources with provenance (which portal, when).
- __Drug-info links__ (DailyMed + MedlinePlus, keyed by RxCUI; name-search fallback for non-coded)
  — see "Outbound information links" below for the concrete endpoints and URL templates.
- Likely a __"Medications" dashboard widget__ (fits the per-profile dashboards roadmap, #136).

## Outbound information links (Output-end)

The richest and safest way to give a patient "more information" about a medication — indications, contraindications, side effects, dosing guidance — is to __link out to authoritative public sources__, not to store or synthesize that content ourselves. RxNorm gives us drug *identity* only; the clinical content lives in these NLM / FDA resources. Plan for two links per medication — both free, ad-free, no auth, and trustworthy:

| Link | Source | What the patient gets | URL template |
| --- | --- | --- | --- |
| __Consumer drug info__ | MedlinePlus (NLM) | Plain-language: what it treats, how to take, side effects, precautions; English + Spanish | `https://connect.medlineplus.gov/application?mainSearchCriteria.v.cs=2.16.840.1.113883.6.88&mainSearchCriteria.v.c=<RxCUI>&mainSearchCriteria.v.dn=<name>&informationRecipient.languageCode.c=en` |
| __FDA label__ | DailyMed (NLM / FDA) | Full structured labeling: indications, contraindications, dosage & administration, adverse reactions | `https://dailymed.nlm.nih.gov/dailymed/search.cfm?query=<name>` |

Confirmed details (verified against NLM docs, 2026-06-09):

- The RxNorm code-system OID for the MedlinePlus `mainSearchCriteria.v.cs` parameter is `2.16.840.1.113883.6.88`. Swap `informationRecipient.languageCode.c=es` for Spanish. `mainSearchCriteria.v.dn` (display name) is optional but improves the match.
- We use the MedlinePlus Connect __Web Application__ endpoint (`/application`), which returns a rendered human page — not the __Web Service__ endpoint (`/service`), which returns XML/JSON for machine use.
- These are __pure hrefs built on the client__ — nothing is fetched until the patient clicks, and the request then carries only a drug name / RxCUI, never patient identity. This reaffirms the "user-clicked, not auto-fetched" decision.
- Render as normal links opening in a new tab with `rel="noopener noreferrer"`.

Construction strategy (detect-don't-require):

- __Have an RxCUI__ → MedlinePlus Connect by code (best match), passing the display name as `v.dn` too.
- __No RxCUI__ (non-US-Core / local code system) → fall back to __name-based__ links: DailyMed `search.cfm?query=<name>` and a MedlinePlus name search; both accept a free-text drug name. Never a dead end.

Parked for v1 (decided):

- __MedlinePlus "no information" page__ — when an RxCUI isn't covered, Connect shows its own "no information available" page. v1 accepts that and always *also* renders the DailyMed name-search link, so there is never a dead end. A nicer "drop to name search" fallback is a v2 polish, not a v1 blocker.
- __DailyMed deep link__ to the *exact* label (`drugInfo.cfm?setid=<setid>`) needs an API hop (`services/v2/spls.json?rxcui=<RxCUI>` → `setid`). v1 uses the name-search link; the deep link is a v2 enhancement (a server-side or on-click lookup, not a static href).

## Open questions (to decide)

*All resolved as of 2026-06-09 — see Confirmed decisions and the Derived-layer section.*

## Related codebase state (2026-06-09)

- __MedicationRequest__ — display model + card + `resourceSortConfig` + US Core Must-Support audited
  (#144). Complete.
- __Medication__ — display model + card wired; no `resourceSortConfig`; not MS-audited. (Usually a
  referenced/contained resource, so "no sort" matters less.)
- __MedicationDispense__ — display model exists, but its fhir-card `typeLookup` case is __commented
  out__ (renders via the generic fallback); no `resourceSortConfig`. Effectively unhandled in the UI.
- __MedicationStatement__ — __no frontend display model__ (factory case commented out); backend
  stores/indexes it. Not a US Core profile.
- __RxNorm glossary__ exists (code -> display) — the basis for grouping + the external links.
- Backend already has computed-summary precedent: `/summary` and the IPS summary endpoint.

## Suggested phasing

1. __Input-end:__ parse + sort all medication types — wire the MedicationDispense card, add a
   MedicationStatement model, add `resourceSortConfig` entries, filter placeholder notes.
2. __Derived layer:__ the `GET /api/secure/medications/reconciled` endpoint — de-dup by RxNorm,
   suggested active/past + evidence, original codings preserved; Go service + fixture tests.
3. __Output-end:__ the __Current Medications__ view consuming the endpoint (active/past,
   expand-for-details), plus the dashboard widget.
4. __Drug-info links__ (DailyMed + MedlinePlus by RxCUI, with name-search fallback).
5. Track as an __epic / design issue__ before code (the "current" heuristic deserves its own
   discussion).
