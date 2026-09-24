import { describe, expect, it } from 'vitest';
import { PATIENT_ENTRY_SOURCE, PatientEntryError, buildPatientRecord, buildPatientVital } from '../index.js';
import { titleFor } from '../../server.js';

/** Fixed, so the default-time assertion is about the shape rather than the clock. */
const NOW = new Date('2026-09-23T10:30:00.000Z');

describe('a vital the patient measured', () => {
  it('is a US Core vital-signs Observation with the LOINC code Go used', () => {
    const { observation, sortTitle } = buildPatientVital({ vital: 'body_weight', value: 72.5, effective_date_time: '2026-09-20' }, NOW);
    expect(observation).toMatchObject({
      resourceType: 'Observation',
      status: 'final',
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'vital-signs' }] }],
      code: { coding: [{ system: 'http://loinc.org', code: '29463-7', display: 'Body weight' }] },
      effectiveDateTime: '2026-09-20',
      valueQuantity: { value: 72.5, unit: 'kg', system: 'http://unitsofmeasure.org', code: 'kg' },
    });
    expect(sortTitle).toBe('Body weight 72.5 kg');
    expect(observation.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('says it is patient-reported, so it can never be mistaken for what a hospital asserted', () => {
    const { observation } = buildPatientVital({ vital: 'heart_rate', value: 64 }, NOW);
    expect(observation.meta).toMatchObject({
      source: PATIENT_ENTRY_SOURCE,
      tag: [{ system: 'https://yourphr.org/fhir/CodeSystem/record-origin', code: 'patient-reported' }],
    });
  });

  it('carries a blood pressure as two components, not one value', () => {
    const { observation, sortTitle } = buildPatientVital({ vital: 'blood_pressure', systolic: 128, diastolic: 78 }, NOW);
    expect(observation.code?.coding?.[0]?.code).toBe('85354-9');
    expect(observation.valueQuantity).toBeUndefined();
    expect(observation.component?.map((c) => [c.code?.coding?.[0]?.code, c.valueQuantity?.value, c.valueQuantity?.code])).toEqual([
      ['8480-6', 128, 'mm[Hg]'],
      ['8462-4', 78, 'mm[Hg]'],
    ]);
    expect(sortTitle).toBe('Blood pressure 128/78 mmHg');
  });

  it('keeps the canonical UCUM code when the person types a friendlier unit — a coded unit is what makes it comparable', () => {
    const { observation, sortTitle } = buildPatientVital({ vital: 'heart_rate', value: 64, unit: 'bpm' }, NOW);
    expect(observation.valueQuantity).toEqual({ value: 64, unit: 'bpm', system: 'http://unitsofmeasure.org', code: '/min' });
    expect(sortTitle).toBe('Heart rate 64 bpm');
  });

  it('accepts the v2-era aliases, so a client written against Go still works', () => {
    for (const [alias, code] of [['weight', '29463-7'], ['pulse', '8867-4'], ['temperature', '8310-5'], ['spo2', '2708-6'], ['bp', '85354-9']] as const) {
      const req = code === '85354-9' ? { vital: alias, systolic: 120, diastolic: 80 } : { vital: alias, value: 1 };
      expect(buildPatientVital(req, NOW).observation.code?.coding?.[0]?.code, alias).toBe(code);
    }
  });

  it('defaults the time to now in UTC, and never invents a time zone for a date-only entry', () => {
    expect(buildPatientVital({ vital: 'heart_rate', value: 64 }, NOW).observation.effectiveDateTime).toBe('2026-09-23T10:30:00Z');
    expect(buildPatientVital({ vital: 'heart_rate', value: 64, effective_date_time: '2026-09-01' }, NOW).observation.effectiveDateTime).toBe('2026-09-01');
  });
});

describe('what it keeps when it cannot code what was said (yourphr#696)', () => {
  const tagged = (o: { meta?: { tag?: { code?: string }[] } }) => (o.meta?.tag ?? []).some((t) => t.code === 'needs-review');

  it('stores an unknown measurement as the person\'s own words, uncoded, for review', () => {
    const { observation, sortTitle, review } = buildPatientVital({ vital: 'peak flow', value: 400, unit: 'L/min' }, NOW);
    expect(observation.code).toEqual({ text: 'peak flow' }); // no coding invented
    expect(observation.valueQuantity).toBeUndefined(); // nor a value hung off a code that is not there
    expect(sortTitle).toBe('peak flow');
    expect(review[0]).toContain('not a measurement this release knows how to code');
    expect(tagged(observation)).toBe(true);
  });

  it('keeps half a blood pressure — 128 is a fact — and says the other half is missing', () => {
    const { observation, sortTitle, review } = buildPatientVital({ vital: 'blood_pressure', systolic: 128 }, NOW);
    expect(observation.component).toEqual([
      { code: expect.objectContaining({ text: 'Systolic blood pressure' }), valueQuantity: { value: 128, unit: 'mm[Hg]', system: 'http://unitsofmeasure.org', code: 'mm[Hg]' } },
    ]);
    expect(sortTitle).toBe('Blood pressure 128 systolic mmHg');
    expect(review[0]).toContain('only the systolic half');
    expect(tagged(observation)).toBe(true);
  });

  it('leaves a record with NO date when the date cannot be read, rather than dating it today', () => {
    const { observation, review } = buildPatientVital({ vital: 'heart_rate', value: 64, effective_date_time: 'last tuesday' }, NOW);
    expect(observation.effectiveDateTime).toBeUndefined();
    expect(observation.valueQuantity?.value).toBe(64); // the reading is still kept
    expect(review[0]).toContain('could not be read');
    expect(tagged(observation)).toBe(true);
  });

  it('keeps a kind it cannot yet store in its own resource type, and says so', () => {
    const { resource, review } = buildPatientRecord({ kind: 'procedure', name: 'knee arthroscopy' }, NOW);
    expect(resource.resourceType).toBe('Observation'); // kept, in the only shape available
    expect((resource as { code?: unknown }).code).toEqual({ text: 'knee arthroscopy' });
    expect(review.some((r) => r.includes('cannot yet store a "procedure"'))).toBe(true);
    expect(tagged(resource as { meta?: { tag?: { code?: string }[] } })).toBe(true);
  });

  it('records a measurement with no reading yet, rather than dropping the fact that it was named', () => {
    const { observation, review } = buildPatientVital({ vital: 'body_weight' }, NOW);
    expect(observation.code?.coding?.[0]?.code).toBe('29463-7');
    expect(observation.valueQuantity).toBeUndefined();
    expect(review[0]).toContain('no reading was given');
  });

  it('refuses ONLY an empty submission — no name and no reading is not a fact', () => {
    expect(() => buildPatientVital({}, NOW)).toThrow(PatientEntryError);
    expect(() => buildPatientVital({}, NOW)).toThrow('there is nothing to record');
  });

  it('marks nothing for review when everything was understood', () => {
    const { observation, review } = buildPatientVital({ vital: 'heart_rate', value: 64 }, NOW);
    expect(review).toEqual([]);
    expect(tagged(observation)).toBe(false);
  });
});

describe('a home glucose reading (yourphr#696)', () => {
  it('is coded by the UNIT, because the unit says which quantity was measured', () => {
    expect(buildPatientVital({ vital: 'blood_sugar', value: 96, unit: 'mg/dL' }, NOW).observation.code?.coding?.[0]?.code).toBe('41653-7');
    expect(buildPatientVital({ vital: 'blood_sugar', value: 5.3, unit: 'mmol/L' }, NOW).observation.code?.coding?.[0]?.code).toBe('14743-9');
    expect(buildPatientVital({ vital: 'glucose', value: 96 }, NOW).observation.code?.coding?.[0]?.code).toBe('41653-7'); // mg/dL by default
  });

  it('is a laboratory observation, not a vital sign — a finger-stick is a lab value wherever it was taken', () => {
    const { observation } = buildPatientVital({ vital: 'blood_sugar', value: 96 }, NOW);
    expect(observation.category?.[0]?.coding?.[0]?.code).toBe('laboratory');
  });

  it('leaves a reading in an unrecognised unit uncoded for review, rather than guessing the specimen', () => {
    const { observation, review } = buildPatientVital({ vital: 'blood_sugar', value: 96, unit: 'g/L' }, NOW);
    expect(observation.code).toEqual({ text: 'blood sugar' });
    expect(review[0]).toContain('unit "g/L" was not recognised');
  });
});

describe('who the record is about and who measured it (PGHD)', () => {
  it('states both, when the caller gives the person record', () => {
    const { observation } = buildPatientVital({ vital: 'heart_rate', value: 64 }, NOW, { subject: 'Patient/self-1' });
    expect(observation.subject).toEqual({ reference: 'Patient/self-1' });
    expect(observation.performer).toEqual([{ reference: 'Patient/self-1' }]);
  });

  // yourphr#764: what measured it is evidence, and only ever what the person said.
  it('states the device when one was named', () => {
    const { observation } = buildPatientVital({ vital: 'blood_pressure', systolic: 128, diastolic: 78 }, NOW, { subject: 'Patient/self-1', device: 'Device/cuff-1' });
    expect(observation.device).toEqual({ reference: 'Device/cuff-1' });
  });

  it('leaves the device absent when none was named — a remembered reading is not a measured one', () => {
    expect(buildPatientVital({ vital: 'heart_rate', value: 64 }, NOW, { subject: 'Patient/self-1' }).observation.device).toBeUndefined();
    // Nor is one inferred from a value or a unit: mg/dL does not mean a meter produced it.
    expect(buildPatientVital({ vital: 'blood_sugar', value: 96, unit: 'mg/dL' }, NOW, { subject: 'Patient/self-1' }).observation.device).toBeUndefined();
  });
});

describe('what the record list shows for a vital (yourphr#696, and the display rule in #262)', () => {
  it('shows the measurement, not the LOINC panel name — the reason a saved 128/78 read as "Blood pressure panel with all children optional"', () => {
    const { observation } = buildPatientVital({ vital: 'blood_pressure', systolic: 128, diastolic: 78 }, NOW);
    expect(titleFor(observation)).toBe('Blood pressure 128/78 mmHg');
  });

  it('names the measurement for a single-value vital', () => {
    expect(titleFor(buildPatientVital({ vital: 'body_weight', value: 72.5 }, NOW).observation)).toBe('Body weight 72.5 kg');
    expect(titleFor(buildPatientVital({ vital: 'oxygen_saturation', value: 97 }, NOW).observation)).toBe('Oxygen saturation in Arterial blood 97 %');
  });

  it('does the same for an imported observation, since the gap was never specific to hand-entered records', () => {
    const fromEpic = {
      resourceType: 'Observation',
      code: { text: 'Hemoglobin A1c', coding: [{ system: 'http://loinc.org', code: '4548-4' }] },
      valueQuantity: { value: 5.9, unit: '%' },
    };
    expect(titleFor(fromEpic)).toBe('Hemoglobin A1c 5.9 %');
  });

  it('names half a reading too, rather than falling back to the panel LOINC display (yourphr#696)', () => {
    const { observation } = buildPatientVital({ vital: 'blood_pressure', systolic: 128 }, NOW);
    expect(titleFor(observation)).toBe('Blood pressure 128 systolic mmHg');
    expect(titleFor(buildPatientVital({ vital: 'blood_pressure', diastolic: 78 }, NOW).observation)).toBe('Blood pressure 78 diastolic mmHg');
  });

  it('falls back to the code text rather than inventing one when the record states no value yet', () => {
    expect(titleFor({ resourceType: 'Observation', code: { text: 'Lipid panel' } })).toBe('Lipid panel');
    expect(titleFor({ resourceType: 'Observation', code: { text: 'Blood pressure' }, component: [{ code: { coding: [{ code: '8480-6' }] } }] })).toBe('Blood pressure');
  });
});


describe('an allergy the patient states (yourphr#763)', () => {
  it('is an AllergyIntolerance about the person, asserted by the person — not an Observation wearing a label', () => {
    const { resource, sortTitle } = buildPatientRecord({ kind: 'allergy', name: 'penicillin' }, NOW, { subject: 'Patient/self-1' });
    expect(resource).toMatchObject({
      resourceType: 'AllergyIntolerance',
      code: { text: 'penicillin' },
      patient: { reference: 'Patient/self-1' },
      asserter: { reference: 'Patient/self-1' }, // who says so: the PGHD pattern, stated in FHIR's own field
      recordedDate: '2026-09-23T10:30:00Z',
    });
    expect(sortTitle).toBe('Allergy to penicillin');
  });

  it('invents no criticality, severity, reaction or verification — the form never asked', () => {
    const { resource } = buildPatientRecord({ kind: 'allergy', name: 'penicillin' }, NOW, { subject: 'Patient/self-1' });
    const allergy = resource as unknown as Record<string, unknown>;
    expect(allergy['criticality']).toBeUndefined();
    expect(allergy['reaction']).toBeUndefined();
    expect(allergy['verificationStatus']).toBeUndefined();
    expect(allergy['clinicalStatus']).toBeUndefined();
  });

  it('waits for the person, because nothing has matched the substance to a coded one', () => {
    const { resource, review } = buildPatientRecord({ kind: 'allergy', name: 'penicillin' }, NOW, { subject: 'Patient/self-1' });
    expect(review[0]).toContain('nothing has matched it to a known substance');
    expect(((resource.meta?.tag ?? []) as { code?: string }[]).some((t) => t.code === 'needs-review')).toBe(true);
    expect((resource as { note?: { text?: string }[] }).note?.[0]?.text).toBe(review[0]);
  });

  it('takes the substance under the older field name too, so a v2-era client still works', () => {
    expect((buildPatientRecord({ kind: 'allergy', vital: 'shellfish' }, NOW).resource as { code?: { text?: string } }).code?.text).toBe('shellfish');
  });

  it('refuses only an unnamed allergy — there is no fact in it', () => {
    expect(() => buildPatientRecord({ kind: 'allergy' }, NOW)).toThrow(PatientEntryError);
  });

  it('leaves the record undated rather than dating it today when the date cannot be read', () => {
    const { resource, review } = buildPatientRecord({ kind: 'allergy', name: 'penicillin', effective_date_time: 'last spring' }, NOW);
    expect((resource as { recordedDate?: string }).recordedDate).toBeUndefined();
    expect(review.some((r) => r.includes('could not be read'))).toBe(true);
  });
});

describe('a medication the patient says they take (yourphr#763)', () => {
  it('is a MedicationStatement about the person, sourced to the person', () => {
    const { resource, sortTitle } = buildPatientRecord({ kind: 'medication', name: 'metformin 500mg', status: 'active' }, NOW, { subject: 'Patient/self-1' });
    expect(resource).toMatchObject({
      resourceType: 'MedicationStatement',
      status: 'active',
      medicationCodeableConcept: { text: 'metformin 500mg' },
      subject: { reference: 'Patient/self-1' },
      informationSource: { reference: 'Patient/self-1' },
      dateAsserted: '2026-09-23T10:30:00Z',
    });
    expect(sortTitle).toBe('metformin 500mg');
  });

  // FHIR R4 requires a status. "unknown" is its own value for one nobody stated — "active" would be
  // this instance asserting that they take it today.
  it('says unknown, not active, when the person did not say whether they still take it', () => {
    const { resource, review } = buildPatientRecord({ kind: 'medication', name: 'metformin' }, NOW);
    expect((resource as { status?: string }).status).toBe('unknown');
    expect(review.some((r) => r.includes('did not say whether you are still taking this'))).toBe(true);
  });

  it('keeps a stopped medication as stopped — it is still a fact about them', () => {
    const { resource, review } = buildPatientRecord({ kind: 'medication', name: 'lisinopril', status: 'stopped' }, NOW);
    expect((resource as { status?: string }).status).toBe('stopped');
    expect(review.some((r) => r.includes('did not say whether'))).toBe(false);
  });

  it('invents no dose, route or frequency, and no coding', () => {
    const { resource } = buildPatientRecord({ kind: 'medication', name: 'metformin', status: 'active' }, NOW);
    const statement = resource as unknown as Record<string, unknown>;
    expect(statement['dosage']).toBeUndefined();
    expect((statement['medicationCodeableConcept'] as { coding?: unknown }).coding).toBeUndefined();
  });

  it('refuses only an unnamed medication', () => {
    expect(() => buildPatientRecord({ kind: 'medication' }, NOW)).toThrow(PatientEntryError);
  });
});

describe('what the record list shows for the kinds added in yourphr#763', () => {
  it('names an allergy by what it is an allergy to, so a mixed list reads as sentences', () => {
    const { resource } = buildPatientRecord({ kind: 'allergy', name: 'penicillin' }, NOW);
    expect(titleFor(resource)).toBe('Allergy to penicillin');
    // The same for one a provider sent: the display gap was never specific to hand-entered records.
    expect(titleFor({ resourceType: 'AllergyIntolerance', code: { coding: [{ display: 'Peanut' }] } })).toBe('Allergy to Peanut');
  });

  it('names a medication by the medicine, which is what the record states', () => {
    const { resource, sortTitle } = buildPatientRecord({ kind: 'medication', name: 'metformin 500mg', status: 'active' }, NOW);
    expect(titleFor(resource)).toBe('metformin 500mg');
    expect(titleFor(resource)).toBe(sortTitle); // the queue and the list must not disagree (yourphr#762)
  });
});
