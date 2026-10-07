import type { Device, Procedure } from '@medplum/fhirtypes';
import type { BuiltRecord, PatientEntryContext, PatientEntryRequest } from './shared.js';
import { PatientEntryError, PGHD_TAG, US_CORE_IMPLANTABLE_DEVICE, stamp, statedName, validDate } from './shared.js';

const DEVICE_STATUSES = new Set(['active', 'inactive', 'unknown']);

export function buildPatientImplant(req: PatientEntryRequest, _now = new Date(), context: PatientEntryContext = { subject: '' }): BuiltRecord {
  const type = statedName(req);
  if (!type) throw new PatientEntryError('Name the implant.');
  if (!context.subject) throw new PatientEntryError('A patient record is required for an implant.');

  const statedStatus = (req.implant_status ?? 'unknown').trim();
  if (!DEVICE_STATUSES.has(statedStatus)) throw new PatientEntryError('Choose a valid implant status.');

  const device: Device = {
    resourceType: 'Device',
    status: statedStatus as Device['status'],
    type: { text: type },
    patient: { reference: context.subject },
  };

  const deviceIdentifier = (req.implant_device_identifier ?? '').trim();
  if (deviceIdentifier) device.udiCarrier = [{ deviceIdentifier }];

  const distinctIdentifier = (req.implant_distinct_identifier ?? '').trim();
  if (distinctIdentifier) device.distinctIdentifier = distinctIdentifier;

  const serialNumber = (req.implant_serial_number ?? '').trim();
  if (serialNumber) device.serialNumber = serialNumber;

  const lotNumber = (req.implant_lot_number ?? '').trim();
  if (lotNumber) device.lotNumber = lotNumber;

  const manufactureDate = validDate(req.implant_manufacture_date, 'implant manufacture');
  if (manufactureDate) device.manufactureDate = manufactureDate;

  const expirationDate = validDate(req.implant_expiration_date, 'implant expiration');
  if (expirationDate) device.expirationDate = expirationDate;

  stamp(device, []);
  device.meta = {
    ...device.meta,
    profile: [...(device.meta?.profile ?? []), US_CORE_IMPLANTABLE_DEVICE],
  };
  const insertion = validDate(req.implant_insertion_date, 'implant placement');
  const removal = validDate(req.implant_removal_date, 'implant removal');
  if (insertion && removal && removal < insertion) {
    throw new PatientEntryError('The removal date cannot be before the implant was put in.');
  }
  // Containment saves, exports and deletes the implant and its history together. "#" references
  // the containing Device, not a separate record that could be left behind.
  const procedures: Procedure[] = [];
  for (const [id, label, date] of [
    ['implant-placement', 'Implant placement', insertion],
    ['implant-removal', 'Implant removal', removal],
  ] as const) {
    if (!date) continue;
    procedures.push({
      resourceType: 'Procedure',
      id,
      status: 'completed',
      code: { text: label },
      subject: { reference: context.subject },
      performedDateTime: date,
      focalDevice: [{ manipulated: { reference: '#' } }],
      meta: { tag: [{ ...PGHD_TAG }] },
    });
  }
  if (procedures.length) device.contained = procedures;
  return { resource: device, sortTitle: type, review: [] };
}
