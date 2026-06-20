# TODO

> Generated from live GitHub state — ranked by priority label. The `▶ Resume here` pointer is written by `/wrap`.

## 🔴 P0 — Security & Critical

- None open. (Security [#345](https://github.com/jwilleke/yourphr/issues/345) is graded P2 — dev-only, blocked on upstream — listed under P2.)

## 🟠 P1

- [#351](https://github.com/jwilleke/yourphr/issues/351) [FEATURE] /medical-history — group & filter by Date (default), Condition, Provider, Place, Type.
- [#315](https://github.com/jwilleke/yourphr/issues/315) [FEATURE] /medical-history — readability polish (labels, microcopy, a11y, pagination context).
- [#313](https://github.com/jwilleke/yourphr/issues/313) [FEATURE] patients able to add records to their own PHR.
- [#309](https://github.com/jwilleke/yourphr/issues/309) [FEATURE] EHI display Phase 4 — generalize Layer-1 classifiers/resolvers to remaining resource types.
- [#308](https://github.com/jwilleke/yourphr/issues/308) [FEATURE] EHI display Phase 3 — legible detail cards across all resource types.
- [#279](https://github.com/jwilleke/yourphr/issues/279) [FEATURE] Blue Button 2.0 — frontend source entry + sandbox end-to-end verification.
- [#262](https://github.com/jwilleke/yourphr/issues/262) [EPIC] Patient-legible display — health info a normal person can actually use.
- [#250](https://github.com/jwilleke/yourphr/issues/250) [FEATURE] Add CMS Blue Button 2.0 as a SMART-on-FHIR sync source (low-friction first provider).

## 🟡 P2

- [#345](https://github.com/jwilleke/yourphr/issues/345) [security] http-proxy-middleware (webpack-dev-server tree) — blocked on upstream hpm 3.x (GHSA-64mm-vxmg-q3vj).
- [#353](https://github.com/jwilleke/yourphr/issues/353) [FEATURE] Patient private notes on records (persist + indicator).
- [#352](https://github.com/jwilleke/yourphr/issues/352) [FEATURE] Patient-friendly Body Diagram / Body Map View.
- [#348](https://github.com/jwilleke/yourphr/issues/348) [FEATURE] Binary import: skip already-stored documents on re-sync (cross-sync existence check).
- [#343](https://github.com/jwilleke/yourphr/issues/343) [FEATURE] Add remaining higher-signal Cerner scopes (first cut done).
- [#340](https://github.com/jwilleke/yourphr/issues/340) [FEATURE] Provider logos on Connected Sources.
- [#339](https://github.com/jwilleke/yourphr/issues/339) [FEATURE] athenahealth sandbox — complete Developer-Portal onboarding (blocked).
- [#337](https://github.com/jwilleke/yourphr/issues/337) [BUG] SSE sync events dropped ("Room not found") — import progress never clears.
- [#333](https://github.com/jwilleke/yourphr/issues/333) [EPIC] Explore — record export options (Save Report, PDF, Email).
- [#334](https://github.com/jwilleke/yourphr/issues/334) [FEATURE] Explore — Save Report.
- [#335](https://github.com/jwilleke/yourphr/issues/335) [FEATURE] Explore — Export to PDF.
- [#336](https://github.com/jwilleke/yourphr/issues/336) [FEATURE] Explore — Send to Email.
- [#300](https://github.com/jwilleke/yourphr/issues/300) [FEATURE] Angular surface for Medicare claims & coverage (insurance view).
- [#307](https://github.com/jwilleke/yourphr/issues/307) [FEATURE] Manual records — frontend: entry/edit/delete forms.
- [#305](https://github.com/jwilleke/yourphr/issues/305) [FEATURE] Manual records — backend: store/edit/delete user-created records (FHIR-consistent).
- [#290](https://github.com/jwilleke/yourphr/issues/290) [FEATURE] "No Known Allergies" assertions inflate the allergy count and read confusingly.
- [#289](https://github.com/jwilleke/yourphr/issues/289) [FEATURE] Allergies & Immunizations tiles dead-end at /medical-history — route to /patient-profile.
- [#288](https://github.com/jwilleke/yourphr/issues/288) [ARCH] Decide the future of fasten-sources-stub.
- [#287](https://github.com/jwilleke/yourphr/issues/287) [FEATURE] Upload/import UI polish — make all supported file types selectable + clearer 'add my data' affordances.
- [#280](https://github.com/jwilleke/yourphr/issues/280) [FEATURE] Raw fhir-cards: resolve a referenced resource's display name (e.g. Medication/{id}).
- [#256](https://github.com/jwilleke/yourphr/issues/256) [FEATURE] Sharing PHR data.
- [#253](https://github.com/jwilleke/yourphr/issues/253) [EPIC] Support manual data entry and user-created records.
- [#252](https://github.com/jwilleke/yourphr/issues/252) [FEATURE] Harden re-import dedup: guard idempotent upserts against stale overwrites.
- [#251](https://github.com/jwilleke/yourphr/issues/251) [FEATURE] Explore Apple Health's supported-institution list as a provider-catalog / FHIR-endpoint source.
- [#244](https://github.com/jwilleke/yourphr/issues/244) [EPIC] Per-profile dashboard widgets (US Core display end-state).
- [#241](https://github.com/jwilleke/yourphr/issues/241) [chore] release-please: authenticate with a PAT / GitHub App token.
- [#53](https://github.com/jwilleke/yourphr/issues/53) [SMART] Veradigm/FollowMyHealth registration + end-to-end integration (blocked).
- [#20](https://github.com/jwilleke/yourphr/issues/20) [EPIC] SMART on FHIR — live provider sync.
- [#14](https://github.com/jwilleke/yourphr/issues/14) [FEATURE] User Profile Update.

## ⏸ Deferred

- [#278](https://github.com/jwilleke/yourphr/issues/278) [EPIC] Rename Fasten* → YourPHR.
- [#263](https://github.com/jwilleke/yourphr/issues/263) [FEATURE] Message Provider.
- [#239](https://github.com/jwilleke/yourphr/issues/239) [chore] Revisit gofhir-models 0.1.x once encoding/json/v2 is default in Go.
- [#131](https://github.com/jwilleke/yourphr/issues/131) [FEATURE] E2E testing — lforms questionnaire render + interact.

## ❓ Needs triage

- [#314](https://github.com/jwilleke/yourphr/issues/314) [FEATURE] Wearable Device Integration for Vitals, Activity & PGHD — no priority label yet.
