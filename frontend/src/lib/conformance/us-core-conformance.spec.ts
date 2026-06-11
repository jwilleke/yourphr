// US Core 9.0.0 display-conformance verification (#248).
//
// Repeatable gate: for each audited US Core profile, build its display model from the *official*
// US Core 9.0.0 example (pinned under fixtures/us-core/) and assert the model surfaces every
// Must-Support element the example exercises. The expected state per element lives in
// `us-core-conformance.ts` (`status: 'displayed' | 'gap'`); this spec enforces it, so a regression
// (a 'displayed' element stops surfacing) OR an improvement (a 'gap' starts surfacing) both fail
// the build until the registry + `docs/us-core/conformance-coverage.md` are updated to match.
//
// Elements not populated by the official example are reported pending (N/A) — Must-Support means
// "display when present", and that example can't verify what it doesn't contain.

import { fhirVersions } from '../models/constants';
import { US_CORE_CONFORMANCE, MsElement, UsCoreProfileConformance } from './us-core-conformance';

import { PatientModel } from '../models/resources/patient-model';
import { ConditionModel } from '../models/resources/condition-model';
import { AllergyIntoleranceModel } from '../models/resources/allergy-intolerance-model';
import { MedicationRequestModel } from '../models/resources/medication-request-model';
import { ObservationModel } from '../models/resources/observation-model';
import { DocumentReferenceModel } from '../models/resources/document-reference-model';

import * as patientExample from '../fixtures/us-core/9.0.0/patient/Patient-example.json';
import * as conditionExample from '../fixtures/us-core/9.0.0/condition/Condition-health-concern-example.json';
import * as allergyExample from '../fixtures/us-core/9.0.0/allergy-intolerance/AllergyIntolerance-example.json';
import * as medicationRequestExample from '../fixtures/us-core/9.0.0/medication-request/MedicationRequest-medicationrequest-coded-oral-axid.json';
import * as observationLabExample from '../fixtures/us-core/9.0.0/observation/Observation-cbc-hemoglobin.json';
import * as documentReferenceExample from '../fixtures/us-core/9.0.0/document-reference/DocumentReference-discharge-summary.json';

// canonical → { official example resource, display-model builder }
const BUILDERS: Record<string, { raw: any; build: () => any }> = {
  'http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient':
    { raw: patientExample, build: () => new PatientModel(patientExample as any, fhirVersions.R4) },
  'http://hl7.org/fhir/us/core/StructureDefinition/us-core-condition-problems-health-concerns':
    { raw: conditionExample, build: () => new ConditionModel(conditionExample as any, fhirVersions.R4) },
  'http://hl7.org/fhir/us/core/StructureDefinition/us-core-allergyintolerance':
    { raw: allergyExample, build: () => new AllergyIntoleranceModel(allergyExample as any, fhirVersions.R4) },
  'http://hl7.org/fhir/us/core/StructureDefinition/us-core-medicationrequest':
    { raw: medicationRequestExample, build: () => new MedicationRequestModel(medicationRequestExample as any, fhirVersions.R4) },
  'http://hl7.org/fhir/us/core/StructureDefinition/us-core-observation-lab':
    { raw: observationLabExample, build: () => new ObservationModel(observationLabExample as any, fhirVersions.R4) },
  'http://hl7.org/fhir/us/core/StructureDefinition/us-core-documentreference':
    { raw: documentReferenceExample, build: () => new DocumentReferenceModel(documentReferenceExample as any, fhirVersions.R4) },
};

interface CoverageRow {
  profile: string;
  kind: 'MS' | 'extra';
  element: string;
  exercised: boolean;
  surfaced: boolean | null; // null = not exercised by the example
  status: string;
}

describe('US Core 9.0.0 display conformance (#248)', () => {
  const coverage: CoverageRow[] = [];

  US_CORE_CONFORMANCE.forEach((profile: UsCoreProfileConformance) => {
    describe(profile.profile, () => {
      const b = BUILDERS[profile.canonical];
      let model: any;

      beforeAll(() => { model = b.build(); });

      it('a builder + official example are wired for this profile', () => {
        expect(b).withContext(`no BUILDERS entry for ${profile.canonical}`).toBeTruthy();
      });

      it(`official example declares ${profile.canonical}`, () => {
        const declared = (b.raw.meta?.profile || []).map((p: string) => String(p).split('|')[0]);
        expect(declared).toContain(profile.canonical);
      });

      const verify = (el: MsElement, kind: 'MS' | 'extra') => {
        it(`${kind} ${el.path} [${el.status}]`, () => {
          const exercised = el.present(b.raw);
          if (!exercised) {
            coverage.push({ profile: profile.profile, kind, element: el.path, exercised: false, surfaced: null, status: el.status });
            pending('not populated by the official example (Must-Support is "display when present")');
            return;
          }
          const surfaced = el.surfaced(model);
          coverage.push({ profile: profile.profile, kind, element: el.path, exercised: true, surfaced, status: el.status });
          // 'displayed' must surface; a known 'gap' must not (documents the gap + flags when it's fixed).
          expect(surfaced)
            .withContext(`${el.path}: expected status='${el.status}' (${el.note || ''})`)
            .toBe(el.status === 'displayed');
        });
      };

      profile.mustSupport.forEach((el) => verify(el, 'MS'));
      (profile.additional || []).forEach((el) => verify(el, 'extra'));
    });
  });

  afterAll(() => {
    const ms = coverage.filter((r) => r.kind === 'MS');
    const exercised = ms.filter((r) => r.exercised);
    const displayed = exercised.filter((r) => r.surfaced === true);
    const gaps = exercised.filter((r) => r.surfaced !== true);
    // Surfaced as a quick console summary when running `ng test` locally.
    // eslint-disable-next-line no-console
    console.log(
      `\n[US Core 9.0.0 display conformance #248] MS elements exercised by official examples: ` +
      `${displayed.length}/${exercised.length} displayed` +
      (gaps.length ? `; gaps: ${gaps.map((g) => g.element).join(', ')}` : '') + `\n`
    );
  });
});
