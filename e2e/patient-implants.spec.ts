import {expect, test} from '@playwright/test';
import type {Device} from '@medplum/fhirtypes';
import {BASE, login, trackPageErrors} from './helpers.js';
import {E2E_PASS, E2E_USER} from './constants.js';
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
