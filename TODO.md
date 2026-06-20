# TODO

<!-- RESUME:START -->
## ▶ Resume here — 2026-06-20

- Last worked on: closed out the Cerner saga — [#338](https://github.com/jwilleke/yourphr/issues/338) (connect) + [#341](https://github.com/jwilleke/yourphr/issues/341) (import engine) **CLOSED** (verified importing real data: AllergyIntolerance 120, CarePlan 14, Device 1, DiagnosticReport 15, DocumentReference 2149). Rewrote `docs/vendors/oracle-cerner.md` into a professional integration guide (registration, the 4 challenges, conformance/scope, data-shape). Scanned the export → filed [#342](https://github.com/jwilleke/yourphr/issues/342) (DocumentReference→Binary fetch) + [#343](https://github.com/jwilleke/yourphr/issues/343) (Observation scope). Cleared both pre-existing stashes (verified obsolete).
- Branch / state: `main`, clean, all pushed. **No stashes.**
- Running / in-flight: none.
- Parked / half-done: none.
- Next steps:
  - [#342](https://github.com/jwilleke/yourphr/issues/342) DocumentReference → Binary fetch (P1 — 2149 docs currently unopenable) · [#343](https://github.com/jwilleke/yourphr/issues/343) add `patient/Observation.rs` (+ Coverage etc.) for lab values.
  - [#340](https://github.com/jwilleke/yourphr/issues/340) provider logos · [#337](https://github.com/jwilleke/yourphr/issues/337) UI completion/record-count indicator · batch import upserts (GORM perf for large patients).
  - Mission-priority P1s still open: [#262](https://github.com/jwilleke/yourphr/issues/262) patient-legible display ([#308](https://github.com/jwilleke/yourphr/issues/308)/[#309](https://github.com/jwilleke/yourphr/issues/309)) · [#313](https://github.com/jwilleke/yourphr/issues/313)/[#315](https://github.com/jwilleke/yourphr/issues/315) patients add records.
- Blockers / significant notes: Cerner sandbox inherently slow/flaky (~57s 504s) — sandbox-specific, handled by #341's resilience. App MUST be Offline + enumerated v2 `.rs` scopes.
<!-- RESUME:END -->

> Generated from live GitHub state — ranked by priority label. The `▶ Resume here` pointer is written by `/wrap`.

## 🔴 P0 — Security & Critical

- None. 0 open Dependabot or code-scanning alerts.

## 🟠 P1

- [#342](https://github.com/jwilleke/yourphr/issues/342) [BUG] Import engine — follow DocumentReference → Binary (2149 Cerner docs currently unopenable).
- **Patient-legible display ([#262](https://github.com/jwilleke/yourphr/issues/262)):** [#262](https://github.com/jwilleke/yourphr/issues/262) EPIC · [#308](https://github.com/jwilleke/yourphr/issues/308) EHI Phase 3 (frontend) · [#309](https://github.com/jwilleke/yourphr/issues/309) EHI Phase 4 (backend).
- **Patients add own records:** [#313](https://github.com/jwilleke/yourphr/issues/313) · [#315](https://github.com/jwilleke/yourphr/issues/315) `/medical-history` layout.
- **Blue Button:** [#250](https://github.com/jwilleke/yourphr/issues/250) source · [#279](https://github.com/jwilleke/yourphr/issues/279) frontend.

## 🟡 P2

- **Provider sandboxes / catalog:** [#343](https://github.com/jwilleke/yourphr/issues/343) Cerner Observation/Coverage scopes · [#339](https://github.com/jwilleke/yourphr/issues/339) athenahealth (`blocked`) · [#340](https://github.com/jwilleke/yourphr/issues/340) provider logos · [#251](https://github.com/jwilleke/yourphr/issues/251) Apple Health · [#53](https://github.com/jwilleke/yourphr/issues/53) Veradigm (`blocked`) · [#20](https://github.com/jwilleke/yourphr/issues/20) EPIC SMART live sync. (Cerner connect/import [#338](https://github.com/jwilleke/yourphr/issues/338) + engine [#341](https://github.com/jwilleke/yourphr/issues/341) ✅ closed.)
- [#337](https://github.com/jwilleke/yourphr/issues/337) [BUG] SSE progress never clears (UI completion/count indicator).
- [#333](https://github.com/jwilleke/yourphr/issues/333) EPIC Explore export → [#334](https://github.com/jwilleke/yourphr/issues/334) Save Report · [#335](https://github.com/jwilleke/yourphr/issues/335) PDF · [#336](https://github.com/jwilleke/yourphr/issues/336) Email.
- [#300](https://github.com/jwilleke/yourphr/issues/300) Medicare claims UI · [#305](https://github.com/jwilleke/yourphr/issues/305)/[#307](https://github.com/jwilleke/yourphr/issues/307) manual records (under [#253](https://github.com/jwilleke/yourphr/issues/253)).
- [#277](https://github.com/jwilleke/yourphr/issues/277) Medical History hub · [#287](https://github.com/jwilleke/yourphr/issues/287) upload UI · [#289](https://github.com/jwilleke/yourphr/issues/289) allergy tiles · [#290](https://github.com/jwilleke/yourphr/issues/290) "No Known Allergies" · [#280](https://github.com/jwilleke/yourphr/issues/280) fhir-card refs.
- [#288](https://github.com/jwilleke/yourphr/issues/288) [ARCH] fasten-sources-stub future · [#252](https://github.com/jwilleke/yourphr/issues/252) re-import dedup · [#241](https://github.com/jwilleke/yourphr/issues/241) release-please PAT · [#244](https://github.com/jwilleke/yourphr/issues/244) EPIC dashboards · [#256](https://github.com/jwilleke/yourphr/issues/256) sharing · [#14](https://github.com/jwilleke/yourphr/issues/14) User Profile.

## ⏸ Deferred

- [#278](https://github.com/jwilleke/yourphr/issues/278) [EPIC] Rename Fasten* → YourPHR · [#263](https://github.com/jwilleke/yourphr/issues/263) Message Provider · [#239](https://github.com/jwilleke/yourphr/issues/239) gofhir-models 0.1.x · [#131](https://github.com/jwilleke/yourphr/issues/131) E2E lforms interact.

## ❓ Needs triage

- [#314](https://github.com/jwilleke/yourphr/issues/314) Wearable Device Integration — no priority label yet.
