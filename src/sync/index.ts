/**
 * Pulling records from a provider and storing them — the last untested part of the transition
 * (yourphr#539).
 *
 * Two properties this has to get right, and only one of them is about fetching:
 *
 *   1. Paging. A patient's record arrives across many Bundle pages, linked by `link[relation=next]`.
 *      Those URLs come from the PROVIDER, so every one goes back through the guarded capability and
 *      is additionally required to stay on the server the sync started from — see nextPageUrl.
 *
 *   2. Idempotence. A resync must not duplicate. This is the failure that matters to a patient: a
 *      record list that doubles every time somebody presses refresh is worse than one that fails,
 *      because it looks like it worked. yourphr#252 tracks the same question on the Go side.
 */
import type { Bundle, BundleEntry, Resource } from '@medplum/fhirtypes';
import { OutboundHttp } from '../http/index.js';
import type { SqliteFhirRepository } from '../SqliteFhirRepository.js';
import type { RecordsWriter } from '../app/providers/BaseRecordsProvider.js';

export interface SyncOptions {
  /** The door (yourphr#609). When absent, `repo` + `sourceId` build a repository-bound writer. */
  writer?: RecordsWriter;
  repo?: SqliteFhirRepository;
  /**
   * Empty means send no Authorization header at all. Some sandbox and public FHIR endpoints serve
   * open data and reject a malformed bearer token with 401 — sending "Bearer " plus a placeholder
   * fails where sending nothing succeeds.
   */
  accessToken: string;
  /** Tests only. Disables the SSRF guard so a loopback fake can be reached. */
  allowInternal?: boolean;
  /** Refused past this, rather than paging forever on a server that always returns a next link. */
  maxPages?: number;
  /**
   * Which connected provider these records come from. When set, a record already held from a
   * DIFFERENT source is refused rather than overwritten — see SqliteFhirRepository.COLLISION.
   * Unset keeps the previous behaviour, which is correct for a single-source install.
   */
  sourceId?: string;
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
}

const DEFAULT_MAX_PAGES = 500;

/**
 * A FHIR server answered with something other than 200. Carries the status so a caller can tell
 * the one answer that ends a sync — 401, the token itself refused — from the per-type refusals a
 * real server gives routinely: Epic answers 403 for a type the app was not granted and 400 for a
 * search it will not run without a `category` (yourphr#753).
 */
export class FhirHttpError extends Error {
  /**
   * The response body as the server sent it, so a caller can read the OperationOutcome rather than
   * pattern-match the message (yourphr#754): Epic's "requires a category" refusal is an issue with
   * `code: required`, and that is what decides whether asking differently is worth a try.
   */
  constructor(readonly status: number, message: string, readonly body = '') {
    super(message);
    this.name = 'FhirHttpError';
  }
}

/**
 * The next page URL, or undefined when the bundle is the last one.
 *
 * A `next` link is a provider-supplied URL that this client will follow while holding an access
 * token, so it is checked twice: the guarded capability refuses internal addresses, and this
 * refuses a link that leaves the origin the sync started from. Without the second check a provider
 * could page a caller onto an unrelated host and be handed the Authorization header.
 */
export function nextPageUrl(bundle: Bundle, currentUrl: string): string | undefined {
  const link = (bundle.link ?? []).find((l) => l.relation === 'next');
  if (!link?.url) {
    return undefined;
  }
  let candidate: URL;
  let origin: URL;
  try {
    candidate = new URL(link.url, currentUrl);
    origin = new URL(currentUrl);
  } catch {
    throw new Error(`unusable next link: ${link.url}`);
  }
  if (candidate.origin !== origin.origin) {
    throw new Error(
      `refusing a next link that leaves the origin: ${candidate.origin} is not ${origin.origin} — ` +
        'the access token would be sent there'
    );
  }
  return candidate.href;
}

/**
 * Fetches every page from `startUrl` and stores what comes back.
 *
 * Storage goes through the repository's create/update path, which keys on (resourceType, id, user).
 * So a resource that arrives twice — across a resync, or twice within one run — updates in place
 * rather than inserting again. That is where idempotence comes from; it is a property of the
 * primary key, not of anything clever here.
 */
export async function syncFrom(startUrl: string, options: SyncOptions): Promise<SyncReport> {
  const { accessToken } = options;
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const http = new OutboundHttp({ allowInternal: options.allowInternal });
  // The door the records go through (yourphr#609): a writer bound to the account and the source.
  // A repository-bound writer is built here for the harnesses that hand a repository in directly.
  const writer = options.writer ?? repositoryWriter(options.repo!, options.sourceId ?? '');

  const report = emptySyncReport();
  const seenThisRun = new Set<string>();

  let url: string | undefined = startUrl;
  try {
    while (url) {
      if (report.pages >= maxPages) {
        throw new Error(`stopped after ${maxPages} pages — a provider that always returns a next link`);
      }

      const response = await http.get(url, {
          headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
        });
      if (response.status !== 200) {
        throw new FhirHttpError(response.status, `HTTP ${response.status} fetching ${url}: ${response.body.toString('utf8').slice(0, 256)}`, response.body.toString('utf8'));
      }

      let bundle: Bundle;
      try {
        bundle = JSON.parse(response.body.toString('utf8')) as Bundle;
      } catch (err) {
        throw new Error(`decoding the bundle from ${url}: ${(err as Error).message}`);
      }
      if (bundle.resourceType !== 'Bundle') {
        throw new Error(`expected a Bundle from ${url}, got ${String(bundle.resourceType)}`);
      }

      report.pages++;
      await storeEntries((bundle.entry ?? []) as BundleEntry[], writer, report, seenThisRun);
      url = nextPageUrl(bundle, url);
    }
  } finally {
    // nothing to restore: the writer carries its own source attribution
  }

  return report;
}

/**
 * Reads ONE resource by URL and stores it — the patient, read as `GET Patient/{id}`.
 *
 * Searching Patient with `?patient=` asks for a parameter Patient does not have, and Epic refuses
 * it; that one request used to be the first of every sync and took the whole import down with it
 * (yourphr#753). Go read the patient by id (v2.10.3 capability_fetch.go, fetchOneResource), and so
 * does this. A server that answers a read with a Bundle anyway is accepted as one.
 */
export async function syncResource(url: string, options: SyncOptions): Promise<SyncReport> {
  const http = new OutboundHttp({ allowInternal: options.allowInternal });
  const writer = options.writer ?? repositoryWriter(options.repo!, options.sourceId ?? '');
  const response = await http.get(url, { headers: options.accessToken ? { authorization: `Bearer ${options.accessToken}` } : {} });
  if (response.status !== 200) {
    throw new FhirHttpError(response.status, `HTTP ${response.status} fetching ${url}: ${response.body.toString('utf8').slice(0, 256)}`, response.body.toString('utf8'));
  }
  let resource: Resource;
  try {
    resource = JSON.parse(response.body.toString('utf8')) as Resource;
  } catch (err) {
    throw new Error(`decoding the resource from ${url}: ${(err as Error).message}`);
  }
  const report = emptySyncReport();
  report.pages = 1;
  const entries = resource.resourceType === 'Bundle' ? ((resource as Bundle).entry ?? []) : [{ resource }];
  await storeEntries(entries as { resource?: Resource }[], writer, report, new Set());
  return report;
}

export function emptySyncReport(): SyncReport {
  return { pages: 0, collisions: [], received: 0, created: 0, updated: 0, duplicatesWithinRun: 0, byType: {}, skipped: [] };
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

/** A writer over a repository handle, attributing every write to one source and restoring afterwards. */
export function repositoryWriter(repo: SqliteFhirRepository, sourceId: string): RecordsWriter {
  return {
    upsert: async (resource) => {
      let existed = true;
      try {
        await repo.readResource(resource.resourceType, resource.id as string);
      } catch {
        existed = false;
      }
      const previous = repo.sourceId;
      repo.sourceId = sourceId;
      try {
        await repo.updateResource(resource);
      } finally {
        repo.sourceId = previous;
      }
      return existed ? 'updated' : 'created';
    },
    exists: async (resourceType, id) => {
      try {
        await repo.readResource(resourceType, id);
        return true;
      } catch {
        return false;
      }
    },
  };
}
