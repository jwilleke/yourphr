# TODO

> Generated from live GitHub state — ranked by priority label. Do not hand-edit. The `▶ Resume here` pointer is written by `/wrap` at session end.

## 🔴 P0 — Security & Critical

**Code-scanning: 0 open** ✅

- [#302](https://github.com/jwilleke/yourphr/issues/302) SSRF guard for user-supplied FHIR base URL (CodeQL CS#23) — **DONE, closed** ([18dd7895](https://github.com/jwilleke/yourphr/commit/18dd7895)); `smart/ssrf.go` gates all FHIR-base fetches. CodeQL re-scanned with the guard and still flagged the sink (doesn't model the custom sanitizer) → CS#23 dismissed won't-fix.
- CS#24 (`js/incomplete-url-substring-sanitization`, e2e test) — **dismissed** (test-file false positive).

**Dependabot: 4 open** — all the Angular cluster, awaiting re-scan:

- [#301](https://github.com/jwilleke/yourphr/issues/301) Bump `@angular/*` → 20.3.25 — **done, `in-review`** ([538058dd](https://github.com/jwilleke/yourphr/commit/538058dd)); DA#182/183/184/185 still open, **awaiting Dependabot re-scan** of the bumped `yarn.lock` to confirm fixed.
- [#303](https://github.com/jwilleke/yourphr/issues/303) Transitive bumps `vite` 7.3.5 + `@babel/core` 7.29.6 — **done, `in-review`** ([fe826131](https://github.com/jwilleke/yourphr/commit/fe826131)); DA#188/189/186 bumped (await re-scan), DA#187 `js-yaml` **dismissed** (fhirpath 3.x pin; DoS vector unreachable).

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

## 🔵 In review — awaiting sign-off (human closes)

Work complete; labeled `in-review` per the AGENTS.md working agreement (never self-close):

- [#296](https://github.com/jwilleke/yourphr/issues/296) Link EOB & Coverage to the patient — `backend/pkg/patientlink` + `/patient/insurance-claims` + tests.
- [#294](https://github.com/jwilleke/yourphr/issues/294) ExplanationOfBenefit classifier — `backend/pkg/explanationofbenefit` + `/claims/classified` + tests.
- [#295](https://github.com/jwilleke/yourphr/issues/295) Coverage classifier — `backend/pkg/coverage` + `/coverages/classified` + tests.
- [#293](https://github.com/jwilleke/yourphr/issues/293) [BUG] BB SMART connect patient-id fallback — fixed (Coverage/EOB fallback), proven live.
- [#292](https://github.com/jwilleke/yourphr/issues/292) Operator-tunable `login_wait_seconds` from backend config — shipped.

## ❓ Needs triage

- None — every open issue carries a priority label or `in-review`.
