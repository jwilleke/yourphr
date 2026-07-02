# TODO

<!-- RESUME:START -->
## ▶ Resume here — 2026-07-02

- Last worked on: **/code-review (high) of the resume-pointer commit → fixed all 3 confirmed findings** (23fdc3ab): removed the internal `ssh user@LAN-IP` nudge that had been published in this public file (tip-only fix — Jim decided **no history scrub**, residual exposure at b5409826 accepted), fixed the unresolvable `mj-flux#135` shorthand → [mj-infra-flux#135](https://github.com/jwilleke/mj-infra-flux/pull/135), and converted all bare #N refs to full URLs. Earlier today: [#387](https://github.com/jwilleke/yourphr/issues/387) RxTerms shipped end to end, **v1.13.0 released + enabled in prod**.
- Branch / state: `main`, pushed/synced — EXCEPT one uncommitted working-tree change: **deletion of `.claude/commands/check-todos-local.md`**, not made by this session (origin unknown — decide restore vs commit before it surprises someone).
- Running / in-flight: CodeQL on `23fdc3ab` finishing (docs-only change). Dev servers from the earlier session are **stopped** (`:9090`/`:4200` free; restart: `make serve-backend` + `make serve-frontend-lan`).
- Parked / half-done: the `.claude/commands/check-todos-local.md` deletion (see above).
- Next steps:
  - **Verify RxTerms live on prod** (yourphr.nerdsbythehour.com → Current Medications; behind Authentik). Nudge: run `flux reconcile kustomization apps --with-source` on the k3s node.
  - Triage **11** open Dependabot PRs ([#372](https://github.com/jwilleke/yourphr/pull/372)–[#382](https://github.com/jwilleke/yourphr/pull/382): frontend npm, Go modules, actions — earlier pointer undercounted at 3).
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

- None.

## ⏸ Deferred

- [#131](https://github.com/jwilleke/yourphr/issues/131) — [FEATURE] E2E testing — remaining gap: lforms questionnaire render + interact
- [#239](https://github.com/jwilleke/yourphr/issues/239) — [chore] Revisit gofhir-models 0.1.x once encoding/json/v2 is default in Go
- [#263](https://github.com/jwilleke/yourphr/issues/263) — [FEATURE] Message Provider
- [#278](https://github.com/jwilleke/yourphr/issues/278) — [EPIC] Rename Fasten* → YourPHR (only on committing to a hard fork)
- [#351](https://github.com/jwilleke/yourphr/issues/351) — [FEATURE] /medical-history — group & filter by Date/Condition/Provider/Place/Type
- [#363](https://github.com/jwilleke/yourphr/issues/363) — [FEATURE] Database at-rest encryption: enable/migrate (guarded) + decrypt

## ❓ Needs triage

- None. (All open issues carry a placement label.)
