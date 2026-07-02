# TODO

<!-- RESUME:START -->
## ▶ Resume here — 2026-07-02

- Last worked on: **[#387](https://github.com/jwilleke/yourphr/issues/387) RxTerms patient-friendly medication names — shipped end to end.** API prototype → strength (`allinfo`) → **offline embedded crosswalk** (21k drugs, 230 KB, `go:embed`, `make gen-rxterms-crosswalk`) → **separate Strength column** (name vs strength vs dose). Released **v1.13.0** and **enabled in prod** ([mj-infra-flux#135](https://github.com/jwilleke/mj-infra-flux/pull/135), `YOURPHR_MEDICATIONS_RXTERMS_ENRICH=true`). Also [#386](https://github.com/jwilleke/yourphr/issues/386) (DailyMed links) + `serve-frontend-lan`.
- Branch / state: `main`, clean, synced (v1.13.0 tagged).
- Running / in-flight: **dev servers I started this session** — backend `:9090` + frontend `:4200` on `0.0.0.0` (LAN, rxterms on); they stop on VS Code shutdown (restart: `make serve-backend` + `make serve-frontend-lan`). CI on `ae58076` finishing (v1.13.0 image already built ✓). **Flux rolling `:1.13.0` + the rxterms flag to prod** — verify once reconciled.
- Parked / half-done: none (tree clean).
- Next steps:
  - **Verify RxTerms live on prod** (yourphr.nerdsbythehour.com → Current Medications; behind Authentik). Nudge: run `flux reconcile kustomization apps --with-source` on the k3s node.
  - Triage 3 Dependabot PRs ([#380](https://github.com/jwilleke/yourphr/pull/380)/[#381](https://github.com/jwilleke/yourphr/pull/381)/[#382](https://github.com/jwilleke/yourphr/pull/382), frontend npm bumps).
  - Backlog: P1 [#313](https://github.com/jwilleke/yourphr/issues/313) / [#355](https://github.com/jwilleke/yourphr/issues/355); [#369](https://github.com/jwilleke/yourphr/issues/369) grouping endpoint; [#370](https://github.com/jwilleke/yourphr/issues/370) VA; [#385](https://github.com/jwilleke/yourphr/issues/385) test-data corpus.
- Blockers / significant notes: RxTerms shows the **generic** name (Lipitor→Atorvastatin; accepted — reopen [#387](https://github.com/jwilleke/yourphr/issues/387) for brand names). Enrichment gated by `medications.rxterms_enrich` (on in prod+dev, off by default; offline crosswalk = no external calls).
<!-- RESUME:END -->

> Generated from live GitHub state — ranked by priority label. The `▶ Resume here` pointer is written by `/wrap`.

## 🔴 P0 — Security & Critical

- None. (0 open Dependabot alerts, 0 open code-scanning alerts.)

## 🟠 P1

- [#313](https://github.com/jwilleke/yourphr/issues/313) — [FEATURE] patients able to add records to their own PHR
- [#355](https://github.com/jwilleke/yourphr/issues/355) — [FEATURE] Dynamic Client Registration (DCR)
- [#387](https://github.com/jwilleke/yourphr/issues/387) — [FEATURE] RxNorm to patient-legible display (RxTerms)

## 🟡 P2

- [#345](https://github.com/jwilleke/yourphr/issues/345) — [security] http-proxy-middleware (webpack-dev-server tree) — blocked on upstream hpm 3.x (GHSA-64mm-vxmg-q3vj)
- [#14](https://github.com/jwilleke/yourphr/issues/14) — [FEATURE] User Profile Update
- [#20](https://github.com/jwilleke/yourphr/issues/20) — [EPIC] SMART on FHIR — live provider sync
- [#53](https://github.com/jwilleke/yourphr/issues/53) — [SMART] Veradigm/FollowMyHealth registration + end-to-end integration (blocked)
- [#244](https://github.com/jwilleke/yourphr/issues/244) — [EPIC] Per-profile dashboard widgets (US Core display end-state)
- [#251](https://github.com/jwilleke/yourphr/issues/251) — [FEATURE] Explore Apple Health's supported-institution list as a provider-catalog / FHIR-endpoint source
- [#252](https://github.com/jwilleke/yourphr/issues/252) — [FEATURE] Harden re-import dedup: guard idempotent upserts against stale (older) overwrites + add coverage
- [#253](https://github.com/jwilleke/yourphr/issues/253) — [FEATURE] Epic: Support manual data entry and user-created records
- [#256](https://github.com/jwilleke/yourphr/issues/256) — [FEATURE] Sharing PHR data
- [#280](https://github.com/jwilleke/yourphr/issues/280) — [FEATURE] Raw fhir-cards: resolve a referenced resource's display name (e.g. Medication/{id})
- [#287](https://github.com/jwilleke/yourphr/issues/287) — [FEATURE] Upload/import UI polish — make all supported file types selectable + clearer 'add my data' affordances
- [#288](https://github.com/jwilleke/yourphr/issues/288) — [ARCH] Decide the future of fasten-sources-stub: fold into the main module vs keep as the owned source layer
- [#300](https://github.com/jwilleke/yourphr/issues/300) — [FEATURE] Angular surface for Medicare claims & coverage (insurance view)
- [#305](https://github.com/jwilleke/yourphr/issues/305) — [FEATURE] Manual records — backend: store/edit/delete user-created records (FHIR-consistent)
- [#307](https://github.com/jwilleke/yourphr/issues/307) — [FEATURE] Manual records — frontend: entry/edit/delete forms
- [#314](https://github.com/jwilleke/yourphr/issues/314) — [FEATURE] Wearable Device Integration for Vitals, Activity & PGHD
- [#333](https://github.com/jwilleke/yourphr/issues/333) — [EPIC] Explore — record export options (Save Report, PDF, Email)
- [#334](https://github.com/jwilleke/yourphr/issues/334) — [FEATURE] Explore — Save Report
- [#335](https://github.com/jwilleke/yourphr/issues/335) — [FEATURE] Explore — Export to PDF
- [#336](https://github.com/jwilleke/yourphr/issues/336) — [FEATURE] Explore — Send to Email
- [#337](https://github.com/jwilleke/yourphr/issues/337) — [BUG] SSE sync events dropped ("Room not found") — import progress never clears
- [#339](https://github.com/jwilleke/yourphr/issues/339) — [FEATURE] athenahealth sandbox — complete Developer-Portal onboarding (blocked, approval-gated)
- [#340](https://github.com/jwilleke/yourphr/issues/340) — [FEATURE] Provider logos on Connected Sources — brand_id / brand_logo_url override
- [#343](https://github.com/jwilleke/yourphr/issues/343) — [FEATURE] Add patient/Observation.rs (+ lab/vital scopes) to the Cerner sandbox seed — no lab values import today
- [#348](https://github.com/jwilleke/yourphr/issues/348) — [FEATURE] Binary import: skip already-stored documents on re-sync (cross-sync existence check)
- [#352](https://github.com/jwilleke/yourphr/issues/352) — [FEATURE] Patient-friendly Body Diagram / Body Map View
- [#353](https://github.com/jwilleke/yourphr/issues/353) — [FEATURE] Patient private notes on records (persist + indicator)
- [#354](https://github.com/jwilleke/yourphr/issues/354) — [FEATURE] Integrate assets from HL7 FHIR GitHub organization (fhir-test-cases, fhir-codegen, etc.)
- [#360](https://github.com/jwilleke/yourphr/issues/360) — [FEATURE] Attach `classified` on resource-graph / list rows (per-row synthesized badges)
- [#364](https://github.com/jwilleke/yourphr/issues/364) — [FEATURE] Admin Database card — polish (free space, schema version, totals, vacuum)
- [#369](https://github.com/jwilleke/yourphr/issues/369) — [FEATURE] /medical-history — server-side grouping endpoint (counts + paged detail) for scale
- [#370](https://github.com/jwilleke/yourphr/issues/370) — [FEATURE] Add VA Clinical Health (FHIR) as a SMART provider
- [#385](https://github.com/jwilleke/yourphr/issues/385) — [EPIC] Realistic test-data corpus + golden-test harness

## 🔵 In review

- [#366](https://github.com/jwilleke/yourphr/issues/366) — [FEATURE] UI consistency: link styling + a small button convention

## ⏸ Deferred

- [#131](https://github.com/jwilleke/yourphr/issues/131) — [FEATURE] E2E testing — remaining gap: lforms questionnaire render + interact
- [#239](https://github.com/jwilleke/yourphr/issues/239) — [chore] Revisit gofhir-models 0.1.x once encoding/json/v2 is default in Go
- [#263](https://github.com/jwilleke/yourphr/issues/263) — [FEATURE] Message Provider
- [#278](https://github.com/jwilleke/yourphr/issues/278) — [EPIC] Rename Fasten* → YourPHR (only on committing to a hard fork)
- [#351](https://github.com/jwilleke/yourphr/issues/351) — [FEATURE] /medical-history — group & filter by Date/Condition/Provider/Place/Type
- [#363](https://github.com/jwilleke/yourphr/issues/363) — [FEATURE] Database at-rest encryption: enable/migrate (guarded) + decrypt

## ❓ Needs triage

- None. (All open issues carry a placement label.)
