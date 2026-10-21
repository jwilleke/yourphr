/**
 * How phr says what a record is, in plain words (yourphr#262: "would my mom
 * understand this"), using only what the record itself states. Nothing is
 * guessed: a record that doesn't say its name or date says "unknown"
 * (the no-guessing rule). Pure: no database, no HTML escaping (callers escape).
 */

/** FHIR's names for kinds of record, in words a patient uses. Kinds not listed fall back to FHIR's own name, split into words. */
const KIND_NAMES: Record<string, { one: string; many: string }> = {
  Observation: { one: 'lab result or measurement', many: 'lab results and measurements' },
  Condition: { one: 'condition', many: 'conditions' },
  MedicationStatement: { one: 'medication', many: 'medications' },
  MedicationRequest: { one: 'prescription', many: 'prescriptions' },
  AllergyIntolerance: { one: 'allergy', many: 'allergies' },
  Immunization: { one: 'vaccination', many: 'vaccinations' },
  Procedure: { one: 'procedure', many: 'procedures' },
  Encounter: { one: 'visit', many: 'visits' },
  DiagnosticReport: { one: 'report', many: 'reports' },
  DocumentReference: { one: 'document', many: 'documents' },
  CarePlan: { one: 'care plan', many: 'care plans' },
  Patient: { one: 'personal details record', many: 'personal details records' },
  Practitioner: { one: 'clinician', many: 'clinicians' },
  Organization: { one: 'organization', many: 'organizations' },
  Coverage: { one: 'insurance coverage', many: 'insurance coverages' },
  ExplanationOfBenefit: { one: 'insurance claim', many: 'insurance claims' }
};

export function kindName(resourceType: string, count: number): string {
  const k = KIND_NAMES[resourceType];
  if (k) return count === 1 ? k.one : k.many;
  return resourceType.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

type Json = Record<string, unknown>;
const asObj = (v: unknown): Json | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? v as Json : undefined);
const firstCodingDisplay = (cc: Json | undefined): string | undefined => {
  const coding = Array.isArray(cc?.coding) ? cc!.coding as Json[] : [];
  const d = coding.find((c) => typeof c.display === 'string')?.display;
  return typeof d === 'string' ? d : undefined;
};

/** What the record calls itself: its code's text, else a coding's display, else a name or title it states. */
export function recordName(resource: Json): string | undefined {
  for (const key of ['code', 'medicationCodeableConcept', 'vaccineCode', 'type']) {
    const cc = asObj(resource[key]) ?? (Array.isArray(resource[key]) ? asObj((resource[key] as unknown[])[0]) : undefined);
    if (!cc) continue;
    if (typeof cc.text === 'string' && cc.text.trim()) return cc.text.trim();
    const d = firstCodingDisplay(cc);
    if (d) return d;
  }
  for (const key of ['description', 'title']) {
    if (typeof resource[key] === 'string' && (resource[key] as string).trim()) return (resource[key] as string).trim();
  }
  return undefined;
}

const DATE_FIELDS = ['effectiveDateTime', 'onsetDateTime', 'occurrenceDateTime', 'performedDateTime', 'authoredOn', 'recordedDate', 'issued', 'date', 'dateAsserted'];

/** The date the record states it's about, as YYYY-MM-DD, or undefined. Never when phr stored it. */
export function recordDate(resource: Json): string | undefined {
  for (const key of DATE_FIELDS) {
    const v = resource[key];
    if (typeof v === 'string' && /^\d{4}(-\d{2}(-\d{2})?)?/.test(v)) return v.slice(0, 10);
  }
  for (const key of ['effectivePeriod', 'period', 'performedPeriod']) {
    const start = asObj(resource[key])?.start;
    if (typeof start === 'string') return start.slice(0, 10);
  }
  return undefined;
}

/** A measured value the record states (number and unit, or text), or undefined. */
export function recordValue(resource: Json): string | undefined {
  const q = asObj(resource.valueQuantity);
  if (q && typeof q.value === 'number') return [String(q.value), typeof q.unit === 'string' ? q.unit : ''].join(' ').trim();
  if (typeof resource.valueString === 'string') return resource.valueString;
  const cc = asObj(resource.valueCodeableConcept);
  if (cc) return (typeof cc.text === 'string' && cc.text) || firstCodingDisplay(cc);
  return undefined;
}
