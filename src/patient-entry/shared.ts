/**
 * What every kind of patient-entered record shares (yourphr#696, #763).
 *
 * A record the person wrote is marked as theirs, keeps exactly what they said, and invents nothing
 * they did not say. Those rules do not change with the kind of record, so they live here and the
 * per-kind builders — a vital, an allergy, a medication — only decide what the resource is.
 */
import { randomUUID } from 'node:crypto';
import type { Resource } from '@medplum/fhirtypes';

/**
 * What the Add-record form posts. Field names are the frontend's, which were Go's.
 *
 * `vital` is the older name for "what this record is about" and is still accepted, because a v2-era
 * client posts it; `name` is the same field under a name that makes sense for an allergy.
 */
export interface PatientEntryRequest {
  /** `vital`, `allergy`, `medication` or `implant`. Anything else is kept and flagged rather than refused. */
  kind?: string;
  vital?: string;
  name?: string;
  value?: number;
  systolic?: number;
  diastolic?: number;
  unit?: string;
  /** Medication only: whether they are taking it. Absent means they did not say. */
  status?: string;
  implant_status?: string;
  implant_device_identifier?: string;
  implant_distinct_identifier?: string;
  implant_serial_number?: string;
  implant_lot_number?: string;
  implant_manufacture_date?: string;
  implant_expiration_date?: string;
  implant_insertion_date?: string;
  implant_removal_date?: string;
  /** A device of theirs, by id, that this reading came from (yourphr#764). */
  device?: string;
  /** A device by the name they call it. The server reuses one of that name or makes it. */
  device_name?: string;
  effective_date_time?: string;
}

/** Thrown only when there is no fact to keep at all — an empty submission. */
export class PatientEntryError extends Error {}

/** Who the record is about and who asserted it (the PGHD pattern, yourphr#696). */
export interface PatientEntryContext {
  /** `Patient/<id>` — the account's own Patient, in its `manual` source. */
  subject: string;
  /**
   * `Device/<id>` — the machine the person said this reading came from (yourphr#764). Empty when
   * they named none, which is the honest answer rather than a default: a reading measured by a cuff
   * and one remembered from this morning are different evidence, and nothing here guesses which.
   */
  device?: string;
}

/** What was stored, the title a list shows, and whatever still needs a human. */
export interface BuiltRecord {
  resource: Resource;
  sortTitle: string;
  /** Why it needs review, in the person's terms. Empty when nothing is outstanding. */
  review: string[];
}

export const LOINC = 'http://loinc.org';
export const UCUM = 'http://unitsofmeasure.org';
export const US_CORE_IMPLANTABLE_DEVICE = 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-implantable-device';

export function validDate(value: unknown, field: string): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString().slice(0, 10) !== value) {
    throw new PatientEntryError(`Enter a valid ${field} date (YYYY-MM-DD).`);
  }
  return value;
}

/** meta.source for a record this instance's own UI wrote, as Go marked it. */
export const PATIENT_ENTRY_SOURCE = 'yourphr://patient-ui';

/** This instance's code system for how a record came to exist. */
export const RECORD_ORIGIN = 'https://yourphr.org/fhir/CodeSystem/record-origin';

/**
 * Patient-generated health data (yourphr#806, Jim 2026-09-30): the patient, or a personal device
 * acting for them, is the source — not a clinician. ONE code for both: whether a device was involved
 * is said by `Observation.device`, not by a second tag. Replaced `patient-reported`, which the
 * records ledger's PGHD migration rewrites on records stored before.
 */
export const PGHD = 'pghd';
export const PGHD_TAG = { system: RECORD_ORIGIN, code: PGHD, display: 'Patient-generated health data (PGHD)' } as const;

/** The resource with the PGHD tag added, unless it already carries it. Never removes a tag. */
export function withPghdTag<T extends { meta?: { tag?: { system?: string; code?: string; display?: string }[] } }>(resource: T): T {
  const tags = resource.meta?.tag ?? [];
  if (tags.some((t) => t.system === RECORD_ORIGIN && t.code === PGHD)) return resource;
  return { ...resource, meta: { ...(resource.meta ?? {}), tag: [...tags, { ...PGHD_TAG }] } };
}

/**
 * A record kept because the person stated it, and held back from the chart until a human confirms
 * it (yourphr#696). The PGHD rule: what they said is a fact and is never discarded, but an
 * incomplete or uncoded row must not count as a chart fact — so it carries this tag, and the read
 * paths that speak for the record (lists, counts, search, the IPS summary) leave it out until the
 * person resolves it. Nothing here is ever auto-resolved, and nothing missing is invented.
 */
export const NEEDS_REVIEW = 'needs-review';

/** Go's `%g`: 70 prints as "70", 70.5 as "70.5" — never "70.000000". */
export const number = (n: number): string => String(n);

/** What this record is about, under either field name the form has used. */
export const statedName = (req: PatientEntryRequest): string => (req.name ?? req.vital ?? '').trim();

/**
 * The id, the patient-reported marks, and — when something is outstanding — the review tag and the
 * reasons, written onto the record in the words the person was shown.
 *
 * The reasons live on the resource (yourphr#762) so the review queue is a read over the records
 * themselves: no second store to fall out of step with them, and a record that travels keeps its
 * own explanation.
 */
export function stamp(resource: Resource, review: string[]): void {
  const r = resource as Resource & { meta?: { source?: string; tag?: { system: string; code: string; display: string }[] }; note?: { text: string }[] };
  r.id = randomUUID();
  r.meta = {
    source: PATIENT_ENTRY_SOURCE,
    tag: [{ ...PGHD_TAG }],
  };
  if (review.length) {
    r.meta.tag = [...(r.meta.tag ?? []), { system: RECORD_ORIGIN, code: NEEDS_REVIEW, display: 'Needs review' }];
    r.note = [...(r.note ?? []), ...review.map((text) => ({ text }))];
  }
}

/**
 * RFC3339 as given, a date-only value as given, or now in UTC.
 *
 * A date that cannot be read leaves the record with NO date and a note for review. Dating it today
 * would be the worst outcome available: a record that reads as fact and is wrong.
 */
export function effectiveDateTime(given: string | undefined, now: Date, review: string[]): string {
  const value = (given ?? '').trim();
  if (value === '') return now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (!Number.isNaN(Date.parse(value))) return value;
  review.push(`the date "${value}" could not be read, so this record has no date yet`);
  return '';
}
