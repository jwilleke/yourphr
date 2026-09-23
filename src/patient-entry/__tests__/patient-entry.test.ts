import { describe, expect, it } from 'vitest';
import { PATIENT_ENTRY_SOURCE, PatientEntryError, buildPatientVital } from '../index.js';
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
    const { observation, review } = buildPatientVital({ kind: 'allergy', vital: 'penicillin' }, NOW);
    expect(observation.code).toEqual({ text: 'penicillin' });
    expect(review.some((r) => r.includes('belongs in its own kind of record'))).toBe(true);
    expect(tagged(observation)).toBe(true);
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
