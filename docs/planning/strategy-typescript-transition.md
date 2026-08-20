# Strategy — freeze Go, build forward in TypeScript

> __Status: proposed, 2026-08-16.__ The direction is the operator's decision. The sequencing, the rules and the stop conditions below are the part that needs agreeing before anything acts on it.

Companion to [`typescript-stack-evaluation.md`](typescript-stack-evaluation.md), which measured whether this is possible. This one is about whether it is *wise*, and how it would run. [`architecture-principles-typescript.md`](architecture-principles-typescript.md) covers *how* the TypeScript side is built — the ngdpbase concepts adopted, and the ones deliberately not.

## The decision

1. __Go development stops__, except security fixes.
2. __TypeScript is the forward path__, and carries no Fasten lineage — no `fasten-sources`, no `gofhir-models`, no inherited module path.

## What the spike established

Everything the evaluation called uncertain, except sync, now has a number against it — measured against a real 19,796-resource snapshot, not fixtures:

| Question | Answer |
|---|---|
| Generic indexing viable? | 551 lines against 18,518 generated Go lines |
| At real scale? | 20,061 resources, ~22s, 417k index rows |
| Identity seam? | __0 collisions__ across 8 sources |
| Matches Medplum's reference? | 71/71 queries |
| Matches production? | __29/29 resource types, id for id__ |
| Write path? | 11/11 — re-import, update, delete, reindex |
| Per-user isolation? | 6/6, including a resource id held by two accounts |
| Frontend contract? | 9/9, via an adapter |
| __Sync?__ | __untested__ |

## Three things to settle before this starts

### 1. "Security fixes only" is the wrong line for a PHR

Today's freeze-worthy examples argue against it. [#528](https://github.com/jwilleke/yourphr/issues/528) was a counter that silently never incremented — filed as a bug, but it meant __a password change did not end a stolen session__, which is security. [#525](https://github.com/jwilleke/yourphr/issues/525) was a dashboard showing 40 practitioners where the page listed 6 — not security at all, and yet a records system that misstates how much of your record exists is not merely untidy.

A record displayed wrongly is a patient-safety problem, not a cosmetic one. Proposed line instead:

__Fix: security, data correctness, and anything that misrepresents a record. Freeze: new capability.__

> __RATIFIED (2026-08-20), together with the Phase 2 proceed decision.__ Operator's words: "we will only do patches to Go code going forward and primary efforts are on the spike implementation." Operationally: Go changes ship as __patch releases__ (fix/security/data-correctness only); new capability is built in the TypeScript stack. A Go itch that is new capability gets an issue labelled `frozen` — visibly not-done, and it doubles as the TypeScript backlog.

Under that rule today's work splits cleanly — [#529](https://github.com/jwilleke/yourphr/issues/529) and [#530](https://github.com/jwilleke/yourphr/issues/530) fixed, [#525](https://github.com/jwilleke/yourphr/issues/525) and [#528](https://github.com/jwilleke/yourphr/issues/528) fixed, [#524](https://github.com/jwilleke/yourphr/issues/524) Send to Email would __not__ have been built.

### 2. The freeze has to survive contact with annoyance

The honest risk is not technical. It is that the freeze breaks the first time something in the daily-driver instance irritates its only user enough — and then it breaks again, and there was never a freeze, only a slower pace with more guilt.

Worth deciding in advance what happens when that occurs. The cheapest answer: __write the issue, label it `frozen`, do not fix it.__ A visible list of things being consciously not-done is what makes a freeze real rather than aspirational, and it doubles as the TypeScript backlog.

### 3. "No Fasten items" costs more than it looks — and the cost is security

`fasten-sources-stub` is not a shim. It is 3,168 lines containing the __real SMART client__: `GetSourceClient`, `RefreshAccessToken`, capability discovery, binary/attachment fetch, patient-ID discovery — and __SSRF guarding__ (`ssrf.go`, `GuardedTransport`, with its own test suite).

`fhirclient` covers launch, token exchange and refresh. It covers __nothing__ of the SSRF hardening. A self-hosted PHR fetches URLs that a provider — or an attacker who can influence a provider response — supplies, from inside a home network. That guard exists because somebody thought about it.

So "no Fasten items in TypeScript" means __re-earning that hardening__, not just re-writing plumbing. It is doable and it is the single most dangerous line item in this plan, because it is the one where being wrong is a vulnerability rather than a bug.

Related, already filed: [#485](https://github.com/jwilleke/yourphr/issues/485) rejects obfuscated numeric hosts when a source is added.

## Sequencing

Each phase is its own issue, tracked under [#544](https://github.com/jwilleke/yourphr/issues/544) as native sub-issues and chained by `blocked by`. Nothing here is a step inside another issue.

| Phase | Issue | Blocked by |
|---|---|---|
| 0 — leave Fasten, stay on Go | [#538](https://github.com/jwilleke/yourphr/issues/538) | — |
| 1 — keep the read stack honest in CI | [#540](https://github.com/jwilleke/yourphr/issues/540) | — |
| __2 — sync, or stop__ | __[#539](https://github.com/jwilleke/yourphr/issues/539)__ | [#538](https://github.com/jwilleke/yourphr/issues/538) |
| 3 — authentication and sessions | [#541](https://github.com/jwilleke/yourphr/issues/541) | [#539](https://github.com/jwilleke/yourphr/issues/539) |
| 4 — the long tail | [#542](https://github.com/jwilleke/yourphr/issues/542) | [#539](https://github.com/jwilleke/yourphr/issues/539), [#541](https://github.com/jwilleke/yourphr/issues/541) |
| 5 — cut over, keep both, or stop | [#543](https://github.com/jwilleke/yourphr/issues/543) | [#542](https://github.com/jwilleke/yourphr/issues/542) |

Phases 0 and 1 are deliberately unblocked and worth doing even if Phase 2 fails.

__Phase 0 — leave Fasten, stay on Go.__ Fold the stub in under YourPHR's own name, replace `gofhir-models`, decide the module path. Cheap, reversible, useful whether or not the rest happens, and it removes the liability of depending on a stub of a package that went private.

__Phase 1 — the read stack in TypeScript, shadowing.__ Already built. Keep it honest by running the harness on the synthetic corpus in CI, and against a real snapshot after any storage change.

__Phase 2 — sync, or stop. Due 2026-09-30__ ([#539](https://github.com/jwilleke/yourphr/issues/539), milestone *Phase 2 decision — TypeScript sync*). The decisive phase, attempted *before* anything is migrated for real, so that failing is cheap.

> __OUTCOME (2026-08-20): DEMONSTRATED — the transition proceeds.__ All five gates cleared 2026-08-18, 43 days ahead of the stop date: SSRF tests that fail when the guard is removed (47 checks, sabotage-verified), a real PKCE S256 exchange and a real refresh grant against the SMART Health IT sandbox's authorization server, records fetched and stored with the differential harness agreeing (re-verified against 20,061 real records; 29/29 resource types match the Go stack exactly), and a resync on the refreshed token creating nothing new. Operator decision recorded on [#539](https://github.com/jwilleke/yourphr/issues/539): __proceed to Phase 3__. The real cut-over commitment remains Phase 5.

The gate is a __sandbox__ provider, not production — [#408](https://github.com/jwilleke/yourphr/issues/408) has been open since July trying to prove a *production* provider end-to-end in Go, and holding TypeScript to a bar the working stack has not cleared would make this fail for the wrong reasons. Six sandboxes are already seeded.

__Mid-point signal, 2026-09-05:__ the SSRF dispatcher should exist in some form. It is the piece with no library behind it; if it has not started by three weeks in, the end date is already lost, and week 3 is a better time to learn that than week 6.

Demonstrated means: one sandbox connected, a token refreshed, records stored with the differential harness still agreeing, __SSRF tests that fail when the guard is removed__, and a resync producing no duplicates.

__Phase 3 — auth and sessions.__ Isolation is proven *given* a user id; establishing who the caller is is not built.

__Phase 4 — the long tail.__ Provider catalog, DCR, background jobs, backup and restore, encryption, config, migrations, IPS renderers including PDF, the classifier, provenance, medication reconciliation. Roughly 22.7k hand-written Go lines, and the part with no library to adopt.

__Phase 5 — cut over, or keep both.__ Only after 2–4.

## Stop rules, agreed in advance

A migration without a defined failure is one that cannot fail, only drag.

- __If Phase 2 is not demonstrated by 2026-09-30, stop.__ Keep Go, keep the read stack as a shadow or delete it, and record why in this document. The date is a GitHub milestone rather than a line in a plan, so it is visible on the issue and on the board.
- __Only two things justify moving it__, and neither is being busy: [#408](https://github.com/jwilleke/yourphr/issues/408) landing in Go first, which would give a known-good reference for what production demands; or a provider registration stalling in somebody else's approval queue, as already happened with [#339](https://github.com/jwilleke/yourphr/issues/339).
- __If the freeze is broken twice for non-security work, the freeze is not real__ — either widen the rule deliberately or abandon it, but do not keep pretending.
- __If two stacks are both serving production for more than one release cycle__, stop and pick one. A half-migrated system maintained by one person is worse than either endpoint.

## What this costs if it works

76.8k lines of Angular are kept — the frontend does not move. The adapter needed to keep it ([#537](https://github.com/jwilleke/yourphr/issues/537)) is bounded and known.

## What this costs if it fails

A Go instance frozen for however long the attempt lasted, carrying unfixed capability gaps, plus a TypeScript stack that never shipped. That is the real downside, and it is why Phase 2 comes before any migration rather than after.
