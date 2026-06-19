# TODO

<!-- RESUME:START -->
## ▶ Resume here — 2026-06-19

- Last worked on: brought the **Cerner/Oracle sandbox live end-to-end** ([#338](https://github.com/jwilleke/yourphr/issues/338)) and hardened the **import engine** ([#341](https://github.com/jwilleke/yourphr/issues/341)). Connect = patient-persona authorize **override** + base `fhir-ehr.cerner.com` + **enumerated v2 `.rs`** scopes + code Console app set to **Offline**. Engine now has a 90s request timeout, **two-pass deferred retry**, **incremental upsert**, per-resource `smart sync:` logging, and idempotent `related_resources` insert.
- Branch / state: `main`, clean, all pushed (HEAD `ff81208c`).
- Running / in-flight: CI (CI / Docker / CodeQL) building `ff81208c` — non-blocking. The `main-338` image (two-pass retry + log-noise fix) deploys via Flux. No dev servers / background agents.
- Parked / half-done: none this session. (Two PRE-EXISTING stashes — `wip-118-phase2b`, `feat/smart-connect-frontend` — not from this session.)
- Next steps:
  - Once `main-338` is live, **reconnect Cerner** to confirm the two-pass retry + quiet logs (data already imports on `8b513527`).
  - [#341](https://github.com/jwilleke/yourphr/issues/341) + [#338](https://github.com/jwilleke/yourphr/issues/338) are `in-review` — operator sign-off after that reconnect.
  - Optional follow-ups: add `patient/Coverage.rs` etc. (more Cerner resources); [#340](https://github.com/jwilleke/yourphr/issues/340) logos; [#337](https://github.com/jwilleke/yourphr/issues/337) UI completion/record-count indicator; batch the import upserts (GORM perf for large patients).
- Blockers / significant notes: Cerner sandbox is inherently slow/flaky (~57s 504s) — sandbox-specific, not fixable. Cerner code Console app MUST be **Offline** access + **SMART v2 `.rs` enumerated** scopes (it drops `.read` and the `*.rs` wildcard).
<!-- RESUME:END -->

> Generated from live GitHub state — ranked by priority label. The `▶ Resume here` pointer is written by `/wrap`.

## 🔴 P0 — Security & Critical

- None. 0 open Dependabot or code-scanning alerts.

## 🟠 P1

- [#341](https://github.com/jwilleke/yourphr/issues/341) [BUG] Import engine — `$everything` failure falls back to per-resource (**`in-review`**; timeout + two-pass retry + incremental upsert + logging shipped).
- **Patient-legible display ([#262](https://github.com/jwilleke/yourphr/issues/262)):** [#262](https://github.com/jwilleke/yourphr/issues/262) EPIC · [#308](https://github.com/jwilleke/yourphr/issues/308) EHI Phase 3 (frontend) · [#309](https://github.com/jwilleke/yourphr/issues/309) EHI Phase 4 (backend).
- **Patients add own records:** [#313](https://github.com/jwilleke/yourphr/issues/313) · [#315](https://github.com/jwilleke/yourphr/issues/315) `/medical-history` layout.
- **Blue Button:** [#250](https://github.com/jwilleke/yourphr/issues/250) source · [#279](https://github.com/jwilleke/yourphr/issues/279) frontend.

## 🟡 P2

- **Provider sandboxes / catalog:** [#338](https://github.com/jwilleke/yourphr/issues/338) Cerner (**`in-review`** — connects + imports live) · [#339](https://github.com/jwilleke/yourphr/issues/339) athenahealth (`blocked`) · [#340](https://github.com/jwilleke/yourphr/issues/340) provider logos · [#251](https://github.com/jwilleke/yourphr/issues/251) Apple Health · [#53](https://github.com/jwilleke/yourphr/issues/53) Veradigm (`blocked`) · [#20](https://github.com/jwilleke/yourphr/issues/20) EPIC SMART live sync.
- [#337](https://github.com/jwilleke/yourphr/issues/337) [BUG] SSE progress never clears (UI completion/count indicator).
- [#333](https://github.com/jwilleke/yourphr/issues/333) EPIC Explore export → [#334](https://github.com/jwilleke/yourphr/issues/334) Save Report · [#335](https://github.com/jwilleke/yourphr/issues/335) PDF · [#336](https://github.com/jwilleke/yourphr/issues/336) Email.
- [#300](https://github.com/jwilleke/yourphr/issues/300) Medicare claims UI · [#305](https://github.com/jwilleke/yourphr/issues/305)/[#307](https://github.com/jwilleke/yourphr/issues/307) manual records (under [#253](https://github.com/jwilleke/yourphr/issues/253)).
- [#277](https://github.com/jwilleke/yourphr/issues/277) Medical History hub · [#287](https://github.com/jwilleke/yourphr/issues/287) upload UI · [#289](https://github.com/jwilleke/yourphr/issues/289) allergy tiles · [#290](https://github.com/jwilleke/yourphr/issues/290) "No Known Allergies" · [#280](https://github.com/jwilleke/yourphr/issues/280) fhir-card refs.
- [#288](https://github.com/jwilleke/yourphr/issues/288) [ARCH] fasten-sources-stub future · [#252](https://github.com/jwilleke/yourphr/issues/252) re-import dedup · [#241](https://github.com/jwilleke/yourphr/issues/241) release-please PAT · [#244](https://github.com/jwilleke/yourphr/issues/244) EPIC dashboards · [#256](https://github.com/jwilleke/yourphr/issues/256) sharing · [#14](https://github.com/jwilleke/yourphr/issues/14) User Profile.

## ⏸ Deferred

- [#278](https://github.com/jwilleke/yourphr/issues/278) [EPIC] Rename Fasten* → YourPHR · [#263](https://github.com/jwilleke/yourphr/issues/263) Message Provider · [#239](https://github.com/jwilleke/yourphr/issues/239) gofhir-models 0.1.x · [#131](https://github.com/jwilleke/yourphr/issues/131) E2E lforms interact.

## ❓ Needs triage

- [#314](https://github.com/jwilleke/yourphr/issues/314) Wearable Device Integration — no priority label yet.
