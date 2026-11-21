/**
 * The medications page's detail columns (yourphr#1025 follow-up): frequency, sig, purpose,
 * prescriber and strength, each mapped from FHIR and each carried with its codings intact.
 * Synthetic records only, no PHI. The contract is the Angular model
 * frontend/src/app/models/fasten/reconciled-medication.ts.
 */
import { describe, expect, it } from 'vitest';
import type { Resource } from '@medplum/fhirtypes';
import { reconcile, RXNORM, toWireMedication, type MedInput, type Resolver } from '../index.js';
import { GTS_ABBREVIATION, UCUM, US_NPI, medicationDetails, ratioText, referencesToResolve, relativeReference, repeatText, strengthFromName } from '../details.js';

const SNOMED = 'http://snomed.info/sct';
const ICD10 = 'http://hl7.org/fhir/sid/icd-10-cm';
const NDC = 'http://hl7.org/fhir/sid/ndc';
const ORAL = { coding: [{ system: SNOMED, code: '26643006', display: 'Oral route' }], text: 'by mouth' };

const med = (resource: Record<string, unknown>, resolve?: Resolver, sourceId = 'src-a'): MedInput =>
  ({ resource: resource as unknown as Resource, sourceId, ...(resolve ? { resolve } : {}) });
const wire = (...inputs: MedInput[]) => reconcile(inputs).map(toWireMedication);
const resolverOf = (...resources: Record<string, any>[]): Resolver => {
  const map = new Map(resources.map((r) => [`${r['resourceType']}/${r['id']}`, r]));
  return (ref) => map.get(ref);
};

const lisinoprilConcept = {
  text: 'Lisinopril 10 MG Oral Tablet',
  coding: [
    { system: RXNORM, code: '314076', display: 'lisinopril 10 MG Oral Tablet' },
    { system: NDC, code: '68180-0513-01' },
  ],
};
const practitioner = {
  resourceType: 'Practitioner', id: 'pr1',
  name: [{ given: ['Ada'], family: 'Okafor', prefix: ['Dr.'] }],
  identifier: [{ system: US_NPI, value: '1234567893' }, { system: 'urn:internal', value: 'x-9' }],
};
const hypertension = {
  resourceType: 'Condition', id: 'c1',
  code: { text: 'High blood pressure', coding: [{ system: SNOMED, code: '38341003', display: 'Hypertensive disorder' }, { system: ICD10, code: 'I10' }] },
};
const fullRequest = {
  resourceType: 'MedicationRequest', id: 'r1', status: 'active', authoredOn: '2025-02-01',
  medicationCodeableConcept: lisinoprilConcept,
  requester: { reference: 'Practitioner/pr1', display: 'Okafor, A' },
  reasonReference: [{ reference: 'Condition/c1', display: 'HTN' }],
  dosageInstruction: [{
    sequence: 1,
    text: 'Take 1 tablet by mouth once daily',
    patientInstruction: 'Take in the morning with water',
    timing: { repeat: { frequency: 1, period: 1, periodUnit: 'd', when: ['MORN'] }, code: { coding: [{ system: GTS_ABBREVIATION, code: 'QD', display: 'QD' }], text: 'once a day' } },
    route: ORAL,
    doseAndRate: [{ type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/dose-rate-type', code: 'ordered' }] }, doseQuantity: { value: 1, unit: 'tablet', system: 'http://terminology.hl7.org/CodeSystem/v3-orderableDrugForm', code: 'TAB' } }],
  }],
};

describe('the five detail fields the page reads', () => {
  it('a fully coded MedicationRequest fills strength, frequency, sig, purpose and prescriber', () => {
    const [row] = wire(med(fullRequest, resolverOf(practitioner, hypertension)));
    expect(row).toMatchObject({
      key: 'rxnorm:314076', title: 'Lisinopril 10 MG Oral Tablet',
      strength: '10 mg', // no Medication resource: read off the RxNorm name, text only
      frequency: 'once a day',
      sig: 'Take 1 tablet by mouth once daily. Take in the morning with water',
      purpose: 'High blood pressure',
      prescriber: 'Ada Okafor',
    });
    // The contributor carries the same lines for the source-records table.
    expect(row!.contributors[0]).toMatchObject({ frequency: 'once a day', sig: row!.sig, sourceResourceId: 'r1' });
  });

  it('keeps every medication coding as recorded — RxNorm and NDC — and invents none', () => {
    const [row] = wire(med(fullRequest));
    expect(row!.originalCodings).toEqual([
      { system: RXNORM, code: '314076', display: 'lisinopril 10 MG Oral Tablet' },
      { system: NDC, code: '68180-0513-01' }, // no display recorded, none added
    ]);
    expect(row!.contributors[0]!.medication).toEqual(lisinoprilConcept);
    expect(row!.rxNormCode).toBe('314076');
  });

  it('carries the dosage FHIR: timing.code (GTS), timing.repeat, route (SNOMED) and the dose Quantity', () => {
    const [row] = wire(med(fullRequest));
    const d = row!.dosageInstruction![0]!;
    expect(d.timing?.code).toEqual({ text: 'once a day', coding: [{ system: GTS_ABBREVIATION, code: 'QD', display: 'QD' }] });
    expect(d.timing?.repeat).toEqual({ frequency: 1, period: 1, periodUnit: 'd', when: ['MORN'] });
    expect(d.route).toEqual(ORAL);
    expect(d.doseAndRate?.[0]?.doseQuantity).toEqual({ value: 1, unit: 'tablet', system: 'http://terminology.hl7.org/CodeSystem/v3-orderableDrugForm', code: 'TAB' });
    expect(d.patientInstruction).toBe('Take in the morning with water');
  });

  it('carries the reason FHIR: the referenced Condition code with SNOMED and ICD-10 codings', () => {
    const [row] = wire(med(fullRequest, resolverOf(hypertension)));
    expect(row!.reasons).toEqual([{
      concept: hypertension.code,
      reference: { reference: 'Condition/c1', type: 'Condition', display: 'High blood pressure' },
    }]);
  });

  it('carries the prescriber reference with its NPI and only its NPI', () => {
    const [row] = wire(med(fullRequest, resolverOf(practitioner)));
    expect(row!.prescriberReference).toEqual({ reference: 'Practitioner/pr1', type: 'Practitioner', display: 'Ada Okafor', identifier: [{ system: US_NPI, value: '1234567893' }] });
  });
});

describe('frequency and instructions from dosageInstruction', () => {
  it('timing.repeat reads as words when there is no timing.code', () => {
    expect(repeatText({ frequency: 2, period: 1, periodUnit: 'd' })).toBe('twice a day');
    expect(repeatText({ frequency: 1, period: 4, periodMax: 6, periodUnit: 'h' })).toBe('every 4-6 hours');
    expect(repeatText({ frequency: 3, period: 1, periodUnit: 'd', when: ['C'] })).toBe('3 times a day with meals');
    expect(repeatText({ frequency: 1, period: 1, periodUnit: 'wk', dayOfWeek: ['mon'] })).toBe('once a week on Mon');
    expect(repeatText({ timeOfDay: ['08:00:00', '20:00:00'] })).toBe('at 08:00, 20:00');
    expect(repeatText({})).toBe('');
  });

  it('several dosageInstructions are all read, in order, joined; asNeeded with its reason is stated', () => {
    const [row] = wire(med({
      resourceType: 'MedicationRequest', id: 'r2', status: 'active',
      medicationCodeableConcept: { text: 'Prednisone 10 MG Oral Tablet', coding: [{ system: RXNORM, code: '312617' }] },
      dosageInstruction: [
        { sequence: 1, timing: { repeat: { frequency: 2, period: 1, periodUnit: 'd', boundsPeriod: { start: '2025-01-01', end: '2025-01-05' } } }, route: ORAL, doseAndRate: [{ doseQuantity: { value: 2, unit: 'tablet' } }] },
        { sequence: 2, timing: { repeat: { frequency: 1, period: 1, periodUnit: 'd' } }, route: ORAL, doseAndRate: [{ doseQuantity: { value: 1, unit: 'tablet' } }] },
        { sequence: 3, asNeededCodeableConcept: { text: 'flare', coding: [{ system: SNOMED, code: '1234', display: 'Flare' }] }, text: 'Extra tablet if flare' },
      ],
    }));
    expect(row!.frequency).toBe('twice a day; once a day; as needed for flare');
    // No text: the sig is the coded parts read back — dose, route, frequency — nothing added.
    expect(row!.sig).toBe('2 tablet by mouth twice a day; 1 tablet by mouth once a day; Extra tablet if flare');
    expect(row!.dosageInstruction).toHaveLength(3);
    expect(row!.dosageInstruction![2]).toMatchObject({ asNeeded: true, asNeededFor: [{ text: 'flare', coding: [{ system: SNOMED, code: '1234', display: 'Flare' }] }] });
    expect(row!.dosageInstruction![0]!.timing?.repeat?.['boundsPeriod']).toEqual({ start: '2025-01-01', end: '2025-01-05' });
  });

  it('a dose Quantity keeps its UCUM system and code; one recorded without them gets none added', () => {
    const d = medicationDetails({
      resourceType: 'MedicationRequest', id: 'q',
      dosageInstruction: [{ doseAndRate: [{ doseQuantity: { value: 5, unit: 'mL', system: UCUM, code: 'mL' } }] }, { doseAndRate: [{ doseQuantity: { value: 1, unit: 'puff' } }] }],
    });
    expect(d.dosageInstruction![0]!.doseAndRate![0]!.doseQuantity).toEqual({ value: 5, unit: 'mL', system: UCUM, code: 'mL' });
    expect(d.dosageInstruction![1]!.doseAndRate![0]!.doseQuantity).toEqual({ value: 1, unit: 'puff' });
  });
});

describe('MedicationStatement', () => {
  it('reads dosage[], reasonCode and informationSource the same way', () => {
    const [row] = wire(med({
      resourceType: 'MedicationStatement', id: 's1', status: 'active', effectiveDateTime: '2025-03-01',
      medicationCodeableConcept: { text: 'Metformin 500 MG Oral Tablet', coding: [{ system: RXNORM, code: '861007' }] },
      reasonCode: [{ coding: [{ system: SNOMED, code: '44054006', display: 'Diabetes mellitus type 2' }, { system: ICD10, code: 'E11.9', display: 'Type 2 diabetes mellitus without complications' }] }],
      informationSource: { reference: 'Organization/o1', display: 'Clinic (display)' },
      dosage: [{ text: '500 mg twice daily with meals', timing: { code: { coding: [{ system: GTS_ABBREVIATION, code: 'BID', display: 'BID' }] } } }],
    }, resolverOf({ resourceType: 'Organization', id: 'o1', name: 'Riverside Family Practice' })));
    expect(row).toMatchObject({ frequency: 'BID', sig: '500 mg twice daily with meals', purpose: 'Diabetes mellitus type 2', prescriber: 'Riverside Family Practice', strength: '500 mg' });
    expect(row!.reasons![0]!.concept!.coding).toEqual([
      { system: SNOMED, code: '44054006', display: 'Diabetes mellitus type 2' },
      { system: ICD10, code: 'E11.9', display: 'Type 2 diabetes mellitus without complications' },
    ]);
    expect(row!.prescriberReference).toEqual({ reference: 'Organization/o1', type: 'Organization', display: 'Riverside Family Practice' });
  });

  it('a patient reporting their own medication is not a prescriber', () => {
    const [row] = wire(med({
      resourceType: 'MedicationStatement', id: 's2', status: 'active', medicationCodeableConcept: { text: 'Vitamin D' },
      informationSource: { reference: 'Patient/p1', display: 'Me' },
    }));
    expect(row!.prescriber).toBeUndefined();
    expect(row!.prescriberReference).toBeUndefined();
  });

  it('R5 shapes: medication CodeableReference, reason[] and informationSource[] are accepted', () => {
    const [row] = wire(med({
      resourceType: 'MedicationStatement', id: 's3', status: 'recorded',
      medication: { concept: { text: 'Atorvastatin 20 MG Oral Tablet', coding: [{ system: RXNORM, code: '617312' }] } },
      reason: [{ concept: { text: 'High cholesterol' } }, { reference: { reference: 'Condition/c1', display: 'HTN' } }],
      informationSource: [{ reference: 'Practitioner/pr1' }],
    }, resolverOf(practitioner, hypertension)));
    expect(row).toMatchObject({ rxNormCode: '617312', purpose: 'High cholesterol; High blood pressure', prescriber: 'Ada Okafor', strength: '20 mg' });
  });
});

describe('strength from Medication.ingredient', () => {
  const medication = (id: string, extra: Record<string, unknown> = {}) => ({
    resourceType: 'Medication', id,
    code: { text: 'Acetaminophen 325 MG Oral Tablet', coding: [{ system: RXNORM, code: '313782', display: 'acetaminophen 325 MG Oral Tablet' }] },
    ingredient: [{
      itemCodeableConcept: { coding: [{ system: RXNORM, code: '161', display: 'Acetaminophen' }] },
      isActive: true,
      strength: { numerator: { value: 325, unit: 'mg', system: UCUM, code: 'mg' }, denominator: { value: 1, unit: 'TAB', system: 'http://terminology.hl7.org/CodeSystem/v3-orderableDrugForm', code: 'TAB' } },
    }],
    ...extra,
  });

  it('a contained Medication (medicationReference "#id") gives name, codes and strength', () => {
    const [row] = wire(med({
      resourceType: 'MedicationRequest', id: 'r3', status: 'active',
      contained: [medication('m1')],
      medicationReference: { reference: '#m1' },
    }));
    expect(row).toMatchObject({ key: 'rxnorm:313782', title: 'Acetaminophen 325 MG Oral Tablet', strength: '325 mg' });
    expect(row!.ingredients).toEqual([{
      item: { coding: [{ system: RXNORM, code: '161', display: 'Acetaminophen' }] },
      isActive: true,
      strengthRatio: { numerator: { value: 325, unit: 'mg', system: UCUM, code: 'mg' }, denominator: { value: 1, unit: 'TAB', system: 'http://terminology.hl7.org/CodeSystem/v3-orderableDrugForm', code: 'TAB' } },
      strength: '325 mg',
    }]);
    expect(row!.originalCodings).toEqual([{ system: RXNORM, code: '313782', display: 'acetaminophen 325 MG Oral Tablet' }]);
  });

  it('a referenced Medication resolves through the resolver; unresolved, only its display is used', () => {
    const resolved = wire(med({ resourceType: 'MedicationRequest', id: 'r4', status: 'active', medicationReference: { reference: 'Medication/m2', display: 'Tylenol' } }, resolverOf(medication('m2'))));
    expect(resolved[0]).toMatchObject({ rxNormCode: '313782', strength: '325 mg' });
    expect(resolved[0]!.contributors[0]!.medicationReference).toEqual({ reference: 'Medication/m2', type: 'Medication', display: 'Acetaminophen 325 MG Oral Tablet' });
    const unresolved = wire(med({ resourceType: 'MedicationRequest', id: 'r5', status: 'active', medicationReference: { reference: 'Medication/m404', display: 'Tylenol' } }));
    expect(unresolved[0]).toMatchObject({ title: 'Tylenol', key: 'text:tylenol' });
    expect(unresolved[0]!.strength).toBeUndefined();
    expect(unresolved[0]!.ingredients).toBeUndefined();
    expect(unresolved[0]!.originalCodings).toBeUndefined();
  });

  it('R5 strengthRatio / strengthQuantity and item CodeableReference; measured denominators stay', () => {
    const d = medicationDetails({
      resourceType: 'MedicationDispense', id: 'd1',
      contained: [{ resourceType: 'Medication', id: 'm3', code: { text: 'Combo' }, ingredient: [
        { item: { concept: { text: 'Amoxicillin' } }, strengthRatio: { numerator: { value: 250, unit: 'mg', system: UCUM, code: 'mg' }, denominator: { value: 5, unit: 'mL', system: UCUM, code: 'mL' } } },
        { item: { concept: { text: 'Clavulanate' } }, strengthQuantity: { value: 62.5, unit: 'mg', system: UCUM, code: 'mg' } },
        { item: { concept: { text: 'Flavour' } }, isActive: false, strengthQuantity: { value: 1, unit: 'mg' } },
      ] }],
      medication: { reference: { reference: '#m3' } },
    });
    expect(d.strength).toBe('250 mg/5 mL / 62.5 mg'); // the inactive ingredient is kept in `ingredients`, not in the line
    expect(d.ingredients).toHaveLength(3);
    expect(d.ingredients![1]!.strengthQuantity).toEqual({ value: 62.5, unit: 'mg', system: UCUM, code: 'mg' });
    expect(ratioText({ numerator: { value: 5, unit: 'mg' }, denominator: { value: 1, unit: 'mL', system: UCUM, code: 'mL' } })).toBe('5 mg/mL');
  });

  it('the drug name is the last resort, as text only', () => {
    expect(strengthFromName('Amoxicillin 250 MG/5ML Oral Suspension')).toBe('250 mg/5 mL');
    expect(strengthFromName('Acetaminophen 325 MG / Hydrocodone Bitartrate 5 MG Oral Tablet')).toBe('325 mg / 5 mg');
    expect(strengthFromName('Aspirin')).toBe('');
  });
});

describe('missing data: omitted, never null, never a crash', () => {
  it('a bare record gives none of the detail fields', () => {
    const [row] = wire(med({ resourceType: 'MedicationRequest', id: 'n1', status: 'active' }));
    for (const field of ['strength', 'frequency', 'sig', 'purpose', 'prescriber', 'originalCodings', 'dosageInstruction', 'reasons', 'prescriberReference', 'ingredients']) {
      expect(row).not.toHaveProperty(field);
    }
    expect(JSON.stringify(row)).not.toContain('null');
  });

  it('malformed and partial shapes are tolerated', () => {
    expect(() => wire(med({
      resourceType: 'MedicationRequest', id: 'n2', status: 'active',
      medicationReference: { reference: '#nope' }, requester: {}, reasonReference: [{}], reasonCode: [{}],
      dosageInstruction: [{}, { timing: {} }, { doseAndRate: [{}] }],
      contained: [{ resourceType: 'Medication', id: 'x', ingredient: [{}, { strength: {} }] }],
    }))).not.toThrow();
    const d = medicationDetails({ resourceType: 'MedicationRequest', id: 'n3', requester: { display: 'Dr. Display Only' }, reasonReference: [{ reference: 'Condition/gone', display: 'Back pain' }] });
    expect(d).toMatchObject({ prescriber: 'Dr. Display Only', purpose: 'Back pain' });
    expect(d.reasons).toEqual([{ reference: { reference: 'Condition/gone', type: 'Condition', display: 'Back pain' } }]);
  });

  it('row details follow request > statement > dispense, codes from the same record as the line', () => {
    const [row] = wire(
      med({ resourceType: 'MedicationDispense', id: 'd9', status: 'completed', medicationCodeableConcept: lisinoprilConcept, dosageInstruction: [{ text: 'dispense label text' }] }),
      med({ resourceType: 'MedicationStatement', id: 's9', status: 'active', medicationCodeableConcept: lisinoprilConcept, reasonCode: [{ text: 'BP' }] }),
      med({ resourceType: 'MedicationRequest', id: 'r9', status: 'active', medicationCodeableConcept: lisinoprilConcept, dosageInstruction: [{ text: 'prescribed text' }] }),
    );
    expect(row).toMatchObject({ sig: 'prescribed text', purpose: 'BP' });
    expect(row!.dosageInstruction).toEqual([{ text: 'prescribed text' }]);
    expect(row!.contributors.map((c) => c.sig ?? '')).toEqual(['prescribed text', '', 'dispense label text']);
  });
});

describe('references', () => {
  it('relative references are normalised; contained ones are not fetched', () => {
    expect(relativeReference('https://ehr.example/fhir/Practitioner/p1/_history/2')).toBe('Practitioner/p1');
    expect(relativeReference('#m1')).toBeUndefined();
    expect(relativeReference('urn:uuid:abc')).toBeUndefined();
    expect(referencesToResolve(fullRequest).sort()).toEqual(['Condition/c1', 'Practitioner/pr1']);
  });
});
