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
 *   - __It states only what the person entered.__ No unit is invented beyond the documented default
 *     for that vital, no value is converted, and an unrecognised vital is refused rather than
 *     stored as something adjacent. The no-guessing rule applies to writing as much as to display.
 */
import { randomUUID } from 'node:crypto';
import type { Observation } from '@medplum/fhirtypes';

/** What the Add-record form posts. Field names are the frontend's, which were Go's. */
export interface PatientEntryRequest {
  /** Only `vital` today; Go refused anything else and so does this. */
  kind?: string;
  vital?: string;
  value?: number;
  systolic?: number;
  diastolic?: number;
  unit?: string;
  effective_date_time?: string;
}

/** Thrown for anything the person could fix by filling the form in differently. */
export class PatientEntryError extends Error {}

const LOINC = 'http://loinc.org';
const UCUM = 'http://unitsofmeasure.org';

/** meta.source for a record this instance's own UI wrote, as Go marked it. */
export const PATIENT_ENTRY_SOURCE = 'yourphr://patient-ui';

interface VitalSpec {
  /** LOINC code and display, as Go used them. */
  code: string;
  display: string;
  /** The unit used when the person does not name one. */
  defaultUnit: string;
  /** A blood pressure carries two components rather than one value. */
  paired?: boolean;
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
};

const codeable = (code: string, display: string) => ({ coding: [{ system: LOINC, code, display }], text: display });
const quantity = (value: number, unit: string, code = unit) => ({ value, unit, system: UCUM, code });

/** Go's `%g`: 70 prints as "70", 70.5 as "70.5" — never "70.000000". */
const number = (n: number): string => String(n);

/**
 * The Observation, and the sort title the record lists show.
 *
 * Throws PatientEntryError with the same wording Go used, so the form's error line reads the same
 * as it did on v2.
 */
export function buildPatientVital(req: PatientEntryRequest, now = new Date()): { observation: Observation; sortTitle: string } {
  const kind = (req.kind ?? 'vital').trim().toLowerCase() || 'vital';
  if (kind !== 'vital') throw new PatientEntryError('unsupported kind; this release supports kind=vital only');

  const name = (req.vital ?? '').trim().toLowerCase();
  if (name === '') throw new PatientEntryError('vital is required (body_weight, heart_rate, body_temperature, oxygen_saturation, blood_pressure)');
  const spec = VITALS[name];
  if (!spec) throw new PatientEntryError(`unknown vital "${name}"`);

  const effective = effectiveDateTime(req.effective_date_time, now);
  const observation: Observation = {
    resourceType: 'Observation',
    id: randomUUID(),
    status: 'final',
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'vital-signs', display: 'Vital Signs' }] }],
    code: codeable(spec.code, spec.display),
    effectiveDateTime: effective,
    meta: {
      source: PATIENT_ENTRY_SOURCE,
      tag: [{ system: 'https://yourphr.org/fhir/CodeSystem/record-origin', code: 'patient-reported', display: 'Patient-reported (YourPHR)' }],
    },
  };

  if (spec.paired) {
    if (typeof req.systolic !== 'number' || typeof req.diastolic !== 'number') {
      throw new PatientEntryError('systolic and diastolic are required for blood_pressure');
    }
    observation.component = [
      { code: codeable('8480-6', 'Systolic blood pressure'), valueQuantity: quantity(req.systolic, 'mm[Hg]') },
      { code: codeable('8462-4', 'Diastolic blood pressure'), valueQuantity: quantity(req.diastolic, 'mm[Hg]') },
    ];
    return { observation, sortTitle: `Blood pressure ${number(req.systolic)}/${number(req.diastolic)} mmHg` };
  }

  if (typeof req.value !== 'number') throw new PatientEntryError(`value is required for ${name}`);
  const unit = (req.unit ?? '').trim() || spec.defaultUnit;
  // Heart rate and oxygen saturation keep their canonical UCUM code even when the person typed a
  // friendlier unit ("bpm", "percent") — Go did the same, and a coded unit is what makes the value
  // comparable with one a provider sent.
  const ucum = name === 'heart_rate' || name === 'pulse' ? '/min' : name === 'oxygen_saturation' || name === 'spo2' ? '%' : unit;
  observation.valueQuantity = quantity(req.value, unit, ucum);
  const sortTitle = ucum === '%' ? `${spec.display} ${number(req.value)}${unit}` : `${spec.display} ${number(req.value)} ${unit}`;
  return { observation, sortTitle };
}

/** RFC3339 as given, a date-only value as given, or now in UTC — never a guessed time zone. */
function effectiveDateTime(given: string | undefined, now: Date): string {
  const value = (given ?? '').trim();
  if (value === '') return now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (!Number.isNaN(Date.parse(value))) return value;
  throw new PatientEntryError('effective_date_time must be RFC3339 or YYYY-MM-DD');
}
