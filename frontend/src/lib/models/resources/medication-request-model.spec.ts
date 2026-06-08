import { MedicationRequestModel } from './medication-request-model';
import * as example1Fixture from '../../fixtures/r4/resources/medicationRequest/example1.json';

describe('MedicationRequestModel', () => {
  it('should create an instance', () => {
    expect(new MedicationRequestModel({})).toBeTruthy();
  });

  describe('US Core 9.0.0 Must-Support (#144)', () => {
    it('should parse subject, encounter, authoredOn, intent, status from r4 example1', () => {
      const model = new MedicationRequestModel(example1Fixture);
      expect(model.subject).toEqual({ reference: 'Patient/pat1', display: 'Donald Duck' });
      expect(model.encounter).toEqual({ reference: 'Encounter/f001', display: 'encounter that leads to this prescription' });
      expect(model.status).toBe('active');
      expect(model.intent).toBe('order');
      expect(model.created).toBe('2015-03-01');
      expect(model.dosage_instruction_text).toBe('Take one tablet daily as directed');
    });

    it('should resolve a medication Reference', () => {
      const model = new MedicationRequestModel(example1Fixture);
      expect(model.medication_reference).toBeTruthy();
    });

    it('should parse reported[x] and category when present', () => {
      const model = new MedicationRequestModel({
        resourceType: 'MedicationRequest',
        status: 'active',
        intent: 'order',
        reportedBoolean: true,
        category: [
          { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/medicationrequest-category', code: 'community', display: 'Community' }] },
        ],
        medicationCodeableConcept: { text: 'Aspirin 81 MG' },
        subject: { reference: 'Patient/pat1' },
      });
      expect(model.reported_boolean).toBe(true);
      expect(model.categories).toEqual(['Community']);
    });

    it('should default categories to [] and leave optional MS fields undefined when absent', () => {
      const model = new MedicationRequestModel({ resourceType: 'MedicationRequest', status: 'active', intent: 'order' });
      expect(model.categories).toEqual([]);
      expect(model.subject).toBeUndefined();
      expect(model.encounter).toBeUndefined();
      expect(model.reported_boolean).toBeUndefined();
      expect(model.reported_reference).toBeUndefined();
    });
  });
});
