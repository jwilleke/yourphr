/**
 * Reading an uploaded file (yourphr#736) and recognising a C-CDA document (yourphr#735).
 *
 * The C-CDA patient ids below were produced by the Go stack's own `cdaPatientID` (v2.10.3,
 * handler/cda_converter.go), run over these exact documents. They are fixtures, not a restatement
 * of the TypeScript: a migrated instance holds Patients Go minted this way, and a re-upload of the
 * same document must land on them.
 */
import { describe, expect, it } from 'vitest';
import { UploadFormatError, cdaPatientId, isCdaDocument, looksLikeCda, parseFhirUpload, patientOf } from '../index.js';

const buf = (s: string): Buffer => Buffer.from(s, 'utf8');

describe('parseFhirUpload', () => {
  it('reads a Bundle and rewrites urn:uuid references to Type/id', () => {
    const out = parseFhirUpload(buf(JSON.stringify({
      resourceType: 'Bundle',
      entry: [
        { fullUrl: 'urn:uuid:p', resource: { resourceType: 'Patient', id: 'p1' } },
        { fullUrl: 'urn:uuid:c', resource: { resourceType: 'Condition', id: 'c1', subject: { reference: 'urn:uuid:p' }, evidence: [{ detail: [{ reference: 'urn:uuid:c' }] }] } },
        { fullUrl: 'urn:uuid:o', resource: { resourceType: 'Observation', id: 'o1', subject: { reference: 'Patient/elsewhere' } } },
      ],
    })));
    expect(out.resources.map((r) => r.id)).toEqual(['p1', 'c1', 'o1']);
    const condition = out.resources[1] as unknown as { subject: { reference: string }; evidence: { detail: { reference: string }[] }[] };
    expect(condition.subject.reference).toBe('Patient/p1');
    expect(condition.evidence[0]!.detail[0]!.reference).toBe('Condition/c1'); // nested, not just top level
    expect((out.resources[2] as unknown as { subject: { reference: string } }).subject.reference).toBe('Patient/elsewhere'); // untouched
    expect(out.skipped).toEqual([]);
  });

  it('reports a Bundle entry with no resource rather than dropping it silently', () => {
    const out = parseFhirUpload(buf(JSON.stringify({ resourceType: 'Bundle', entry: [{ fullUrl: 'x' }, { resource: { resourceType: 'Patient', id: 'p' } }] })));
    expect(out.resources).toHaveLength(1);
    expect(out.skipped).toEqual([{ reason: 'entry carried no resource', detail: 'Bundle.entry[0]' }]);
  });

  it('reads a List of contained resources — what Go\'s record wizard wrote', () => {
    const out = parseFhirUpload(buf(JSON.stringify({ resourceType: 'List', contained: [{ resourceType: 'Practitioner', id: 'pr' }, 'junk'] })));
    expect(out.resources.map((r) => r.resourceType)).toEqual(['Practitioner']);
    expect(out.skipped).toHaveLength(1);
  });

  it('reads a single resource as itself', () => {
    expect(parseFhirUpload(buf('{"resourceType":"Patient","id":"solo"}')).resources).toEqual([{ resourceType: 'Patient', id: 'solo' }]);
  });

  it('reads NDJSON line by line, reporting a bad line without losing the rest', () => {
    const out = parseFhirUpload(buf('{"resourceType":"Patient","id":"a"}\n\n{not json}\r\n{"resourceType":"Condition","id":"b"}\n{"id":"no-type"}\n'));
    expect(out.resources.map((r) => r.id)).toEqual(['a', 'b']);
    expect(out.skipped).toEqual([{ reason: 'line is not JSON', detail: 'line 3' }, { reason: 'line is not a FHIR resource', detail: 'line 5' }]);
  });

  it('tolerates a byte-order mark', () => {
    expect(parseFhirUpload(buf('﻿{"resourceType":"Patient","id":"bom"}')).resources).toHaveLength(1);
  });

  it.each([
    ['empty', ''],
    ['a PDF', '%PDF-1.7 ...'],
    ['XML that is not C-CDA', '<Bundle xmlns="http://hl7.org/fhir"/>'],
    ['plain text', 'hello'],
    ['JSON that is not FHIR', '{"hello":"world"}'],
    ['lines none of which parse', '{a\n{b'],
  ])('refuses %s as a whole, rather than importing nothing and calling it success', (_, content) => {
    expect(() => parseFhirUpload(buf(content))).toThrow(UploadFormatError);
  });
});

describe('patientOf', () => {
  it('is the first Patient\'s id, and empty when the file names none — never a guess', () => {
    expect(patientOf([{ resourceType: 'Condition', id: 'c' }, { resourceType: 'Patient', id: 'p1' }, { resourceType: 'Patient', id: 'p2' }] as never)).toBe('p1');
    expect(patientOf([{ resourceType: 'Condition', id: 'c' }] as never)).toBe('');
  });
});

describe('looksLikeCda', () => {
  it('needs an XML root AND a ClinicalDocument — Go\'s test, so FHIR XML is not mis-routed', () => {
    expect(looksLikeCda(buf('  <?xml version="1.0"?><ClinicalDocument/>'))).toBe(true);
    expect(looksLikeCda(buf('﻿<cda:ClinicalDocument xmlns:cda="urn:hl7-org:v3"/>'))).toBe(true);
    expect(looksLikeCda(buf('<Bundle xmlns="http://hl7.org/fhir"/>'))).toBe(false);
    expect(looksLikeCda(buf('{"resourceType":"ClinicalDocument"}'))).toBe(false);
  });
});

describe('cdaPatientId — identical to Go\'s cdaPatientID', () => {
  it.each([
    ['the first patientRole id', '<?xml version="1.0"?><ClinicalDocument xmlns="urn:hl7-org:v3"><recordTarget><patientRole><id root="2.16.840.1.113883.19.5" extension="996-756-495"/></patientRole></recordTarget></ClinicalDocument>\n', 'cda-c5e5bce6e540a041'],
    ['namespace prefixes ignored', '<?xml version="1.0"?>\n<cda:ClinicalDocument xmlns:cda="urn:hl7-org:v3">\n  <cda:recordTarget>\n    <cda:patientRole>\n      <cda:id root="1.2.3" extension="PFX"/>\n    </cda:patientRole>\n  </cda:recordTarget>\n</cda:ClinicalDocument>\n', 'cda-a80bd55b881f6278'],
    ['an id with neither root nor extension skipped', '<ClinicalDocument><recordTarget><patientRole><id nullFlavor="UNK"/><id root="9.9" extension="second"/></patientRole></recordTarget></ClinicalDocument>\n', 'cda-06cd75e2ed4a81ec'],
    ['a direct-child id after other elements, never the nested patient id', '<ClinicalDocument><recordTarget><patientRole><addr><streetAddressLine>1 Main</streetAddressLine></addr><id root="7.7" extension="late"/><patient><id root="nested" extension="patient-id"/></patient></patientRole></recordTarget></ClinicalDocument>\n', 'cda-ccf77d5504bdc6c6'],
    ['attribute entities decoded, single quotes read', '<ClinicalDocument><recordTarget><patientRole><id root="1.2&amp;3" extension=\'a&lt;b\'/></patientRole></recordTarget></ClinicalDocument>\n', 'cda-de21e4f21752bee0'],
    ['a comment ignored, the next recordTarget searched', '<ClinicalDocument><!-- <recordTarget><patientRole><id root="commented"/></patientRole></recordTarget> --><recordTarget><patientRole><id nullFlavor="NI"/></patientRole></recordTarget><recordTarget><patientRole><id extension="only-ext"/></patientRole></recordTarget></ClinicalDocument>\n', 'cda-0d11f499c85792ca'],
    ['no recordTarget: the whole document', '<ClinicalDocument><title>No target here</title></ClinicalDocument>\n', 'cda-f0d5a0a64274b53f'],
    ['only a nested patient id: the whole document', '<ClinicalDocument><recordTarget><patientRole><patient><id root="nested-only"/></patient></patientRole></recordTarget></ClinicalDocument>\n', 'cda-8d73ebc04a7cd657'],
    ['a recordTarget below the root level ignored', '<ClinicalDocument><component><recordTarget><patientRole><id root="deep"/></patientRole></recordTarget></component><recordTarget><patientRole><id root="top" extension="x"/></patientRole></recordTarget></ClinicalDocument>\n', 'cda-56594fc087960dc0'],
    // Markup that is not an element must be stepped over whole, or a tag written inside it is read
    // as one (yourphr#739). Expected ids computed by Go's cdaPatientID from v2.10.3.
    ['a recordTarget inside CDATA ignored', '<ClinicalDocument><![CDATA[<recordTarget><patientRole><id root="in-cdata"/></patientRole></recordTarget>]]><recordTarget><patientRole><id root="real" extension="after-cdata"/></patientRole></recordTarget></ClinicalDocument>\n', 'cda-a1eb7a4754ddca9f'],
    ['a recordTarget inside a processing instruction ignored', '<?xml version="1.0"?><ClinicalDocument><?pi <recordTarget><patientRole><id root="in-pi"/></patientRole></recordTarget> ?><recordTarget><patientRole><id root="real" extension="after-pi"/></patientRole></recordTarget></ClinicalDocument>\n', 'cda-9570fc8306c98dc8'],
    ['a DOCTYPE stepped over', '<?xml version="1.0"?><!DOCTYPE ClinicalDocument><ClinicalDocument><recordTarget><patientRole><id root="real" extension="after-doctype"/></patientRole></recordTarget></ClinicalDocument>\n', 'cda-6f571db84cff4656'],
    ['a comment inside patientRole ignored', '<ClinicalDocument><recordTarget><patientRole><!-- <id root="commented-in-role"/> --><id root="real" extension="after-inner-comment"/></patientRole></recordTarget></ClinicalDocument>\n', 'cda-ec571ad15041d484'],
  ])('%s', (_, xml, expected) => {
    expect(cdaPatientId(xml)).toBe(expected);
  });
});

describe('isCdaDocument (yourphr#786)', () => {
  it('is true only when the root element is a ClinicalDocument', () => {
    expect(isCdaDocument(buf('<?xml version="1.0"?>\n<!-- c --><ClinicalDocument xmlns="urn:hl7-org:v3"/>'))).toBe(true);
    expect(isCdaDocument(buf('﻿<cda:ClinicalDocument xmlns:cda="urn:hl7-org:v3"/>'))).toBe(true);
    // A viewer stylesheet names ClinicalDocument everywhere, but is not one.
    expect(isCdaDocument(buf('<?xml version="1.0"?><xsl:stylesheet><xsl:template match="n1:ClinicalDocument"/></xsl:stylesheet>'))).toBe(false);
    expect(isCdaDocument(buf('<SubmitObjectsRequest/>'))).toBe(false);
    expect(isCdaDocument(buf('{"resourceType":"Bundle"}'))).toBe(false);
  });

  it('answers in linear time on a crafted prolog that made the old regex backtrack exponentially (yourphr#825)', () => {
    // CodeQL js/redos: "<?" then many "?><?". The old pattern took ~4x longer per two repetitions
    // (28 ms at 22); 64 KB allows thousands. The scan must answer at once, and correctly.
    const attack = '<?' + '?><?'.repeat(16_000);
    const started = Date.now();
    expect(isCdaDocument(buf(attack))).toBe(false);
    expect(isCdaDocument(buf(attack + '?><ClinicalDocument/>'))).toBe(true);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('still skips whitespace, several processing instructions, comments and a DOCTYPE before the root', () => {
    expect(isCdaDocument(buf('  <?xml version="1.0"?>\n<?xml-stylesheet href="cda.xsl"?>\n<!DOCTYPE x>\n<!-- a --><!-- b -->\n<ClinicalDocument/>'))).toBe(true);
    expect(isCdaDocument(buf('<?xml version="1.0"?><!-- never closed <ClinicalDocument/>'))).toBe(false);
  });
});
