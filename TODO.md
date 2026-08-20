# TODO

<!-- RESUME:START -->
## ▶ Resume here — 2026-08-20

- Last worked on: __the biggest single day of the transition.__ Phase 2 decided PROCEED on [#539](https://github.com/jwilleke/yourphr/issues/539) and the Go freeze RATIFIED (patches only; capability goes to the spike). Phase 3 finished ([#541](https://github.com/jwilleke/yourphr/issues/541)). Phase 4's six decomposed issues ALL built ([#577](https://github.com/jwilleke/yourphr/issues/577)–[#582](https://github.com/jwilleke/yourphr/issues/582)). Phase-5 ladder filed ([#583](https://github.com/jwilleke/yourphr/issues/583)–[#588](https://github.com/jwilleke/yourphr/issues/588)) and three rungs climbed: users (bcrypt verify-then-rehash), sources+tokens (refresh with no reconnect), frontend serving (raw-socket traversal teeth). Also: #575 (24 reachable Go vulns) found by /pstatus and fixed same hour; v2.10.1 + v2.10.2 released and deployed; #545 shipped.
- Branch / state: `main` clean + pushed, both repos. Spike CI re-running on `b05adb0` (a timing-flaky auth check widened — was red on the #585 push, fix pushed at wrap).
- Running / in-flight: spike CI on `b05adb0` (verify green next session if not confirmed); session-scoped kit-PR monitor dies with the session (standing rule in memory covers future kit PRs).
- Parked / half-done: none.
- Next steps:
  - Verify spike CI green on `b05adb0` (was the flaky renewal-window check)
  - [#586](https://github.com/jwilleke/yourphr/issues/586) — one-command migration tool (both import halves ready) — then [#587](https://github.com/jwilleke/yourphr/issues/587) packaging, [#588](https://github.com/jwilleke/yourphr/issues/588) runbook
  - 14 in-review issues await close calls ([#539](https://github.com/jwilleke/yourphr/issues/539), [#540](https://github.com/jwilleke/yourphr/issues/540), [#541](https://github.com/jwilleke/yourphr/issues/541), [#545](https://github.com/jwilleke/yourphr/issues/545), [#563](https://github.com/jwilleke/yourphr/issues/563), [#575](https://github.com/jwilleke/yourphr/issues/575), [#577](https://github.com/jwilleke/yourphr/issues/577)–[#585](https://github.com/jwilleke/yourphr/issues/585))
  - Untriaged: [#561](https://github.com/jwilleke/yourphr/issues/561) + 7 Dependabot PRs; [#576](https://github.com/jwilleke/yourphr/issues/576) yarn highs (P1)
  - Epic production distribution live (518 orgs, auto-sweep ~48h from 2026-08-19) — name your health system to finish [#408](https://github.com/jwilleke/yourphr/issues/408)
- Blockers / significant notes: tracking rule — ALL working items live in THIS repo's TODO.md + private/project_log.md. Admin-in-spike = bootstrap account (named simplification). Go tokens are plain column values in an unencrypted prod DB — quiet argument for the cut-over.
<!-- RESUME:END -->

> Generated from live GitHub state — ranked by priority label.
> __Open PRs share these bands with issues__ — a PR takes its own placement label, else the highest priority among the issues it links, else Needs triage.

## 🔴 P0 — Security & Critical

- [#546](https://github.com/jwilleke/yourphr/issues/546) — [FEATURE] Required vs optional capabilities — a required provider must refuse to boot, not degrade to inert

## 🟠 P1

- [#576](https://github.com/jwilleke/yourphr/issues/576) — [security] yarn build-tree high advisories: brace-expansion, cross-spawn, image-size, nanoid, semver
- [#588](https://github.com/jwilleke/yourphr/issues/588) — [SPIKE] Phase 5: the cut-over runbook — freeze, migrate, verify, swap, rollback rehearsed
- [#587](https://github.com/jwilleke/yourphr/issues/587) — [SPIKE] Phase 5: package and deploy the spike — image, release tagging, Flux entry
- [#586](https://github.com/jwilleke/yourphr/issues/586) — [SPIKE] Phase 5: one-command, per-user, verified migration tool
- [#585](https://github.com/jwilleke/yourphr/issues/585) — [SPIKE] Phase 5: serve the Angular frontend from the spike process
- [#584](https://github.com/jwilleke/yourphr/issues/584) — [SPIKE] Phase 5: migrate connected sources and their tokens
- [#583](https://github.com/jwilleke/yourphr/issues/583) — [SPIKE] Phase 5: migrate user accounts — bcrypt verify-then-rehash, nobody resets a password
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

- [#532](https://github.com/jwilleke/yourphr/issues/532) — [CHORE] Load webcrypto-liner only when crypto.subtle is missing
- [#507](https://github.com/jwilleke/yourphr/issues/507) — [FEATURE] Authentication policy survey: password reset, MFA, re-auth, audit — decide what to build
- [#461](https://github.com/jwilleke/yourphr/issues/461) — [FEATURE] Encrypted database backups (and lift the encryption/backup exclusion)
- [#345](https://github.com/jwilleke/yourphr/issues/345) — [security] http-proxy-middleware (webpack-dev-server tree) — blocked on upstream hpm 3.x (GHSA-64mm-vxmg-q3vj)
- [#552](https://github.com/jwilleke/yourphr/issues/552) — [CHORE] Port the DICOM viewer to dwv 0.36 — removed APIs and a build path that no longer exists
- [#551](https://github.com/jwilleke/yourphr/issues/551) — [CHORE] Migrate 647 *ngIf uses to Angular built-in control flow (@if/@for)
- [#543](https://github.com/jwilleke/yourphr/issues/543) — [SPIKE] Phase 5: cut over, keep both, or stop — decided once, not by drift
- [#542](https://github.com/jwilleke/yourphr/issues/542) — [SPIKE] Phase 4: the long tail — 22.7k lines with no library to adopt
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

- [#582](https://github.com/jwilleke/yourphr/issues/582) — [SPIKE] One HTTP layer over all spike modules
- [#581](https://github.com/jwilleke/yourphr/issues/581) — [SPIKE] Dynamic Client Registration in the TypeScript stack
- [#580](https://github.com/jwilleke/yourphr/issues/580) — [SPIKE] Medication reconciliation in the TypeScript stack
- [#579](https://github.com/jwilleke/yourphr/issues/579) — [SPIKE] Provenance in the TypeScript stack — which source said what, when
- [#578](https://github.com/jwilleke/yourphr/issues/578) — [SPIKE] Patient-legible classifier in the TypeScript stack
- [#577](https://github.com/jwilleke/yourphr/issues/577) — [SPIKE] IPS composition and narratives in the TypeScript stack — PDF stays a frontend concern
- [#575](https://github.com/jwilleke/yourphr/issues/575) — [security] Go toolchain 1.26.1 → 1.26.6 (+ x/image 0.43) — 24 reachable stdlib vulnerabilities
- [#541](https://github.com/jwilleke/yourphr/issues/541) — [SPIKE] Phase 3: authentication and sessions in the TypeScript stack
- [#540](https://github.com/jwilleke/yourphr/issues/540) — [CHORE] Phase 1: keep the TypeScript read stack honest in CI
- [#563](https://github.com/jwilleke/yourphr/issues/563) — [FEATURE] Patient-visible access log — a complete record of who accessed which records, shown to the patient
- [#545](https://github.com/jwilleke/yourphr/issues/545) — [BUG] Default install has no backup path — encryption defaults on, and backup is gated on encryption
- [#539](https://github.com/jwilleke/yourphr/issues/539) — [SPIKE] Phase 2: SMART sync in TypeScript with SSRF guarding — or stop the transition

## ⏸ Deferred

- [#388](https://github.com/jwilleke/yourphr/issues/388) — [ARCH] Extract the FHIR domain logic as a consumable library (own-datastore consumers)
- [#363](https://github.com/jwilleke/yourphr/issues/363) — [FEATURE] Database at-rest encryption: enable/migrate (guarded) + decrypt
- [#351](https://github.com/jwilleke/yourphr/issues/351) — [FEATURE] /medical-history — group & filter by Date (default), Condition, Provider, Place, Type
- [#278](https://github.com/jwilleke/yourphr/issues/278) — [EPIC] Rename Fasten* → YourPHR (deferred; only on committing to a hard fork)
- [#263](https://github.com/jwilleke/yourphr/issues/263) — [FEATURE] Message Provider
- [#239](https://github.com/jwilleke/yourphr/issues/239) — [chore] Revisit gofhir-models 0.1.x once encoding/json/v2 is default in Go
- [#131](https://github.com/jwilleke/yourphr/issues/131) — [FEATURE] E2E testing — remaining gap: lforms questionnaire render + interact

## ❓ Needs triage

- [#561](https://github.com/jwilleke/yourphr/issues/561) — [BUG] Two workflow comments justify a lint exclusion on a premise removed in #241
- [#574](https://github.com/jwilleke/yourphr/pull/574) — chore(deps): bump chromatic from 18.1.0 to 18.2.0 in /frontend *(PR · ready)* — no linked issue
- [#573](https://github.com/jwilleke/yourphr/pull/573) — chore(deps): bump @angular/compiler from 20.3.27 to 20.3.28 in /frontend *(PR · ready)* — no linked issue
- [#572](https://github.com/jwilleke/yourphr/pull/572) — chore(deps): bump ts-node from 8.3.0 to 9.1.1 in /frontend *(PR · ready)* — no linked issue
- [#571](https://github.com/jwilleke/yourphr/pull/571) — chore(deps): bump @compodoc/compodoc from 1.2.1 to 2.0.0 in /frontend *(PR · ready)* — no linked issue
- [#570](https://github.com/jwilleke/yourphr/pull/570) — chore(deps): bump @fortawesome/angular-fontawesome from 2.0.1 to 3.0.0 in /frontend *(PR · ready)* — no linked issue
- [#565](https://github.com/jwilleke/yourphr/pull/565) — chore(deps): bump github.com/sirupsen/logrus from 1.9.4 to 1.10.0 *(PR · ready)* — no linked issue
- [#564](https://github.com/jwilleke/yourphr/pull/564) — chore(ci): bump actions/checkout from 4 to 7 *(PR · ready)* — no linked issue
