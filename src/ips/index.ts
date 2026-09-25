/**
 * IPS composition + narratives (yourphr#577; Phase 4 of yourphr#542). Builds the HL7
 * International Patient Summary document — a FHIR `document` Bundle whose first entry is a
 * Composition — from the spike repository.
 *
 * Section taxonomy mirrors the Go stack's constants exactly (backend/pkg/constants.go):
 * REQUIRED (medication summary, allergies, problem list), RECOMMENDED (immunizations,
 * procedures, medical devices, diagnostic results), OPTIONAL (seven more). The rule the IG and
 * this module share: a REQUIRED section with no data still appears, carrying an explicit
 * empty statement and emptyReason — silence and "no known allergies" are different clinical
 * facts. Recommended/optional sections with no data are simply omitted.
 *
 * Narratives follow the patient-legible display principle (yourphr#262): the narrative is what
 * the patient and a receiving clinician read, so each row is the record's own stated display
 * text plus its date — meaning-first, no raw codes, and nothing inferred (the no-guessing rule:
 * a record with no display text shows as "Unnamed <kind>", never a fabricated label).
 *
 * PDF is deliberately NOT here — decided on yourphr#577: the Angular app survives the
 * transition and already renders the PDF; the spike owes the narrative + bundle only.
 */
import type { Bundle, BundleEntry, Composition, CompositionSection, Resource } from '@medplum/fhirtypes';
import type { SearchRequest, WithId } from '@medplum/core';

export type SectionGroup = 'required' | 'recommended' | 'optional';

export interface SectionSpec {
  key: string;
  title: string;
  group: SectionGroup;
  /** LOINC section code, per the IPS IG. */
  loinc: string;
  resourceTypes: string[];
}

/**
 * Order and grouping match Go's IPSSectionGroupsOrdered. vital_signs is deliberately unmapped for
 * now: the spike repository has no category-level Observation split, and double-listing every
 * Observation under two sections would misstate the record — recorded as not-yet rather than
 * guessed (yourphr#577).
 */
export const IPSSections: SectionSpec[] = [
  { key: 'medication_summary', title: 'Medications', group: 'required', loinc: '10160-0', resourceTypes: ['MedicationRequest', 'MedicationStatement'] },
  { key: 'allergies_intolerances', title: 'Allergies', group: 'required', loinc: '48765-2', resourceTypes: ['AllergyIntolerance'] },
  { key: 'problem_list', title: 'Health problems', group: 'required', loinc: '11450-4', resourceTypes: ['Condition'] },
  { key: 'immunizations', title: 'Immunizations', group: 'recommended', loinc: '11369-6', resourceTypes: ['Immunization'] },
  { key: 'history_of_procedures', title: 'Procedures', group: 'recommended', loinc: '47519-4', resourceTypes: ['Procedure'] },
  { key: 'medical_devices', title: 'Medical devices', group: 'recommended', loinc: '46264-8', resourceTypes: ['Device', 'DeviceUseStatement'] },
  { key: 'diagnostic_results', title: 'Test results', group: 'recommended', loinc: '30954-2', resourceTypes: ['Observation', 'DiagnosticReport'] },
  { key: 'history_of_illness', title: 'Past illnesses', group: 'optional', loinc: '11348-0', resourceTypes: ['Encounter'] },
  { key: 'social_history', title: 'Social history', group: 'optional', loinc: '29762-2', resourceTypes: [] },
  { key: 'plan_of_care', title: 'Plan of care', group: 'optional', loinc: '18776-5', resourceTypes: ['CarePlan'] },
];

const EMPTY_STATEMENTS: Record<string, string> = {
  medication_summary: 'No medications are recorded in this summary.',
  allergies_intolerances: 'No known allergies are recorded in this summary.',
  problem_list: 'No health problems are recorded in this summary.',
};

function escapeXhtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * The one patient-legible line for a resource: its own stated display text, then its own stated
 * date. Nothing derived, nothing guessed (yourphr#262 + the no-guessing principle).
 */
export function legibleLine(resource: Resource): string {
  const r = resource as Record<string, any>;
  const text: string =
    r['code']?.text ?? r['code']?.coding?.[0]?.display ??
    r['vaccineCode']?.text ?? r['vaccineCode']?.coding?.[0]?.display ??
    r['medicationCodeableConcept']?.text ?? r['medicationCodeableConcept']?.coding?.[0]?.display ??
    r['type']?.text ??
    `Unnamed ${resource.resourceType}`;
  const date: string | undefined =
    r['effectiveDateTime'] ?? r['occurrenceDateTime'] ?? r['recordedDate'] ?? r['performedDateTime'] ??
    r['period']?.start ?? r['date'] ?? r['authoredOn'];
  return date ? `${text} — ${String(date).slice(0, 10)}` : text;
}

function narrative(title: string, lines: string[]): string {
  const items = lines.map((l) => `<li>${escapeXhtml(l)}</li>`).join('');
  return `<div xmlns="http://www.w3.org/1999/xhtml"><h2>${escapeXhtml(title)}</h2><ul>${items}</ul></div>`;
}

function emptyNarrative(title: string, statement: string): string {
  return `<div xmlns="http://www.w3.org/1999/xhtml"><h2>${escapeXhtml(title)}</h2><p>${escapeXhtml(statement)}</p></div>`;
}

export interface IpsDocument {
  bundle: Bundle;
  /** keys of sections present, in order — the harness's cheap view. */
  sections: string[];
}

/**
 * Builds the IPS document for the repository's user. `now` injected for determinism — two calls
 * with the same records and the same now are byte-identical.
 */
/** What the composer needs from the store: a search. A repository satisfies it; so does the Records manager. */
export interface IpsSource {
  search<T extends Resource>(request: SearchRequest<T>): Promise<Bundle<WithId<T>>>;
}

export async function buildIps(repo: IpsSource, now: Date): Promise<IpsDocument> {
  const patientBundle = await repo.search({ resourceType: 'Patient', count: 1 });
  const patient = patientBundle.entry?.[0]?.resource as Resource | undefined;

  const sections: CompositionSection[] = [];
  const included: Resource[] = [];
  const presentKeys: string[] = [];

  for (const spec of IPSSections) {
    const resources: Resource[] = [];
    for (const type of spec.resourceTypes) {
      const found = await repo.search({ resourceType: type as never, count: 1000, total: 'accurate' });
      for (const entry of found.entry ?? []) {
        resources.push(entry.resource as Resource);
      }
    }
    // Deterministic order: by legible line, then id — never insertion order.
    resources.sort((a, b) => (legibleLine(a) + a.id).localeCompare(legibleLine(b) + b.id));

    if (resources.length === 0) {
      if (spec.group !== 'required') {
        continue; // an empty recommended/optional section is omitted, not fabricated
      }
      sections.push({
        title: spec.title,
        code: { coding: [{ system: 'http://loinc.org', code: spec.loinc }] },
        text: { status: 'generated', div: emptyNarrative(spec.title, EMPTY_STATEMENTS[spec.key] ?? 'Nothing recorded.') },
        emptyReason: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/list-empty-reason', code: 'unavailable' }] },
      });
      presentKeys.push(spec.key);
      continue;
    }

    sections.push({
      title: spec.title,
      code: { coding: [{ system: 'http://loinc.org', code: spec.loinc }] },
      text: { status: 'generated', div: narrative(spec.title, resources.map(legibleLine)) },
      entry: resources.map((r) => ({ reference: `${r.resourceType}/${r.id}` })),
    });
    included.push(...resources);
    presentKeys.push(spec.key);
  }

  const composition: Composition = {
    resourceType: 'Composition',
    id: 'ips-composition',
    status: 'final',
    type: { coding: [{ system: 'http://loinc.org', code: '60591-5', display: 'Patient summary Document' }] },
    date: now.toISOString(),
    title: 'International Patient Summary',
    author: [{ display: 'YourPHR (self-hosted personal health record)' }],
    subject: patient ? { reference: `Patient/${patient.id}` } : undefined,
    section: sections,
  };

  const entries: BundleEntry[] = [{ resource: composition }];
  if (patient) {
    entries.push({ resource: patient });
  }
  const seen = new Set<string>();
  for (const resource of included) {
    const key = `${resource.resourceType}/${resource.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      entries.push({ resource });
    }
  }

  const bundle: Bundle = {
    resourceType: 'Bundle',
    type: 'document',
    timestamp: now.toISOString(),
    entry: entries,
  };
  return { bundle, sections: presentKeys };
}
