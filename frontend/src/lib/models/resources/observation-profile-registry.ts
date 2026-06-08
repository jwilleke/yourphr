import _ from "lodash";

// US Core 9.0.0 Observation profiles — the full family from
// https://www.hl7.org/fhir/us/core/#us-core-profiles (each profile is a SHALL-contract identified by
// its canonical URL, which is what appears in Observation.meta.profile).
//
// We classify an Observation by its claimed meta.profile; when meta.profile is absent — common in
// imported / non-US-Core exports (e.g. Veradigm/FollowMyHealth) — we fall back to category + LOINC
// code. This registry is the single source of truth: it lists every Observation profile so adding
// richer handling later is an additive change. #146 renders the first slice richly (Laboratory,
// Vital Signs, Blood Pressure); the rest classify and degrade gracefully to the generic value view.

const US_CORE = 'http://hl7.org/fhir/us/core/StructureDefinition/';

// Rendering-meaningful grouping of the profiles (NOT a US Core concept — our display routing).
export type ObservationProfileKind =
  | 'laboratory'
  | 'vital-signs'
  | 'blood-pressure'      // component-bearing (systolic + diastolic)
  | 'social-history'
  | 'preference'
  | 'pregnancy'
  | 'advance-directive'
  | 'other';

export interface ObservationProfileEntry {
  canonical: string;
  display: string;
  kind: ObservationProfileKind;
  hasComponents?: boolean;
}

function entry(id: string, display: string, kind: ObservationProfileKind, hasComponents = false): [string, ObservationProfileEntry] {
  const canonical = US_CORE + id;
  return [canonical, { canonical, display, kind, hasComponents }];
}

// Keyed by canonical URL (the meta.profile value).
export const US_CORE_OBSERVATION_PROFILES: Record<string, ObservationProfileEntry> = Object.fromEntries([
  // Lab / results
  entry('us-core-observation-lab', 'Laboratory Result', 'laboratory'),
  entry('us-core-observation-clinical-result', 'Clinical Result', 'laboratory'),
  entry('us-core-simple-observation', 'Simple Observation', 'other'),
  entry('us-core-observation-screening-assessment', 'Screening / Assessment', 'other'),
  // Vital signs (parent + subtypes)
  entry('us-core-vital-signs', 'Vital Signs', 'vital-signs'),
  entry('us-core-blood-pressure', 'Blood Pressure', 'blood-pressure', true),
  entry('us-core-average-blood-pressure', 'Average Blood Pressure', 'blood-pressure', true),
  entry('us-core-bmi', 'BMI', 'vital-signs'),
  entry('us-core-body-height', 'Body Height', 'vital-signs'),
  entry('us-core-body-weight', 'Body Weight', 'vital-signs'),
  entry('us-core-body-temperature', 'Body Temperature', 'vital-signs'),
  entry('us-core-head-circumference', 'Head Circumference', 'vital-signs'),
  entry('us-core-heart-rate', 'Heart Rate', 'vital-signs'),
  entry('us-core-pulse-oximetry', 'Pulse Oximetry', 'vital-signs'),
  entry('us-core-respiratory-rate', 'Respiratory Rate', 'vital-signs'),
  entry('pediatric-bmi-for-age', 'Pediatric BMI for Age', 'vital-signs'),
  entry('pediatric-weight-for-height', 'Pediatric Weight for Height', 'vital-signs'),
  entry('head-occipital-frontal-circumference-percentile', 'Pediatric Head Circumference Percentile', 'vital-signs'),
  // Social / behavioral
  entry('us-core-smokingstatus', 'Smoking Status', 'social-history'),
  entry('us-core-observation-occupation', 'Occupation', 'social-history'),
  entry('us-core-observation-sexual-orientation', 'Sexual Orientation', 'social-history'),
  // Preferences / intent
  entry('us-core-care-experience-preference', 'Care Experience Preference', 'preference'),
  entry('us-core-treatment-intervention-preference', 'Treatment Intervention Preference', 'preference'),
  entry('us-core-observation-pregnancyintent', 'Pregnancy Intent', 'pregnancy'),
  entry('us-core-observation-pregnancystatus', 'Pregnancy Status', 'pregnancy'),
  // Advance directives
  entry('us-core-observation-adi-documentation', 'Advance Directive Documentation', 'advance-directive'),
]);

// LOINC codes used to recognise a blood-pressure observation when meta.profile is absent.
const BP_PANEL_CODES = ['85354-9', '55284-4'];     // BP panel codes
const BP_SYSTOLIC = '8480-6';
const BP_DIASTOLIC = '8462-4';

export interface ObservationClassification {
  profile?: ObservationProfileEntry;   // matched registry entry (only when meta.profile is known)
  kind: ObservationProfileKind;        // resolved kind (from registry or inferred)
  canonical?: string;                  // the matched meta.profile URL
  inferred: boolean;                   // true => resolved via category/code fallback, not meta.profile
}

// Classify by meta.profile (primary), else infer from category + LOINC code (fallback for data that
// doesn't declare conformance — the common case for imported non-US-Core exports).
export function classifyObservationProfile(fhirResource: any): ObservationClassification {
  const metaProfiles: string[] = _.get(fhirResource, 'meta.profile', []) || [];
  for (const url of metaProfiles) {
    const matched = US_CORE_OBSERVATION_PROFILES[url];
    if (matched) {
      return { profile: matched, kind: matched.kind, canonical: url, inferred: false };
    }
  }

  // Fallback inference
  const categoryCodes: string[] = (_.get(fhirResource, 'category', []) as any[])
    .flatMap((c) => _.get(c, 'coding', []).map((cd: any) => cd.code));
  const codes: string[] = _.get(fhirResource, 'code.coding', []).map((c: any) => c.code);
  const componentCodes: string[] = (_.get(fhirResource, 'component', []) as any[])
    .flatMap((comp) => _.get(comp, 'code.coding', []).map((c: any) => c.code));

  const looksLikeBP = codes.some((c) => BP_PANEL_CODES.includes(c))
    || (componentCodes.includes(BP_SYSTOLIC) && componentCodes.includes(BP_DIASTOLIC));
  if (looksLikeBP) return { kind: 'blood-pressure', inferred: true };
  if (categoryCodes.includes('laboratory')) return { kind: 'laboratory', inferred: true };
  if (categoryCodes.includes('vital-signs')) return { kind: 'vital-signs', inferred: true };
  if (categoryCodes.includes('social-history')) return { kind: 'social-history', inferred: true };
  return { kind: 'other', inferred: true };
}
