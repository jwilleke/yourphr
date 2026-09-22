/**
 * What US Core says a server must be able to be asked (yourphr#754, epic yourphr#755).
 *
 * GENERATED from the published US Core server CapabilityStatement — do not hand-edit the tables
 * below; run `npm run refresh:us-core` and commit the result, which records the version it came
 * from. Pinned on purpose: a sync must not depend on hl7.org being reachable, and the rule must not
 * change under a running instance.
 *
 * Why this exists at all. A FHIR server publishes what it ACCEPTS (`/metadata`) and never what it
 * INSISTS ON: Epic's CapabilityStatement, read 2026-09-22, declares 60 resources with their search
 * parameters and carries no `search-parameter-combination` extension anywhere. US Core carries
 * exactly that extension, and Epic and Oracle Health (Cerner) both refuse an unqualified
 * `Observation?patient=` search because both certify to it. So the knowledge is standards-derived,
 * not vendor-specific — which is why there is no table here keyed by vendor name.
 *
 * What it does NOT mean. A combination listed here is what a server SHALL support, not what it
 * refuses without. Epic answers a plain `Condition?patient=` and `DocumentReference?patient=`
 * happily — that same live run imported 7 conditions and 8 documents. So these tables say how to
 * ask a SECOND time when a plain search is refused; see `query-plan.ts` for that rule.
 */

/** Source of the tables below, for the refresh script and for anyone auditing them. */
export const US_CORE_SOURCE = {
  url: 'https://hl7.org/fhir/us/core/CapabilityStatement-us-core-server.json',
  version: '9.0.0',
  readOn: '2026-09-22',
} as const;

/**
 * Resource type -> the required search-parameter combinations US Core declares for it, each as a
 * sorted list of parameter names. Only combinations that include `patient` are useful here: this
 * client always searches within one patient.
 */
export const REQUIRED_COMBINATIONS: Readonly<Record<string, readonly (readonly string[])[]>> = {
  AllergyIntolerance: [['clinical-status', 'patient']],
  CarePlan: [['category', 'patient'], ['category', 'patient', 'status'], ['category', 'date', 'patient'], ['category', 'date', 'patient', 'status']],
  CareTeam: [['patient', 'role'], ['patient', 'status']],
  Condition: [['category', 'patient'], ['clinical-status', 'patient'], ['code', 'patient'], ['abatement-date', 'patient'], ['patient', 'recorded-date'], ['_lastUpdated', 'patient'], ['asserted-date', 'patient'], ['category', 'clinical-status', 'patient'], ['onset-date', 'patient'], ['category', 'encounter', 'patient']],
  Device: [['patient', 'type'], ['patient', 'status']],
  DiagnosticReport: [['category', 'patient'], ['code', 'patient'], ['code', 'date', 'patient'], ['_lastUpdated', 'category', 'patient'], ['category', 'date', 'patient'], ['patient', 'status']],
  DocumentReference: [['category', 'patient'], ['patient', 'type'], ['category', 'date', 'patient'], ['patient', 'period', 'type'], ['patient', 'status']],
  Encounter: [['date', 'patient'], ['patient', 'type'], ['class', 'patient'], ['patient', 'status'], ['_lastUpdated', 'patient'], ['location', 'patient'], ['discharge-disposition', 'patient']],
  FamilyMemberHistory: [['code', 'patient']],
  Goal: [['description', 'patient'], ['patient', 'target-date'], ['lifecycle-status', 'patient']],
  Immunization: [['date', 'patient'], ['patient', 'status']],
  MedicationDispense: [['patient', 'status'], ['patient', 'status', 'type']],
  MedicationRequest: [['intent', 'patient'], ['authoredon', 'intent', 'patient'], ['encounter', 'intent', 'patient'], ['intent', 'patient', 'status']],
  Observation: [['category', 'patient'], ['code', 'patient'], ['code', 'date', 'patient'], ['_lastUpdated', 'category', 'patient'], ['category', 'date', 'patient'], ['category', 'patient', 'status']],
  Procedure: [['date', 'patient'], ['code', 'date', 'patient'], ['patient', 'status']],
  QuestionnaireResponse: [['patient', 'questionnaire'], ['authored', 'patient'], ['patient', 'status']],
  RelatedPerson: [['name', 'patient']],
  ServiceRequest: [['category', 'patient'], ['code', 'patient'], ['authored', 'code', 'patient'], ['authored', 'category', 'patient'], ['patient', 'status']],
};

/**
 * The category codes to fan a search out across, per type, when a server refuses a plain patient
 * search. Hand-maintained rather than generated: US Core binds each type's `category` to a value
 * set, and what belongs here is the small set of codes that partition a patient's record — asking
 * for every code in a value set would be slower and no more complete.
 *
 * Observation's are the FHIR `observation-category` codes US Core profiles use. Condition's are US
 * Core's three problem categories. The rest are absent deliberately: no server has been observed
 * refusing them, and an empty list means "do not fan out", not "unknown".
 */
export const CATEGORY_CODES: Readonly<Record<string, readonly string[]>> = {
  Observation: ['laboratory', 'vital-signs', 'social-history', 'survey', 'exam', 'imaging', 'therapy', 'activity', 'procedure'],
  Condition: ['problem-list-item', 'encounter-diagnosis', 'health-concern'],
};

/** Does US Core declare `patient` + `category` as a supported combination for this type? */
export function categoryIsCombinable(resourceType: string): boolean {
  return (REQUIRED_COMBINATIONS[resourceType] ?? []).some((combo) => combo.length === 2 && combo.includes('patient') && combo.includes('category'));
}
