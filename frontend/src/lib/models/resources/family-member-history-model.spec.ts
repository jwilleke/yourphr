import { FamilyMemberHistoryModel } from './family-member-history-model';

describe('FamilyMemberHistoryModel', () => {
  it('should create an instance', () => {
    expect(new FamilyMemberHistoryModel({})).toBeTruthy();
  });

  // US Core 9.0.0 Must-Support: status, relationship, patient, name, sex, condition.
  it('should capture US Core Must-Support elements', () => {
    const m = new FamilyMemberHistoryModel({
      resourceType: 'FamilyMemberHistory',
      status: 'completed',
      patient: { reference: 'Patient/example' },
      relationship: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-RoleCode', code: 'FTH', display: 'father' }], text: 'Father' },
      name: 'Father',
      sex: { coding: [{ code: 'male', display: 'Male' }] },
      bornDate: '1950-05-01',
      condition: [{ code: { text: 'Myocardial infarction' }, outcome: { text: 'deceased' }, contributedToDeath: true }],
    });
    expect(m.title).toEqual('Father');
    expect(m.status).toEqual('completed');
    expect(m.patient).toEqual({ reference: 'Patient/example' });
    expect(m.name).toEqual('Father');
    expect(m.born_date).toEqual('1950-05-01');
    expect(m.conditions?.length).toEqual(1);
    expect(m.conditions?.[0]?.code).toEqual({ text: 'Myocardial infarction' });
    expect(m.conditions?.[0]?.contributedToDeath).toEqual(true);
  });
});
