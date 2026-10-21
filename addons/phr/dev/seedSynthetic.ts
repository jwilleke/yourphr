/**
 * DEVELOPMENT ONLY. Loads a small set of made-up health records for the
 * signed-in person on a local test site, so the records page has something
 * to show while real imports wait on core's upload (ngdpbase#1855).
 *
 * - Never in the published package: package.json's `files` leaves dev/ out,
 *   and index.ts loads this only when it exists.
 * - Only on a local site: index.ts mounts it only when
 *   `ngdpbase.addons.phr.dev-seed` is true AND the site's base URL is
 *   localhost or *.localhost.
 * - Writes through PhrManager like any other write (the one door, audited),
 *   owned by the person asking, from the source "synthetic".
 * - No real person: every name, value and date below is invented.
 */
import type { Application, Request, Response } from 'express';
import type { AddonHost, WikiEngine } from '@jwilleke/ngdpbase-types';
import type { PhrManager } from '../managers/PhrManager.js';

const LOINC = 'http://loinc.org';
const SNOMED = 'http://snomed.info/sct';
const tag = { meta: { tag: [{ system: 'urn:yourphr:dev', code: 'synthetic', display: 'Made-up test record' }] } };

const observation = (id: string, code: string, text: string, value: number, unit: string, date: string) => ({
  resourceType: 'Observation', id, status: 'final', ...tag,
  category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
  code: { coding: [{ system: LOINC, code, display: text }], text },
  effectiveDateTime: date, valueQuantity: { value, unit }
});

export const SYNTHETIC_RECORDS: Record<string, unknown>[] = [
  { resourceType: 'Patient', id: 'synthetic-patient', ...tag, name: [{ family: 'Sample', given: ['Pat'] }], birthDate: '1950-04-01' },
  observation('syn-glucose-2019', '2345-7', 'Glucose', 104, 'mg/dL', '2019-03-12'),
  observation('syn-glucose-2021', '2345-7', 'Glucose', 112, 'mg/dL', '2021-05-20'),
  observation('syn-glucose-2024', '2345-7', 'Glucose', 98, 'mg/dL', '2024-09-03'),
  observation('syn-a1c-2021', '4548-4', 'Hemoglobin A1c', 6.1, '%', '2021-05-20'),
  observation('syn-a1c-2024', '4548-4', 'Hemoglobin A1c', 5.8, '%', '2024-09-03'),
  observation('syn-ldl-2024', '13457-7', 'LDL cholesterol', 118, 'mg/dL', '2024-09-03'),
  { resourceType: 'Condition', id: 'syn-prediabetes', ...tag, code: { coding: [{ system: SNOMED, code: '714628002', display: 'Prediabetes' }], text: 'Prediabetes' }, onsetDateTime: '2021-05-20', clinicalStatus: { coding: [{ code: 'active' }] } },
  { resourceType: 'Condition', id: 'syn-hypertension', ...tag, code: { coding: [{ system: SNOMED, code: '38341003', display: 'High blood pressure' }], text: 'High blood pressure' }, onsetDateTime: '2017-11-02', clinicalStatus: { coding: [{ code: 'active' }] } },
  { resourceType: 'MedicationStatement', id: 'syn-metformin', ...tag, status: 'active', medicationCodeableConcept: { text: 'Metformin 500 mg tablet' }, effectiveDateTime: '2021-06-01' },
  { resourceType: 'MedicationStatement', id: 'syn-lisinopril', ...tag, status: 'active', medicationCodeableConcept: { text: 'Lisinopril 10 mg tablet' }, effectiveDateTime: '2017-11-15' },
  { resourceType: 'AllergyIntolerance', id: 'syn-penicillin', ...tag, code: { text: 'Penicillin' }, criticality: 'high', recordedDate: '1988-07-01' },
  { resourceType: 'Immunization', id: 'syn-flu-2024', ...tag, status: 'completed', vaccineCode: { text: 'Influenza vaccine' }, occurrenceDateTime: '2024-10-05' },
  // A record that states no name and no date, to show "not stated" rather than a guess.
  { resourceType: 'Observation', id: 'syn-unnamed', status: 'final', ...tag, code: {} }
];

export function mountDevSeed(app: Application, engine: WikiEngine, host: AddonHost, records: () => PhrManager | null): void {
  app.post('/api/phr/dev/seed-synthetic', (req: Request, res: Response) => {
    void (async () => {
      try {
        const ctx = host.ApiContext.from(req, engine);
        const phr = records();
        if (!phr) { res.status(503).json({ success: false, error: 'phr is not ready' }); return; }
        let written = 0;
        for (const r of SYNTHETIC_RECORDS) { await phr.write(ctx, r, 'synthetic'); written++; }
        res.json({ success: true, data: { written } });
      } catch (err) {
        if (err instanceof host.ApiError) { host.sendApiError(res, err); return; }
        host.logger.error(`[phr] dev seed: ${String(err)}`);
        res.status(500).json({ success: false, error: 'internal error' });
      }
    })();
  });
  host.logger.warn('[phr] DEVELOPMENT: /api/phr/dev/seed-synthetic is on (made-up records only)');
}
