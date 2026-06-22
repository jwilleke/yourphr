# TODO

<!-- RESUME:START -->
## ▶ Resume here — 2026-06-22

- Last worked on: **test-data / DQF thread.** Released **v1.11.1** (backup/restore hardening #368 + encryption gate #367). Then: lazy-loaded medical-history by-Type universe; wrote a **testing strategy + Data-Quality-Framework doc set** under `docs/testing-sandboxes/`; built the **first vendor golden** — real Epic HOV encounter caught a real #262 bug (`Category`="HOV") → fixed (prefer `type[].text` over raw local `class.display`) → green at both tiers.
- Branch / state: `main`, clean, **1 unpushed** (`de44719a` test-sandboxes move) — push pending operator OK.
- Running / in-flight: CI green on `b0f6fd52`/`a6faff9f`. No dev servers started this session. No workflows/background agents.
- Parked / half-done: none (tree clean).
- Next steps:
  - **Push `de44719a`** (test-sandboxes.md move + 9 link redirects).
  - Optional: cut a **patch release** for the HOV #262 fix (unreleased on `main`).
  - Extend goldens to the **Cerner docs-only** case (`nsmart`) + Condition dedup; then file the umbrella "test-data corpus + golden harness" issue.
  - Open follow-ups: [#371](https://github.com/jwilleke/yourphr/issues/371) (frontend raw "Class:" line), [#369](https://github.com/jwilleke/yourphr/issues/369) (grouping endpoint), [#370](https://github.com/jwilleke/yourphr/issues/370) (VA provider), [#262](https://github.com/jwilleke/yourphr/issues/262) legibility QA.
- Blockers / significant notes: Epic spec pages (`fhir.epic.com/Specifications?api=…`) are JS-gated — WebFetch can't read them; need the rendered page saved locally (verbatim Epic specs now in gitignored `sample-data/epic-specs/`).
<!-- RESUME:END -->

> Generated from live GitHub state — ranked by priority label. The `▶ Resume here` pointer is written by `/wrap`.

## 🔴 P0 — Security & Critical

- None. (CodeQL backup/restore alerts resolved + dismissed in [#365](https://github.com/jwilleke/yourphr/issues/365); 0 open code-scanning alerts.)

## 🟠 P1

- [#355](https://github.com/jwilleke/yourphr/issues/355) — [FEATURE] Dynamic Client Registration (DCR).
- [#313](https://github.com/jwilleke/yourphr/issues/313) — [FEATURE] patients able to add records to their own PHR.
- [#262](https://github.com/jwilleke/yourphr/issues/262) — [EPIC] Patient-legible display — health info a normal person can actually use.

## 🟡 P2

- [#345](https://github.com/jwilleke/yourphr/issues/345) — [security] http-proxy-middleware (webpack-dev-server tree) — blocked on upstream hpm 3.x (GHSA-64mm-vxmg-q3vj).
- [#364](https://github.com/jwilleke/yourphr/issues/364) — [FEATURE] Admin Database card — polish (free space, schema version, totals, vacuum).
- [#360](https://github.com/jwilleke/yourphr/issues/360) — [FEATURE] Attach `classified` on resource-graph / list rows.
- [#354](https://github.com/jwilleke/yourphr/issues/354) — [FEATURE] Integrate assets from HL7 FHIR GitHub org.
- [#353](https://github.com/jwilleke/yourphr/issues/353) — [FEATURE] Patient private notes on records (persist + indicator).
- [#352](https://github.com/jwilleke/yourphr/issues/352) — [FEATURE] Patient-friendly Body Diagram / Body Map View.
- [#348](https://github.com/jwilleke/yourphr/issues/348) — [FEATURE] Binary import: skip already-stored documents on re-sync.
- [#343](https://github.com/jwilleke/yourphr/issues/343) — [FEATURE] Add remaining higher-signal Cerner scopes.
- [#340](https://github.com/jwilleke/yourphr/issues/340) — [FEATURE] Provider logos on Connected Sources.
- [#339](https://github.com/jwilleke/yourphr/issues/339) — [FEATURE] athenahealth sandbox — Developer-Portal onboarding (blocked).
- [#337](https://github.com/jwilleke/yourphr/issues/337) — [BUG] SSE sync events dropped ("Room not found") — import progress never clears.
- [#333](https://github.com/jwilleke/yourphr/issues/333) — [EPIC] Explore — record export options (Save Report, PDF, Email).
- [#334](https://github.com/jwilleke/yourphr/issues/334) — [FEATURE] Explore — Save Report.
- [#335](https://github.com/jwilleke/yourphr/issues/335) — [FEATURE] Explore — Export to PDF.
- [#336](https://github.com/jwilleke/yourphr/issues/336) — [FEATURE] Explore — Send to Email.
- [#314](https://github.com/jwilleke/yourphr/issues/314) — [FEATURE] Wearable Device Integration for Vitals, Activity & PGHD.
- [#300](https://github.com/jwilleke/yourphr/issues/300) — [FEATURE] Angular surface for Medicare claims & coverage.
- [#307](https://github.com/jwilleke/yourphr/issues/307) — [FEATURE] Manual records — frontend: entry/edit/delete forms.
- [#305](https://github.com/jwilleke/yourphr/issues/305) — [FEATURE] Manual records — backend: store/edit/delete user-created records.
- [#288](https://github.com/jwilleke/yourphr/issues/288) — [ARCH] Decide the future of fasten-sources-stub.
- [#287](https://github.com/jwilleke/yourphr/issues/287) — [FEATURE] Upload/import UI polish.
- [#280](https://github.com/jwilleke/yourphr/issues/280) — [FEATURE] Raw fhir-cards: resolve a referenced resource's display name.
- [#256](https://github.com/jwilleke/yourphr/issues/256) — [FEATURE] Sharing PHR data.
- [#253](https://github.com/jwilleke/yourphr/issues/253) — [EPIC] Support manual data entry and user-created records.
- [#252](https://github.com/jwilleke/yourphr/issues/252) — [FEATURE] Harden re-import dedup against stale overwrites.
- [#251](https://github.com/jwilleke/yourphr/issues/251) — [FEATURE] Explore Apple Health's supported-institution list as a source.
- [#244](https://github.com/jwilleke/yourphr/issues/244) — [EPIC] Per-profile dashboard widgets (US Core display end-state).
- [#53](https://github.com/jwilleke/yourphr/issues/53) — [SMART] Veradigm/FollowMyHealth registration + integration (blocked).
- [#20](https://github.com/jwilleke/yourphr/issues/20) — [EPIC] SMART on FHIR — live provider sync.
- [#14](https://github.com/jwilleke/yourphr/issues/14) — [FEATURE] User Profile Update.

## 🔵 In review

- [#366](https://github.com/jwilleke/yourphr/issues/366) — [FEATURE] UI consistency: link styling + button convention (shipped v1.11.0; verify on deploy).

## ⏸ Deferred

- [#351](https://github.com/jwilleke/yourphr/issues/351) — [EPIC] /medical-history — group-by (all 5 dims) + rich detail shipped v1.11.0; Filters deferred (uncertain need).
- [#363](https://github.com/jwilleke/yourphr/issues/363) — [FEATURE] Database at-rest encryption: enable/migrate (guarded) + decrypt.
- [#278](https://github.com/jwilleke/yourphr/issues/278) — [EPIC] Rename Fasten* → YourPHR.
- [#263](https://github.com/jwilleke/yourphr/issues/263) — [FEATURE] Message Provider.
- [#239](https://github.com/jwilleke/yourphr/issues/239) — [chore] Revisit gofhir-models 0.1.x once encoding/json/v2 is default in Go.
- [#131](https://github.com/jwilleke/yourphr/issues/131) — [FEATURE] E2E testing — lforms questionnaire render + interact.

## ❓ Needs triage

- None — every open issue carries a priority label.
