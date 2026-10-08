import {expect, test} from '@playwright/test';
import type {Device} from '@medplum/fhirtypes';
import {BASE, login, trackPageErrors} from './helpers.js';
import {E2E_PASS, E2E_USER, E2E_PW_PASS, E2E_PW_USER} from './constants.js';
import {PGHD_TAG, US_CORE_IMPLANTABLE_DEVICE} from '../src/patient-entry/shared.js';

test('a patient records an implant and its lifecycle, sees its Device card, and cannot select it for a measurement', async ({page}) => {
  const errors = trackPageErrors(page);
  await login(page, E2E_USER, E2E_PASS);
  await page.goto(`${BASE}/resource/add`);
  await page.selectOption('#entry-kind', 'implant');
  await expect(page.getByLabel('What implant is it?')).toBeVisible();
  await expect(page.getByText(/An implant is inside your body/)).toBeVisible();
  await expect(page.locator('#vital-date')).toHaveCount(0);
  await page.fill('#entry-name', 'Synthetic coronary stent');
  await page.selectOption('#implant-status', 'inactive');
  await page.fill('#implant-insertion-date', '2020-04-20');
  await page.fill('#implant-removal-date', '2024-06-10');
  await page.fill('#implant-udi', '00844588003288');
  await page.fill('#implant-serial', 'SYNTHETIC-456');
  const saving = page.waitForResponse(response => response.url().endsWith('/api/secure/resource/patient-entry')
    && response.request().method() === 'POST');
  await page.getByRole('button', {name: 'Save record', exact: true}).click();
  const response = await saving;
  expect(response.status()).toBe(200);
  const saved = (await response.json() as {data: {
    resource_type: string; source_id: string; source_resource_id: string; needs_review: string[];
  }}).data;
  expect(saved.resource_type).toBe('Device');
  expect(saved.needs_review).toEqual([]);
  const readback = await page.request.get(`${BASE}/api/secure/resource/fhir/${saved.source_id}/${saved.source_resource_id}`);
  expect(readback.status()).toBe(200);
  const device = (await readback.json() as {data: {resource_raw: Device}}).data.resource_raw;
  expect(device.meta?.profile).toContain(US_CORE_IMPLANTABLE_DEVICE);
  expect(device.meta?.tag).toContainEqual(PGHD_TAG);
  expect(device.contained).toMatchObject([
    {resourceType: 'Procedure', code: {text: 'Implant placement'}, performedDateTime: '2020-04-20',
      subject: device.patient, focalDevice: [{manipulated: {reference: '#'}}], meta: {tag: [PGHD_TAG]}},
    {resourceType: 'Procedure', code: {text: 'Implant removal'}, performedDateTime: '2024-06-10',
      subject: device.patient, focalDevice: [{manipulated: {reference: '#'}}], meta: {tag: [PGHD_TAG]}},
  ]);
  await page.getByRole('button', {name: 'View in Explore', exact: true}).click();
  const card = page.locator('fhir-device');
  await expect(card).toContainText('Synthetic coronary stent');
  await expect(card).toContainText('00844588003288');
  await expect(card).toContainText('SYNTHETIC-456');
  await expect(card).toContainText('Implant placement');
  await expect(card).toContainText('2020-04-20');
  await expect(card).toContainText('Implant removal');
  await expect(card).toContainText('2024-06-10');
  await page.goto(`${BASE}/resource/add`);
  await expect(page.locator('#vital-device')).toBeVisible();
  await expect(page.locator(`#vital-device option[value="${saved.source_resource_id}"]`)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('implant lifecycle dates are optional and invalid chronology is rejected by the server', async ({page}) => {
  await login(page, E2E_USER, E2E_PASS);
  const request = {kind: 'implant', name: 'Synthetic pacemaker'};
  const response = await page.request.post(`${BASE}/api/secure/resource/patient-entry`, {data: request});
  expect(response.status()).toBe(200);
  const device = (await response.json() as {data: {resource: Device}}).data.resource;
  expect(device).not.toHaveProperty('contained');
  for (const dates of [
    {implant_insertion_date: '2024-02-30'},
    {implant_manufacture_date: '2024-02-30'},
    {implant_expiration_date: 'not a date'},
    {implant_insertion_date: '2024-06-10', implant_removal_date: '2020-04-20'},
  ]) {
    const refused = await page.request.post(`${BASE}/api/secure/resource/patient-entry`, {data: {...request, ...dates}});
    expect(refused.status()).toBe(400);
    expect(await refused.json()).toMatchObject({success: false});
  }
});

test('partial implant dates flow through entry, Procedures, search and linked detail; deleting the Device removes its views', async ({page}) => {
  const errors = trackPageErrors(page);
  await login(page, E2E_USER, E2E_PASS);
  await page.goto(`${BASE}/resource/add`);
  await page.selectOption('#entry-kind', 'implant');
  await page.fill('#entry-name', 'Synthetic precision implant');
  await page.fill('#implant-insertion-date', '2024-06');
  await page.fill('#implant-removal-date', '2024');
  await page.fill('#implant-manufacture-date', '2020');
  await page.fill('#implant-expiration-date', '2030-07');
  const saving = page.waitForResponse(r => r.url().endsWith('/api/secure/resource/patient-entry') && r.request().method() === 'POST');
  await page.getByRole('button', {name: 'Save record', exact: true}).click();
  const response = await saving;
  expect(response.status()).toBe(200);
  const saved = (await response.json()).data;
  const parentId = saved.source_resource_id as string;
  const sourceId = saved.source_id as string;
  await page.getByRole('button', {name: 'View in Explore', exact: true}).click();
  const deviceCard = page.locator('fhir-device');
  for (const date of ['2024-06', '2024', '2020', '2030-07']) await expect(deviceCard).toContainText(date);

  const listResponse = await page.request.get(`${BASE}/api/secure/resource/fhir?sourceResourceType=Procedure&sourceID=${sourceId}`);
  expect(listResponse.status()).toBe(200);
  const rows = (await listResponse.json()).data as {source_resource_id: string; resource_raw: {performedDateTime: string}}[];
  const projections = rows.filter(r => r.source_resource_id.startsWith(`${parentId}#`));
  expect(projections).toHaveLength(2);
  expect(projections.map(r => r.resource_raw.performedDateTime)).toEqual(['2024-06', '2024']);
  await page.goto(`${BASE}/procedures`);
  const placement = page.locator('.procedure-row').filter({hasText: 'Implant placement'}).filter({hasText: '2024-06'});
  await expect(placement).toHaveCount(1);
  await placement.click();
  const procedureCard = page.locator('fhir-procedure').filter({hasText: 'Date performed 2024-06'});
  await expect(procedureCard).toContainText('Synthetic precision implant');
  await expect(procedureCard).not.toContainText('Jun 1');
  await procedureCard.getByRole('link', {name: 'details', exact: true}).click();
  await expect(page.locator('fhir-procedure')).toContainText('Date performed 2024-06');
  await page.locator('fhir-procedure').getByRole('link', {name: /^Patient\//}).click();
  await expect(page.locator('fhir-patient')).toBeVisible();
  await page.goBack();
  await expect(page.locator('fhir-procedure')).toContainText('Date performed 2024-06');
  await page.locator('fhir-procedure').getByRole('link', {name: 'Synthetic precision implant', exact: true}).click();
  await expect(page.locator('fhir-device')).toContainText('Synthetic precision implant');

  const found = await page.request.get(`${BASE}/api/secure/resources/search?q=implant%20removal`);
  expect(found.status()).toBe(200);
  const hits = (await found.json()).data as {source_resource_id: string; source_resource_type: string; date: string}[];
  expect(hits).toContainEqual(expect.objectContaining({
    source_resource_id: `${parentId}#implant-removal`, source_resource_type: 'Procedure', date: '2024',
  }));
  await page.goto(`${BASE}/dashboard`);
  const search = page.locator('input[placeholder*="Search"]');
  await search.fill('implant removal');
  const result = page.locator('.search-item').filter({hasText: 'Implant removal'})
    .filter({has: page.locator('.search-item-date').filter({hasText: /^2024$/})});
  await expect(result).toHaveCount(1);
  await expect(result.locator('.search-item-date')).toHaveText('2024');
  await result.click();
  await expect(page.locator('fhir-procedure')).toContainText('Date performed 2024');
  await expect(page.locator('fhir-procedure')).not.toContainText('Jan 1');

  const before = await page.request.get(`${BASE}/api/secure/resource/fhir/${sourceId}/${parentId}`);
  const original = (await before.json()).data.resource_raw as Device;
  expect(original.manufactureDate).toBe('2020');
  expect(original.expirationDate).toBe('2030-07');
  expect(original.contained?.[0]).toMatchObject({id: 'implant-placement', focalDevice: [{manipulated: {reference: '#'}}]});
  await login(page, E2E_PW_USER, E2E_PW_PASS);
  const otherList = await page.request.get(`${BASE}/api/secure/resource/fhir?sourceResourceType=Procedure`);
  expect((await otherList.json()).data.some((r: {source_resource_id: string}) => r.source_resource_id.startsWith(`${parentId}#`))).toBe(false);
  const otherSearch = await page.request.get(`${BASE}/api/secure/resources/search?q=precision`);
  expect((await otherSearch.json()).data).toEqual([]);
  expect((await page.request.get(`${BASE}/api/secure/resource/fhir/${sourceId}/${encodeURIComponent(`${parentId}#implant-removal`)}`)).status()).toBe(404);
  await login(page, E2E_USER, E2E_PASS);
  const deleted = await page.request.delete(`${BASE}/api/secure/resource/fhir/Device/${parentId}`);
  expect(deleted.status()).toBe(200);
  const after = await page.request.get(`${BASE}/api/secure/resource/fhir?sourceResourceType=Procedure`);
  expect((await after.json()).data.some((r: {source_resource_id: string}) => r.source_resource_id.startsWith(`${parentId}#`))).toBe(false);
  expect((await page.request.get(`${BASE}/api/secure/resource/fhir/${sourceId}/${encodeURIComponent(`${parentId}#implant-removal`)}`)).status()).toBe(404);
  expect(errors).toEqual([]);
});

test('implant partial-date chronology and calendar validation agree over HTTP', async ({page}) => {
  await login(page, E2E_USER, E2E_PASS);
  for (const dates of [
    {implant_insertion_date: '2024', implant_removal_date: '2023'},
    {implant_insertion_date: '2024-06', implant_removal_date: '2024-05'},
    {implant_manufacture_date: '2025', implant_expiration_date: '2024'},
    {implant_removal_date: '2024-13'},
    {implant_expiration_date: '2023-02-29'},
  ]) {
    const refused = await page.request.post(`${BASE}/api/secure/resource/patient-entry`, {
      data: {kind: 'implant', name: 'Synthetic invalid date implant', ...dates},
    });
    expect(refused.status()).toBe(400);
  }
});
