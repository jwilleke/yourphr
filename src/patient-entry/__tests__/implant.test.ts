import {describe, expect, it} from 'vitest';
import {buildPatientRecord, PGHD_TAG} from '../index.js';
import {US_CORE_IMPLANTABLE_DEVICE} from '../shared.js';

const NOW = new Date('2026-09-23T10:30:00Z');
const context = {subject: 'Patient/self-1'};
const request = {kind: 'implant', name: 'Synthetic coronary stent'};

describe('patient-entered implants', () => {
  it('creates a patient-linked PGHD Device with the stated identifiers, not invented codes', () => {
    const {resource, sortTitle, review} = buildPatientRecord({
      ...request, implant_status: 'active', implant_device_identifier: '00844588003288',
      implant_distinct_identifier: 'A9999', implant_serial_number: 'SYNTHETIC-456',
      implant_lot_number: 'LOT123', implant_manufacture_date: '2022-01-15',
      implant_expiration_date: '2032-01-15',
    }, NOW, context);
    expect(resource).toMatchObject({
      resourceType: 'Device', status: 'active', type: {text: request.name}, patient: {reference: context.subject},
      udiCarrier: [{deviceIdentifier: '00844588003288'}], distinctIdentifier: 'A9999',
      serialNumber: 'SYNTHETIC-456', lotNumber: 'LOT123', manufactureDate: '2022-01-15',
      expirationDate: '2032-01-15', meta: {profile: [US_CORE_IMPLANTABLE_DEVICE], tag: [PGHD_TAG]},
    });
    expect(sortTitle).toBe(request.name);
    expect(review).toEqual([]);
    expect(resource).not.toHaveProperty('type.coding');
  });

  it('does not invent optional identifiers, dates, or status', () => {
    const {resource} = buildPatientRecord(request, NOW, context);
    expect(resource).toMatchObject({resourceType: 'Device', status: 'unknown'});
    for (const field of ['udiCarrier', 'serialNumber', 'distinctIdentifier', 'lotNumber', 'manufactureDate', 'expirationDate', 'contained']) {
      expect(resource).not.toHaveProperty(field);
    }
  });

  it('stores placement and removal as completed contained PGHD Procedures linked to the Device', () => {
    const {resource} = buildPatientRecord({
      ...request, implant_insertion_date: '2020-04-20', implant_removal_date: '2024-06-10',
    }, NOW, context);
    expect(resource).toMatchObject({contained: [
      {
        resourceType: 'Procedure', id: 'implant-placement', status: 'completed', code: {text: 'Implant placement'},
        subject: {reference: context.subject}, performedDateTime: '2020-04-20',
        focalDevice: [{manipulated: {reference: '#'}}], meta: {tag: [PGHD_TAG]},
      },
      {
        resourceType: 'Procedure', id: 'implant-removal', status: 'completed', code: {text: 'Implant removal'},
        subject: {reference: context.subject}, performedDateTime: '2024-06-10',
        focalDevice: [{manipulated: {reference: '#'}}], meta: {tag: [PGHD_TAG]},
      },
    ]});
  });

  it('supports placement only, removal only, and both on the same day', () => {
    expect(buildPatientRecord({...request, implant_insertion_date: '2020-04-20'}, NOW, context).resource).toMatchObject({
      contained: [{id: 'implant-placement', performedDateTime: '2020-04-20'}],
    });
    expect(buildPatientRecord({...request, implant_removal_date: '2024-06-10'}, NOW, context).resource).toMatchObject({
      contained: [{id: 'implant-removal', performedDateTime: '2024-06-10'}],
    });
    expect(buildPatientRecord({...request, implant_insertion_date: '2024-06-10', implant_removal_date: '2024-06-10'}, NOW, context).resource).toMatchObject({
      contained: [{performedDateTime: '2024-06-10'}, {performedDateTime: '2024-06-10'}],
    });
  });

  it.each(['2024-02-30', 'not a date', '2024-06-10T09:00:00Z', 123, null])('rejects invalid lifecycle dates: %s', date => {
    for (const field of ['implant_insertion_date', 'implant_removal_date']) {
      expect(() => buildPatientRecord({...request, [field]: date}, NOW, context)).toThrow('Enter a valid implant');
    }
  });

  it('rejects removal before placement', () => {
    expect(() => buildPatientRecord({
      ...request, implant_insertion_date: '2024-06-10', implant_removal_date: '2020-04-20',
    }, NOW, context)).toThrow('cannot be before');
  });

  it.each(['2024-02-30', 'not a date', '2024-06-10T09:00:00Z', 123, null])('rejects invalid manufacture and expiration dates: %s', date => {
    for (const field of ['implant_manufacture_date', 'implant_expiration_date']) {
      expect(() => buildPatientRecord({...request, [field]: date}, NOW, context)).toThrow('Enter a valid implant');
    }
  });

  it('preserves valid leap-day dates and omits empty manufacture and expiration dates', () => {
    expect(buildPatientRecord({
      ...request, implant_manufacture_date: '2024-02-29', implant_expiration_date: '2028-02-29',
    }, NOW, context).resource).toMatchObject({manufactureDate: '2024-02-29', expirationDate: '2028-02-29'});
    const {resource} = buildPatientRecord({
      ...request, implant_manufacture_date: '', implant_expiration_date: '',
    }, NOW, context);
    expect(resource).not.toHaveProperty('manufactureDate');
    expect(resource).not.toHaveProperty('expirationDate');
  });

  it('requires a name, patient and supported status', () => {
    expect(() => buildPatientRecord({kind: 'implant'}, NOW, context)).toThrow('Name the implant');
    expect(() => buildPatientRecord(request, NOW)).toThrow('patient record is required');
    expect(() => buildPatientRecord({...request, implant_status: 'entered-in-error'}, NOW, context)).toThrow('valid implant status');
    expect(buildPatientRecord({...request, kind: 'implants'}, NOW, context).resource.resourceType).toBe('Device');
  });
});
