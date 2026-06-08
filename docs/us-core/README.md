# US Core support

> **Status (2026-06-07):** YourPHR **displays essentially all US Core resource types** as generic FHIR R4, and handles the Patient US Core extensions — but it is **not yet verified-conformant** to any US Core version's Must-Support requirements. Closing that gap is tracked in the epic [#136](https://github.com/jwilleke/yourphr/issues/136).
>
> Path note: this lives at `docs/us-core/` (no space) for link/tooling friendliness.

## What this is

How YourPHR relates to the [FHIR **US Core** Implementation Guide](https://hl7.org/fhir/us/core/). Honest baseline + roadmap — not a conformance claim.

## Role and target

- **Actor:** YourPHR is a US Core **Requestor / Client** — it imports FHIR bundles and fetches data via the SMART relay, then displays it. It is **not** a Responder/Server (it doesn't serve a FHIR API). So only the *Requestor* actor applies.
- **Target version:** **US Core 9.0.0 (STU 9)** (published 2026-05-31), FHIR R4 — the latest published release.
- **Client conformance bar:** be able to **process and display the Must-Support data elements** of US Core profiles. (We don't need to *produce* conformant resources.)

## Support matrix (current)

"Display model" = a frontend view-model renders the resource. "US Core handling" = profile-specific Must-Support / extension awareness (vs. generic FHIR display).

| USCDI data class | US Core profile(s) | Resource(s) | Display model | US Core handling |
|---|---|---|---|---|
| Patient demographics | US Core Patient | Patient | ✅ | ✅ audited vs 9.0.0 (#142): core MS + all extension slices — race / ethnicity / birthsex / **sex (individual-sex)** / **tribal-affiliation** / **interpreter-needed** (no gender-identity slice in 9.0.0) |
| Problems / health concerns | Condition (Problems), Condition (Encounter Dx) | Condition | ✅ | ✅ audited vs 9.0.0 (#143): MS clinicalStatus / verificationStatus / **category (problem-list-item vs health-concern)** / code / subject / onset / abatement / recordedDate |
| Allergies | AllergyIntolerance | AllergyIntolerance | ✅ | ✅ audited vs 9.0.0 (#145): MS code / clinicalStatus / verificationStatus / patient + reaction.manifestation; plus criticality & reaction.severity |
| Medications | MedicationRequest, Medication, MedicationDispense | MedicationRequest, Medication, MedicationDispense | ✅ | ✅ MedicationRequest audited vs 9.0.0 (#144): MS status / intent / medication[x] (CodeableConcept + Reference) / subject / encounter / reported[x] / authoredOn / requester / dosageInstruction.text / category |
| Lab results | Observation (Lab Result), DiagnosticReport (Lab) | Observation, DiagnosticReport | ✅ | ✅ Observation classified by `meta.profile` + category/LOINC fallback (#146); registry covers all ~28 Observation sub-profiles. Labs: value + reference range |
| Vital signs | Vital Signs + the per-vital profiles (BP, height, weight, temp, HR, RR, SpO₂, …) | Observation | ✅ | ✅ classified (#146); **multi-component BP** (systolic/diastolic) now rendered + `value[x]` extended. Per-vital dashboard widgets deferred |
| Smoking status | Smoking Status Observation | Observation | ✅ | ⚠️ classified as social-history (#146); generic value render — dedicated view deferred |
| Immunizations | Immunization | Immunization | ✅ | generic |
| Procedures | Procedure | Procedure | ✅ | generic |
| Clinical notes | DocumentReference, DiagnosticReport (Note) | DocumentReference, DiagnosticReport | ✅ | ✅ DocumentReference audited vs 9.0.0 (#147): MS status / type / category / subject / date / author / content.attachment (contentType, data/url — rendered & downloadable) / content.format / context |
| Encounters | Encounter | Encounter | ✅ | generic |
| Care plan / team / goals | CarePlan, CareTeam, Goal | CarePlan, CareTeam, Goal | ✅ | generic |
| Implantable device | Device | Device | ✅ | generic |
| Care providers / orgs | Practitioner, PractitionerRole, Organization, Location | Practitioner, PractitionerRole, Organization, Location | ✅ | partial (practitionerrole ext) |
| Related person | RelatedPerson | RelatedPerson | ✅ | generic |
| Coverage / specimen / service request | Coverage, Specimen, ServiceRequest | Coverage, Specimen, ServiceRequest | ✅ | generic |
| **Provenance** | US Core Provenance | Provenance | ❌ **none** | ❌ required by US Core; missing |
| **Questionnaire responses** | QuestionnaireResponse | QuestionnaireResponse | ❌ **none** | ❌ (lforms renders questionnaires, but no QR display model) |

Backend coverage is broad — ~56 generated FHIR R4 resource models with search-parameter extraction handle storage/indexing for essentially all of these. A code→display **glossary** renders coded values (LOINC / SNOMED / RxNorm).

## Known gaps (the work in [#136](https://github.com/jwilleke/yourphr/issues/136))

1. **No profile-level Must-Support audit** — we render generic FHIR R4, not per US Core 9.0.0 profile.
2. **Observation isn't split** into US Core's ~15 sub-profiles (vitals, labs, smoking, sexual orientation, occupation, screening, …).
3. **Missing resources:** Provenance (US-Core-required) and QuestionnaireResponse have no display models.
4. **Extensions beyond Patient** aren't handled.
5. **No conformance verification** — nothing checked against US Core 9.0.0 examples or the ONC **Inferno** test kit.

## Roadmap

Tracked in epic [#136](https://github.com/jwilleke/yourphr/issues/136): pick the target version (done — 9.0.0), audit + complete Must-Support display per profile (prioritizing the Cures-Act USCDI core: problems, medications, allergies, labs+vitals, clinical notes), add the missing resources, then verify with Inferno. Complement: [#54](https://github.com/jwilleke/yourphr/issues/54) handles *non*-US-Core (non-conformant) data display.

## Per-profile dashboards

Goal: YourPHR should ship a pre-built dashboard widget for each US Core profile (the profiles enumerated as sections 1.5.1–1.5.17 in the [US Core 9.0.0 ToC](https://hl7.org/fhir/us/core/STU9/)), so a patient lands on a familiar, purpose-built view per data category (problems, medications, allergies, labs, vitals, clinical notes, …) instead of a generic resource table. Each widget renders that profile's Must-Support elements and degrades gracefully for non-conformant data (see [#54](https://github.com/jwilleke/yourphr/issues/54)). This is the display end-state of the [#136](https://github.com/jwilleke/yourphr/issues/136) audit: as each profile's Must-Support display is completed, its dashboard widget is what surfaces it.
