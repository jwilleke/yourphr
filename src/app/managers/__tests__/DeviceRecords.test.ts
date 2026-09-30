/**
 * Records a CONNECTED DEVICE writes (yourphr#806, #314) are credited to that device's own source.
 *
 * The tooth is provenance: filed under the patient's `manual` source, a watch's heart-rate summary
 * would read as something the patient typed — the misrepresentation savePatientRecord exists to
 * prevent. And a device may write only into its own source, never the patient's or a provider's.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStores, type Stores } from '../../../app.js';
import { ApiContext } from '../../../framework/ApiContext.js';
import { DEVICE_PLATFORM_TYPE, MANUAL_PLATFORM_TYPE } from '../SourcesManager.js';

const daily = (id: string, value: number) => ({
  resourceType: 'Observation' as const,
  id,
  status: 'final',
  category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'vital-signs' }] }],
  code: { coding: [{ system: 'http://loinc.org', code: '8867-4', display: 'Heart rate' }] },
  effectivePeriod: { start: '2026-09-30T00:00:00-04:00', end: '2026-09-30T23:59:59-04:00' },
  valueQuantity: { value, unit: '/min', system: 'http://unitsofmeasure.org', code: '/min' },
});

async function withStores(fn: (s: Stores, ctxOf: (u: string) => ApiContext) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'device-records-'));
  const stores = await openStores(dir, {});
  try {
    await fn(stores, (u) => ApiContext.system('test', u, stores.engine));
  } finally {
    await stores.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('device-written records (yourphr#806)', () => {
  it('are credited to the device by name — "where this came from" says the device, not "Added by you"', async () => {
    await withStores(async (s, ctxOf) => {
      const ctx = ctxOf('jim');
      const device = await s.sources.addDeviceSource(ctx, "Jim's iPhone — Apple Health");
      expect(device.platformType).toBe(DEVICE_PLATFORM_TYPE);
      const sourceId = `source-${device.id}`;

      expect(await s.records.saveDeviceRecord(ctx, sourceId, daily('hr-2026-09-30', 61) as never)).toEqual({ id: 'hr-2026-09-30', outcome: 'created' });
      const where = await s.records.provenance(ctx, 'Observation', 'hr-2026-09-30');
      expect(where?.sourceId).toBe(sourceId);
      expect(where?.sourceDisplay).toBe("Jim's iPhone — Apple Health");
      // The reading is not filed under the manual source; that source holds only the person record.
      const manual = `source-${(await s.sources.manualSource(ctx)).id}`;
      expect(where?.sourceId).not.toBe(manual);
      expect(MANUAL_PLATFORM_TYPE).toBe('manual');
    });
  });

  it('carries the PGHD shape: the tag, performer = the patient, device = a Device that is the patient\'s own (yourphr#806)', async () => {
    await withStores(async (s, ctxOf) => {
      const ctx = ctxOf('jim');
      const sourceId = `source-${(await s.sources.addDeviceSource(ctx, "Jim's watch")).id}`;
      await s.records.saveDeviceRecord(ctx, sourceId, daily('hr-shape', 61) as never);
      const stored = (await s.records.list(ctx, 'Observation')).find((r) => r['source_resource_id'] === 'hr-shape')!['resource_raw'] as {
        meta?: { tag?: { system: string; code: string }[] }; performer?: { reference: string }[]; device?: { reference: string };
      };
      const self = await s.records.selfPatient(ctx);
      expect(stored.meta?.tag).toContainEqual(expect.objectContaining({ system: 'https://yourphr.org/fhir/CodeSystem/record-origin', code: 'pghd' }));
      expect(stored.performer).toEqual([{ reference: self.reference }]);
      const device = (await s.records.list(ctx, 'Device')).find((r) => `Device/${String(r['source_resource_id'])}` === stored.device?.reference)!['resource_raw'] as {
        patient?: { reference: string }; deviceName?: { name: string; type: string }[];
      };
      expect(device.patient).toEqual({ reference: self.reference });
      expect(device.deviceName).toEqual([{ name: "Jim's watch", type: 'user-friendly-name' }]);

      // An app that names the hardware and the performer keeps what it said.
      await s.records.saveDeviceRecord(ctx, sourceId, { ...daily('hr-named', 62), device: { display: 'Apple Watch Series 9' }, performer: [{ display: 'Jim' }] } as never);
      const named = (await s.records.list(ctx, 'Observation')).find((r) => r['source_resource_id'] === 'hr-named')!['resource_raw'] as { device?: unknown; performer?: unknown };
      expect(named.device).toEqual({ display: 'Apple Watch Series 9' });
      expect(named.performer).toEqual([{ display: 'Jim' }]);
    });
  });

  it('a re-sent daily summary replaces that day\'s record rather than adding a second', async () => {
    await withStores(async (s, ctxOf) => {
      const ctx = ctxOf('jim');
      const sourceId = `source-${(await s.sources.addDeviceSource(ctx, 'Scale')).id}`;
      await s.records.saveDeviceRecord(ctx, sourceId, daily('hr-day', 61) as never);
      expect((await s.records.saveDeviceRecord(ctx, sourceId, daily('hr-day', 64) as never)).outcome).toBe('updated');
      expect(await s.records.list(ctx, 'Observation')).toHaveLength(1);
    });
  });

  it('refuses any source that is not the caller\'s own device source — manual, another person\'s device, or none', async () => {
    await withStores(async (s, ctxOf) => {
      const jim = ctxOf('jim');
      const nora = ctxOf('nora');
      const manual = `source-${(await s.sources.manualSource(jim)).id}`;
      const norasDevice = `source-${(await s.sources.addDeviceSource(nora, "Nora's watch")).id}`;
      for (const target of [manual, norasDevice, 'source-999']) {
        await expect(s.records.saveDeviceRecord(jim, target, daily('x', 1) as never)).rejects.toMatchObject({ status: 403 });
      }
    });
  });

  it('a device source needs a short name, and is never synced (it holds no provider tokens)', async () => {
    await withStores(async (s, ctxOf) => {
      const ctx = ctxOf('jim');
      await expect(s.sources.addDeviceSource(ctx, '   ')).rejects.toMatchObject({ status: 400 });
      await expect(s.sources.addDeviceSource(ctx, 'x'.repeat(81))).rejects.toMatchObject({ status: 400 });
      const device = await s.sources.addDeviceSource(ctx, 'Scale');
      expect([device.fhirBaseUrl, device.accessToken, device.refreshToken]).toEqual(['', '', '']);
    });
  });
});
