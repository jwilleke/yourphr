/**
 * C-CDA documents (an Epic MyChart download, a portal's "continuity of care
 * document") read into FHIR records, in phr's own process (yourphr#939).
 *
 * Operator decision 2026-10-21: no converter service in the cluster; use
 * Medplum's C-CDA library (@medplum/ccda) and see how it does on real files.
 * Pure: no database, no network, no logging.
 *
 * Medplum gives every record a fresh random id on each conversion, so the same
 * document read twice would be stored twice. The ids are replaced here with
 * ones derived from the document, and every reference is rewritten to match:
 *
 *  - the Patient: from the document's `recordTarget/patientRole/id`, the same
 *    derivation yourPHR uses (`cdaPatientId` in src/upload/index.ts), so the
 *    same person's documents land on one Patient, and it matches the Patients
 *    yourPHR already holds;
 *  - every other record: from its own identifiers when the document gives
 *    them, otherwise from its content, both scoped to that patient. A record
 *    unchanged between two downloads keeps its id; a changed one is a new
 *    record.
 */
import { createHash } from 'node:crypto';
import { convertCcdaToFhir, convertXmlToCcda } from '@medplum/ccda';
import type { Ccda } from '@medplum/ccda';

export type CcdaResult =
  | { ok: true; resources: Record<string, unknown>[]; partial?: string }
  | { ok: false; reason: string };

/** What kind of XML this is, from its root element. Only a C-CDA is read; CCR is yourphr#941. */
export function xmlKind(text: string): 'ccda' | 'ccr' | 'xdm-metadata' | 'html' | 'other' {
  // Step over the prolog (a byte-order mark, the declaration, comments, a DOCTYPE) to the first element.
  const prolog = /^(?:\uFEFF|\s+|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>)+/;
  const root = text.slice(0, 4096).replace(prolog, '').match(/^<(?:[A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)/)?.[1];
  if (root === 'ClinicalDocument') return 'ccda';
  if (root === 'ContinuityOfCareRecord') return 'ccr';
  if (root === 'SubmitObjectsRequest' || root === 'ProvideAndRegisterDocumentSetRequest') return 'xdm-metadata';
  // Portals save the document's printable page with an .xml name too.
  if (root?.toLowerCase() === 'html') return 'html';
  return 'other';
}

/** Read one C-CDA document. Never echoes the document's content in a reason: it is health data. */
export function readCcda(xml: string): CcdaResult {
  let ccda: Ccda;
  try {
    ccda = convertXmlToCcda(xml);
  } catch {
    return { ok: false, reason: 'C-CDA, but not well-formed XML' };
  }
  let bundle: { entry?: { resource?: unknown }[] };
  let partial: string | undefined;
  try {
    bundle = convertCcdaToFhir(ccda);
  } catch (strict) {
    // Medplum stops at the first part it has no mapping for. Read the rest, and
    // say a part was left out: its message names a template id, never content.
    try {
      bundle = convertCcdaToFhir(ccda, { ignoreUnsupportedSections: true });
      partial = `some parts were not converted (${strict instanceof Error ? strict.message : 'unsupported content'})`;
    } catch {
      return { ok: false, reason: 'C-CDA, but it could not be converted' };
    }
  }
  const resources = (bundle.entry ?? [])
    .map((e) => e.resource)
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null && typeof (r as Record<string, unknown>).resourceType === 'string');
  if (resources.length === 0) return { ok: false, reason: 'C-CDA, but no records in it' };
  return { ok: true, resources: withStableIds(resources, patientIdOf(ccda, xml)), ...(partial ? { partial } : {}) };
}

/**
 * The Patient's id, as yourPHR derives it: the first `recordTarget/patientRole/id`
 * with a root or an extension, hashed; the whole document when there is none.
 */
export function patientIdOf(ccda: Ccda, xml: string): string {
  let seed = '';
  for (const id of ccda.recordTarget?.[0]?.patientRole?.id ?? []) {
    const root = id['@_root'] ?? '';
    const extension = id['@_extension'] ?? '';
    if (root !== '' || extension !== '') { seed = `${root}|${extension}`; break; }
  }
  if (seed === '') seed = xml;
  return `cda-${createHash('sha1').update(seed, 'utf8').digest('hex').slice(0, 16)}`;
}

const hash = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 24);

/** A value with keys sorted and every reference blanked, so random ids don't change it. */
function canonical(value: unknown, key = ''): string {
  if (Array.isArray(value)) return `[${value.map((v) => canonical(v)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort()
      .filter((k) => k !== 'id' && k !== 'meta')
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k], k)}`).join(',')}}`;
  }
  if (key === 'reference') return '""';
  return JSON.stringify(value) ?? 'null';
}

/** The identifiers a record states, as "system|value", or null when it states none. */
function identifierKey(resource: Record<string, unknown>): string | null {
  const ids = Array.isArray(resource.identifier) ? (resource.identifier as Record<string, unknown>[]) : [];
  const keys = ids.filter((i) => typeof i.value === 'string' && i.value !== '').map((i) => `${String(i.system ?? '')}|${String(i.value)}`).sort();
  return keys.length > 0 ? keys.join('\n') : null;
}

function withStableIds(resources: Record<string, unknown>[], patientId: string): Record<string, unknown>[] {
  const renamed = new Map<string, string>();
  const used = new Set<string>();
  let patientAssigned = false;
  for (const r of resources) {
    const type = String(r.resourceType);
    // The document's own patient (the first Patient) gets the derived id.
    let id = type === 'Patient' && !patientAssigned ? patientId : `cda-${hash(`${patientId}\u0000${type}\u0000${identifierKey(r) ?? canonical(r)}`)}`;
    // Two records with the same content in one document stay two records.
    for (let n = 2; used.has(`${type}/${id}`); n++) id = `cda-${hash(`${patientId}\u0000${type}\u0000${identifierKey(r) ?? canonical(r)}\u0000${n}`)}`;
    used.add(`${type}/${id}`);
    if (typeof r.id === 'string') renamed.set(`${type}/${r.id}`, `${type}/${id}`);
    if (type === 'Patient') patientAssigned = true;
    r.id = id;
  }
  const rewrite = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach(rewrite); return; }
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'reference' && typeof v === 'string') obj[k] = renamed.get(v) ?? v;
      else rewrite(v);
    }
  };
  resources.forEach(rewrite);
  return resources;
}
