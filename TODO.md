# TODO

> Generated from live GitHub state — ranked by priority label. Do not hand-edit. The `▶ Resume here` pointer is written by `/wrap` at session end.

## 🔴 P0 — Security & Critical

- **`hono` 4.12.x — 5 Dependabot alerts** (DA#192 high + DA#190/191/193/194 medium), all fixed by **4.12.25**. **Dependabot PR [#311](https://github.com/jwilleke/yourphr/pull/311) already bumps to 4.12.25** — merging it clears the cluster. `development`-scope, Lambda/Windows-specific (low real-risk for this self-hosted app), but free to take. Code-scanning: 0 open.

## 🟠 P1

**Patient-legible display ([#262](https://github.com/jwilleke/yourphr/issues/262) / [#266](https://github.com/jwilleke/yourphr/issues/266) epics):**

- [#262](https://github.com/jwilleke/yourphr/issues/262) [EPIC] Patient-legible display — the quality bar. Biggest open litmus gap: lab results "normal/high/low".
- [#308](https://github.com/jwilleke/yourphr/issues/308) EHI Phase 3 — legible detail cards across all resource types (frontend).
- [#309](https://github.com/jwilleke/yourphr/issues/309) EHI Phase 4 — generalize Layer-1 classifiers/resolvers to remaining types (backend).

**Provider catalog ([#291](https://github.com/jwilleke/yourphr/issues/291) umbrella — backend [#304](https://github.com/jwilleke/yourphr/issues/304) done):**

- [#306](https://github.com/jwilleke/yourphr/issues/306) frontend: patient provider-picker connect (no credentials shown) — **unblocked**.
- [#310](https://github.com/jwilleke/yourphr/issues/310) frontend: admin manage entries (create/edit/delete client_id/secret).

**Live provider sync (Blue Button thread):**

- [#250](https://github.com/jwilleke/yourphr/issues/250) Add CMS Blue Button 2.0 as a SMART source — `help wanted` (backend done; live import verified).
- [#279](https://github.com/jwilleke/yourphr/issues/279) Blue Button 2.0 — frontend source entry + sandbox verification (pre-fill button is the remaining gap).

## 🟡 P2

- [#300](https://github.com/jwilleke/yourphr/issues/300) Angular surface for Medicare claims & coverage (consumes the shipped #294/#295/#296 endpoints).
- [#305](https://github.com/jwilleke/yourphr/issues/305) Manual records — backend store/edit/delete · [#307](https://github.com/jwilleke/yourphr/issues/307) frontend forms (under [#253](https://github.com/jwilleke/yourphr/issues/253)).
- [#277](https://github.com/jwilleke/yourphr/issues/277) Medical History hub page · [#287](https://github.com/jwilleke/yourphr/issues/287) upload/import UI polish.
- [#289](https://github.com/jwilleke/yourphr/issues/289) Allergies/Immunizations tiles dead-end · [#290](https://github.com/jwilleke/yourphr/issues/290) "No Known Allergies" inflates allergy count.
- [#280](https://github.com/jwilleke/yourphr/issues/280) Raw fhir-cards resolve referenced display name · [#252](https://github.com/jwilleke/yourphr/issues/252) harden re-import dedup.
- [#288](https://github.com/jwilleke/yourphr/issues/288) [ARCH] future of `fasten-sources-stub` · [#241](https://github.com/jwilleke/yourphr/issues/241) release-please PAT (so release PRs trigger CI).
- [#244](https://github.com/jwilleke/yourphr/issues/244) [EPIC] per-profile dashboard widgets · [#256](https://github.com/jwilleke/yourphr/issues/256) sharing PHR data · [#251](https://github.com/jwilleke/yourphr/issues/251) Apple Health institution list.
- [#20](https://github.com/jwilleke/yourphr/issues/20) [EPIC] SMART live provider sync · [#53](https://github.com/jwilleke/yourphr/issues/53) Veradigm/FollowMyHealth (`blocked` — vendor approval) · [#14](https://github.com/jwilleke/yourphr/issues/14) User Profile Update.

## ⏸ Deferred

- [#278](https://github.com/jwilleke/yourphr/issues/278) [EPIC] Rename Fasten* → YourPHR (one-way door) · [#263](https://github.com/jwilleke/yourphr/issues/263) Message Provider · [#239](https://github.com/jwilleke/yourphr/issues/239) gofhir-models 0.1.x · [#131](https://github.com/jwilleke/yourphr/issues/131) E2E lforms questionnaire interact.

## ❓ Needs triage

- None — every open issue carries a priority label.
