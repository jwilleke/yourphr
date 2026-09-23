/**
 * A vital the PATIENT measured at home, turned into an Observation (yourphr#696; the product's #313).
 *
 * "Add record" is a primary call to action in three places in the app, and its form posted to a
 * route this stack never had — so the form filled in, submitted, and 404'd. This is the half that
 * was missing, ported decision-for-decision from Go's `patient_entry.go` at v2.10.3 so that a
 * record entered on v2 and one entered here are the same record: same LOINC codes, same UCUM units,
 * same category, same shape.
 *
 * Two properties it must keep:
 *
 *   - __It is patient-reported, and says so.__ `meta.tag` carries `patient-reported` and
 *     `meta.source` the patient-UI marker, exactly as Go wrote them. A hand-typed blood pressure
 *     must never be mistaken for one a hospital asserted — the manager files it under the person's
 *     own `manual` source for the same reason.
 *   - __It states only what the person entered, and it never loses what they said.__ A vital this
 *     module cannot code is stored with their words as `code.text` and NO coding, which is what a
 *     CodeableConcept is for; an incomplete reading keeps the half that was measured. Such a record
 *     carries `needs-review` and is held out of the chart until a person resolves it — kept as a
 *     fact, not counted as a chart fact. Nothing missing is ever invented: no unit conversion, no
 *     guessed code, no date supplied for one that could not be read.
 */
import { randomUUID } from 'node:crypto';
import type { Observation } from '@medplum/fhirtypes';

/** What the Add-record form posts. Field names are the frontend's, which were Go's. */
export interface PatientEntryRequest {
  /** `vital` today. Other kinds map to other resource types and are their own work. */
  kind?: string;
  vital?: string;
  value?: number;
  systolic?: number;
  diastolic?: number;
  unit?: string;
  effective_date_time?: string;
}

/** Thrown only when there is no fact to keep at all — an empty submission. */
export class PatientEntryError extends Error {}

/** Who the record is about and who measured it (the PGHD pattern, yourphr#696). */
export interface PatientEntryContext {
  /** `Patient/<id>` — the account's own Patient, in its `manual` source. */
  subject: string;
}

const LOINC = 'http://loinc.org';
const UCUM = 'http://unitsofmeasure.org';
const OBSERVATION_CATEGORY = 'http://terminology.hl7.org/CodeSystem/observation-category';

/** Units kept coded whatever the person types, so the value stays comparable with a provider's. */
const CANONICAL_UNITS: Record<string, string> = { heart_rate: '/min', pulse: '/min', oxygen_saturation: '%', spo2: '%' };

/** meta.source for a record this instance's own UI wrote, as Go marked it. */
export const PATIENT_ENTRY_SOURCE = 'yourphr://patient-ui';

/** This instance's code system for how a record came to exist. */
export const RECORD_ORIGIN = 'https://yourphr.org/fhir/CodeSystem/record-origin';

/**
 * A record kept because the person stated it, and held back from the chart until a human confirms
 * it (yourphr#696). The PGHD rule: what they said is a fact and is never discarded, but an
 * incomplete or uncoded row must not count as a chart fact — so it carries this tag, and the read
 * paths that speak for the record (lists, counts, search, the IPS summary) leave it out until the
 * person resolves it. Nothing here is ever auto-resolved, and nothing missing is invented.
 */
export const NEEDS_REVIEW = 'needs-review';

interface VitalSpec {
  /** LOINC code and display, as Go used them. */
  code: string;
  display: string;
  /** The unit used when the person does not name one. */
  defaultUnit: string;
  /** A blood pressure carries two components rather than one value. */
  paired?: boolean;
  /**
   * `vital-signs` for the US Core vital signs; `laboratory` for a measurement that is a lab result
   * wherever it was taken — a finger-stick glucose is a lab value, not a vital sign.
   */
  category?: 'vital-signs' | 'laboratory';
  /**
   * A measurement whose LOINC code depends on the unit the person used, because the unit says which
   * quantity was measured. Never a guess: an unrecognised unit leaves the reading uncoded.
   */
  byUnit?: Record<string, { code: string; display: string }>;
}

/** The five the form offers. Aliases are Go's, kept so a v2-era client still works. */
const VITALS: Record<string, VitalSpec> = {
  body_weight: { code: '29463-7', display: 'Body weight', defaultUnit: 'kg' },
  weight: { code: '29463-7', display: 'Body weight', defaultUnit: 'kg' },
  heart_rate: { code: '8867-4', display: 'Heart rate', defaultUnit: '/min' },
  pulse: { code: '8867-4', display: 'Heart rate', defaultUnit: '/min' },
  body_temperature: { code: '8310-5', display: 'Body temperature', defaultUnit: 'Cel' },
  temperature: { code: '8310-5', display: 'Body temperature', defaultUnit: 'Cel' },
  oxygen_saturation: { code: '2708-6', display: 'Oxygen saturation in Arterial blood', defaultUnit: '%' },
  spo2: { code: '2708-6', display: 'Oxygen saturation in Arterial blood', defaultUnit: '%' },
  blood_pressure: { code: '85354-9', display: 'Blood pressure panel with all children optional', defaultUnit: 'mm[Hg]', paired: true },
  bp: { code: '85354-9', display: 'Blood pressure panel with all children optional', defaultUnit: 'mm[Hg]', paired: true },
  // A home glucose reading. The UNIT decides the code, because the unit says which quantity was
  // measured: mass/volume from a meter is 41653-7, moles/volume is 14743-9. A unit neither of those
  // recognises is recorded as stated and left uncoded for review — a serum draw (2345-7) or whole
  // blood (2339-0) is a different specimen, and the form does not ask which, so it is not assumed.
  blood_sugar: {
    code: '41653-7', display: 'Glucose [Mass/volume] in Capillary blood by Glucometer', defaultUnit: 'mg/dL', category: 'laboratory',
    byUnit: {
      'mg/dl': { code: '41653-7', display: 'Glucose [Mass/volume] in Capillary blood by Glucometer' },
      'mmol/l': { code: '14743-9', display: 'Glucose [Moles/volume] in Capillary blood by Glucometer' },
    },
  },
  glucose: {
    code: '41653-7', display: 'Glucose [Mass/volume] in Capillary blood by Glucometer', defaultUnit: 'mg/dL', category: 'laboratory',
    byUnit: {
      'mg/dl': { code: '41653-7', display: 'Glucose [Mass/volume] in Capillary blood by Glucometer' },
      'mmol/l': { code: '14743-9', display: 'Glucose [Moles/volume] in Capillary blood by Glucometer' },
    },
  },
};

const codeable = (code: string, display: string) => ({ coding: [{ system: LOINC, code, display }], text: display });
const quantity = (value: number, unit: string, code = unit) => ({ value, unit, system: UCUM, code });

/** Go's `%g`: 70 prints as "70", 70.5 as "70.5" — never "70.000000". */
const number = (n: number): string => String(n);

/** What was stored, and whether a person still has to look at it. */
export interface BuiltEntry {
  observation: Observation;
  sortTitle: string;
  /** Why it needs review, in the person's terms. Empty when nothing is outstanding. */
  review: string[];
}

/**
 * The Observation to store, the title a list shows, and whatever still needs a human.
 *
 * Nothing the person said is discarded and nothing they did not say is invented. A vital this
 * module cannot code keeps their words as `code.text` with no coding; an incomplete reading keeps
 * the half that was measured; a date that cannot be read is left absent with their text kept. Each
 * of those marks the record `needs-review`, which holds it out of the chart until they resolve it.
 *
 * Throws only when there is no fact at all to keep.
 */
export function buildPatientVital(req: PatientEntryRequest, now = new Date(), context: PatientEntryContext = { subject: '' }): BuiltEntry {
  const kind = (req.kind ?? 'vital').trim().toLowerCase() || 'vital';
  const name = (req.vital ?? '').trim();
  const lower = name.toLowerCase();
  const review: string[] = [];

  const hasValue = typeof req.value === 'number' || typeof req.systolic === 'number' || typeof req.diastolic === 'number';
  if (name === '' && !hasValue) throw new PatientEntryError('there is nothing to record: name what was measured, and what it read');
  if (kind !== 'vital') {
    // An allergy is an AllergyIntolerance, a medication a MedicationStatement — their own resource
    // types, not an Observation wearing a label (yourphr#696). Until those paths exist, what the
    // person said is kept and flagged rather than forced into the wrong shape or thrown away.
    review.push(`recorded as a measurement because this release cannot yet store a "${kind}" — an allergy or medication belongs in its own kind of record`);
  }

  const spec = VITALS[lower];
  const { observation, title } = spec
    ? codedObservation(spec, lower, req, review)
    : uncodedObservation(name, review);

  observation.id = randomUUID();
  observation.status = 'final';
  observation.meta = {
    source: PATIENT_ENTRY_SOURCE,
    tag: [{ system: RECORD_ORIGIN, code: 'patient-reported', display: 'Patient-reported (YourPHR)' }],
  };
  if (context.subject !== '') {
    // Who it is about, and who measured it: the PGHD pattern states both in the resource.
    observation.subject = { reference: context.subject };
    observation.performer = [{ reference: context.subject }];
  }

  const effective = effectiveDateTime(req.effective_date_time, now, review);
  if (effective !== '') observation.effectiveDateTime = effective;

  if (review.length) {
    observation.meta.tag = [...(observation.meta.tag ?? []), { system: RECORD_ORIGIN, code: NEEDS_REVIEW, display: 'Needs review' }];
    // Why it is waiting, kept ON the record in the words the person was shown (yourphr#762). The
    // queue is then a read over the records themselves — no second store to fall out of step with
    // them, and a record that travels keeps its own explanation.
    observation.note = [...(observation.note ?? []), ...review.map((text) => ({ text }))];
  }
  return { observation, sortTitle: title, review };
}

/** A vital this module knows: the LOINC code, the category, and the value as measured. */
function codedObservation(spec: VitalSpec, lower: string, req: PatientEntryRequest, review: string[]): { observation: Observation; title: string } {
  const unit = (req.unit ?? '').trim() || spec.defaultUnit;
  const chosen = spec.byUnit ? spec.byUnit[unit.toLowerCase()] : undefined;
  if (spec.byUnit && !chosen) {
    // The unit is what says which quantity was measured. An unrecognised one is recorded as stated
    // and left for a person — guessing between mass/volume and moles/volume would be a clinical
    // claim nobody made.
    review.push(`the unit "${unit}" was not recognised, so the reading is stored without a code`);
  }
  const code = chosen ?? (spec.byUnit ? undefined : { code: spec.code, display: spec.display });
  const observation: Observation = {
    resourceType: 'Observation',
    category: [{ coding: [{ system: OBSERVATION_CATEGORY, code: spec.category ?? 'vital-signs', display: spec.category === 'laboratory' ? 'Laboratory' : 'Vital Signs' }] }],
    code: code ? codeable(code.code, code.display) : { text: lower.replace(/_/g, ' ') },
  } as Observation;

  if (spec.paired) {
    const components = [];
    if (typeof req.systolic === 'number') components.push({ code: codeable('8480-6', 'Systolic blood pressure'), valueQuantity: quantity(req.systolic, 'mm[Hg]') });
    if (typeof req.diastolic === 'number') components.push({ code: codeable('8462-4', 'Diastolic blood pressure'), valueQuantity: quantity(req.diastolic, 'mm[Hg]') });
    if (components.length === 0) {
      review.push('no reading was given for this blood pressure');
      return { observation, title: 'Blood pressure' };
    }
    if (components.length === 1) {
      // Half a reading is still a fact: it is kept, and nobody pretends the other half exists.
      review.push(`only the ${typeof req.systolic === 'number' ? 'systolic' : 'diastolic'} half of this blood pressure was given`);
    }
    observation.component = components;
    const title = components.length === 2
      ? `Blood pressure ${number(req.systolic as number)}/${number(req.diastolic as number)} mmHg`
      : `Blood pressure ${typeof req.systolic === 'number' ? `${number(req.systolic)} systolic` : `${number(req.diastolic as number)} diastolic`} mmHg`;
    return { observation, title };
  }

  if (typeof req.value !== 'number') {
    review.push(`no reading was given for ${lower.replace(/_/g, ' ')}`);
    return { observation, title: code?.display ?? lower.replace(/_/g, ' ') };
  }
  // A friendlier unit is kept as the person typed it, beside the coded one that makes the value
  // comparable with what a provider sent.
  const ucum = CANONICAL_UNITS[lower] ?? (chosen ? spec.defaultUnit : unit);
  observation.valueQuantity = quantity(req.value, unit, ucum);
  const label = code?.display ?? lower.replace(/_/g, ' ');
  return { observation, title: ucum === '%' ? `${label} ${number(req.value)}${unit}` : `${label} ${number(req.value)} ${unit}` };
}

/** Something this module has no code for: the person's words, stored as words. */
function uncodedObservation(name: string, review: string[]): { observation: Observation; title: string } {
  review.push(`"${name}" is not a measurement this release knows how to code, so it is stored as written`);
  return {
    observation: {
      resourceType: 'Observation',
      category: [{ coding: [{ system: OBSERVATION_CATEGORY, code: 'vital-signs', display: 'Vital Signs' }] }],
      code: { text: name },
    } as Observation,
    title: name,
  };
}

/**
 * RFC3339 as given, a date-only value as given, or now in UTC.
 *
 * A date that cannot be read leaves the record with NO date and a note for review. Dating it today
 * would be the worst outcome available: a record that reads as fact and is wrong.
 */
function effectiveDateTime(given: string | undefined, now: Date, review: string[]): string {
  const value = (given ?? '').trim();
  if (value === '') return now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (!Number.isNaN(Date.parse(value))) return value;
  review.push(`the date "${value}" could not be read, so this record has no date yet`);
  return '';
}
