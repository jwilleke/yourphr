/**
 * An allergy the PATIENT states, as an AllergyIntolerance (yourphr#763).
 *
 * Until now this arrived as an Observation carrying the word "allergy" — the fact was kept, in the
 * wrong kind of record. The PGHD patterns are explicit: a patient-reported allergy is an
 * AllergyIntolerance whose `patient` is the person and whose `asserter` is the person, which is how
 * FHIR says "they told us this" without a flag invented for the purpose.
 *
 * What it does NOT do, on purpose:
 *
 *   - __No criticality, no severity, no reaction.__ The form does not ask, so the record does not
 *     say. "high" or "mild" on a record nobody asked about is a clinical claim, and a wrong one is
 *     worse than an absent one.
 *   - __No verificationStatus.__ `unconfirmed` reads as a clinician's judgement about the claim.
 *     Whether a patient-stated allergy has been verified is not something this instance knows.
 *   - __No substance coding.__ Matching "penicillin" to RxNorm or SNOMED is a terminology job this
 *     release does not do (explicitly out of scope on #763), so the substance is kept as written and
 *     the record waits for the person rather than pretending to be coded.
 */
import type { AllergyIntolerance } from '@medplum/fhirtypes';
import { type BuiltRecord, type PatientEntryContext, type PatientEntryRequest, PatientEntryError, effectiveDateTime, stamp, statedName } from './shared.js';

export function buildPatientAllergy(req: PatientEntryRequest, now = new Date(), context: PatientEntryContext = { subject: '' }): BuiltRecord {
  const substance = statedName(req);
  if (substance === '') throw new PatientEntryError('there is nothing to record: name what you are allergic to');

  const review: string[] = [
    // Every patient-entered allergy waits, for now: an uncoded substance is not something the chart
    // can reason about, and the person confirming it is the only thing that makes it a chart fact.
    `"${substance}" is stored exactly as you wrote it — nothing has matched it to a known substance yet`,
  ];

  const allergy: AllergyIntolerance = {
    resourceType: 'AllergyIntolerance',
    code: { text: substance }, // their words, uncoded: what a CodeableConcept is for
  } as AllergyIntolerance;
  if (context.subject !== '') {
    // Who it is about and who says so — the PGHD pattern states both in the resource.
    allergy.patient = { reference: context.subject };
    allergy.asserter = { reference: context.subject };
  }

  const recorded = effectiveDateTime(req.effective_date_time, now, review);
  if (recorded !== '') allergy.recordedDate = recorded;

  stamp(allergy, review);
  return { resource: allergy, sortTitle: `Allergy to ${substance}`, review };
}
