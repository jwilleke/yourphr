import {MedicationStatementModel} from './medication-statement-model';
import {fhirVersions} from '../constants';

describe('MedicationStatementModel', () => {
  it('should create an instance', () => {
    expect(new MedicationStatementModel({})).toBeTruthy();
  });

  it('resolves the medication title from a non-US-Core coding[0].display (no text)', () => {
    const model = new MedicationStatementModel({
      resourceType: 'MedicationStatement',
      status: 'active',
      medicationCodeableConcept: {
        coding: [{
          system: 'https://fhir.followmyhealth.com/id/translation',
          code: '7c2e9d40-uuid',
          display: 'Omeprazole 20 MG Oral Tablet Delayed Release',
        }],
      },
      effectivePeriod: {start: '2025-11-01'},
      dateAsserted: '2026-02-20',
    }, fhirVersions.R4);

    expect(model.display).toBe('Omeprazole 20 MG Oral Tablet Delayed Release');
    expect(model.status).toBe('active');
    expect(model.effective_date).toBe('2025-11-01');
    expect(model.date_asserted).toBe('2026-02-20');
  });
});
