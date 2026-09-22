import { describe, expect, it } from 'vitest';
import { decodeCapability, encodeCapability, narrowTypes, searchableByPatient, type SourceCapability } from '../capability.js';

/** Shaped as Epic's own statement is (read live 2026-09-22), trimmed to the types under test. */
const epic: SourceCapability = {
  readAt: 1_700_000_000,
  fhirVersion: '4.0.1',
  everything: false,
  types: {
    Patient: ['_id', 'identifier', 'family', 'birthdate'], // no `patient` parameter — Patient is READ by id
    Observation: ['patient', 'category', 'code', 'date'],
    Condition: ['patient', 'category', 'clinical-status'],
    Binary: ['_id'], // present, but not searchable within a patient
  },
};

describe('what a server says it can be searched by', () => {
  it('accepts `patient` or `subject`, and nothing else', () => {
    expect(searchableByPatient(epic, 'Observation')).toBe(true);
    expect(searchableByPatient({ ...epic, types: { Thing: ['subject'] } }, 'Thing')).toBe(true);
    expect(searchableByPatient(epic, 'Binary')).toBe(false);
    expect(searchableByPatient(epic, 'CarePlan')).toBe(false); // absent entirely
  });
});

describe('narrowing the type list', () => {
  it('keeps what the server serves and can search, and says why it dropped the rest', () => {
    const { keep, dropped } = narrowTypes(epic, ['Observation', 'Condition', 'Binary', 'MedicationStatement']);
    expect(keep).toEqual(['Observation', 'Condition']);
    expect(dropped).toEqual([
      { type: 'Binary', reason: 'the server serves it but not by patient' },
      { type: 'MedicationStatement', reason: 'the server does not serve it' },
    ]);
  });

  it('keeps Patient whenever the server has it at all — it is READ by id, never searched (yourphr#753)', () => {
    expect(narrowTypes(epic, ['Patient']).keep).toEqual(['Patient']);
    expect(narrowTypes({ ...epic, types: { Observation: ['patient'] } }, ['Patient']).dropped).toEqual([
      { type: 'Patient', reason: 'the server does not serve it' },
    ]);
  });

  it('never widens: a type the server serves but nobody asked for stays unasked', () => {
    expect(narrowTypes(epic, ['Condition']).keep).toEqual(['Condition']);
  });
});

describe('storing the summary', () => {
  it('round-trips', () => {
    expect(decodeCapability(encodeCapability(epic))).toEqual(epic);
  });

  it('treats an empty, truncated or foreign value as "never read" rather than throwing — a stored summary is a cache, not a source of truth', () => {
    expect(decodeCapability('')).toBeUndefined();
    expect(decodeCapability('{"types":')).toBeUndefined();
    expect(decodeCapability('{"hello":"world"}')).toBeUndefined();
  });
});
