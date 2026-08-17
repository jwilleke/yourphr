# TODO

> Generated from live GitHub state — ranked by priority label.

## 🔴 P0 — Security & Critical

- [#546](https://github.com/jwilleke/yourphr/issues/546) — [FEATURE] Required vs optional capabilities — a required provider must refuse to boot, not degrade to inert
- [#545](https://github.com/jwilleke/yourphr/issues/545) — [BUG] Default install has no backup path — encryption defaults on, and backup is gated on encryption

## 🟠 P1

- [#539](https://github.com/jwilleke/yourphr/issues/539) — [SPIKE] Phase 2: SMART sync in TypeScript with SSRF guarding — or stop the transition
- [#506](https://github.com/jwilleke/yourphr/issues/506) — [FEATURE] Password policy in configuration, enforced server-side and published to the UI
- [#544](https://github.com/jwilleke/yourphr/issues/544) — [EPIC] Transition: freeze Go, build forward in TypeScript
- [#538](https://github.com/jwilleke/yourphr/issues/538) — [CHORE] Phase 0: leave Fasten, stay on Go — adopt the stub under our own name
- [#537](https://github.com/jwilleke/yourphr/issues/537) — [SPIKE] TypeScript stack: prove auth, the HTTP layer and sync, or stop
- [#536](https://github.com/jwilleke/yourphr/issues/536) — [FEATURE] Outbound mail transport: one sender, console by default
- [#494](https://github.com/jwilleke/yourphr/issues/494) — [FEATURE] Public demo: seeded demo account + golden-DB reset runbook (demo.yourphr.org)
- [#438](https://github.com/jwilleke/yourphr/issues/438) — [EPIC] demo.yourphr.org — public CMS / sandbox demo instance
- [#436](https://github.com/jwilleke/yourphr/issues/436) — [FEATURE] Support for "Bootstrap" and themas
- [#408](https://github.com/jwilleke/yourphr/issues/408) — [FEATURE] Prove one production SMART provider end-to-end via provider catalog
- [#389](https://github.com/jwilleke/yourphr/issues/389) — [FEATURE] /patient-profile Care Provider
- [#355](https://github.com/jwilleke/yourphr/issues/355) — [FEATURE] Dynamic Client Registration (DCR)
- [#313](https://github.com/jwilleke/yourphr/issues/313) — [FEATURE] patients able to add records to their own PHR

## 🟡 P2

- [#541](https://github.com/jwilleke/yourphr/issues/541) — [SPIKE] Phase 3: authentication and sessions in the TypeScript stack
- [#532](https://github.com/jwilleke/yourphr/issues/532) — [CHORE] Load webcrypto-liner only when crypto.subtle is missing
- [#507](https://github.com/jwilleke/yourphr/issues/507) — [FEATURE] Authentication policy survey: password reset, MFA, re-auth, audit — decide what to build
- [#461](https://github.com/jwilleke/yourphr/issues/461) — [FEATURE] Encrypted database backups (and lift the encryption/backup exclusion)
- [#345](https://github.com/jwilleke/yourphr/issues/345) — [security] http-proxy-middleware (webpack-dev-server tree) — blocked on upstream hpm 3.x (GHSA-64mm-vxmg-q3vj)
- [#552](https://github.com/jwilleke/yourphr/issues/552) — [CHORE] Port the DICOM viewer to dwv 0.36 — removed APIs and a build path that no longer exists
- [#551](https://github.com/jwilleke/yourphr/issues/551) — [CHORE] Migrate 647 *ngIf uses to Angular built-in control flow (@if/@for)
- [#543](https://github.com/jwilleke/yourphr/issues/543) — [SPIKE] Phase 5: cut over, keep both, or stop — decided once, not by drift
- [#542](https://github.com/jwilleke/yourphr/issues/542) — [SPIKE] Phase 4: the long tail — 22.7k lines with no library to adopt
- [#540](https://github.com/jwilleke/yourphr/issues/540) — [CHORE] Phase 1: keep the TypeScript read stack honest in CI
- [#535](https://github.com/jwilleke/yourphr/issues/535) — [FEATURE] No list view for Organizations (individual ones display fine)
- [#534](https://github.com/jwilleke/yourphr/issues/534) — [CHORE] related_versions.json is tracked but build-generated, so it dirties the tree on every build
- [#502](https://github.com/jwilleke/yourphr/issues/502) — [ARCH] Evaluate moving Azia's hand-rolled dark stylesheet onto Bootstrap 5.3 colour modes (data-bs-theme)
- [#500](https://github.com/jwilleke/yourphr/issues/500) — [FEATURE] ui.theme-name: theme.name is published but wired to nothing — wire it up or remove it
- [#499](https://github.com/jwilleke/yourphr/issues/499) — [FEATURE] ui.color-mode: instance default for light/dark (user's own choice still wins)
- [#487](https://github.com/jwilleke/yourphr/issues/487) — [CHORE] Migrating off Karma must not silently defang the contrast test (jsdom has no real cascade)
- [#485](https://github.com/jwilleke/yourphr/issues/485) — [FEATURE] Reject obfuscated numeric hosts when a source is added, not when it syncs
- [#482](https://github.com/jwilleke/yourphr/issues/482) — [FEATURE] Upgrade angular Angular to 22.x
- [#475](https://github.com/jwilleke/yourphr/issues/475) — [FEATURE] display the bootstrap values
- [#473](https://github.com/jwilleke/yourphr/issues/473) — [FEATURE] Warn about configuration keys that have no effect
- [#472](https://github.com/jwilleke/yourphr/issues/472) — [CHORE] Reference deployment: env carries bootstrap and secrets, not settings
- [#471](https://github.com/jwilleke/yourphr/issues/471) — [FEATURE] Show which provider entries were provisioned from environment variables
- [#469](https://github.com/jwilleke/yourphr/issues/469) — [CHORE] Remove AllowedBackupRoots, keep path hygiene
- [#465](https://github.com/jwilleke/yourphr/issues/465) — [FEATURE] Record the document digest on the consent record
- [#462](https://github.com/jwilleke/yourphr/issues/462) — [FEATURE] Share records as a SMART Health Link (shlink)
- [#455](https://github.com/jwilleke/yourphr/issues/455) — [CHORE] Route all config reads through config.Interface (retire direct os.Getenv and ad-hoc settings files)
- [#415](https://github.com/jwilleke/yourphr/issues/415) — [docs] Manual SMART connect golden-path checklist (relay + catalog)
- [#413](https://github.com/jwilleke/yourphr/issues/413) — [BUG] authorizeSource (BYO) drops redirect_uri from API response mapping
- [#409](https://github.com/jwilleke/yourphr/issues/409) — [CHORE] Retire or quarantine legacy connect-gateway.service.ts (Fasten Lighthouse)
- [#407](https://github.com/jwilleke/yourphr/issues/407) — [FEATURE] Decide fate of BYO SMART Path B (/source/authorize + /source/connect)
- [#393](https://github.com/jwilleke/yourphr/issues/393) — [FEATURE] Live API Sync CARIN framework
- [#392](https://github.com/jwilleke/yourphr/issues/392) — [FEATURE] Display C4BB files patient-legible layout
- [#385](https://github.com/jwilleke/yourphr/issues/385) — [EPIC] Realistic test-data corpus + golden-test harness
- [#370](https://github.com/jwilleke/yourphr/issues/370) — [FEATURE] Add VA Clinical Health (FHIR) as a SMART provider
- [#369](https://github.com/jwilleke/yourphr/issues/369) — [FEATURE] /medical-history — server-side grouping endpoint (counts + paged detail) for scale
- [#364](https://github.com/jwilleke/yourphr/issues/364) — [FEATURE] Admin Database card — polish (free space, schema version, totals, vacuum)
- [#360](https://github.com/jwilleke/yourphr/issues/360) — [FEATURE] Attach `classified` on resource-graph / list rows (per-row synthesized badges)
- [#354](https://github.com/jwilleke/yourphr/issues/354) — [FEATURE] Integrate assets from HL7 FHIR GitHub organization (fhir-test-cases, fhir-codegen, etc.)
- [#353](https://github.com/jwilleke/yourphr/issues/353) — [FEATURE] Patient private notes on records (persist + indicator)
- [#352](https://github.com/jwilleke/yourphr/issues/352) — [FEATURE] Patient-friendly Body Diagram / Body Map View
- [#348](https://github.com/jwilleke/yourphr/issues/348) — [FEATURE] Binary import: skip already-stored documents on re-sync (cross-sync existence check)
- [#343](https://github.com/jwilleke/yourphr/issues/343) — [FEATURE] Add patient/Observation.rs (+ lab/vital scopes) to the Cerner sandbox seed — no lab values import today
- [#340](https://github.com/jwilleke/yourphr/issues/340) — [FEATURE] Provider logos on Connected Sources — minted UUID brand_id for seeded sandboxes, brand_logo_url override for custom entries
- [#339](https://github.com/jwilleke/yourphr/issues/339) — [FEATURE] athenahealth sandbox — complete Developer-Portal onboarding (approval-gated)
- [#336](https://github.com/jwilleke/yourphr/issues/336) — [FEATURE] Explore — Send to Email
- [#335](https://github.com/jwilleke/yourphr/issues/335) — [FEATURE] Explore — Export to PDF
- [#334](https://github.com/jwilleke/yourphr/issues/334) — [FEATURE] Explore — Save Report
- [#333](https://github.com/jwilleke/yourphr/issues/333) — [EPIC] Explore — record export options (Save Report, PDF, Email)
- [#314](https://github.com/jwilleke/yourphr/issues/314) — [FEATURE] Wearable Device Integration for Vitals, Activity & PGHD
- [#307](https://github.com/jwilleke/yourphr/issues/307) — [FEATURE] Manual records — frontend: entry/edit/delete forms
- [#305](https://github.com/jwilleke/yourphr/issues/305) — [FEATURE] Manual records — backend: store/edit/delete user-created records (FHIR-consistent)
- [#300](https://github.com/jwilleke/yourphr/issues/300) — [FEATURE] Angular surface for Medicare claims & coverage (insurance view)
- [#288](https://github.com/jwilleke/yourphr/issues/288) — [ARCH] Decide the future of fasten-sources-stub: fold into the main module vs keep as the owned source layer
- [#287](https://github.com/jwilleke/yourphr/issues/287) — [FEATURE] Upload/import UI polish — make all supported file types selectable + clearer 'add my data' affordances
- [#280](https://github.com/jwilleke/yourphr/issues/280) — [FEATURE] Raw fhir-cards: resolve a referenced resource's display name (e.g. Medication/{id})
- [#256](https://github.com/jwilleke/yourphr/issues/256) — [FEATURE] Sharing PHR data.
- [#253](https://github.com/jwilleke/yourphr/issues/253) — [FEATURE] Epic: Support manual data entry and user-created records
- [#252](https://github.com/jwilleke/yourphr/issues/252) — [FEATURE] Harden re-import dedup: guard idempotent upserts against stale (older) overwrites + add coverage
- [#251](https://github.com/jwilleke/yourphr/issues/251) — [FEATURE] Explore Apple Health's supported-institution list as a provider-catalog / FHIR-endpoint source
- [#244](https://github.com/jwilleke/yourphr/issues/244) — [EPIC] Per-profile dashboard widgets (US Core display end-state)
- [#53](https://github.com/jwilleke/yourphr/issues/53) — [SMART] Veradigm/FollowMyHealth registration + end-to-end integration
- [#20](https://github.com/jwilleke/yourphr/issues/20) — [EPIC] SMART on FHIR — live provider sync
- [#14](https://github.com/jwilleke/yourphr/issues/14) — [FEATURE] User Profile Update

## 🔵 In review

*None.*

## ⏸ Deferred

- [#363](https://github.com/jwilleke/yourphr/issues/363) — [FEATURE] Database at-rest encryption: enable/migrate (guarded) + decrypt
- [#388](https://github.com/jwilleke/yourphr/issues/388) — [ARCH] Extract the FHIR domain logic as a consumable library (own-datastore consumers)
- [#378](https://github.com/jwilleke/yourphr/pull/378) — chore(deps): bump zone.js from 0.15.1 to 0.16.2 in /frontend *(PR · ready · stale 53d)* — blocked by [#482](https://github.com/jwilleke/yourphr/issues/482)
- [#351](https://github.com/jwilleke/yourphr/issues/351) — [FEATURE] /medical-history — group & filter by Date (default), Condition, Provider, Place, Type
- [#278](https://github.com/jwilleke/yourphr/issues/278) — [EPIC] Rename Fasten* → YourPHR (deferred; only on committing to a hard fork)
- [#263](https://github.com/jwilleke/yourphr/issues/263) — [FEATURE] Message Provider
- [#239](https://github.com/jwilleke/yourphr/issues/239) — [chore] Revisit gofhir-models 0.1.x once encoding/json/v2 is default in Go
- [#131](https://github.com/jwilleke/yourphr/issues/131) — [FEATURE] E2E testing — remaining gap: lforms questionnaire render + interact

## ❓ Needs triage

- [#554](https://github.com/jwilleke/yourphr/pull/554) — chore(kit): sync to v1.5.2-0-gc41842f *(PR · ready)* — refs [#553](https://github.com/jwilleke/yourphr/issues/553)
