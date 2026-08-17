# Best practices for uncoded Questionnaires

*Guidance for implementing standard clinical assessments before official codes (e.g. LOINC) exist for them. See [#65](https://github.com/jwilleke/yourphr/issues/65).*

## The question

How do you handle a standard clinical assessment (a questionnaire / score) that needs to be implemented __before__ an official code can be minted for it?

## Guidance

__You do not need official codes to use a `Questionnaire`.__

- __Questions__ — assign a unique `linkId` to each question. `linkId` only has to be unique *within the scope of that questionnaire*, so it works immediately with no external code system.
- __Answer options__ — prefer a __local custom `CodeSystem`__ over raw `valueString` arrays. A local CodeSystem:
  - lets you attach __extensions__ to each option — e.g. `ordinalValue` (a decimal) so the answers can be __scored__;
  - lets you define __user-friendly display names__ separately from the code;
  - makes it straightforward to __migrate to an official standard code system later__ via a `ConceptMap`, without rewriting the stored responses.

Raw `valueString` answers, by contrast, can't carry an `ordinalValue` for scoring, conflate the display text with the value, and are painful to remap later.

## How this applies to YourPHR

YourPHR is a __viewer__ — it displays imported `Questionnaire` / `QuestionnaireResponse` resources, it does not author them. The relevant consequences:

- __Display from `linkId` + text, not from codes.__ Rendering must not assume a question or answer carries a standard code. Show the question/answer text (and `linkId` as a fallback), so an uncoded-but-valid questionnaire still renders — consistent with the project's detect-don't-require, no-guessing stance for non-US-Core data.
- __Local CodeSystems are first-class.__ When an answer option references a local/custom `CodeSystem`, display its `display` (falling back to `code`); do not treat a non-standard system as "unknown."
- __Scores via `ordinalValue`.__ If the future scoring/summary work needs to compute an assessment score, read the `ordinalValue` decimal extension on the answer options rather than parsing display text.

## References

- FHIR R4 [Questionnaire](https://hl7.org/fhir/r4/questionnaire.html) · [QuestionnaireResponse](https://hl7.org/fhir/r4/questionnaireresponse.html)
- FHIR [ordinalValue extension](https://hl7.org/fhir/extensions/StructureDefinition-ordinalValue.html)
- FHIR [ConceptMap](https://hl7.org/fhir/r4/conceptmap.html)
