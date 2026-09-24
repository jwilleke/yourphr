/**
 * A medication the PATIENT says they take, as a MedicationStatement (yourphr#763).
 *
 * MedicationStatement is the right resource for exactly this: what someone says is being taken, as
 * distinct from a MedicationRequest, which is a prescriber's order. `subject` is the person and
 * `informationSource` is the person, which is FHIR's own way of recording who the claim came from.
 *
 * Two decisions worth naming:
 *
 *   - __`status` is required by FHIR R4, and the person may not have said.__ The answer is
 *     `unknown`, which is a value in FHIR's own status list and means precisely "not stated" — not
 *     `active`, which would assert they are taking it today. Where they did say, that is what is
 *     stored, and where they did not, the record waits for them.
 *   - __No dose, no route, no frequency, and no coding.__ The form does not ask, and matching a
 *     medicine name to RxNorm is out of scope on #763. The name is kept as written.
 */
import type { MedicationStatement } from '@medplum/fhirtypes';
import { type BuiltRecord, type PatientEntryContext, type PatientEntryRequest, PatientEntryError, effectiveDateTime, stamp, statedName } from './shared.js';

/** What the form's three answers mean in FHIR. Anything else is treated as not stated. */
const STATED_STATUS: Record<string, 'active' | 'stopped'> = {
  active: 'active',
  taking: 'active',
  stopped: 'stopped',
  'not-taking': 'stopped',
};

export function buildPatientMedication(req: PatientEntryRequest, now = new Date(), context: PatientEntryContext = { subject: '' }): BuiltRecord {
  const medicine = statedName(req);
  if (medicine === '') throw new PatientEntryError('there is nothing to record: name the medication');

  const review: string[] = [
    `"${medicine}" is stored exactly as you wrote it — nothing has matched it to a known medication yet`,
  ];

  const stated = STATED_STATUS[(req.status ?? '').trim().toLowerCase()];
  if (!stated) review.push('you did not say whether you are still taking this');

  const statement: MedicationStatement = {
    resourceType: 'MedicationStatement',
    // `unknown` is FHIR's value for a status nobody stated. It is not a claim that they take it.
    status: stated ?? 'unknown',
    medicationCodeableConcept: { text: medicine },
  } as MedicationStatement;
  if (context.subject !== '') {
    statement.subject = { reference: context.subject };
    statement.informationSource = { reference: context.subject };
  }

  const asserted = effectiveDateTime(req.effective_date_time, now, review);
  if (asserted !== '') statement.dateAsserted = asserted;

  stamp(statement, review);
  return { resource: statement, sortTitle: medicine, review };
}
