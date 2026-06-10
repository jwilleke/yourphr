import { SpecimenModel } from './specimen-model';

describe('SpecimenModel', () => {
  it('should create an instance', () => {
    expect(new SpecimenModel({})).toBeTruthy();
  });

  // US Core 9.0.0 Must-Support: type, subject, collection (collectedDateTime, bodySite), condition.
  it('should capture US Core Must-Support elements', () => {
    const m = new SpecimenModel({
      resourceType: 'Specimen',
      status: 'available',
      type: { coding: [{ system: 'http://snomed.info/sct', code: '122555007', display: 'Venous blood specimen' }], text: 'Venous blood' },
      subject: { reference: 'Patient/example' },
      receivedTime: '2023-02-13T10:00:00Z',
      collection: {
        collectedDateTime: '2023-02-13T09:30:00Z',
        bodySite: { text: 'Left antecubital fossa' },
      },
      condition: [{ text: 'fasting' }],
    });
    expect(m.title).toEqual('Venous blood');
    expect(m.status).toEqual('available');
    expect(m.subject).toEqual({ reference: 'Patient/example' });
    expect(m.collected_datetime).toEqual('2023-02-13T09:30:00Z');
    expect(m.collection_body_site).toEqual({ text: 'Left antecubital fossa' });
    expect(m.received_time).toEqual('2023-02-13T10:00:00Z');
    expect(m.condition).toEqual([{ text: 'fasting' }]);
  });
});
