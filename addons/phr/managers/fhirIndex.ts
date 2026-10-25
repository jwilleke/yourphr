/**
 * What phr indexes about a FHIR record, so it can be searched. Pure: no
 * database. PhrRecordStore writes and queries the results.
 *
 * Ported, not reinvented (operator decision 2026-10-21, option A), from
 * yourPHR's FHIR store: `indexResource`, `stripResolveGuards`,
 * `normalizeValues` and `codingValues` from src/SqliteFhirRepository.ts, and
 * `textFor` / `ftsQuery` from src/app/providers/record-text.ts. The thesis is
 * unchanged: for each SearchParameter FHIR itself defines for a resource
 * type, evaluate its FHIRPath expression and keep the values in ONE generic
 * index, so search works for every resource type with no per-type code.
 */
import { getSearchParameters, indexSearchParameterBundle, indexStructureDefinitionBundle } from '@medplum/core';
import { readJson } from '@medplum/definitions';
import type { Bundle, SearchParameter, StructureDefinition } from '@medplum/fhirtypes';
import { createHash } from 'node:crypto';
import fhirpath from 'fhirpath';
import fhirpathR4Model from 'fhirpath/fhir-context/r4/index.js';

let definitionsLoaded = false;

/**
 * Medplum keeps the FHIR schema in module-level state. Loaded on first use,
 * not at start-up: parsing the definitions takes a moment, and a site that
 * never searches never pays it.
 */
function loadDefinitions(): void {
  if (definitionsLoaded) return;
  indexStructureDefinitionBundle(readJson('fhir/r4/profiles-types.json') as Bundle<StructureDefinition>);
  indexStructureDefinitionBundle(readJson('fhir/r4/profiles-resources.json') as Bundle<StructureDefinition>);
  indexSearchParameterBundle(readJson('fhir/r4/search-parameters.json') as Bundle<SearchParameter>);
  definitionsLoaded = true;
}

/**
 * Which derivation built the index. Bump it with any change to `textFor` or to
 * search-parameter extraction: an index built by an older number is stale and
 * has to be rebuilt from the stored records.
 */
export const PHR_INDEX_VERSION = 1;

export interface IndexEntry { code: string; value: string }

/** Every (search parameter, value) pair FHIR defines for this record. */
export function indexEntries(resource: Record<string, unknown>): IndexEntry[] {
  loadDefinitions();
  const resourceType = String(resource.resourceType);
  const params = getSearchParameters(resourceType);
  if (!params) return [];
  const seen = new Set<string>();
  const out: IndexEntry[] = [];
  for (const param of Object.values(params) as SearchParameter[]) {
    if (!param.expression) continue;
    const { expression, allowedTypes } = stripResolveGuards(param.expression);
    let results: unknown[];
    try {
      results = fhirpath.evaluate(resource, expression, undefined, fhirpathR4Model) as unknown[];
    } catch {
      // One unsupported expression must not make a record unstorable.
      continue;
    }
    for (const result of results) {
      for (const value of normalizeValues(result, param.type)) {
        // Reinstate the stripped guard: keep only references to the types the
        // parameter targets, judged from the reference itself.
        if (allowedTypes && !allowedTypes.some((t) => value.startsWith(`${t}/`))) continue;
        const key = `${param.code}\u0000${value}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ code: param.code, value });
      }
    }
  }
  return out;
}

/**
 * Remove `.where(resolve() is Type)` guards from a SearchParameter expression,
 * returning the types they named. fhirpath.js refuses `resolve()` in
 * synchronous mode, so `Condition.patient` (`Condition.subject.where(resolve()
 * is Patient)`) would otherwise index nothing while `Immunization.patient`
 * indexed fine: a search that is confidently wrong. A reference carries its own
 * type ("Patient/123"), so the guard is reinstated by prefix.
 */
export function stripResolveGuards(expression: string): { expression: string; allowedTypes?: string[] } {
  if (!expression.includes('resolve()')) return { expression };
  const types: string[] = [];
  let out = '';
  let i = 0;
  while (i < expression.length) {
    const start = expression.indexOf('.where(', i);
    if (start === -1) { out += expression.slice(i); break; }
    let depth = 0;
    let end = start + '.where('.length - 1;
    for (; end < expression.length; end++) {
      if (expression[end] === '(') depth++;
      else if (expression[end] === ')') { depth--; if (depth === 0) break; }
    }
    const clause = expression.slice(start, end + 1);
    if (clause.includes('resolve()')) {
      for (const match of clause.matchAll(/resolve\(\)\s+is\s+([A-Za-z]+)/g)) if (match[1]) types.push(match[1]);
      out += expression.slice(i, start);
    } else {
      out += expression.slice(i, end + 1);
    }
    i = end + 1;
  }
  return { expression: out, allowedTypes: types.length > 0 ? types : undefined };
}

/** Flatten one FHIRPath result into the string forms a search can match. */
export function normalizeValues(value: unknown, paramType: SearchParameter['type']): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value === 'string') return [paramType === 'string' ? value.toLowerCase() : value];
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  if (typeof value !== 'object') return [];
  const obj = value as Record<string, unknown>;
  if (typeof obj.reference === 'string') return [obj.reference];
  if (Array.isArray(obj.coding)) {
    const out: string[] = [];
    for (const coding of obj.coding as Record<string, unknown>[]) out.push(...codingValues(coding));
    if (typeof obj.text === 'string') out.push(obj.text.toLowerCase());
    return out;
  }
  if (typeof obj.code === 'string' || typeof obj.value === 'string') return codingValues(obj);
  if (typeof obj.start === 'string') return [obj.start];
  if (typeof obj.value === 'number') return [String(obj.value)];
  const textParts = ['text', 'family', 'city', 'state', 'postalCode', 'display']
    .map((key) => obj[key]).filter((v): v is string => typeof v === 'string');
  if (Array.isArray(obj.given)) textParts.push(...(obj.given as unknown[]).filter((v): v is string => typeof v === 'string'));
  return textParts.map((t) => t.toLowerCase());
}

function codingValues(coding: Record<string, unknown>): string[] {
  const code = (coding.code ?? coding.value) as string | undefined;
  const system = coding.system as string | undefined;
  if (!code) return [];
  return system ? [code, `${system}|${code}`] : [code];
}

// ── The words in a record (yourphr#599), for "find anything by words" ──────

const TEXT_KEYS = new Set(['text', 'display', 'title', 'description', 'name', 'family', 'given', 'prefix', 'suffix', 'valueString', 'comment', 'conclusion', 'summary', 'detail', 'unit', 'status', 'outcome', 'criticality', 'severity']);
const DATE_KEYS = new Set(['effectiveDateTime', 'issued', 'onsetDateTime', 'abatementDateTime', 'recordedDate', 'occurrenceDateTime', 'performedDateTime', 'authoredOn', 'date', 'created', 'dateAsserted', 'start', 'end', 'birthDate']);
const SKIP_KEYS = new Set(['id', 'reference', 'system', 'code', 'url', 'identifier', 'meta', 'extension', 'modifierExtension', 'data', 'contentType', 'fullUrl', 'versionId', 'lastUpdated', 'profile', 'fhir_comments']);
const MAX_CHARS = 8_000;

/** Narrative HTML reduced to its words. `&amp;` resolves LAST, or escaped text comes back as markup (yourphr#681). */
function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * The human-readable text of a record: display names, code text, notes,
 * narrative, dates; never ids, system URIs, references or bare codes. A `code`
 * that is a CodeableConcept is kept (it's the clinical name of most records);
 * the bare code string inside a coding is skipped.
 */
export function textFor(resource: unknown): string {
  const out: string[] = [];
  const walk = (node: unknown, key: string): void => {
    if (out.join(' ').length > MAX_CHARS) return;
    if (Array.isArray(node)) { node.forEach((n) => walk(n, key)); return; }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (SKIP_KEYS.has(k) && !(k === 'code' && v !== null && typeof v === 'object')) continue;
        if (k === 'div' && typeof v === 'string') { out.push(stripTags(v)); continue; }
        walk(v, k);
      }
      return;
    }
    if (typeof node === 'string') {
      if (key === 'resourceType') out.push(node.replace(/([a-z])([A-Z])/g, '$1 $2'));
      else if (TEXT_KEYS.has(key)) out.push(node);
      else if (DATE_KEYS.has(key)) out.push(node.slice(0, 10));
    } else if (typeof node === 'number' && key === 'value') {
      out.push(String(node));
    }
  };
  walk(resource, '');
  return out.join(' ').replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS);
}

/** A user's words as an FTS5 query: every term required, the last one as a prefix, nothing else interpreted. */
export function ftsQuery(q: string): string {
  const terms = q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 0).slice(0, 12);
  if (terms.length === 0) return '';
  return terms.map((t, i) => `"${t.replace(/"/g, '')}"${i === terms.length - 1 ? '*' : ''}`).join(' AND ');
}

/**
 * The owner as one FTS5 token (yourphr#912): a hash, so any username becomes a
 * single token that no other username shares. Indexed in the text table, it
 * lets a search match only that user's rows, instead of matching every
 * user's and filtering afterwards.
 */
export function ownerKey(owner: string): string {
  return `k${createHash('sha256').update(owner, 'utf8').digest('hex').slice(0, 32)}`;
}

/** A user's words, matched in their own text only. '' when there are no words. */
export function ownTextQuery(owner: string, q: string): string {
  const words = ftsQuery(q);
  return words === '' ? '' : `owner_key : "${ownerKey(owner)}" AND body : (${words})`;
}

/** The comparisons a search filter may make. Anything else is refused, never guessed. */
export type FilterOperator = 'eq' | 'contains' | 'sw' | 'gt' | 'ge' | 'lt' | 'le' | 'missing';
export interface SearchFilter { code: string; operator: FilterOperator; value: string }
