# Testing & Test Data

How we test the parts of YourPHR that meet real-world FHIR — the import engine, the Layer-1 classifiers, and the patient-legible display — and which test data to use for what. Living document; append as the strategy evolves.

See also: [`data-quality-framework.md`](./data-quality-framework.md) (the DQF this testing asserts against — our doctrine + per-source quality profiles), [`test-sandboxes.md`](./test-sandboxes.md) (sandbox accounts + status), and the project `CLAUDE.md` (only *synthetic* fixtures may be committed).

## The concern

Our automated coverage of **data we actually encounter** is thin: classifiers are tested mostly with small hand-written fixtures, plus a couple of Synthea bundles. The bugs we hit in practice are not caught by those.

Two parts to the gap:

1. **Breadth** — not enough realistic, varied data exercised.
2. **Assertions** — *having* more data (e.g. loading patients into a dev instance) only helps *manual* QA. Regression protection needs **golden tests**: a fixed input plus an expected output. More bundles without assertions don't move the needle.

## Two failure classes — cover both

- **US-Core conformance / happy path** — "do we display every compliant profile correctly + completely." Caught by clean, compliant data (Synthea, US-Core IG examples, Inferno).
- **Non-US-Core vendor quirks** — the *reason this fork exists*. Every real bug this project hit (Epic `class` = `HOV` rendered raw instead of the readable `type[].text` "Outpatient"; duplicate conditions; a Cerner export that is documents-only with no `Patient`/`Encounter`) is a **vendor non-conformance**, not a spec violation. Compliant data would pass all of them.

Implication: **clean sources give breadth; vendor exports give the messy reality.** For *this* app, the most "real life" data is the **vendor sandbox exports**, because that is the shape patients actually upload (Epic MyChart, Cerner, Veradigm, Blue Button) — not idealized US-Core.

## Test-data sources

| Source | Best for | Caveat | License |
|---|---|---|---|
| Hand-written per-classifier fixtures | targeted logic branches | tiny; not realistic | n/a (ours) |
| **Synthea / SyntheticMass** | volume + a complete happy-path patient | "too clean" — never reproduces vendor non-conformance | Apache-2.0 |
| **Vendor sandbox exports** (Epic Camila, Cerner nancysmart, …) | the non-US-Core quirks that bite us | sandbox ≠ production; narrow; provenance must be the *raw* vendor response | public synthetic |
| **VA Clinical Health** ([#370](https://github.com/jwilleke/yourphr/issues/370)) | another real-world US-Core-aligned vendor shape (VistA/Cerner); veterans mission | live OAuth API (not a ZIP) — fixtures require a SMART connect + export; onboarding cost | public synthetic |
| **US-Core IG examples** | canonical per-profile conformance ("every profile we display") | happy-path; a better fit than base-R4 fhir-test-cases for a US-Core PHR | HL7 (permissive — verify) |
| **Inferno US-Core test kit** | edge cases across US-Core 3.1.1 → 8.0+; what EHRs are certified against | data embedded in a server test kit → extraction effort | Apache-2.0 |
| **fhir-test-cases** ([#354](https://github.com/jwilleke/yourphr/issues/354)) | spec validity + intentionally-*invalid* R4 (import resilience) | base R4, not US-Core; modest ROI | Apache-2.0 |

All listed licenses are permissive — commit only **curated subsets** with a NOTICE/attribution, and never a real (non-synthetic) export.

## Can we trust the vendor sandbox slices?

Yes *for what they are*, no *if we overclaim them*.

**Trustworthy as:**

- **PHI-safe** — Epic/Cerner sandbox patients are public + synthetic (see [`test-sandboxes.md`](./test-sandboxes.md)).
- **Genuinely vendor-shaped** — e.g. the Camila Encounter carries Epic's own OID arc (`1.2.840.114350.*`) and an `open.epic.com/FHIR/StructureDefinition/...` extension. That is real Epic output; the `HOV` quirk is an authentic Epic convention, which is exactly why it is worth testing.

**Limits (do not overclaim):**

- **Sandbox ≠ production** — curated + limited; real prod data is messier and more varied.
- **Narrow** — one patient per vendor is a thin slice even of the sandbox.
- **Provenance is the real risk** — if a slice is something *we re-exported through our own app* rather than the **raw vendor FHIR response**, a golden built on it can be self-confirming (asserting our output against our own prior transformation).
- **Snapshot drift** — vendors can change sandbox data. Fine for a *frozen fixture*, but only if we record what it is.

**The reframe that resolves it:** a golden test's trust comes from **(1) a frozen, genuinely-real-shaped input + (2) a human-authored expected output** — not from the input being exhaustive. Camila does not have to represent all of Epic; she has to be *real Epic* (she is), and our expected "HOV → Outpatient" has to be *what we decided correct looks like* (reviewed by a human). That is a legitimate regression guard — as long as we never call it "Epic coverage."

## The golden-test harness

One **table-driven runner**: `bundle/resource → import → classify → display → assert`. Seed it in tiers:

- **Vendor depth (highest value):** Epic/Cerner slices — assert the legible output (HOV → "Outpatient", conditions dedup, docs-only empty state). This is the regression net for the patient-legible work ([#262](https://github.com/jwilleke/yourphr/issues/262)).
- **Conformance breadth:** curated US-Core IG examples — one per profile we display.
- **Full patient:** one Synthea patient, end-to-end.
- **Resilience:** Inferno validation-triggering + fhir-test-cases malformed → assert we skip-and-survive (never crash on bad input).

Adding a newly-found quirk later = drop a fixture + its expected output. That is the durable win.

## Guardrails

- **Commit only synthetic/public** slices into `backend/pkg/database/testdata/` (and `frontend/src/lib/fixtures/`). Real exports stay in gitignored `sample-data/`.
- **Verify raw-ness** — each committed vendor slice must be the *raw vendor FHIR response*, not an app re-export.
- **Provenance header per fixture** — source, patient id, sandbox base URL, export date, FHIR/US-Core version. Answers "what is this + can I re-derive it" in the file.
- **Human-authored expected outputs** — the assertions are our spec, not derived from the input.
- **Pair vendor with the US-Core-IG baseline** — so we can tell a *vendor quirk* from *spec*.

## Issue map

- [#354](https://github.com/jwilleke/yourphr/issues/354) — integrate **fhir-test-cases** (one source: spec validity + malformed corpus).
- [#369](https://github.com/jwilleke/yourphr/issues/369) — medical-history grouping endpoint / perf (the document-heavy fixture lives here).
- [#262](https://github.com/jwilleke/yourphr/issues/262) — patient-legible display (the vendor golden assertions guard this).
- [#131](https://github.com/jwilleke/yourphr/issues/131) — E2E; a non-US-Core (Epic-shaped) seed would exercise the legible path end-to-end.
- [#370](https://github.com/jwilleke/yourphr/issues/370) — add **VA Clinical Health** as a SMART provider (self-serve sandbox; yields a VA-shaped fixture as a bonus).
- *Proposed:* an umbrella issue — "realistic test-data corpus + golden harness" — relating the above, pulling US-Core-IG + Synthea + vendor slices + Inferno.

## Recommended first steps

1. **Verify provenance** of `sample-data/epic/…Camila….json` (raw vendor response vs our re-export); add a provenance header.
2. **Prototype the harness with one vendor fixture** — the Camila `HOV → "Outpatient"` assertion — to set the shape before scaling.
3. **Then** widen: US-Core-IG breadth, more sandbox patients, the resilience tier.
4. File the umbrella issue once the shape is proven.
