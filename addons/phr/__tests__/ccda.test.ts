import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { buildAddonHost, openAddonTestDatabase } from '@jwilleke/ngdpbase-types/testing';
import type { Decision, PermissionSubject } from '@jwilleke/ngdpbase-types';
import { PHR_MIGRATIONS, PHR_LEDGER_TABLE } from '../managers/migrations.js';
import { PhrRecordStore, type Db } from '../managers/PhrRecordStore.js';
import { PhrManager, type PhrCaller } from '../managers/PhrManager.js';
import { readCcda, xmlKind } from '../importers/ccda.js';
import { readFolderFile } from '../importers/recordsFolder.js';
import { fileItem, importFiles, shimFor } from './importHelpers.js';

// A synthetic C-CDA document: every person, place and value in it is made up.
const CCD = readFileSync(new URL('./fixtures/synthetic-ccd.xml', import.meta.url), 'utf8');
const ok = (xml: string) => {
  const got = readCcda(xml);
  if (!got.ok) throw new Error(got.reason);
  return got;
};
const byType = (resources: Record<string, unknown>[], type: string) => resources.filter((r) => r.resourceType === type);
const identified = (resources: Record<string, unknown>[], value: string) =>
  resources.find((r) => JSON.stringify(r.identifier ?? []).includes(`"value":"${value}"`));

describe('reading a C-CDA document', () => {
  it('tells a C-CDA from other XML by its root element', () => {
    expect(xmlKind(CCD)).toBe('ccda');
    expect(xmlKind('<?xml version="1.0"?>\n<!-- x --><ContinuityOfCareRecord xmlns="urn:astm-org:CCR"/>')).toBe('ccr');
    expect(xmlKind('<rs:SubmitObjectsRequest xmlns:rs="urn:oasis"/>')).toBe('xdm-metadata');
    expect(xmlKind('<!-- saved -->\n<!DOCTYPE html>\n<html><head></head></html>')).toBe('html');
    expect(xmlKind('<svg/>')).toBe('other');
  });

  it('turns each section into FHIR records', () => {
    const { resources, partial } = ok(CCD);
    expect(partial).toBeUndefined();
    for (const type of ['Patient', 'Composition', 'AllergyIntolerance', 'Condition', 'MedicationRequest', 'Immunization', 'Observation']) {
      expect(byType(resources, type).length, type).toBeGreaterThan(0);
    }
  });

  it('gives the patient the id yourPHR gives them, from recordTarget/patientRole/id', () => {
    const [patient] = byType(ok(CCD).resources, 'Patient');
    const expected = `cda-${createHash('sha1').update('2.16.840.1.113883.19.5.99999.2|SYN-0001').digest('hex').slice(0, 16)}`;
    expect(patient.id).toBe(expected);
  });

  it('gives the same records the same ids every time, and every reference points at a record in the document', () => {
    const first = ok(CCD).resources;
    const second = ok(CCD).resources;
    expect(second.map((r) => `${String(r.resourceType)}/${String(r.id)}`)).toEqual(first.map((r) => `${String(r.resourceType)}/${String(r.id)}`));
    const ids = new Set(first.map((r) => `${String(r.resourceType)}/${String(r.id)}`));
    expect(ids.size).toBe(first.length);
    const refs = [...JSON.stringify(first).matchAll(/"reference":"([^"]+)"/g)].map((m) => m[1]);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) expect(ids.has(ref), ref).toBe(true);
  });

  it('a record with its own identifier keeps its id when its value changes; the others are untouched', () => {
    const before = ok(CCD).resources;
    const after = ok(CCD.replace('<value xsi:type="PQ" value="70" unit="kg"/>', '<value xsi:type="PQ" value="71" unit="kg"/>')).resources;
    expect(identified(after, 'weight-1')?.id).toBe(identified(before, 'weight-1')?.id);
    expect((identified(after, 'weight-1')?.valueQuantity as { value: number }).value).toBe(71);
    expect(identified(after, 'problem-1')?.id).toBe(identified(before, 'problem-1')?.id);
  });

  it('reads what it can and says when a part was left out', () => {
    // A section kind Medplum has no mapping for: the problem list, under a made-up template id.
    const odd = CCD.replace('<templateId root="2.16.840.1.113883.10.20.22.2.5.1" extension="2015-08-01"/>', '<templateId root="2.16.840.1.113883.10.20.22.2.999"/>');
    const got = ok(odd);
    expect(got.partial).toMatch(/some parts were not converted .*2\.16\.840\.1\.113883\.10\.20\.22\.2\.999/);
    expect(byType(got.resources, 'Condition')).toHaveLength(0);
    expect(byType(got.resources, 'Immunization')).toHaveLength(1);
  });

  it('never echoes the document in a reason', () => {
    const got = readCcda('<ClinicalDocument xmlns="urn:hl7-org:v3"><name>Alex Synthetic</nam');
    expect(got.ok).toBe(false);
    expect(JSON.stringify(got)).not.toContain('Synthetic');
  });
});

describe('a C-CDA download in a records folder', () => {
  // Epic MyChart's "Download my records" layout: documents under IHE_XDM, with a packing list.
  const download = (xml = CCD): Record<string, string> => ({
    'IHE_XDM/SYNTHETIC1/DOC0001.XML': xml,
    'IHE_XDM/SYNTHETIC1/METADATA.XML': '<rs:SubmitObjectsRequest xmlns:rs="urn:oasis:names:tc:ebxml-regrep:xsd:rs:3.0"/>',
    'INDEX.HTM': '<html></html>'
  });

  it('the engine hands phr the documents only, never the packing list or the index page', () => {
    const picked = Object.entries(download()).map(([name, text]) => [name, shimFor(fileItem(name, text))?.name ?? null]);
    expect(picked).toEqual([
      ['IHE_XDM/SYNTHETIC1/DOC0001.XML', 'ccda'],
      ['IHE_XDM/SYNTHETIC1/METADATA.XML', null],
      ['INDEX.HTM', null]
    ]);
    const meta = readFolderFile('METADATA.XML', new TextEncoder().encode(download()['IHE_XDM/SYNTHETIC1/METADATA.XML']));
    expect(meta.kind === 'unsupported' && meta.reason).toMatch(/packing list/);
  });

  describe('imported through PhrManager', () => {
    const defaults = JSON.parse(readFileSync(new URL('../config/default-config.json', import.meta.url), 'utf8')) as Record<string, unknown>;
    const allowAll = async (): Promise<Decision> => ({ permit: true, applicable: true, reason: 'test-allow' });
    const alice: PhrCaller = {
      subject: { username: 'alice', roles: ['reader'], isAuthenticated: true } as unknown as PermissionSubject,
      ipAddress: '127.0.0.1',
      enforceDeny: async (permission: string) => { throw new Error(`refused ${permission}`); }
    };
    let db: Db & { close(): void };
    let phr: PhrManager;
    beforeEach(() => {
      db = openAddonTestDatabase<Db & { close(): void }>('phr', { migrations: PHR_MIGRATIONS, ledgerTable: PHR_LEDGER_TABLE }, { slug: 'phr', defaults });
      const host = buildAddonHost('phr', defaults);
      const sink = { logAuditEvent: async () => 'id', flushAuditQueue: async () => {} };
      phr = new PhrManager({ store: new PhrRecordStore(db), decide: allowAll, recordAudit: (e) => host.recordAuditEvent(sink, e), host });
    });
    afterEach(() => db.close());

    it('a newer download of the same document updates records in place, never duplicates them', async () => {
      const first = await importFiles(phr, alice, download());
      const created = first.created;
      expect(created).toBe(ok(CCD).resources.length);
      const newer = await importFiles(phr, alice, download(CCD.replace('value="70" unit="kg"', 'value="71" unit="kg"')));
      expect(newer.created).toBe(0);
      expect(newer.updated).toBeGreaterThan(0);
      const observations = await phr.list(alice, 'Observation');
      expect(observations.length).toBe(byType(ok(CCD).resources, 'Observation').length);
    });
  });
});

describe('nothing the document does not state is filled in', () => {
  const recordWith = (resources: Record<string, unknown>[], value: string) => identified(resources, value) as Record<string, unknown>;

  it('a date stays a date, and a month stays a month', () => {
    const got = ok(CCD.replace('<effectiveTime value="20231001"/>', '<effectiveTime value="202310"/>')).resources;
    expect(recordWith(got, 'imm-1').occurrenceDateTime).toBe('2023-10');
    expect(recordWith(got, 'result-1').effectiveDateTime).toBe('2024-01-10');
  });

  it('a time with a time zone is kept; a time without one keeps only its date', () => {
    const got = ok(CCD
      .replace(/<effectiveTime value="20240110"\/>(\s*<value xsi:type="PQ" value="5\.6")/, '<effectiveTime value="20240110083000-0500"/>$1')
      .replace(/<effectiveTime value="20240115"\/>(\s*<value xsi:type="PQ" value="70")/, '<effectiveTime value="20240115093000"/>$1')).resources;
    expect(CCD).toMatch(/<effectiveTime value="20240115"\/>\s*<value xsi:type="PQ" value="70"/);
    expect(recordWith(got, 'result-1').effectiveDateTime).toBe('2024-01-10T08:30:00-05:00');
    expect(recordWith(got, 'weight-1').effectiveDateTime).toBe('2024-01-15');
  });

  it('a dose with no unit gets none', () => {
    const [med] = byType(ok(CCD).resources, 'MedicationRequest');
    expect(JSON.stringify(med.dosageInstruction)).not.toContain('IU');
  });

  it('a document with no date is undated, never dated today', () => {
    const [composition] = byType(ok(CCD.replace('<effectiveTime value="20240115103000-0500"/>', '')).resources, 'Composition');
    expect(composition.date).toBeUndefined();
    expect(JSON.stringify(composition._date)).toContain('data-absent-reason');
    const [dated] = byType(ok(CCD).resources, 'Composition');
    expect(dated.date).toBe('2024-01-15T10:30:00-05:00');
  });
});
