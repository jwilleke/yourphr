/**
 * phr's import shims for ngdpbase's import engine (ICE, ngdpbase#1979).
 *
 * The engine owns everything about files: unzipping, the noise filter,
 * fingerprints, skipping unchanged files, per-file status. A shim only reads
 * one file it is handed. phr has two: FHIR (JSON, NDJSON) and C-CDA (XML).
 *
 * Each shim hands over ONE item per file, holding every record in it. phr's
 * own ids are derived across a file's records (localIds, yourphr#784), so
 * references between them resolve. And one file is one door call and one
 * audit event, not one per record. Duplicates are therefore per file: an
 * unchanged file is skipped by the engine; a changed one is read again, and
 * the store makes no new version of a record whose content is the same.
 *
 * Pure: no database, no network, no logging. Never echoes a file's content in
 * a message: it may be health data.
 */
import type { IceItem, IceShim, ShimReadResult } from '@jwilleke/ngdpbase-types';
import { xmlKind } from './ccda.js';
import { readFolderFile } from './recordsFolder.js';

/** The kind of item phr's shims produce: one file's FHIR records. */
export const PHR_FILE_KIND = 'phr.fhir-file';

/** phr's receiver, as the engine names it (`<slug>.<name>`). */
export const PHR_RECEIVER = 'phr.health-records';

/** What a `phr.fhir-file` item carries in `data`. */
export interface PhrFileData {
  resources: Record<string, unknown>[];
  /** Each record's Bundle entry `fullUrl`, when it had one: it names the server the record came from. */
  fullUrls?: (string | undefined)[];
  /** Bundle entries or lines that held no FHIR resource. */
  skippedEntries: number;
}

/** The first characters of a file, without decoding all of it: enough to recognise the format. */
const head = (input: IceItem, chars = 4096): string =>
  input.text !== undefined ? input.text.slice(0, chars) : new TextDecoder('utf-8', { fatal: false }).decode((input.bytes ?? Buffer.alloc(0)).subarray(0, chars));

/** "Can I read this?" for FHIR JSON or NDJSON: a JSON object that names a resourceType near its start. */
function looksLikeFhir(input: IceItem): boolean {
  const start = head(input).replace(/^﻿/, '').trimStart();
  return start.startsWith('{') && /"resourceType"\s*:/.test(start);
}

/** Read one file through phr's reader; a file it can't read is an error the engine records, by reason. */
function readOne(input: IceItem): ShimReadResult {
  const file = readFolderFile(input.name, input.bytes ?? Buffer.from(input.text ?? '', 'utf8'));
  if (file.kind !== 'fhir') throw new Error(file.reason);
  const data: PhrFileData = { resources: file.resources, skippedEntries: file.skippedEntries, ...(file.fullUrls ? { fullUrls: file.fullUrls } : {}) };
  return {
    items: [{ kind: PHR_FILE_KIND, name: input.name, data }],
    ...(file.note ? { partial: file.note } : {})
  };
}

/** `phr.fhir`: a FHIR resource, a Bundle of them, or NDJSON (one per line). */
export function fhirShim(): IceShim {
  return {
    name: 'fhir',
    label: 'FHIR records (JSON, NDJSON)',
    direction: 'in',
    accepts: {
      extensions: ['.json', '.ndjson'],
      mediaTypes: ['application/fhir+json', 'application/fhir+ndjson', 'application/x-ndjson'],
      canRead: looksLikeFhir
    },
    produces: PHR_FILE_KIND,
    receivers: [PHR_RECEIVER],
    duplicates: 'file',
    read: async (input) => readOne(input)
  };
}

/** `phr.ccda`: a C-CDA document (Medplum's reader). CCR is yourphr#941. */
export function ccdaShim(): IceShim {
  return {
    name: 'ccda',
    label: 'C-CDA documents (XML)',
    direction: 'in',
    accepts: {
      extensions: ['.xml'],
      mediaTypes: ['application/xml', 'text/xml', 'application/hl7-cda+xml'],
      canRead: (input) => xmlKind(head(input)) === 'ccda'
    },
    produces: PHR_FILE_KIND,
    receivers: [PHR_RECEIVER],
    duplicates: 'file',
    read: async (input) => readOne(input)
  };
}
