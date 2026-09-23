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

describe('what it refuses, rather than storing something adjacent', () => {
  const refuses = (req: Parameters<typeof buildPatientVital>[0], message: string) => {
    expect(() => buildPatientVital(req, NOW)).toThrow(PatientEntryError);
    expect(() => buildPatientVital(req, NOW)).toThrow(message);
  };

  it('an unknown vital, rather than filing it as something near it', () => {
    refuses({ vital: 'blood_sugar', value: 5.5 }, 'unknown vital "blood_sugar"');
  });

  it('a kind this release does not support', () => {
    refuses({ kind: 'allergy', vital: 'body_weight', value: 70 }, 'kind=vital only');
  });

  it('a missing value, and half a blood pressure', () => {
    refuses({ vital: 'body_weight' }, 'value is required for body_weight');
    refuses({ vital: 'blood_pressure', systolic: 120 }, 'systolic and diastolic are required');
  });

  it('a date it cannot read — better an error on the form than a record dated wrongly', () => {
    refuses({ vital: 'heart_rate', value: 64, effective_date_time: 'last tuesday' }, 'RFC3339 or YYYY-MM-DD');
  });

  it('a vital that was not named at all', () => {
    refuses({ value: 70 }, 'vital is required');
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

  it('falls back to the code text rather than inventing one when the record states no value yet', () => {
    expect(titleFor({ resourceType: 'Observation', code: { text: 'Lipid panel' } })).toBe('Lipid panel');
    expect(titleFor({ resourceType: 'Observation', code: { text: 'Blood pressure' }, component: [{ code: { coding: [{ code: '8480-6' }] } }] })).toBe('Blood pressure');
  });
});
