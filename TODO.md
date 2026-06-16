# TODO

> Generated from live GitHub state — ranked by priority label. Do not hand-edit. The `▶ Resume here` pointer is written by `/wrap` at session end.

## 🔴 P0 — Security & Critical

- None. No open Dependabot or code-scanning alerts.

## 🟠 P1

**Patient-legible display (active — [#266](https://github.com/jwilleke/yourphr/issues/266) / [#262](https://github.com/jwilleke/yourphr/issues/262)):**

- [#266](https://github.com/jwilleke/yourphr/issues/266) [EPIC] FollowMyHealth/Veradigm EHI classification & patient-legible display — Layer-1 classifiers + provenance shipped; condition / medication / Medical-Concerns / Patient-Profile surfaces + "who said this" on every card landed.
- [#262](https://github.com/jwilleke/yourphr/issues/262) [EPIC] Patient-legible display — the quality bar. Biggest open litmus gap: lab results "normal/high/low" (unissued).

**US Core 9.0.0 Must-Support display gaps ([#249](https://github.com/jwilleke/yourphr/issues/249) tracker → [#136](https://github.com/jwilleke/yourphr/issues/136) epic) — frontend, `help wanted`, bounded:**

- [#281](https://github.com/jwilleke/yourphr/issues/281) "Last updated" row on Condition + Observation cards (`meta.lastUpdated`, shared helper).
- [#282](https://github.com/jwilleke/yourphr/issues/282) Condition `extension:assertedDate` as its own field.
- [#283](https://github.com/jwilleke/yourphr/issues/283) MedicationRequest `dispenseRequest` — quantity / refills.
- [#284](https://github.com/jwilleke/yourphr/issues/284) Observation `specimen` — specimen reference.
- [#285](https://github.com/jwilleke/yourphr/issues/285) DocumentReference `context.encounter` — encounter in model context.

**Live provider sync (Blue Button thread):**

- [#250](https://github.com/jwilleke/yourphr/issues/250) Add CMS Blue Button 2.0 as a SMART-on-FHIR sync source — `help wanted` (backend done: CapabilityStatement-driven fetch landed; live import verified end-to-end).
- [#279](https://github.com/jwilleke/yourphr/issues/279) Blue Button 2.0 — frontend source entry + sandbox end-to-end verification.
- [#291](https://github.com/jwilleke/yourphr/issues/291) Admin-configured provider catalog — connect providers without patients seeing client_id/secret.
- [#286](https://github.com/jwilleke/yourphr/issues/286) SMART client: confidential-client (client_secret) support.

**Import:**

- [#254](https://github.com/jwilleke/yourphr/issues/254) Support C-CDA / CCD document import — `help wanted` (code-complete, pending Metriport sidecar deployment).

## 🟡 P2

- [#300](https://github.com/jwilleke/yourphr/issues/300) Angular surface for Medicare claims & coverage (insurance view) — parked; consumes the #294/#295/#296 endpoints. Under #262.
- [#277](https://github.com/jwilleke/yourphr/issues/277) Medical History hub page (`/medical-history`) — umbrella for Visits & Notes, Procedures, etc.
- [#280](https://github.com/jwilleke/yourphr/issues/280) Raw fhir-cards: resolve a referenced resource's display name (e.g. `Medication/{id}`) — `help wanted`.
- [#287](https://github.com/jwilleke/yourphr/issues/287) Upload/import UI polish — make all supported file types selectable + clearer 'add my data' affordances.
- [#289](https://github.com/jwilleke/yourphr/issues/289) Allergies & Immunizations tiles dead-end at `/medical-history` — route to `/patient-profile`.
- [#290](https://github.com/jwilleke/yourphr/issues/290) "No Known Allergies" assertions inflate the allergy count and read confusingly.
- [#288](https://github.com/jwilleke/yourphr/issues/288) [ARCH] Decide the future of `fasten-sources-stub` — fold into main module vs keep as owned source layer.
- [#244](https://github.com/jwilleke/yourphr/issues/244) [EPIC] Per-profile dashboard widgets (US Core display end-state).
- [#256](https://github.com/jwilleke/yourphr/issues/256) Sharing PHR data — drives the conformance-remodeling goal.
- [#253](https://github.com/jwilleke/yourphr/issues/253) [EPIC] Manual data entry / user-created records.
- [#252](https://github.com/jwilleke/yourphr/issues/252) Harden re-import dedup against stale overwrites.
- [#251](https://github.com/jwilleke/yourphr/issues/251) Explore Apple Health's supported-institution list as a provider-catalog source.
- [#241](https://github.com/jwilleke/yourphr/issues/241) release-please: authenticate with a PAT / GitHub App token.
- [#209](https://github.com/jwilleke/yourphr/issues/209) [EPIC] Migrate to Bootstrap 5.
- [#53](https://github.com/jwilleke/yourphr/issues/53) Veradigm/FollowMyHealth registration + integration — `blocked` (vendor approval).
- [#20](https://github.com/jwilleke/yourphr/issues/20) [EPIC] SMART on FHIR — live provider sync.
- [#14](https://github.com/jwilleke/yourphr/issues/14) User Profile Update (PII).

## ⏸ Deferred

- [#278](https://github.com/jwilleke/yourphr/issues/278) [EPIC] Rename Fasten* → YourPHR — only on committing to a hard fork (one-way door).
- [#263](https://github.com/jwilleke/yourphr/issues/263) Message Provider.
- [#239](https://github.com/jwilleke/yourphr/issues/239) Revisit gofhir-models 0.1.x once encoding/json/v2 is default in Go.
- [#131](https://github.com/jwilleke/yourphr/issues/131) E2E testing — lforms questionnaire render + interact.

## ❓ Needs triage

Unlabeled — awaiting a priority band:

- [#294](https://github.com/jwilleke/yourphr/issues/294) ExplanationOfBenefit (Medicare claims) classifier — **backend done** (classifier + `/claims/classified` + tests); open pending close.
- [#295](https://github.com/jwilleke/yourphr/issues/295) Coverage (Medicare/insurance) classifier — **backend done** (classifier + `/coverages/classified` + tests); open pending close.
- [#293](https://github.com/jwilleke/yourphr/issues/293) [BUG] SMART connect fails for Blue Button — patient id required in token, no /Patient fallback — **fixed** (Coverage/EOB fallback shipped); open pending close.
- [#292](https://github.com/jwilleke/yourphr/issues/292) Serve operator-tunable frontend settings from backend config (no rebuild) — `login_wait_seconds` shipped.
