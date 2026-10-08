import type { Device, Procedure } from '@medplum/fhirtypes';
import type { StoredRecord } from '../providers/BaseRecordsProvider.js';

/** Read-only chart projections, never independent stored records or review-queue entries. */
export function implantProcedures(parent: StoredRecord): StoredRecord[] {
  if (parent.resourceType !== 'Device') return [];
  const device = parent.resource as Device;
  return (device.contained ?? [])
    .filter((r): r is Procedure => r.resourceType === 'Procedure')
    .filter(p => !!p.id && p.status === 'completed' && !!p.performedDateTime
      && p.focalDevice?.some(d => d.manipulated.reference === '#'))
    .map(p => {
      const id = `${parent.id}#${p.id}`;
      return {
        ...parent, resourceType: 'Procedure', id,
        resource: {
          ...p,
          focalDevice: p.focalDevice?.map(d => ({
            ...d, manipulated: d.manipulated.reference === '#'
              ? { reference: `Device/${parent.id}`, display: device.type?.text || device.type?.coding?.[0]?.display || 'Device' } : d.manipulated,
          })),
        },
      };
    });
}
