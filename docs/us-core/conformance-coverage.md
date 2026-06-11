# US Core 9.0.0 — display-conformance coverage

> **What this is:** the client-appropriate conformance gate for epic [#136](https://github.com/jwilleke/yourphr/issues/136), tracked as [#248](https://github.com/jwilleke/yourphr/issues/248). It verifies that YourPHR's **display models surface the Must-Support (MS) elements** of the audited US Core 9.0.0 profiles, checked against the **official US Core 9.0.0 example resources** (not hand-made fixtures). It is **not** a server/API conformance claim — YourPHR is a display-only Requestor/Client, so Inferno's server suites are N/A (see closed [#161](https://github.com/jwilleke/yourphr/issues/161)).

**Method.** For each audited profile, the official US Core 9.0.0 example (pinned under `frontend/src/lib/fixtures/us-core/`) is parsed into its display model and every MS element it populates is checked. Must-Support means *"display the element when it is present"*, so an MS element the example does not populate is reported **N/A** (it can't be verified by that example), not a pass or fail. The MS lists come verbatim from the published US Core 9.0.0 `StructureDefinition` differentials (`element[].mustSupport === true`).

**Enforcement.** This table is generated from, and kept honest by, `frontend/src/lib/conformance/us-core-conformance.ts` + its spec (`us-core-conformance.spec.ts`), which runs in `make test-frontend` / CI. Each element carries a committed status (`displayed` / `gap`); the spec asserts the live display model matches it, so a regression (a `displayed` element stops surfacing) **or** a fix (a `gap` starts surfacing) fails the build until this doc + the registry are updated.

## Summary

Audited profiles: **6** (the Cures-Act USCDI core — Patient, Condition, AllergyIntolerance, MedicationRequest, Observation-Lab, DocumentReference).

| | Count |
|---|---|
| MS elements exercised by the official examples | **44** |
| …displayed by the model | **38** |
| …known gaps (not yet surfaced) | **6** |

Resource types that still render generically (Encounter, Immunization, Procedure, Care*, Device, Provider/Org, Coverage, Specimen, ServiceRequest, etc.) are **not** claimed here — no MS-display assertion is made for them.

## Per-profile coverage

Legend: ✅ displayed · ⚠️ gap (present in the example but not surfaced) · — N/A (element not populated by the example, so not verifiable from it).

### US Core Patient — `Patient-example` (audited #142)

| Must-Support element | In example | Displayed |
|---|---|---|
| identifier (system/value) | yes | ✅ |
| name (family/given) | yes | ✅ |
| telecom (system/value/use) | yes | ✅ |
| birthDate | yes | ✅ |
| address (line/city/state/postalCode) | yes | ✅ |
| communication.language | yes | ✅ |

Additional US Core elements surfaced (USCDI-supported; **not** MS-flagged in 9.0.0): race ✅, ethnicity ✅, individual sex ✅, tribal affiliation ✅, interpreter needed ✅.

### US Core Condition (Problems & Health Concerns) — `Condition-health-concern-example` (audited #143 / #246)

| Must-Support element | In example | Displayed |
|---|---|---|
| clinicalStatus | yes | ✅ |
| verificationStatus | yes | ✅ |
| category (incl. us-core slice) | yes | ✅ |
| code | yes | ✅ |
| subject | yes | ✅ |
| onset[x] | yes | ✅ |
| recordedDate | yes | ✅ |
| abatement[x] | no | — |
| meta.lastUpdated | yes | ⚠️ |
| extension:assertedDate | yes | ⚠️ |

### US Core AllergyIntolerance — `AllergyIntolerance-example` (audited #145)

| Must-Support element | In example | Displayed |
|---|---|---|
| clinicalStatus | yes | ✅ |
| verificationStatus | yes | ✅ |
| code | yes | ✅ |
| patient | yes | ✅ |
| reaction | yes | ✅ |
| reaction.manifestation | yes | ✅ |

### US Core MedicationRequest — `MedicationRequest-medicationrequest-coded-oral-axid` (audited #144)

| Must-Support element | In example | Displayed |
|---|---|---|
| status | yes | ✅ |
| intent | yes | ✅ |
| medication[x] | yes | ✅ |
| subject | yes | ✅ |
| authoredOn | yes | ✅ |
| requester | yes | ✅ |
| dosageInstruction.text | yes | ✅ |
| encounter | no | — |
| dispenseRequest | yes | ⚠️ |

### US Core Observation (Laboratory Result) — `Observation-cbc-hemoglobin` (audited #146)

| Must-Support element | In example | Displayed |
|---|---|---|
| category (us-core lab slice) | yes | ✅ |
| code | yes | ✅ |
| value[x] | yes | ✅ |
| interpretation | yes | ✅ |
| referenceRange | yes | ✅ |
| meta.lastUpdated | yes | ⚠️ |
| specimen | yes | ⚠️ |

### US Core DocumentReference — `DocumentReference-discharge-summary` (audited #147)

| Must-Support element | In example | Displayed |
|---|---|---|
| status | yes | ✅ |
| type | yes | ✅ |
| category | yes | ✅ |
| subject | yes | ✅ |
| content.attachment | yes | ✅ |
| content.attachment.contentType | yes | ✅ |
| content.attachment.data | yes | ✅ |
| identifier | no | — |
| date | no | — |
| author | no | — |
| content.attachment.url | no | — |
| content.format | no | — |
| context.period | no | — |
| context.encounter | yes | ⚠️ |

## Known gaps (follow-up work)

Six MS elements are exercised by the official examples but not yet surfaced. Each is small and additive:

1. **Condition.meta.lastUpdated** and **Observation.meta.lastUpdated** — the cards don't show the record's last-updated timestamp. (Same gap likely applies to other resource cards.)
2. **Condition.extension:assertedDate** — the asserted-date extension is only used as an onset fallback, not surfaced as its own field.
3. **MedicationRequest.dispenseRequest** — quantity / number-of-refills not surfaced by the model.
4. **Observation.specimen** — the specimen reference is not surfaced.
5. **DocumentReference.context.encounter** — the model's `context` carries event/facility/practiceSetting/period but omits the encounter reference.

These do not block the display-conformance statement (Must-Support is "display when present"; the gate makes the gaps explicit and CI-tracked). They are good first follow-ups against [#136](https://github.com/jwilleke/yourphr/issues/136).

## Regenerating

The MS lists are derived from the published US Core 9.0.0 package; the examples are pinned from it. See `frontend/src/lib/fixtures/us-core/README.md` for the `package.tgz` download + re-pin steps. To re-verify locally:

```bash
cd frontend && npx ng test --watch=false \
  --include='src/lib/conformance/us-core-conformance.spec.ts'
```
