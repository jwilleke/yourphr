# TODO

> Generated from live GitHub state — ranked by priority label. Do not hand-edit. The `▶ Resume here` pointer is written by `/wrap` at session end.

## 🔴 P0 — Security & Critical

- None. 0 open Dependabot or code-scanning alerts.

## 🟠 P1

**Provider catalog ([#291](https://github.com/jwilleke/yourphr/issues/291) umbrella) — vertical complete, awaiting sign-off:**

- [#291](https://github.com/jwilleke/yourphr/issues/291) umbrella **`in-review`**: backend [#304](https://github.com/jwilleke/yourphr/issues/304) ✅ closed · patient picker [#306](https://github.com/jwilleke/yourphr/issues/306) **`in-review`** · admin CRUD [#310](https://github.com/jwilleke/yourphr/issues/310) **`in-review`**. Production/sandbox split shipped: `/sandbox` is now one-click connect with server-side (env/SOPS) creds — none typed or exposed. All admin functions consolidated under `/admin`.

**Patients add their own records:**

- [#313](https://github.com/jwilleke/yourphr/issues/313) patients able to add records to their own PHR (`smart-on-fhir`).
- [#315](https://github.com/jwilleke/yourphr/issues/315) `/medical-history` Layout (`good first issue`).

**Patient-legible display ([#262](https://github.com/jwilleke/yourphr/issues/262) / [#266](https://github.com/jwilleke/yourphr/issues/266)):**

- [#262](https://github.com/jwilleke/yourphr/issues/262) [EPIC] Patient-legible display — quality bar; biggest gap: lab results "normal/high/low".
- [#308](https://github.com/jwilleke/yourphr/issues/308) EHI Phase 3 — legible detail cards across all resource types (frontend).
- [#309](https://github.com/jwilleke/yourphr/issues/309) EHI Phase 4 — generalize Layer-1 classifiers/resolvers (backend).

**Live provider sync (Blue Button):**

- [#250](https://github.com/jwilleke/yourphr/issues/250) Add CMS Blue Button 2.0 as a SMART source — `help wanted` (backend done; live import verified).
- [#279](https://github.com/jwilleke/yourphr/issues/279) Blue Button 2.0 — frontend source entry + sandbox verification (pre-fill button remains).

## 🟡 P2

- [#300](https://github.com/jwilleke/yourphr/issues/300) Angular surface for Medicare claims & coverage (consumes the shipped #294/#295/#296 endpoints).
- [#305](https://github.com/jwilleke/yourphr/issues/305) Manual records backend · [#307](https://github.com/jwilleke/yourphr/issues/307) frontend forms (under [#253](https://github.com/jwilleke/yourphr/issues/253)).
- [#277](https://github.com/jwilleke/yourphr/issues/277) Medical History hub · [#287](https://github.com/jwilleke/yourphr/issues/287) upload UI polish · [#289](https://github.com/jwilleke/yourphr/issues/289) allergy tiles dead-end · [#290](https://github.com/jwilleke/yourphr/issues/290) "No Known Allergies" count.
- [#280](https://github.com/jwilleke/yourphr/issues/280) fhir-card referenced display name · [#252](https://github.com/jwilleke/yourphr/issues/252) harden re-import dedup · [#288](https://github.com/jwilleke/yourphr/issues/288) [ARCH] `fasten-sources-stub` future · [#241](https://github.com/jwilleke/yourphr/issues/241) release-please PAT.
- [#244](https://github.com/jwilleke/yourphr/issues/244) [EPIC] per-profile dashboards · [#256](https://github.com/jwilleke/yourphr/issues/256) sharing PHR · [#251](https://github.com/jwilleke/yourphr/issues/251) Apple Health list · [#20](https://github.com/jwilleke/yourphr/issues/20) [EPIC] SMART live sync · [#53](https://github.com/jwilleke/yourphr/issues/53) Veradigm (`blocked`) · [#14](https://github.com/jwilleke/yourphr/issues/14) User Profile Update.

## ⏸ Deferred

- [#278](https://github.com/jwilleke/yourphr/issues/278) [EPIC] Rename Fasten* → YourPHR · [#263](https://github.com/jwilleke/yourphr/issues/263) Message Provider · [#239](https://github.com/jwilleke/yourphr/issues/239) gofhir-models 0.1.x · [#131](https://github.com/jwilleke/yourphr/issues/131) E2E lforms interact.

## ❓ Needs triage

- [#314](https://github.com/jwilleke/yourphr/issues/314) Wearable Device Integration for Vitals, Activity & PGHD — no priority label yet.
