/**
 * The human-readable text of a record (yourphr#599): what a person would recognise — display names,
 * code text, notes, narrative, dates — derived from the resource, never the raw JSON. Ids, system
 * URIs, references and bare codes are left out on purpose: "metformin" should match the
 * medication, not every record that mentions an identifier containing those letters.
 */
const TEXT_KEYS = new Set(['text', 'display', 'title', 'description', 'name', 'family', 'given', 'prefix', 'suffix', 'valueString', 'comment', 'conclusion', 'summary', 'detail', 'unit', 'status', 'outcome', 'criticality', 'severity']);
const DATE_KEYS = new Set(['effectiveDateTime', 'issued', 'onsetDateTime', 'abatementDateTime', 'recordedDate', 'occurrenceDateTime', 'performedDateTime', 'authoredOn', 'date', 'created', 'dateAsserted', 'start', 'end', 'birthDate']);
const SKIP_KEYS = new Set(['id', 'reference', 'system', 'code', 'url', 'identifier', 'meta', 'extension', 'modifierExtension', 'data', 'contentType', 'fullUrl', 'versionId', 'lastUpdated', 'profile', 'fhir_comments']);
const MAX_CHARS = 8_000;

/**
 * Narrative HTML reduced to the words in it.
 *
 * ORDER IS THE WHOLE CORRECTNESS ARGUMENT (yourphr#681). `&amp;` must be resolved LAST, because it
 * is the escape for the escape character — every other entity it could produce has already been
 * handled by the time it runs. Resolving it first, as this did, makes the pass eat its own output:
 *
 *   &amp;lt;script&amp;gt;   ->  &lt;script&gt;   (after &amp; -> &)
 *                            ->  <script>         (after &lt; -> <)
 *
 * Text that arrived deliberately escaped comes back as live markup. Nothing renders this string as
 * HTML today — it feeds the FTS5 index and is served as search snippets, which the Angular app
 * interpolates — so the bug was latent rather than exploited. It is fixed anyway: this function's
 * contract is "the words a person would recognise", and silently manufacturing markup breaks that
 * for whatever consumes it next. The records it reads are documents other people wrote.
 */
function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&amp;/g, '&'); // LAST — see above
}

export function textFor(resource: unknown): string {
  const out: string[] = [];
  const walk = (node: unknown, key: string): void => {
    if (out.join(' ').length > MAX_CHARS) return;
    if (Array.isArray(node)) { node.forEach((n) => walk(n, key)); return; }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        // A key in SKIP_KEYS is skipped only when its VALUE is a leaf. `code` is the case that
        // matters: in FHIR it is usually a CodeableConcept, so skipping it by name threw away the
        // clinical name of most resources — Condition.code, Observation.code, Procedure.code,
        // AllergyIntolerance.code, DiagnosticReport.code — and searching "prediabetes" or
        // "colonoscopy" matched nothing while the index looked like it worked. The bare `code`
        // STRING inside each coding is still skipped, which is what the rule was reaching for.
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

export function queryTerms(q: string): string[] {
  return q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 0).slice(0, 12);
}

/** A person's words as an FTS5 query: every term required, the last one as a prefix, nothing else interpreted. */
export function ftsQuery(q: string): string {
  const terms = queryTerms(q);
  if (terms.length === 0) return '';
  return terms.map((t, i) => `"${t.replace(/"/g, '')}"${i === terms.length - 1 ? '*' : ''}`).join(' AND ');
}

/** The same word/prefix contract for a contained projection of an indexed parent. */
export function matchesText(text: string, q: string): boolean {
  const plain = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '');
  const terms = queryTerms(plain(q));
  const words = plain(text).toLowerCase().split(/[^\p{L}\p{N}]+/u);
  return terms.length > 0 && terms.every((term, i) =>
    words.some(word => i === terms.length - 1 ? word.startsWith(term) : word === term));
}
