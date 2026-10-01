/**
 * Reading an uploaded file into FHIR resources (yourphr#736) — what the Sources page's "upload"
 * sends, ported from the Go stack's file-import client (v2.10.3 `sources/clients/factory`).
 *
 * Pure: bytes in, resources out. Storing them is the Sources door's job, through the same
 * `storeEntries` a sync page goes through, so an upload is exactly as idempotent as a resync.
 *
 * The shapes Go accepted, all still accepted, because a patient's portal decides the format and
 * not us:
 *
 *   - a Bundle, with `urn:uuid:` references rewritten to `Type/id` (see rewriteUrnReferences);
 *   - a List carrying `contained` resources — what Go's own record wizard wrote;
 *   - a single resource;
 *   - NDJSON, one resource per line — what a bulk-data export produces.
 *
 * C-CDA is NOT parsed here. An XML ClinicalDocument goes to a converter first (yourphr#735) and
 * what comes back is a Bundle, which lands here like any other.
 */
import { createHash } from 'node:crypto';
import type { Resource } from '@medplum/fhirtypes';

export interface ParsedUpload {
  resources: Resource[];
  /** Lines or entries that could not be read. Reported, never dropped without a word. */
  skipped: { reason: string; detail: string }[];
}

/** An upload this module cannot read at all — the whole file, not one entry. */
export class UploadFormatError extends Error {}

/**
 * Whether the bytes are a C-CDA (HL7 CDA R2) document. Go's test, kept exactly: an XML root AND a
 * ClinicalDocument element, so a stray FHIR-XML upload is not mis-routed to the converter.
 */
export function looksLikeCda(bytes: Buffer): boolean {
  const head = bytes.toString('utf8').replace(/^﻿/, '').trimStart();
  return head.startsWith('<') && head.includes('ClinicalDocument');
}

/**
 * Whether the document's ROOT element is a ClinicalDocument — stricter than looksLikeCda, for a zip
 * (yourphr#786), where a portal packs a stylesheet for its viewer beside the documents. Epic's
 * `STYLE.XSL` names ClinicalDocument throughout, so the loose test would send it to the converter.
 */
export function isCdaDocument(bytes: Buffer): boolean {
  const text = bytes.subarray(0, 64 * 1024).toString('utf8').replace(/^\uFEFF/, '');
  // The XML declaration, comments, processing instructions and a DOCTYPE may come before the root.
  // Skipped by a single forward scan (yourphr#825): the regex this replaces backtracked
  // exponentially on a crafted prolog ("<?" then many "?><?"), so one uploaded file could pin the
  // server. Each step below moves forward, so the whole check is linear in the 64 KB it reads.
  let at = 0;
  for (;;) {
    while (at < text.length && /\s/.test(text[at]!)) at++;
    const skip = (open: string, close: string): boolean => {
      if (!text.startsWith(open, at)) return false;
      const end = text.indexOf(close, at + open.length);
      at = end < 0 ? text.length : end + close.length;
      return true;
    };
    if (skip('<?', '?>') || skip('<!--', '-->') || skip('<!DOCTYPE', '>')) continue;
    break;
  }
  const m = /^<(?:[A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)/.exec(text.slice(at, at + 256));
  return m?.[1] === 'ClinicalDocument';
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function xmlAttribute(tag: string, name: string): string {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tag);
  const raw = m ? (m[1] ?? m[2] ?? '') : '';
  return raw.replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => XML_ENTITIES[e] ?? '');
}

/**
 * A STABLE patient id for a C-CDA document, ported byte-for-byte from Go's `cdaPatientID`.
 *
 * The converter uses the id it is given as `Patient.id`, so it must be deterministic per patient:
 * otherwise re-importing the same person's documents mints a new Patient every time and breaks
 * idempotence (yourphr#252, #254). Seeded from the first `recordTarget/patientRole/id` carrying a
 * root or an extension; the whole document when there is none (still deterministic per document).
 *
 * Byte-for-byte matters beyond tidiness: a migrated instance already holds Patients Go minted
 * this way, and a re-upload of the same document must land on them rather than beside them.
 */
export function cdaPatientId(xml: string): string {
  let seed = '';
  // Go decoded into ClinicalDocument > recordTarget > patientRole > id, each a DIRECT child — so
  // the ids of the patient, their guardian or the provider organisation nested inside the role are
  // not candidates. The walk below keeps that rule: a path of local names, matched exactly.
  for (const tag of elementsAt(xml, ['recordTarget', 'patientRole', 'id'])) {
    const root = xmlAttribute(tag, 'root');
    const extension = xmlAttribute(tag, 'extension');
    if (root !== '' || extension !== '') {
      seed = `${root}|${extension}`;
      break;
    }
  }
  if (seed === '') seed = xml;
  return `cda-${createHash('sha1').update(seed, 'utf8').digest('hex').slice(0, 16)}`;
}

/**
 * The start tags of elements at `path` below the document root, in document order, matched by
 * local name (a namespace prefix ignored, as Go's decoder ignores it). Not an XML parser: enough of
 * one to walk element nesting, with comments, CDATA and processing instructions stepped over.
 */
function elementsAt(xml: string, path: string[]): string[] {
  const out: string[] = [];
  const stack: string[] = [];
  // Comments, CDATA, processing instructions and a DOCTYPE are alternatives in the SAME pattern,
  // listed first, so each is consumed whole and a tag written inside one is never read as a tag.
  // They are skipped here rather than deleted beforehand (yourphr#739).
  for (const m of xml.matchAll(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)(?:[A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g)) {
    const [whole, closing, name, , selfClosing] = m as unknown as [string, string, string | undefined, string, string];
    if (name === undefined) continue;
    if (closing) {
      stack.pop();
      continue;
    }
    // stack[0] is the document root; the path is matched below it.
    if (stack.length === path.length && name === path[path.length - 1] && path.slice(0, -1).every((p, i) => stack[i + 1] === p)) out.push(whole);
    if (!selfClosing) stack.push(name);
  }
  return out;
}

/**
 * `urn:uuid:` references rewritten to `Type/id`, using the bundle's own fullUrl -> resource map.
 *
 * A transaction bundle points one entry at another by fullUrl. Stored as-is, those references name
 * nothing once the bundle is gone, and the record graph silently loses its edges. Go did this with
 * string replacement over the raw JSON; walking the parsed value does the same job without caring
 * how the file was spaced.
 */
function rewriteUrnReferences(value: unknown, urlToRef: Map<string, string>): unknown {
  if (Array.isArray(value)) return value.map((v) => rewriteUrnReferences(v, urlToRef));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = k === 'reference' && typeof v === 'string' && urlToRef.has(v) ? urlToRef.get(v) : rewriteUrnReferences(v, urlToRef);
    }
    return out;
  }
  return value;
}

function asResource(value: unknown): Resource | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) && typeof (value as { resourceType?: unknown }).resourceType === 'string'
    ? (value as Resource)
    : undefined;
}

function fromJson(parsed: unknown, out: ParsedUpload): void {
  const top = asResource(parsed);
  if (!top) throw new UploadFormatError('the file is JSON but not a FHIR resource (no resourceType)');

  if (top.resourceType === 'List') {
    // Go's record wizard wrote the patient's entries as a List of contained resources.
    const contained = (top as { contained?: unknown[] }).contained;
    if (Array.isArray(contained)) {
      contained.forEach((c, i) => {
        const r = asResource(c);
        r ? out.resources.push(r) : out.skipped.push({ reason: 'contained entry is not a resource', detail: `List.contained[${i}]` });
      });
      return;
    }
  }

  if (top.resourceType === 'Bundle') {
    const entries = ((top as { entry?: unknown[] }).entry ?? []) as { fullUrl?: unknown; resource?: unknown }[];
    const urlToRef = new Map<string, string>();
    for (const e of entries) {
      const r = asResource(e?.resource);
      if (typeof e?.fullUrl === 'string' && e.fullUrl !== '' && r?.id) urlToRef.set(e.fullUrl, `${r.resourceType}/${r.id}`);
    }
    entries.forEach((e, i) => {
      const r = asResource(e?.resource);
      if (!r) {
        out.skipped.push({ reason: 'entry carried no resource', detail: `Bundle.entry[${i}]` });
        return;
      }
      out.resources.push((urlToRef.size > 0 ? rewriteUrnReferences(r, urlToRef) : r) as Resource);
    });
    return;
  }

  out.resources.push(top);
}

/**
 * The resources in an uploaded FHIR file. Throws UploadFormatError when the file as a whole is
 * not something this reads — a PDF, an image, a spreadsheet — rather than returning nothing and
 * letting "0 records imported" read as success.
 */
export function parseFhirUpload(bytes: Buffer): ParsedUpload {
  const out: ParsedUpload = { resources: [], skipped: [] };
  const text = bytes.toString('utf8').replace(/^﻿/, '').trim();
  if (text === '') throw new UploadFormatError('the file is empty');
  if (text.startsWith('%PDF')) throw new UploadFormatError('PDF files cannot be imported yet — upload the FHIR (JSON) or C-CDA (XML) export from your portal instead');
  if (text.startsWith('<')) throw new UploadFormatError('the file is XML but not a C-CDA document (no ClinicalDocument) — FHIR XML is not supported; upload FHIR JSON instead');
  if (!text.startsWith('{')) throw new UploadFormatError('the file is not FHIR JSON, NDJSON or C-CDA XML');

  let whole: unknown;
  let isWhole = true;
  try {
    whole = JSON.parse(text);
  } catch {
    isWhole = false;
  }
  if (isWhole) {
    fromJson(whole, out);
    return out;
  }

  // NDJSON: one resource per line. A line that does not parse is reported, not fatal, so one bad
  // line in a 40,000-line export does not cost the patient the rest of it.
  text.split(/\r?\n/).forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed === '') return;
    let value: unknown;
    try {
      value = JSON.parse(trimmed);
    } catch {
      out.skipped.push({ reason: 'line is not JSON', detail: `line ${i + 1}` });
      return;
    }
    const r = asResource(value);
    r ? out.resources.push(r) : out.skipped.push({ reason: 'line is not a FHIR resource', detail: `line ${i + 1}` });
  });
  if (out.resources.length === 0) throw new UploadFormatError('the file is neither a FHIR JSON document nor NDJSON');
  return out;
}

/** The first Patient's id — what Go stored as the source's patient. '' when the file names none. */
export function patientOf(resources: Resource[]): string {
  return resources.find((r) => r.resourceType === 'Patient' && r.id)?.id ?? '';
}
