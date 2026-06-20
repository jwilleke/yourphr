import { test, expect } from '@playwright/test';
import { login } from './helpers';
import { API_BASE } from './constants';

// #349 / #342: a DocumentReference whose attachment points to a SEPARATE Binary resource by URL
// (the shape Cerner/Oracle produce and #342's import now stores) must resolve, render, and be
// downloadable from the resource-detail page. This drives the real app end-to-end: seed a bundle
// via manual import, open the detail page, confirm the PDF viewer renders the resolved Binary and
// the Download button saves the bytes.
test('DocumentReference → Binary renders and downloads (#349)', async ({ page }) => {
  await login(page);

  // A minimal valid PDF, base64'd, stored as the Binary the DocumentReference references by URL.
  const pdf = [
    '%PDF-1.4',
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj',
    '4 0 obj<</Length 44>>stream',
    'BT /F1 24 Tf 20 100 Td (Hello PHR) Tj ET',
    'endstream endobj',
    '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj',
    'trailer<</Root 1 0 R>>',
    '%%EOF',
  ].join('\n');
  const pdfB64 = Buffer.from(pdf, 'latin1').toString('base64');

  const binaryId = 'e2e-binary-1';
  const docRefId = 'e2e-docref-1';
  const bundle = {
    resourceType: 'Bundle',
    type: 'collection',
    entry: [
      { resource: { resourceType: 'Patient', id: 'e2e-pat-1', name: [{ family: 'BinaryTest', given: ['E2E'] }] } },
      { resource: { resourceType: 'Binary', id: binaryId, contentType: 'application/pdf', data: pdfB64 } },
      {
        resource: {
          resourceType: 'DocumentReference', id: docRefId, status: 'current',
          subject: { reference: 'Patient/e2e-pat-1' },
          content: [{ attachment: { contentType: 'application/pdf', url: `Binary/${binaryId}`, title: 'E2E Discharge Summary' } }],
        },
      },
    ],
  };

  // Seed via the manual-import endpoint (page.request shares the browser's auth cookie).
  const up = await page.request.post(`${API_BASE}/secure/source/manual`, {
    multipart: { file: { name: 'e2e-docref.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bundle)) } },
    timeout: 60_000,
  });
  expect(up.ok(), `manual import -> ${up.status()}: ${await up.text()}`).toBeTruthy();

  // Find the seeded DocumentReference to get its source_id + source_resource_id.
  const list = await page.request.get(`${API_BASE}/secure/resource/fhir?sourceResourceType=DocumentReference`);
  expect(list.ok(), `list DocumentReference -> ${list.status()}`).toBeTruthy();
  const items = (await list.json())?.data ?? [];
  const docRef = items.find((r: any) => r.source_resource_id === docRefId);
  expect(docRef, 'seeded DocumentReference present').toBeTruthy();

  // Open the resource-detail page (showDetails=false → attachments render via <fhir-binary>).
  await page.goto(`explore/${docRef.source_id}/resource/${docRef.source_resource_id}`);
  await expect(page.locator('fhir-document-reference')).toBeVisible({ timeout: 15_000 });

  // The Download button only appears once the referenced Binary has been fetched + decoded
  // (hasContent), so its presence proves the Binary/{id} resolution path worked end-to-end. #349
  const downloadBtn = page.locator('fhir-binary button', { hasText: 'Download' });
  await expect(downloadBtn).toBeVisible({ timeout: 15_000 });

  // The PDF viewer renders the resolved Binary as a data-URI embed.
  const embed = page.locator('fhir-pdf embed');
  await expect(embed).toBeVisible({ timeout: 15_000 });
  const src = await embed.getAttribute('src');
  expect(src ?? '', 'PDF embed data URI').toContain('application/pdf');

  // Download saves the document bytes (#349).
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    downloadBtn.click(),
  ]);
  expect(download.suggestedFilename()).toContain('.pdf');
});
