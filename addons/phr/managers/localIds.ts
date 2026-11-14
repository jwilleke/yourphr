/**
 * phr's own id for every record it receives (yourphr#784). Pure: no database.
 *
 * A FHIR `Resource.id` is unique only on the server that issued it: two
 * providers can both send `Condition/12345`. Following John Moehrke's guidance
 * (yourphr#784, 2026-09-29), phr never stores a provider's id as its own. Each
 * copy gets a phr id, and a FHIR `Provenance` says where it came from:
 * `target` is phr's record, `entity` is the original (its server and id), and
 * `recorded` is when phr last took it in.
 *
 * The phr id is derived from (origin, type, original id), so the same record
 * from the same server lands on the same phr record on every import, and a
 * reference to a record in another file of the same download resolves without
 * a lookup. Records from different servers can't collide.
 *
 * The origin of a record is, in order:
 *  - the server base of its Bundle entry's `fullUrl` (".../Condition/12345");
 *  - its `meta.source`;
 *  - the import's own source (`fallbackOrigin`): a download that doesn't name
 *    its server is one source of its own. Callers give each download its own.
 */
import { createHash } from 'node:crypto';

export interface LocalisedFile {
  /** The records, with phr ids and every reference rewritten to match. */
  resources: Record<string, unknown>[];
  /** The Provenance for record i, stamped `recorded`: written when record i is created or changed. */
  provenanceFor(index: number, recorded: string): Record<string, unknown>;
}

const ABSOLUTE = /^(https?:\/\/.+?)\/([A-Z][A-Za-z]+)\/([A-Za-z0-9\-.]{1,64})(?:\/_history\/[^/]+)?$/;
const RELATIVE = /^([A-Z][A-Za-z]+)\/([A-Za-z0-9\-.]{1,64})(?:\/_history\/[^/]+)?$/;

const hash = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 32);

/** phr's id for a record of `type` that `origin` calls `originalId`. */
export function localId(origin: string, type: string, originalId: string): string {
  return `p${hash(`${origin}\u0000${type}\u0000${originalId}`)}`;
}

/** Where a record says it came from, or undefined when it doesn't say. */
function statedOrigin(resource: Record<string, unknown>, fullUrl: string | undefined): string | undefined {
  const fromUrl = fullUrl?.match(ABSOLUTE);
  if (fromUrl && fromUrl[2] === resource.resourceType) return fromUrl[1];
  const meta = resource.meta as { source?: unknown } | undefined;
  return typeof meta?.source === 'string' && meta.source !== '' ? meta.source : undefined;
}

export function localiseRecords(
  input: readonly Record<string, unknown>[],
  fullUrls: readonly (string | undefined)[] | undefined,
  fallbackOrigin: string
): LocalisedFile {
  const origins = input.map((r, i) => statedOrigin(r, fullUrls?.[i]) ?? fallbackOrigin);
  const originals = input.map((r) => ({ type: String(r.resourceType), id: String(r.id) }));
  // A Bundle may reference its own entries by fullUrl (often urn:uuid:...).
  const byFullUrl = new Map<string, string>();
  input.forEach((_r, i) => {
    const url = fullUrls?.[i];
    if (url) byFullUrl.set(url, `${originals[i].type}/${localId(origins[i], originals[i].type, originals[i].id)}`);
  });

  const rewrite = (node: unknown, origin: string): unknown => {
    if (Array.isArray(node)) return node.map((n) => rewrite(n, origin));
    if (!node || typeof node !== 'object') return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === 'reference' && typeof v === 'string') out[k] = rewriteReference(v, origin);
      else if (k === 'contained' || k === 'meta') out[k] = v; // contained records keep their local "#x" ids
      else out[k] = rewrite(v, origin);
    }
    return out;
  };
  const rewriteReference = (ref: string, origin: string): string => {
    if (ref.startsWith('#')) return ref;
    const inBundle = byFullUrl.get(ref);
    if (inBundle) return inBundle;
    const absolute = ref.match(ABSOLUTE);
    if (absolute) return `${absolute[2]}/${localId(absolute[1], absolute[2], absolute[3])}`;
    const relative = ref.match(RELATIVE);
    if (relative) return `${relative[1]}/${localId(origin, relative[1], relative[2])}`;
    return ref; // a URN or anything else phr can't place is kept as the record states it
  };

  const resources = input.map((r, i) => ({
    ...(rewrite(r, origins[i]) as Record<string, unknown>),
    id: localId(origins[i], originals[i].type, originals[i].id)
  }));

  return {
    resources,
    provenanceFor(index, recorded) {
      const { type, id } = originals[index];
      const origin = origins[index];
      return {
        resourceType: 'Provenance',
        id: `v${hash(`provenance\u0000${origin}\u0000${type}\u0000${id}`)}`,
        target: [{ reference: `${type}/${String(resources[index].id)}` }],
        recorded,
        agent: [{
          type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/provenance-participant-type', code: 'assembler', display: 'Assembler' }] },
          who: { display: 'yourPHR' }
        }],
        entity: [{ role: 'source', what: { identifier: { system: origin, value: `${type}/${id}` } } }]
      };
    }
  };
}
