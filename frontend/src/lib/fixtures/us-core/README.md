# US Core official example fixtures

Official **US Core 9.0.0** example resources, pinned verbatim from the published HL7 FHIR package and used as the **display-conformance** gate for [#248](https://github.com/jwilleke/yourphr/issues/248) (the client-appropriate verification workstream of epic [#136](https://github.com/jwilleke/yourphr/issues/136)).

These are the *authoritative* IG examples — the same conformant data Inferno would feed a server — not hand-made fixtures. Each carries a `meta.profile` declaring its US Core profile (with the `|9.0.0` version suffix, exactly as real conformant exports do).

## Why these are separate from the Synthea fixtures

The fixtures under `frontend/src/lib/fixtures/r4/resources/` are synthetic Synthea-style data used for model-parsing unit tests. The files here are different: they are the **published US Core IG examples**, kept unmodified so the conformance harness verifies our display models against the spec's own data. Do not edit them — re-pin from the package instead (below).

## Provenance / licence

- Package: `hl7.fhir.us.core` **9.0.0** (canonical `http://hl7.org/fhir/us/core`, published 2026-05-31).
- Source tarball: <https://hl7.org/fhir/us/core/STU9/package.tgz> (`package/example/*.json`).
- HL7 publishes these examples as part of the IG; they are synthetic (no PHI) and safe to commit.

## Pinned examples

| Resource | Profile | File |
|---|---|---|
| Patient | us-core-patient | `9.0.0/patient/Patient-example.json` |
| Condition | us-core-condition-problems-health-concerns | `9.0.0/condition/Condition-health-concern-example.json` |
| AllergyIntolerance | us-core-allergyintolerance | `9.0.0/allergy-intolerance/AllergyIntolerance-example.json` |
| MedicationRequest | us-core-medicationrequest | `9.0.0/medication-request/MedicationRequest-medicationrequest-coded-oral-axid.json` |
| Observation (Lab) | us-core-observation-lab | `9.0.0/observation/Observation-cbc-hemoglobin.json` |
| DocumentReference | us-core-documentreference | `9.0.0/document-reference/DocumentReference-discharge-summary.json` |

## Re-pinning (when the target US Core version changes)

```bash
curl -sL https://hl7.org/fhir/us/core/STU9/package.tgz -o /tmp/uscore.tgz
mkdir -p /tmp/uscore && tar xzf /tmp/uscore.tgz -C /tmp/uscore
# copy the example you want, e.g.:
cp /tmp/uscore/package/example/Patient-example.json \
   frontend/src/lib/fixtures/us-core/9.0.0/patient/
```

The Must-Support element list for each profile is derived from the package's `StructureDefinition-*.json` (`differential.element[].mustSupport === true`) — see `frontend/src/lib/conformance/us-core-conformance.ts` and `docs/us-core/conformance-coverage.md`.
