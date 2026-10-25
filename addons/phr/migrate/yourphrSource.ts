/**
 * The move from yourPHR into phr (yourphr#969): reading today's yourPHR
 * records store (`records.db`, main's `src/SqliteFhirRepository.ts`), and
 * checking afterwards that every record arrived.
 *
 * Pure: no database, no network, no logging. YourphrSourceStore reads the
 * rows; this turns them into what PhrManager's migration door takes, and
 * computes the phr id each record gets so a check can ask for exactly those.
 * History is not carried: each record arrives as its current version.
 *
 * Never puts a record's content in a message: it is health data.
 */
import { localiseRecords } from '../managers/localIds.js';
import type { PhrFileData } from '../importers/shims.js';
import type { SourceRow } from './YourphrSourceStore.js';

/** One source's records for one person, as phr's migration door takes them. */
export interface SourceFile {
  /** The connected source the records came from in yourPHR, or `yourphr` for none. */
  sourceId: string;
  file: PhrFileData;
}

/** A record's phr id, `Type/id`, as the move gives it. */
export type PhrRef = string;

/** yourPHR's own name for records with no source (uploaded files, notes). */
export const NO_SOURCE = 'yourphr';

/** A person's live rows (YourphrSourceStore.rowsOf), one file per source, ready for PhrManager.migrateFile. */
export function filesFrom(rows: readonly SourceRow[]): SourceFile[] {
  const bySource = new Map<string, PhrFileData>();
  for (const row of rows) {
    const sourceId = row.source_id || NO_SOURCE;
    const file = bySource.get(sourceId) ?? { resources: [], skippedEntries: 0 };
    bySource.set(sourceId, file);
    try {
      const resource = JSON.parse(row.content) as unknown;
      if (resource && typeof resource === 'object' && !Array.isArray(resource) && typeof (resource as { resourceType?: unknown }).resourceType === 'string') {
        file.resources.push(resource as Record<string, unknown>);
      } else {
        file.skippedEntries++;
      }
    } catch {
      file.skippedEntries++;
    }
  }
  return [...bySource.entries()].map(([sourceId, file]) => ({ sourceId, file }));
}

/**
 * The phr id each of a person's records gets in the move, computed the way
 * the move computes it (same origin rules, same fallback per source), so a
 * check can ask phr for exactly these. Records without an id are left out,
 * as the move skips them.
 */
export function expectedRefs(files: readonly SourceFile[]): PhrRef[] {
  const refs: PhrRef[] = [];
  for (const { sourceId, file } of files) {
    const kept = file.resources.filter((r) => typeof r.id === 'string' && r.id !== '');
    const local = localiseRecords(kept, file.fullUrls, `urn:yourphr:source:${sourceId}`);
    for (const r of local.resources) refs.push(`${String(r.resourceType)}/${String(r.id)}`);
  }
  return refs;
}
