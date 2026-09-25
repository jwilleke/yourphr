/**
 * Storing what a sync fetched — YourPHR's half (yourphr#539; the fetch half moved to
 * `src/sources/fetch.ts` in yourphr#760).
 *
 * Idempotence lives here: storage goes through the repository's create/update path, which keys on
 * (resourceType, id, user), so a resource that arrives twice — across a resync, or twice within one
 * run — updates in place rather than inserting again. A record list that doubles every time
 * somebody presses refresh is worse than one that fails, because it looks like it worked.
 *
 * An uploaded file (yourphr#736) comes through the same door, so a re-upload is exactly as
 * idempotent as a resync, and a contested id is refused the same way whichever path brought it.
 */
import type { Resource } from '@medplum/fhirtypes';
import type { RecordsWriter } from '../app/providers/BaseRecordsProvider.js';
import type { OutboundHttp } from '../http/index.js';

export interface SyncOptions {
  /**
   * The door (yourphr#609): a writer bound to one account and one source, from the records
   * manager or — in a harness — `SqliteRecordsProvider.writer()`. The source it attributes writes to
   * is what refuses a record already held from a DIFFERENT source (SqliteFhirRepository.COLLISION).
   */
  writer: RecordsWriter;
  /**
   * Empty means send no Authorization header at all. Some sandbox and public FHIR endpoints serve
   * open data and reject a malformed bearer token with 401 — sending "Bearer " plus a placeholder
   * fails where sending nothing succeeds.
   */
  accessToken: string;
  /** Tests only. Disables the SSRF guard so a loopback fake can be reached. */
  allowInternal?: boolean;
  /**
   * The caller's guarded HTTP capability (yourphr#760). `src/sources` never makes its own: handing
   * one in is what keeps `scripts/check-http-boundary.sh` meaningful, and is the shape an extracted
   * package would require. One is built from `allowInternal` when a caller passes none.
   */
  http?: OutboundHttp;
  /** Refused past this, rather than paging forever on a server that always returns a next link. */
  maxPages?: number;
}

export interface SyncReport {
  pages: number;
  /** Records refused because another provider already holds that id. Never silently merged. */
  collisions: { resource: string; detail: string }[];
  /** Resources seen in the response, including ones already held. */
  received: number;
  created: number;
  updated: number;
  /** Same (type, id) appearing more than once within a single sync — a provider-side oddity. */
  duplicatesWithinRun: number;
  byType: Record<string, number>;
  skipped: { reason: string; detail: string }[];
  /**
   * The page budget ran out before the provider ran out of pages (yourphr#759). Soft, as Go's was:
   * what arrived is kept and the caller SAYS so, because a truncated import that looks complete is
   * the failure worth avoiding.
   */
  truncated: boolean;
}

export function emptySyncReport(): SyncReport {
  return { pages: 0, collisions: [], received: 0, created: 0, updated: 0, duplicatesWithinRun: 0, byType: {}, skipped: [], truncated: false };
}

/**
 * Writes one batch of entries through the door and accounts for them in `report`. A sync page and
 * an uploaded file (yourphr#736) both come through here, so a re-upload is exactly as idempotent as
 * a resync, and a contested id is refused the same way whichever path brought it.
 */
export async function storeEntries(entries: { resource?: Resource }[], writer: RecordsWriter, report: SyncReport, seenThisRun: Set<string>): Promise<void> {
  for (const entry of entries) {
    const resource = entry.resource;
    if (!resource?.resourceType) {
      report.skipped.push({ reason: 'entry carried no resource', detail: JSON.stringify(entry).slice(0, 120) });
      continue;
    }
    if (!resource.id) {
      // Without an id there is no way to recognise this record on the next sync, so storing it
      // would guarantee a duplicate later. Refusing is the honest outcome.
      report.skipped.push({ reason: 'resource had no id', detail: resource.resourceType });
      continue;
    }

    report.received++;
    const key = `${resource.resourceType}/${resource.id}`;
    if (seenThisRun.has(key)) {
      report.duplicatesWithinRun++;
    }
    seenThisRun.add(key);

    let outcome: 'created' | 'updated';
    try {
      outcome = await writer.upsert(resource);
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes('cross-source id collision')) {
        // Reported and skipped rather than aborting the run: one contested id must not cost the
        // patient the other 20,000 records in the sync.
        report.collisions.push({ resource: key, detail: message });
        continue;
      }
      throw err;
    }
    if (outcome === 'updated') {
      report.updated++;
    } else {
      report.created++;
      report.byType[resource.resourceType] = (report.byType[resource.resourceType] ?? 0) + 1;
    }
  }
}

