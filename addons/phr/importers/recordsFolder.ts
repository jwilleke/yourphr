/**
 * "My records folder" (yourphr#939): read one file a patient downloaded (from
 * an EHI export, "Export All My Data", a portal download) and pick out the
 * FHIR records in it. Pure: no database, no network, no logging. ngdpbase's
 * import engine unzips, filters noise and fingerprints; phr's shims
 * (./shims.ts) call this for each file, and PhrManager.importFile writes it.
 *
 * Read now: FHIR JSON (one resource, or a Bundle of them), FHIR NDJSON (one
 * resource per line) and C-CDA XML documents (./ccda.ts). Everything else
 * (CCR XML, PDFs, images, DICOM) is listed as not yet supported, by file, so
 * nothing is silently dropped. Later slices add those.
 * */
import { createHash } from 'node:crypto';
import { readCcda, xmlKind } from './ccda.js';

export type FolderFile =
  | { path: string; sha256: string; kind: 'fhir'; resources: Record<string, unknown>[]; skippedEntries: number; note?: string;
      /** Each record's Bundle entry `fullUrl`, when it had one: it names the server the record came from. */
      fullUrls?: (string | undefined)[] }
  | { path: string; sha256: string; kind: 'unsupported'; reason: string }
  | { path: string; sha256: string; kind: 'unreadable'; reason: string };

const isResource = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && typeof (v as Record<string, unknown>).resourceType === 'string';

/** The resources in one parsed JSON value: a Bundle's entries (with their fullUrls), or the resource itself. */
function resourcesOf(value: unknown): { resources: Record<string, unknown>[]; fullUrls: (string | undefined)[]; skipped: number } {
  if (!isResource(value)) return { resources: [], fullUrls: [], skipped: 1 };
  if (value.resourceType !== 'Bundle') return { resources: [value], fullUrls: [undefined], skipped: 0 };
  const out: Record<string, unknown>[] = [];
  const fullUrls: (string | undefined)[] = [];
  let skipped = 0;
  for (const entry of Array.isArray(value.entry) ? value.entry : []) {
    const e = entry as { resource?: unknown; fullUrl?: unknown } | null;
    if (isResource(e?.resource)) { out.push(e.resource); fullUrls.push(typeof e.fullUrl === 'string' ? e.fullUrl : undefined); } else skipped++;
  }
  return { resources: out, fullUrls, skipped };
}

const fingerprint = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const ext = (path: string): string => (path.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase();

/** Read one file's bytes into what it holds. */
export function readFolderFile(path: string, bytes: Uint8Array): FolderFile {
  const sha256 = fingerprint(bytes);
  const e = ext(path);
  if (e === 'xml') return readXmlFile(path, sha256, bytes);
  if (e !== 'json' && e !== 'ndjson') {
    const what = ({ pdf: 'PDF', dcm: 'DICOM', txt: 'text (e.g. Blue Button)', jpg: 'image', jpeg: 'image', png: 'image', tif: 'image', tiff: 'image' } as Record<string, string>)[e] ?? (e ? `.${e}` : 'file without an extension');
    return { path, sha256, kind: 'unsupported', reason: `${what}: not read yet` };
  }
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  try {
    if (e === 'json') {
      const { resources, fullUrls, skipped } = resourcesOf(JSON.parse(text));
      if (resources.length === 0) return { path, sha256, kind: 'unreadable', reason: 'JSON, but no FHIR resources in it' };
      return { path, sha256, kind: 'fhir', resources, skippedEntries: skipped, fullUrls };
    }
    const resources: Record<string, unknown>[] = [];
    const fullUrls: (string | undefined)[] = [];
    let skipped = 0;
    for (const line of text.split(/\r?\n/)) {
      if (line.trim() === '') continue;
      const got = resourcesOf(JSON.parse(line));
      resources.push(...got.resources);
      fullUrls.push(...got.fullUrls);
      skipped += got.skipped;
    }
    if (resources.length === 0) return { path, sha256, kind: 'unreadable', reason: 'NDJSON, but no FHIR resources in it' };
    return { path, sha256, kind: 'fhir', resources, skippedEntries: skipped, fullUrls };
  } catch {
    // Never echo the file's content: it may be health data.
    return { path, sha256, kind: 'unreadable', reason: `not valid ${e.toUpperCase()}` };
  }
}

/** An XML file: a C-CDA document is read; anything else is named for what it is. */
function readXmlFile(path: string, sha256: string, bytes: Uint8Array): FolderFile {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  switch (xmlKind(text)) {
    case 'ccda': {
      const got = readCcda(text);
      if (!got.ok) return { path, sha256, kind: 'unreadable', reason: got.reason };
      return { path, sha256, kind: 'fhir', resources: got.resources, skippedEntries: 0, ...(got.partial ? { note: got.partial } : {}) };
    }
    case 'ccr': return { path, sha256, kind: 'unsupported', reason: 'CCR: not read yet' };
    case 'xdm-metadata': return { path, sha256, kind: 'unsupported', reason: 'the download\'s packing list (XDM metadata), not a record' };
    case 'html': return { path, sha256, kind: 'unsupported', reason: 'a web page saved as .xml (a printable copy), not a record document' };
    default: return { path, sha256, kind: 'unsupported', reason: 'XML, but not a C-CDA document' };
  }
}
