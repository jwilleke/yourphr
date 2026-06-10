import { ServiceRequestModel } from './service-request-model';

describe('ServiceRequestModel', () => {
  it('should create an instance', () => {
    expect(new ServiceRequestModel({})).toBeTruthy();
  });

  // US Core 9.0.0 Must-Support: status, intent, category, code, subject, occurrence[x], reasonCode.
  it('should capture US Core Must-Support elements', () => {
    const m = new ServiceRequestModel({
      resourceType: 'ServiceRequest',
      status: 'active',
      intent: 'order',
      category: [{ text: 'Laboratory procedure' }],
      code: { coding: [{ system: 'http://loinc.org', code: '24357-6', display: 'Urinalysis' }], text: 'Urinalysis' },
      subject: { reference: 'Patient/example' },
      occurrenceDateTime: '2023-02-13',
      authoredOn: '2023-02-10',
      reasonCode: [{ text: 'Suspected UTI' }],
    });
    expect(m.title).toEqual('Urinalysis');
    expect(m.status).toEqual('active');
    expect(m.intent).toEqual('order');
    expect(m.subject).toEqual({ reference: 'Patient/example' });
    expect(m.occurrence_datetime).toEqual('2023-02-13');
    expect(m.authored_on).toEqual('2023-02-10');
    expect(m.reason_code).toEqual([{ text: 'Suspected UTI' }]);
  });
});
