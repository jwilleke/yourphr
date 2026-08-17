# US Core support

> __Status (2026-06-11):__ The six Cures-Act USCDI __core__ profiles are audited for __Must-Support *display*__ vs US Core 9.0.0 — Patient ([#142](https://github.com/jwilleke/yourphr/issues/142)), AllergyIntolerance ([#145](https://github.com/jwilleke/yourphr/issues/145)), Condition ([#143](https://github.com/jwilleke/yourphr/issues/143)), MedicationRequest ([#144](https://github.com/jwilleke/yourphr/issues/144)), DocumentReference ([#147](https://github.com/jwilleke/yourphr/issues/147)), and Observation (labs + vital signs incl. multi-component blood pressure, [#146](https://github.com/jwilleke/yourphr/issues/146)) — and that audit is now __verified against the official US Core 9.0.0 example resources__ by a CI-enforced display-conformance gate ([#248](https://github.com/jwilleke/yourphr/issues/248)): __38 of 44__ exercised Must-Support elements display, with __6 tracked gaps__. See __[conformance-coverage.md](conformance-coverage.md)__.
>
> __Most other resource types still render as generic FHIR R4__ and ~24 Observation sub-profiles classify but render generically. (The previously-missing required resources Provenance [#162](https://github.com/jwilleke/yourphr/issues/162) and QuestionnaireResponse [#160](https://github.com/jwilleke/yourphr/issues/160) now have display models.)
>
> This is a __display-conformance claim for the six audited profiles, not a server/API conformance claim__: YourPHR is a display-only Requestor/Client, so the ONC __Inferno__ US Core *server* suites are N/A (see closed [#161](https://github.com/jwilleke/yourphr/issues/161)). The client-appropriate gate is whether we surface Must-Support elements of conformant input — which the [#248](https://github.com/jwilleke/yourphr/issues/248) harness now checks against the IG's own examples. The rest is tracked in epic [#136](https://github.com/jwilleke/yourphr/issues/136).
>
> Path note: this lives at `docs/us-core/` (no space) for link/tooling friendliness.

## What this is

How YourPHR relates to the [FHIR __US Core__ Implementation Guide](https://hl7.org/fhir/us/core/). Honest baseline + roadmap — not a conformance claim.

## Role and target

- __Actor:__ YourPHR is a US Core __Requestor / Client__ — it imports FHIR bundles and fetches data via the SMART relay, then displays it. It is __not__ a Responder/Server (it doesn't serve a FHIR API). So only the *Requestor* actor applies.
- __Target version:__ __US Core 9.0.0 (STU 9)__ (published 2026-05-31), FHIR R4 — the latest published release.
- __Client conformance bar:__ be able to __process and display the Must-Support data elements__ of US Core profiles. (We don't need to *produce* conformant resources.)

## Support matrix (current)

"Display model" = a frontend view-model renders the resource. "US Core handling" = profile-specific Must-Support / extension awareness (vs. generic FHIR display).

| USCDI data class | US Core profile(s) | Resource(s) | Display model | US Core handling |
|---|---|---|---|---|
| Patient demographics | US Core Patient | Patient | ✅ | ✅ audited vs 9.0.0 (#142): core MS + all extension slices — race / ethnicity / birthsex / __sex (individual-sex)__ / __tribal-affiliation__ / __interpreter-needed__ (no gender-identity slice in 9.0.0) |
| Problems / health concerns | Condition (Problems), Condition (Encounter Dx) | Condition | ✅ | ✅ audited vs 9.0.0 (#143): MS clinicalStatus / verificationStatus / __category (problem-list-item vs health-concern)__ / code / subject / onset / abatement / recordedDate |
| Allergies | AllergyIntolerance | AllergyIntolerance | ✅ | ✅ audited vs 9.0.0 (#145): MS code / clinicalStatus / verificationStatus / patient + reaction.manifestation; plus criticality & reaction.severity |
| Medications | MedicationRequest, Medication, MedicationDispense | MedicationRequest, Medication, MedicationDispense | ✅ | ✅ MedicationRequest audited vs 9.0.0 (#144): MS status / intent / medication[x] (CodeableConcept + Reference) / subject / encounter / reported[x] / authoredOn / requester / dosageInstruction.text / category |
| Lab results | Observation (Lab Result), DiagnosticReport (Lab) | Observation, DiagnosticReport | ✅ | ✅ Observation classified by `meta.profile` + category/LOINC fallback (#146); registry covers all ~28 Observation sub-profiles. Labs: value + reference range |
| Vital signs | Vital Signs + the per-vital profiles (BP, height, weight, temp, HR, RR, SpO₂, …) | Observation | ✅ | ✅ classified (#146); __multi-component BP__ (systolic/diastolic) now rendered + `value[x]` extended. Per-vital dashboard widgets deferred |
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
| Provenance | US Core Provenance | Provenance | ✅ | ✅ display model added (#162): MS target[] / recorded / agent[] (type, who, onBehalfOf) — author/transmitter; resolves agent + target references |
| Questionnaire responses | QuestionnaireResponse | QuestionnaireResponse | ✅ | ✅ display model added (#160): MS questionnaire / status / subject / authored / author + recursive item/answer tree (item.text + answer value[x]) |

Backend coverage is broad — ~56 generated FHIR R4 resource models with search-parameter extraction handle storage/indexing for essentially all of these. A code→display __glossary__ renders coded values (LOINC / SNOMED / RxNorm).

## Known gaps (the work in [#136](https://github.com/jwilleke/yourphr/issues/136))

1. __No profile-level Must-Support audit__ — we render generic FHIR R4, not per US Core 9.0.0 profile.
2. __Observation isn't split__ into US Core's ~15 sub-profiles (vitals, labs, smoking, sexual orientation, occupation, screening, …).
3. __Missing resources:__ none outstanding — Provenance ([#162](https://github.com/jwilleke/yourphr/issues/162)) and QuestionnaireResponse ([#160](https://github.com/jwilleke/yourphr/issues/160)) display models are done.
4. __Extensions beyond Patient__ aren't handled.
5. __Conformance verification — done for the six audited profiles__ ([#248](https://github.com/jwilleke/yourphr/issues/248)): their Must-Support display is checked against the official US Core 9.0.0 example resources by a CI-enforced gate (see [conformance-coverage.md](conformance-coverage.md)). Not yet extended to the generically-rendered resource types. (Inferno's *server* suites remain N/A — closed [#161](https://github.com/jwilleke/yourphr/issues/161).)

## Roadmap

Tracked in epic [#136](https://github.com/jwilleke/yourphr/issues/136): pick the target version (done — 9.0.0), audit + complete Must-Support display per profile (prioritizing the Cures-Act USCDI core: problems, medications, allergies, labs+vitals, clinical notes), add the missing resources, then verify with Inferno. Complement: [#54](https://github.com/jwilleke/yourphr/issues/54) handles *non*-US-Core (non-conformant) data display.

## Per-profile dashboards

Goal: YourPHR should ship a pre-built dashboard widget for each US Core profile (the profiles enumerated as sections 1.5.1–1.5.17 in the [US Core 9.0.0 ToC](https://hl7.org/fhir/us/core/STU9/)), so a patient lands on a familiar, purpose-built view per data category (problems, medications, allergies, labs, vitals, clinical notes, …) instead of a generic resource table. Each widget renders that profile's Must-Support elements and degrades gracefully for non-conformant data (see [#54](https://github.com/jwilleke/yourphr/issues/54)). This is the display end-state of the [#136](https://github.com/jwilleke/yourphr/issues/136) audit: as each profile's Must-Support display is completed, its dashboard widget is what surfaces it.
