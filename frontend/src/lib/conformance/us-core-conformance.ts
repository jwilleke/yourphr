// US Core 9.0.0 display-conformance registry (#248).
//
// The client-appropriate conformance gate for epic #136: given conformant US Core input, does
// YourPHR's *display model* surface every Must-Support (MS) element? (Inferno's suites test FHIR
// *servers*; YourPHR is a display-only Requestor/Client — see closed #161.)
//
// This file is the single source of truth for that claim. For each audited profile it lists the
// MS elements — taken verbatim from the published US Core 9.0.0 StructureDefinitions
// (`differential.element[].mustSupport === true`) — and pairs each with two pure predicates:
//
//   - present(raw):   does the pinned official example actually populate this element?
//                     (MS means "display it *when present*" — an element absent from the example
//                      can't be verified by that example, so it's reported N/A, not a pass/fail.)
//   - surfaced(model): does our built display model expose a non-empty value for it?
//
// `status` is the committed claim for each element ('displayed' or a known 'gap'). The spec
// (`us-core-conformance.spec.ts`) asserts surfaced(model) === (status === 'displayed') for every
// element the example exercises, so CI keeps this registry — and the generated coverage table in
// `docs/us-core/conformance-coverage.md` — honest: a regression flips a 'displayed' to failing, and
// fixing a gap flips it too (prompting you to update the status here + the doc).
//
// Scope: the six Cures-Act USCDI core profiles already audited across #142–#147. Resource types
// that still render generically are intentionally NOT claimed here (no MS-display assertion).

export type MsStatus = 'displayed' | 'gap';

export interface MsElement {
  /** FHIR path, e.g. "Condition.clinicalStatus" — the MS element being verified. */
  path: string;
  /** Short human label for the coverage table. */
  label: string;
  /** Optional clarifying note (e.g. why it's a gap, or how it's surfaced indirectly). */
  note?: string;
  /** Does the pinned official example populate this element? */
  present: (raw: any) => boolean;
  /** Does the built display model surface a non-empty value for it? */
  surfaced: (model: any) => boolean;
  /** Committed current state — CI-enforced against surfaced() for examples that exercise it. */
  status: MsStatus;
}

export interface UsCoreProfileConformance {
  /** Human display name of the profile. */
  profile: string;
  /** Profile canonical URL (version-less). */
  canonical: string;
  /** FHIR resource type. */
  resourceType: string;
  /** Issue that audited the Must-Support display for this profile. */
  auditedIn: string;
  /** Official US Core 9.0.0 example id pinned as the fixture. */
  exampleId: string;
  /** Must-Support elements (from the 9.0.0 StructureDefinition differential). */
  mustSupport: MsElement[];
  /** US Core elements we also surface that are NOT MS-flagged in 9.0.0 (e.g. Patient USCDI extensions). */
  additional?: MsElement[];
}

// ---- helpers (kept dependency-free so the registry stays import-light) ----

const arr = (v: any): any[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const nonEmpty = (v: any): boolean => arr(v).length > 0;
const hasExt = (raw: any, url: string): boolean =>
  arr(raw?.extension).some((e: any) => e?.url === url);

const RACE_URL = 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-race';
const ETHNICITY_URL = 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-ethnicity';
const SEX_URL = 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-individual-sex';
const TRIBAL_URL = 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-tribal-affiliation';
const INTERPRETER_URL = 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-interpreter-needed';
const ASSERTED_DATE_URL = 'http://hl7.org/fhir/StructureDefinition/condition-assertedDate';

export const US_CORE_CONFORMANCE: UsCoreProfileConformance[] = [
  // ----------------------------------------------------------------------- Patient
  {
    profile: 'US Core Patient',
    canonical: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient',
    resourceType: 'Patient',
    auditedIn: '#142',
    exampleId: 'Patient-example',
    mustSupport: [
      { path: 'Patient.identifier', label: 'identifier (system/value)', status: 'displayed',
        present: (r) => nonEmpty(r.identifier),
        surfaced: (m) => !!m.mrn || !!m.ssn || nonEmpty(m.identifiers) },
      { path: 'Patient.name', label: 'name (family/given)', status: 'displayed',
        present: (r) => nonEmpty(r.name), surfaced: (m) => !!m.patient_name },
      { path: 'Patient.telecom', label: 'telecom (system/value/use)', status: 'displayed',
        present: (r) => nonEmpty(r.telecom), surfaced: (m) => nonEmpty(m.patient_phones) },
      { path: 'Patient.birthDate', label: 'birthDate', status: 'displayed',
        present: (r) => !!r.birthDate, surfaced: (m) => !!m.patient_birthdate },
      { path: 'Patient.address', label: 'address (line/city/state/postalCode)', status: 'displayed',
        present: (r) => nonEmpty(r.address), surfaced: (m) => nonEmpty(m.patient_address) },
      { path: 'Patient.communication.language', label: 'communication.language', status: 'displayed',
        present: (r) => nonEmpty(r.communication), surfaced: (m) => !!m.has_communication_language },
    ],
    // Not MS-flagged in US Core 9.0.0 (USCDI-supported extensions) but surfaced by the Patient card (#142).
    additional: [
      { path: 'Patient.extension:race', label: 'race', status: 'displayed',
        present: (r) => hasExt(r, RACE_URL), surfaced: (m) => !!m.race },
      { path: 'Patient.extension:ethnicity', label: 'ethnicity', status: 'displayed',
        present: (r) => hasExt(r, ETHNICITY_URL), surfaced: (m) => !!m.ethnicity },
      { path: 'Patient.extension:sex', label: 'individual sex', status: 'displayed',
        present: (r) => hasExt(r, SEX_URL), surfaced: (m) => !!m.individual_sex },
      { path: 'Patient.extension:tribalAffiliation', label: 'tribal affiliation', status: 'displayed',
        present: (r) => hasExt(r, TRIBAL_URL), surfaced: (m) => !!m.tribal_affiliation },
      { path: 'Patient.extension:interpreterRequired', label: 'interpreter needed', status: 'displayed',
        present: (r) => hasExt(r, INTERPRETER_URL), surfaced: (m) => !!m.interpreter_needed },
    ],
  },

  // ------------------------------------------------------ Condition (Problems & Health Concerns)
  {
    profile: 'US Core Condition (Problems & Health Concerns)',
    canonical: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-condition-problems-health-concerns',
    resourceType: 'Condition',
    auditedIn: '#143 / #246',
    exampleId: 'Condition-health-concern-example',
    mustSupport: [
      { path: 'Condition.meta.lastUpdated', label: 'meta.lastUpdated', status: 'displayed',
        present: (r) => !!r.meta?.lastUpdated, surfaced: (m) => !!m.meta_last_updated },
      { path: 'Condition.extension:assertedDate', label: 'assertedDate extension', status: 'displayed',
        present: (r) => hasExt(r, ASSERTED_DATE_URL), surfaced: (m) => !!m.asserted_date },
      { path: 'Condition.clinicalStatus', label: 'clinicalStatus', status: 'displayed',
        present: (r) => !!r.clinicalStatus, surfaced: (m) => !!m.clinical_status },
      { path: 'Condition.verificationStatus', label: 'verificationStatus', status: 'displayed',
        present: (r) => !!r.verificationStatus, surfaced: (m) => !!m.verification_status },
      { path: 'Condition.category', label: 'category (incl. us-core slice)', status: 'displayed',
        present: (r) => nonEmpty(r.category), surfaced: (m) => nonEmpty(m.categories) },
      { path: 'Condition.code', label: 'code', status: 'displayed',
        present: (r) => !!r.code, surfaced: (m) => !!m.code || !!m.code_text },
      { path: 'Condition.subject', label: 'subject', status: 'displayed',
        present: (r) => !!r.subject, surfaced: (m) => !!m.subject },
      { path: 'Condition.onset[x]', label: 'onset[x]', status: 'displayed',
        present: (r) => !!r.onsetDateTime || !!r.onsetPeriod || !!r.onsetAge,
        surfaced: (m) => !!m.onset_datetime },
      { path: 'Condition.abatement[x]', label: 'abatement[x]', status: 'displayed',
        present: (r) => !!r.abatementDateTime || !!r.abatementPeriod,
        surfaced: (m) => !!m.abatement_datetime },
      { path: 'Condition.recordedDate', label: 'recordedDate', status: 'displayed',
        present: (r) => !!r.recordedDate, surfaced: (m) => !!m.date_recorded },
    ],
  },

  // ------------------------------------------------------------------- AllergyIntolerance
  {
    profile: 'US Core AllergyIntolerance',
    canonical: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-allergyintolerance',
    resourceType: 'AllergyIntolerance',
    auditedIn: '#145',
    exampleId: 'AllergyIntolerance-example',
    mustSupport: [
      { path: 'AllergyIntolerance.clinicalStatus', label: 'clinicalStatus', status: 'displayed',
        present: (r) => !!r.clinicalStatus, surfaced: (m) => !!m.clinical_status },
      { path: 'AllergyIntolerance.verificationStatus', label: 'verificationStatus', status: 'displayed',
        note: 'Surfaced via the model `status` field (resolveStatus of verificationStatus).',
        present: (r) => !!r.verificationStatus, surfaced: (m) => !!m.status },
      { path: 'AllergyIntolerance.code', label: 'code', status: 'displayed',
        present: (r) => !!r.code, surfaced: (m) => !!m.code },
      { path: 'AllergyIntolerance.patient', label: 'patient', status: 'displayed',
        present: (r) => !!r.patient, surfaced: (m) => !!m.patient },
      { path: 'AllergyIntolerance.reaction', label: 'reaction', status: 'displayed',
        present: (r) => nonEmpty(r.reaction), surfaced: (m) => nonEmpty(m.reactions) },
      { path: 'AllergyIntolerance.reaction.manifestation', label: 'reaction.manifestation', status: 'displayed',
        present: (r) => arr(r.reaction).some((x: any) => nonEmpty(x?.manifestation)),
        surfaced: (m) => arr(m.reactions).some((x: any) => nonEmpty(x?.manifestation)) },
    ],
  },

  // -------------------------------------------------------------------- MedicationRequest
  {
    profile: 'US Core MedicationRequest',
    canonical: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-medicationrequest',
    resourceType: 'MedicationRequest',
    auditedIn: '#144',
    exampleId: 'MedicationRequest-medicationrequest-coded-oral-axid',
    mustSupport: [
      { path: 'MedicationRequest.status', label: 'status', status: 'displayed',
        present: (r) => !!r.status, surfaced: (m) => !!m.status },
      { path: 'MedicationRequest.intent', label: 'intent', status: 'displayed',
        present: (r) => !!r.intent, surfaced: (m) => !!m.intent },
      { path: 'MedicationRequest.medication[x]', label: 'medication[x]', status: 'displayed',
        present: (r) => !!r.medicationCodeableConcept || !!r.medicationReference,
        surfaced: (m) => !!m.medication_codeable_concept || !!m.medication_reference },
      { path: 'MedicationRequest.subject', label: 'subject', status: 'displayed',
        present: (r) => !!r.subject, surfaced: (m) => !!m.subject },
      { path: 'MedicationRequest.encounter', label: 'encounter', status: 'displayed',
        present: (r) => !!r.encounter, surfaced: (m) => !!m.encounter },
      { path: 'MedicationRequest.authoredOn', label: 'authoredOn', status: 'displayed',
        present: (r) => !!r.authoredOn, surfaced: (m) => !!m.created },
      { path: 'MedicationRequest.requester', label: 'requester', status: 'displayed',
        present: (r) => !!r.requester, surfaced: (m) => !!m.requester },
      { path: 'MedicationRequest.dosageInstruction.text', label: 'dosageInstruction.text', status: 'displayed',
        present: (r) => !!arr(r.dosageInstruction)[0]?.text,
        surfaced: (m) => !!m.dosage_instruction_text || !!m.dosage_instruction },
      { path: 'MedicationRequest.dispenseRequest', label: 'dispenseRequest', status: 'displayed',
        present: (r) => !!r.dispenseRequest, surfaced: (m) => !!m.dispense_request_quantity || !!m.dispense_request_refills },
    ],
  },

  // ------------------------------------------------------------ Observation (Laboratory Result)
  {
    profile: 'US Core Observation (Laboratory Result)',
    canonical: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-observation-lab',
    resourceType: 'Observation',
    auditedIn: '#146',
    exampleId: 'Observation-cbc-hemoglobin',
    mustSupport: [
      { path: 'Observation.meta.lastUpdated', label: 'meta.lastUpdated', status: 'displayed',
        present: (r) => !!r.meta?.lastUpdated, surfaced: (m) => !!m.meta_last_updated },
      { path: 'Observation.category:us-core', label: 'category (us-core lab slice)', status: 'displayed',
        note: 'Surfaced via profile classification (us_core_profile → Laboratory Result).',
        present: (r) => nonEmpty(r.category),
        surfaced: (m) => m.us_core_profile?.kind === 'laboratory' },
      { path: 'Observation.code', label: 'code', status: 'displayed',
        present: (r) => !!r.code, surfaced: (m) => !!m.code || !!m.code_text },
      { path: 'Observation.value[x]', label: 'value[x]', status: 'displayed',
        present: (r) => r.valueQuantity != null || r.valueCodeableConcept != null ||
          r.valueString != null || r.valueBoolean != null || nonEmpty(r.component),
        surfaced: (m) => !!m.value_model || nonEmpty(m.components) },
      { path: 'Observation.interpretation', label: 'interpretation', status: 'displayed',
        present: (r) => nonEmpty(r.interpretation), surfaced: (m) => !!m.interpretation },
      { path: 'Observation.specimen', label: 'specimen', status: 'displayed',
        present: (r) => !!r.specimen, surfaced: (m) => !!m.specimen },
      { path: 'Observation.referenceRange', label: 'referenceRange', status: 'displayed',
        present: (r) => nonEmpty(r.referenceRange), surfaced: (m) => !!m.reference_range },
    ],
  },

  // ------------------------------------------------------------------- DocumentReference
  {
    profile: 'US Core DocumentReference',
    canonical: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-documentreference',
    resourceType: 'DocumentReference',
    auditedIn: '#147',
    exampleId: 'DocumentReference-discharge-summary',
    mustSupport: [
      { path: 'DocumentReference.identifier', label: 'identifier', status: 'displayed',
        present: (r) => nonEmpty(r.identifier), surfaced: (m) => nonEmpty(m.identifiers) },
      { path: 'DocumentReference.status', label: 'status', status: 'displayed',
        present: (r) => !!r.status, surfaced: (m) => !!m.status },
      { path: 'DocumentReference.type', label: 'type', status: 'displayed',
        present: (r) => !!r.type, surfaced: (m) => !!m.type_coding },
      { path: 'DocumentReference.category', label: 'category', status: 'displayed',
        present: (r) => nonEmpty(r.category), surfaced: (m) => !!m.category },
      { path: 'DocumentReference.subject', label: 'subject', status: 'displayed',
        present: (r) => !!r.subject, surfaced: (m) => !!m.subject },
      { path: 'DocumentReference.date', label: 'date', status: 'displayed',
        present: (r) => !!r.date, surfaced: (m) => !!m.created_at },
      { path: 'DocumentReference.author', label: 'author', status: 'displayed',
        present: (r) => nonEmpty(r.author), surfaced: (m) => nonEmpty(m.authors) },
      { path: 'DocumentReference.content.attachment', label: 'content.attachment', status: 'displayed',
        present: (r) => arr(r.content).some((c: any) => !!c?.attachment),
        surfaced: (m) => nonEmpty(m.content) },
      { path: 'DocumentReference.content.attachment.contentType', label: 'content.attachment.contentType',
        status: 'displayed',
        present: (r) => arr(r.content).some((c: any) => !!c?.attachment?.contentType),
        surfaced: (m) => arr(m.content).some((a: any) => !!a?.contentType) },
      { path: 'DocumentReference.content.attachment.data', label: 'content.attachment.data', status: 'displayed',
        present: (r) => arr(r.content).some((c: any) => !!c?.attachment?.data),
        surfaced: (m) => arr(m.content).some((a: any) => !!a?.data) },
      { path: 'DocumentReference.content.attachment.url', label: 'content.attachment.url', status: 'displayed',
        present: (r) => arr(r.content).some((c: any) => !!c?.attachment?.url),
        surfaced: (m) => arr(m.content).some((a: any) => !!a?.url) },
      { path: 'DocumentReference.content.format', label: 'content.format', status: 'displayed',
        present: (r) => arr(r.content).some((c: any) => !!c?.format),
        surfaced: (m) => nonEmpty(m.content_formats) },
      { path: 'DocumentReference.context.encounter', label: 'context.encounter', status: 'displayed',
        present: (r) => nonEmpty(r.context?.encounter),
        surfaced: (m) => !!m.context?.encounter },
      { path: 'DocumentReference.context.period', label: 'context.period', status: 'displayed',
        present: (r) => !!r.context?.period,
        surfaced: (m) => !!m.context?.periodStart || !!m.context?.periodEnd },
    ],
  },
];
