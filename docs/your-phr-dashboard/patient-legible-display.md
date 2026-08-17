# Patient-legible display — the north star

> Mission: __Your medical records, immediately and in your hands — for free.__

"In your hands" means __a normal person can understand their own health information__ — not just that the data is technically present. This document is the design north star for every card, widget, and dashboard in YourPHR. If a display fails the test below, it is not done, no matter how faithfully it renders the FHIR.

## The problem we are fixing

Today the display is __FHIR-resource-faithful__: it renders every field of every FHIR resource type. So a patient sees a card titled "MedicationStatement," a row "Status: active," a "medicationReference," and "unknown" where the drug name belongs. That is the __data model talking, not a person.__ It surfaces *structure*, not *meaning*.

It is the medical version of getting your results by phone in a parking lot — "it's your such-and-such tendon" — jargon, no context, nothing you can act on or even write down. YourPHR exists to be the __opposite__ of that call.

## The five principles

1. __Meaning first, metadata last.__ Lead with the thing's plain-language name and *what it is / why it matters*. Demote or hide the resource type, status, IDs, references, and other scaffolding. A card must never show "unknown" or a bare FHIR resource-type name as its title.
2. __Translate every code.__ No raw codes in front of a patient. `C38288` → "taken by mouth"; a LOINC lab code → the test's plain name. Use the `glossary-lookup` component; it is underused.
3. __Tell the person what it means for them.__ For a lab result, say whether the value is __normal / high / low__ against its reference range — not just the number. For a medication, say what it is *for* and *how to take it*.
4. __Organize by the patient's mental model.__ Group as "My medications / My conditions / My recent results" — the questions a person actually has — not by FHIR resource type.
5. __Plain language, always.__ Write for someone with no medical training, walking through a parking lot. Short sentences. Define the term the first time it appears.

## The litmus test

Every card / widget must pass __all__ of these before it ships:

- [ ] __Title says what it IS__ in plain words — never the FHIR resource type, never "unknown."
- [ ] A one-line __"what it is / why it matters"__ a non-clinician understands.
- [ ] __Every code is translated__ to words, with an explanation available on demand.
- [ ] For results: __says normal / high / low__, not just a raw value.
- [ ] The technical/structured detail is __available but secondary__ (lower on the card, or behind "details").
- [ ] __The "would my mom understand this?" test__ — would a person with no medical training get it at a glance?

## Before / after

A real CCD-converted medication (see `sample-data/sample-data-failure-examples.md`):

- __Before (FHIR-faithful):__ title `unknown`, badge `active`, rows `Medication`(blank), `Status: active`, `Patient`(blank). No dosage. No route.
- __After (patient-legible):__
  > __Lisinopril__ — a blood-pressure medicine.
  > Take 1 tablet by mouth, once a day. Started Aug 2013.
  > *(full record under "details")*

## What this does NOT mean

Completeness is also the mission — "complete records." We do __not__ delete the technical view. The move is to put a __plain-language layer on top__ and keep the full structured record one click away under "details." Both/and: legible by default, complete on demand.

## Relationship to existing work

- Tracked as epic [#262](https://github.com/jwilleke/yourphr/issues/262).
- This is the explicit north star for #136 (US Core display), #244 (per-profile dashboards), and #249 (Must-Support gaps) — those carry the work; this judges it.
- The `glossary-lookup` component is the code-translation lever (principle 2).
- Complements the "derive only from explicit record-stated signals; absent = unknown" rule — *legible* ≠ *invented*. We never fabricate meaning; we translate and organize what the record actually states.
