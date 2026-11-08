/**
 * phd-samples.db opens with the same SQLCipher key as the other databases (yourphr#314).
 * A missing or wrong key does not fall back to a clear file.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SqlitePhdSamplesProvider } from '../SqlitePhdSamplesProvider.js';
import type { HealthSampleRow } from '../BaseHealthProvider.js';

function row(): HealthSampleRow {
  return {
    id: 'row-1', userId: '', externalUuid: 'ext-1', identifierSystem: 'urn:uuid', adapter: 'healthkit',
    vendorType: 'HKQuantityTypeIdentifierStepCount', metricType: 'step_count', codeSystem: 'http://loinc.org',
    code: '55423-8', category: 'activity', subject: '', startTime: '2026-08-24T12:00:00Z', endTime: '2026-08-24T12:00:00Z',
    tzOffset: 'Z', localDay: '2026-08-24', valueNum: 10, unit: '{steps}', originalUnit: 'count', valueText: '',
    valueSystem: '', components: '', correlationUuid: '', sourceName: 'Phone', sourceBundleId: '', deviceName: '',
    sourceId: 'source-1', metadata: '', deleted: false,
  };
}

describe('SqlitePhdSamplesProvider encryption', () => {
  it('reads back under the key it was written with, and refuses the file without that key', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'phd-key-'));
    const file = join(dir, 'phd-samples.db');
    const writer = new SqlitePhdSamplesProvider(file, 'unit-key');
    try {
      expect(await writer.insertSamples('jim', [row()])).toBe(1);
    } finally {
      await writer.close();
    }
    const reader = new SqlitePhdSamplesProvider(file, 'unit-key');
    try {
      expect((await reader.listSamples('jim', { codes: [], metricTypes: [], vendorType: '', limit: 10, offset: 0, sortAscending: true })).total).toBe(1);
    } finally {
      await reader.close();
    }
    expect(() => new SqlitePhdSamplesProvider(file, '')).toThrow();
    expect(() => new SqlitePhdSamplesProvider(file, 'other-key')).toThrow();
    rmSync(dir, { recursive: true, force: true });
  });
});
