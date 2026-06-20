# TODO

> Generated from live GitHub state — ranked by priority label. The `▶ Resume here` pointer is written by `/wrap`.

## 🔴 P0 — Security & Critical

- [#344](https://github.com/jwilleke/yourphr/issues/344) [security] frontend build-tooling Dependabot alerts (http-proxy-middleware, piscina, webpack-dev-server) — all `frontend/yarn.lock` dev/build tooling, patched upstream, routine yarn bump.

## 🟠 P1

- [#342](https://github.com/jwilleke/yourphr/issues/342) [BUG] Import engine — follow DocumentReference → Binary (2149 Cerner docs currently unopenable).
- [#262](https://github.com/jwilleke/yourphr/issues/262) [EPIC] Patient-legible display — health info a normal person can actually use.
- [#308](https://github.com/jwilleke/yourphr/issues/308) EHI display Phase 3 — legible detail cards across all resource types.
- [#309](https://github.com/jwilleke/yourphr/issues/309) EHI display Phase 4 — generalize Layer-1 classifiers/resolvers to remaining resource types.
- [#313](https://github.com/jwilleke/yourphr/issues/313) Patients able to add records to their own PHR.
- [#315](https://github.com/jwilleke/yourphr/issues/315) `/medical-history` layout.
- [#250](https://github.com/jwilleke/yourphr/issues/250) Add CMS Blue Button 2.0 as a SMART-on-FHIR sync source.
- [#279](https://github.com/jwilleke/yourphr/issues/279) Blue Button 2.0 — frontend source entry + sandbox end-to-end verification.

## 🟡 P2

- [#343](https://github.com/jwilleke/yourphr/issues/343) Add patient/Observation.rs (+ lab/vital scopes) to the Cerner sandbox seed.
- [#339](https://github.com/jwilleke/yourphr/issues/339) athenahealth sandbox — complete Developer-Portal onboarding (`blocked`).
- [#340](https://github.com/jwilleke/yourphr/issues/340) Provider logos on Connected Sources.
- [#251](https://github.com/jwilleke/yourphr/issues/251) Explore Apple Health's supported-institution list as a provider catalog.
- [#53](https://github.com/jwilleke/yourphr/issues/53) Veradigm/FollowMyHealth registration + end-to-end integration (`blocked`).
- [#20](https://github.com/jwilleke/yourphr/issues/20) [EPIC] SMART on FHIR — live provider sync.
- [#337](https://github.com/jwilleke/yourphr/issues/337) [BUG] SSE sync events dropped ("Room not found") — import progress never clears.
- [#333](https://github.com/jwilleke/yourphr/issues/333) [EPIC] Explore — record export options (Save Report, PDF, Email).
- [#334](https://github.com/jwilleke/yourphr/issues/334) Explore — Save Report.
- [#335](https://github.com/jwilleke/yourphr/issues/335) Explore — Export to PDF.
- [#336](https://github.com/jwilleke/yourphr/issues/336) Explore — Send to Email.
- [#300](https://github.com/jwilleke/yourphr/issues/300) Angular surface for Medicare claims & coverage (insurance view).
- [#253](https://github.com/jwilleke/yourphr/issues/253) [EPIC] Support manual data entry and user-created records.
- [#305](https://github.com/jwilleke/yourphr/issues/305) Manual records — backend: store/edit/delete user-created records.
- [#307](https://github.com/jwilleke/yourphr/issues/307) Manual records — frontend: entry/edit/delete forms.
- [#277](https://github.com/jwilleke/yourphr/issues/277) Medical History hub page (/medical-history).
- [#287](https://github.com/jwilleke/yourphr/issues/287) Upload/import UI polish.
- [#289](https://github.com/jwilleke/yourphr/issues/289) Allergies & Immunizations tiles dead-end at /medical-history.
- [#290](https://github.com/jwilleke/yourphr/issues/290) "No Known Allergies" assertions inflate the allergy count.
- [#280](https://github.com/jwilleke/yourphr/issues/280) Raw fhir-cards: resolve a referenced resource's display name.
- [#288](https://github.com/jwilleke/yourphr/issues/288) [ARCH] Decide the future of fasten-sources-stub.
- [#252](https://github.com/jwilleke/yourphr/issues/252) Harden re-import dedup against stale overwrites.
- [#241](https://github.com/jwilleke/yourphr/issues/241) release-please: authenticate with a PAT / GitHub App token.
- [#244](https://github.com/jwilleke/yourphr/issues/244) [EPIC] Per-profile dashboard widgets (US Core display end-state).
- [#256](https://github.com/jwilleke/yourphr/issues/256) Sharing PHR data.
- [#14](https://github.com/jwilleke/yourphr/issues/14) User Profile Update.

## ⏸ Deferred

- [#278](https://github.com/jwilleke/yourphr/issues/278) [EPIC] Rename Fasten* → YourPHR.
- [#263](https://github.com/jwilleke/yourphr/issues/263) Message Provider.
- [#239](https://github.com/jwilleke/yourphr/issues/239) Revisit gofhir-models 0.1.x once encoding/json/v2 is default in Go.
- [#131](https://github.com/jwilleke/yourphr/issues/131) E2E testing — lforms questionnaire render + interact.

## ❓ Needs triage

- [#314](https://github.com/jwilleke/yourphr/issues/314) Wearable Device Integration for Vitals, Activity & PGHD — no priority label yet.
