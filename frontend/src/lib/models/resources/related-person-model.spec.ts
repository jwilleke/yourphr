import { RelatedPersonModel } from './related-person-model';

describe('RelatedPersonModel', () => {
  it('should create an instance (no name → no crash)', () => {
    // Regression: stu3r4DTO previously did `_.get(name)[0]`, which threw when name was absent.
    expect(new RelatedPersonModel({})).toBeTruthy();
  });

  // US Core 9.0.0 Must-Support: relationship, name, patient, telecom.
  it('should capture relationship + format the name (r4)', () => {
    const m = new RelatedPersonModel({
      resourceType: 'RelatedPerson',
      patient: { reference: 'Patient/example' },
      relationship: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0131', code: 'N', display: 'Next-of-Kin' }], text: 'Next of kin' }],
      name: [{ given: ['Jane'], family: 'Doe' }],
      gender: 'female',
      telecom: [{ system: 'phone', value: '555-1234' }, { system: 'email', value: 'x@y.com' }],
    });
    expect(m.patient).toEqual({ reference: 'Patient/example' });
    expect(m.relationship).toEqual([{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0131', code: 'N', display: 'Next-of-Kin' }], text: 'Next of kin' }]);
    expect(m.display_name).toEqual('Jane Doe');
    // telecom is filtered to phone entries only
    expect((m.related_person_telecom as any).length).toEqual(1);
  });
});
