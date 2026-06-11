import { PractitionerRoleModel } from './practitioner-role-model';

describe('PractitionerRoleModel', () => {
  it('should create an instance', () => {
    expect(new PractitionerRoleModel({})).toBeTruthy();
  });

  // US Core 9.0.0 Must-Support: practitioner, organization, code, specialty, location, telecom, endpoint.
  it('captures US Core Must-Support elements', () => {
    const m = new PractitionerRoleModel({
      resourceType: 'PractitionerRole',
      active: true,
      practitioner: { reference: 'Practitioner/p1', display: 'Dr Jane Smith' },
      organization: { reference: 'Organization/o1', display: 'Knox Community Hospital' },
      code: [{ coding: [{ system: 'http://nucc.org/provider-taxonomy', code: '208D00000X', display: 'General Practice' }], text: 'GP' }],
      specialty: [{ text: 'Family Medicine' }],
      location: [{ reference: 'Location/l1', display: 'Family Medicine Clinic' }],
      telecom: [{ system: 'phone', value: '555-0100' }],
      endpoint: [{ reference: 'Endpoint/e1' }],
    });
    expect(m.status).toEqual('active');
    expect(m.title).toEqual('GP'); // code[0].text
    expect(m.practitioner).toEqual({ reference: 'Practitioner/p1', display: 'Dr Jane Smith' });
    expect(m.organization?.display).toEqual('Knox Community Hospital');
    expect(m.locations?.[0]?.display).toEqual('Family Medicine Clinic');
    expect(m.telecom?.[0]?.value).toEqual('555-0100');
    expect(m.endpoints?.length).toEqual(1);
  });
});
