import { MedicationDispenseModel } from './medication-dispense-model';

describe('MedicationDispenseModel', () => {
  it('should create an instance', () => {
    expect(new MedicationDispenseModel({})).toBeTruthy();
  });

  // US Core 9.0.0 Must-Support additions: performer.actor (who dispensed) + dosageInstruction.
  it('should capture performer and dosageInstruction (r4)', () => {
    const m = new MedicationDispenseModel({
      resourceType: 'MedicationDispense',
      status: 'completed',
      medicationCodeableConcept: { coding: [{ system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '617314', display: 'Lisinopril 40 MG Oral Tablet' }] },
      subject: { reference: 'Patient/example' },
      performer: [{ actor: { reference: 'Practitioner/pharmacist', display: 'Jane Pharmacist' } }],
      whenHandedOver: '2023-02-13',
      dosageInstruction: [{
        route: { coding: [{ display: 'Oral' }] },
        doseAndRate: [{ doseQuantity: { value: 40, unit: 'mg' } }],
        timing: { repeat: { period: 1, periodUnit: 'd' } },
      }],
    });
    expect(m.performer).toEqual({ reference: 'Practitioner/pharmacist', display: 'Jane Pharmacist' });
    expect(m.has_dosage_instruction).toEqual(true);
    expect(m.dosage_instruction_data?.[0]?.route).toEqual('Oral');
    expect(m.dosage_instruction_data?.[0]?.doseQuantity).toEqual('40 mg');
  });
});
