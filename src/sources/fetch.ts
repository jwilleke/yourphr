/**
 * Fetching a patient's records from a provider, and paging through them (yourphr#539, #760).
 *
 * Moved here from `src/sync` so that everything about TALKING to a provider lives under
 * `src/sources`: the SMART flow, the fetch, the query plan and the capability read. What remains in
 * `src/sync` is the storage half — `storeEntries` and the report it fills — which is YourPHR's, not
 * a source's, and which an upload uses without any of this.
 *
 * Two properties this has to get right, and only one of them is about fetching:
 *
 *   1. Paging. A patient's record arrives across many Bundle pages, linked by `link[relation=next]`.
 *      Those URLs come from the PROVIDER, so every one goes back through the guarded capability and
 *      is additionally required to stay on the server the sync started from — see nextPageUrl.
 *
 *   2. Idempotence. A resync must not duplicate. This is the failure that matters to a patient: a
 *      record list that doubles every time somebody presses refresh is worse than one that fails,
 *      because it looks like it worked. That property belongs to the storage half's primary key.
 */
import type { Bundle, BundleEntry, Resource } from '@medplum/fhirtypes';
import { OutboundHttp } from '../http/index.js';
import { emptySyncReport, storeEntries, type SyncOptions, type SyncReport } from '../sync/index.js';



const DEFAULT_MAX_PAGES = 500;

/** Long enough to outlast a blip, short enough that a sync does not hang on a dead provider. */
const RETRY_BACKOFF_MS = 750;

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
  const http = options.http ?? new OutboundHttp({ allowInternal: options.allowInternal });
  // The door the records go through (yourphr#609): a writer bound to the account and the source.
  const { writer } = options;

  const report = emptySyncReport();
  const seenThisRun = new Set<string>();

  let url: string | undefined = startUrl;
  try {
    while (url) {
      if (report.pages >= maxPages) {
        // Truncate rather than throw (yourphr#759): the pages already stored are real records, and
        // a provider with more history than the budget is not an error. The caller reports it.
        report.truncated = true;
        break;
      }

      const response = await getWithOneRetry(http, url, accessToken);
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
 * One GET, retried once after a transient failure (yourphr#759).
 *
 * Transient means the server did not answer, or answered 5xx: a timeout, a reset, a gateway between
 * us and the provider. Those succeed on a second attempt often enough that treating them like a
 * refusal — skipping the type for the whole cycle, as before — loses records for no reason. A 4xx
 * is NOT retried: it will say the same thing again, and 401 in particular ends the sync (#753).
 */
async function getWithOneRetry(http: OutboundHttp, url: string, accessToken: string): Promise<{ status: number; body: Buffer }> {
  const headers: Record<string, string> = accessToken ? { authorization: `Bearer ${accessToken}` } : {};
  try {
    const first = await http.get(url, { headers });
    if (first.status < 500) return first;
  } catch (err) {
    // A thrown error is the network itself failing; fall through to the second attempt.
    if (!isTransient(err)) throw err;
  }
  await new Promise((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS));
  return http.get(url, { headers });
}

/** A guard refusal is not transient and must never be retried; anything else thrown here is. */
function isTransient(err: unknown): boolean {
  const message = (err as Error)?.message ?? '';
  return !/refusing to connect|internal address|blocked/i.test(message);
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
  const http = options.http ?? new OutboundHttp({ allowInternal: options.allowInternal });
  const { writer } = options;
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

