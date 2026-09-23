/**
 * Sources (yourphr#612): what a member connected and how it is kept current — the one door to
 * connected_sources and to the source client. Owns the background pass that was src/worker:
 *
 *   - Token refresh runs BEFORE sync and is accounted separately ("token-refresh: attempted N,
 *     refreshed M") — that exact log line is what proved the Epic confidential-client fix live.
 *   - Refresh only near expiry: refreshing every tick churns refresh tokens for nothing, and some
 *     providers rotate the refresh token on every use.
 *   - One source failing must not cost the others their sync (yourphr#539's rule within a source).
 *   - Every pass records a job — outcome, counts, duration, error (yourphr#441).
 *   - The page cap rides in from configuration (sync.max-pages) — yourphr#439 is what a missing cap does.
 *
 * Ownership is the seam: every member-facing method takes the caller's context and answers only
 * for the caller's own sources (the worker acts for each owner as a named system principal).
 */
import { BaseManager, type BackupData } from '../../framework/BaseManager.js';
import type { Engine } from '../../framework/Engine.js';
import { ApiContext, ApiError } from '../../framework/ApiContext.js';
import { backgroundJobShape, type JobRecord } from '../../framework/managers/JobsManager.js';
import type { BaseSourcesProvider, ConnectedSource, DynamicClient, NewSource } from '../providers/BaseSourcesProvider.js';

/**
 * Go's platform_type for a source nobody syncs: the records the patient writes, and every file
 * they upload (yourphr#736). Go gave both this name, so a migrated instance holds both kinds under
 * it and the two are told apart by what they carry — see manualSource and uploadSourceFor.
 */
export const MANUAL_PLATFORM_TYPE = 'manual';
/** The display of the ONE source holding what the patient wrote themselves (yourphr#683). */
export const MANUAL_SOURCE_DISPLAY = 'Added by you';
import type { BaseSourceClientProvider } from '../providers/BaseSourceClientProvider.js';
import type { BaseDocumentConverterProvider, ConverterStatus } from '../providers/BaseDocumentConverterProvider.js';
import type { EventBus } from '../../events/index.js';
import { providerRequiresLegalConsent } from '../../account/index.js';
import { FhirHttpError, emptySyncReport, storeEntries } from '../../sync/index.js';
import { decodeCapability, encodeCapability, narrowTypes } from '../../sources/capability.js';
import { resourceTypesFromScopes } from '../../migrate/index.js';
import { UploadFormatError, parseFhirUpload, patientOf } from '../../upload/index.js';

declare module '../../framework/Engine.js' {
  interface ManagerRegistry {
    sources: SourcesManager;
  }
}

export type { ConnectedSource, NewSource, DynamicClient };

/** Refresh when this close to expiry — half the typical sandbox hour, same intent as Go's loop. */
const REFRESH_MARGIN_SECONDS = 10 * 60;

/**
 * How stale a stored CapabilityStatement may be before it is read again (yourphr#756). Weekly: a
 * server gains a resource type rarely, and re-reading every sync would spend a request per cycle to
 * learn nothing. A source that has never read one re-reads on its next sync, whatever its age.
 */
const CAPABILITY_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export interface PassReport {
  refreshAttempted: number;
  refreshed: number;
  synced: number;
  failed: number;
}

export interface SourceImportReport {
  imported: string[];
  skippedExisting: string[];
  needsReconnect: string[];
  /** Legacy source id -> spike source id, for imported AND already-present sources alike. */
  idMap: Record<string, number>;
}

export interface SourcesOptions {
  /** Pages one TYPE may fetch (yourphr#759). */
  maxPages: number;
  /**
   * Pages one SOURCE's whole sync may fetch (yourphr#759). Without it a provider with years of one
   * type spends the run on that type and the rest of the record never arrives — and #754's
   * per-category fan-out multiplies the searches a single type makes.
   */
  maxPagesPerSync?: number;
  /** Tests only — lets a loopback fake serve `/metadata`; the SSRF guard stays on everywhere else. */
  allowInternal?: boolean;
  log?: (line: string) => void;
  events?: EventBus;
  /**
   * Formats an upload is converted FROM before import (yourphr#735) — ngdpbase's ImportManager
   * converter list. The first whose canHandle says yes converts; a file none claims is read as FHIR.
   */
  converters?: BaseDocumentConverterProvider[];
}

/** What an upload did (yourphr#736): the sync report's counts, so the page can say what happened. */
export interface UploadReport {
  /** The format converted from ('ccda'), or 'fhir' when the file was FHIR already. */
  format: string;
  received: number;
  created: number;
  updated: number;
  /** Records another source already holds under the same id — refused, never merged. */
  collisions: number;
  /** Entries or lines that could not be read. */
  skipped: number;
}

/**
 * A connected source in the shape of Go's SourceCredential (yourphr#594). The public id is
 * `source-<n>`, the same string every record of that source carries, so /explore/:source and
 * ?sourceID line up. Secrets are Go's "[REDACTED]" when present and '' when disconnected; fields
 * this stack does not hold are absent, not invented — the Angular code defaults every one of them.
 */
export function sourceShape(source: ConnectedSource, latestJob: JobRecord | undefined): Record<string, unknown> {
  const redact = (secret: string): string => (secret === '' ? '' : '[REDACTED]');
  return {
    id: `source-${source.id}`,
    ...(source.lastSyncAt > 0 ? { updated_at: new Date(source.lastSyncAt * 1000).toISOString() } : {}),
    user_id: source.userId,
    display: source.display,
    ...(source.platformType !== '' ? { platform_type: source.platformType } : {}),
    ...(source.environment !== '' ? { environment: source.environment } : {}),
    patient: source.patient,
    client_id: source.clientId,
    api_endpoint_base_url: source.fhirBaseUrl,
    access_token: redact(source.accessToken),
    refresh_token: redact(source.refreshToken),
    expires_at: source.expiresAt,
    ...(latestJob ? { latest_background_job: backgroundJobShape(latestJob, source.userId) } : {}),
  };
}

/**
 * A filename fit to show as a source's name: the last path segment, no control characters, capped.
 * Browsers send only the base name, but a hand-rolled client can send anything.
 */
export function cleanFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  return base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120);
}

/** No access token and no refresh token: the source was disconnected, not merely expired. */
export function isDisconnected(source: ConnectedSource): boolean {
  return source.accessToken === '' && source.refreshToken === '';
}

export class SourcesManager extends BaseManager {
  readonly name = 'sources';
  override readonly dependsOn = ['records', 'jobs'] as const;
  private readonly log: (line: string) => void;
  /**
   * Sources the worker has already reported as expired-with-no-refresh-token (yourphr#706). One
   * log line and one failure job per outage, not one per 15-minute cycle — and no doomed fetches
   * against the provider with a token known to be dead. Per-process on purpose: a restart repeats
   * the warning once, which is a feature.
   */
  private readonly unrefreshable = new Set<number>();
  /**
   * Sources already reported as not serving a readable CapabilityStatement (yourphr#756). Once per
   * outage, not once per cycle — the same rule as `unrefreshable`, for the same reason.
   */
  private readonly capabilityWarned = new Set<number>();

  constructor(
    engine: Engine,
    private readonly provider: BaseSourcesProvider,
    private readonly client: BaseSourceClientProvider,
    private readonly options: SourcesOptions
  ) {
    super(engine);
    this.log = options.log ?? (() => undefined);
  }

  override async initialize(config: Record<string, unknown> = {}): Promise<void> {
    await super.initialize(config);
    await this.provider.initialize();
    this.log(`sources: client provider '${this.client.name}'`);
  }

  /** The per-member event stream the Sources page follows (source_sync / source_complete). */
  get events(): EventBus | undefined {
    return this.options.events;
  }

  // --- ownership -------------------------------------------------------------------------------

  /** The caller's source by its public id — undefined for another member's or a malformed id. */
  async get(ctx: ApiContext, publicId: string): Promise<ConnectedSource | undefined> {
    ctx.requireAuthenticated();
    const m = publicId.match(/^source-(\d+)$/);
    if (!m) return undefined;
    return this.owned(ctx, Number(m[1]));
  }

  /** The caller's source by row id. */
  async owned(ctx: ApiContext, id: number): Promise<ConnectedSource | undefined> {
    ctx.requireAuthenticated();
    const s = await this.provider.byId(id);
    return s && s.userId === ctx.username ? s : undefined;
  }

  /** The caller's sources, oldest first. */
  async list(ctx: ApiContext): Promise<ConnectedSource[]> {
    ctx.requireAuthenticated();
    return (await this.provider.list()).filter((s) => s.userId === ctx.username);
  }

  /** A source's name for the records that carry its id — '' when the source is gone. */
  async displayOf(sourceId: string): Promise<string> {
    const numeric = Number(sourceId.replace('source-', ''));
    return (await this.provider.byId(numeric))?.display ?? '';
  }

  /** How many sources the instance holds — the admin's database page. */
  count(): Promise<number> {
    return this.provider.count();
  }

  // --- shapes ----------------------------------------------------------------------------------

  async shape(source: ConnectedSource): Promise<Record<string, unknown>> {
    return sourceShape(source, await this.engine.managers.jobs.latest(source.id));
  }

  async listShaped(ctx: ApiContext): Promise<Record<string, unknown>[]> {
    return Promise.all((await this.list(ctx)).map((s) => this.shape(s)));
  }

  async getShaped(ctx: ApiContext, publicId: string): Promise<Record<string, unknown> | undefined> {
    const s = await this.get(ctx, publicId);
    return s ? this.shape(s) : undefined;
  }

  /** The source page's header: the source, its type counts and its patient (yourphr#594). */
  async summary(ctx: ApiContext, publicId: string): Promise<Record<string, unknown> | undefined> {
    const s = await this.get(ctx, publicId);
    if (!s) return undefined;
    const records = this.engine.managers.records;
    return { source: await this.shape(s), resource_type_counts: await records.sourceCounts(ctx, publicId), patient: await records.patientOf(ctx, publicId) };
  }

  // --- connect / disconnect / remove -----------------------------------------------------------

  /** Connects a source for the caller; a system principal (migration, seeding) may add for the account it acts for. */
  async add(ctx: ApiContext, source: NewSource): Promise<ConnectedSource> {
    ctx.requireAuthenticated();
    // The shared public-demo account may not bring outside data in (yourphr#496). Enforced HERE
    // rather than at the route because this is the door every connected source comes through, so
    // a new caller cannot arrive without the check.
    if (this.engine.has('demo')) this.engine.managers.demo.refuseConnect(ctx);
    if (source.userId !== ctx.username) throw new ApiError(403, 'a source can only be connected for the signed-in account');
    return this.provider.add(source);
  }

  /**
   * The account's own source — where records the PATIENT wrote go (yourphr#683).
   *
   * Find-or-create, and the whole point is that patient-authored records are NOT anonymous. Every
   * record in this stack is attributed to the source that said it (yourphr#611); writing a
   * hand-entered practitioner with no source, or under a synced provider's source, would make the
   * record claim an origin it does not have. A patient correcting their own care team is a
   * different kind of statement from Epic asserting it, and the store should be able to tell them
   * apart forever.
   *
   * `platformType: 'manual'` is Go's name for exactly this, carried by the migration
   * (`LegacySource.platformType`), so a migrated instance and a fresh one agree.
   *
   * It holds no credentials and no endpoint, so the worker has nothing to sync and skips it — the
   * same shape as a disconnected source.
   */
  async manualSource(ctx: ApiContext): Promise<ConnectedSource> {
    ctx.requireAuthenticated();
    // Matched EXACTLY, not "the first manual source" (yourphr#736): uploads are manual sources too,
    // and a migrated instance carries Go's, so the first one could be an uploaded bundle — and a
    // practitioner the patient typed in would then claim to have come from that file.
    const existing = (await this.list(ctx)).find((s) => s.platformType === MANUAL_PLATFORM_TYPE && s.display === MANUAL_SOURCE_DISPLAY);
    if (existing) return existing;
    return this.add(ctx, {
      userId: ctx.username,
      display: MANUAL_SOURCE_DISPLAY,
      fhirBaseUrl: '',
      tokenUrl: '',
      clientId: '',
      patient: '',
      resourceTypes: [],
      accessToken: '',
      refreshToken: '',
      expiresAt: 0,
      platformType: MANUAL_PLATFORM_TYPE,
      environment: 'production',
    });
  }

  /** Whether the caller's source with this public id is one nobody syncs — theirs to write into. */
  async isManual(ctx: ApiContext, publicId: string): Promise<boolean> {
    return (await this.get(ctx, publicId))?.platformType === MANUAL_PLATFORM_TYPE;
  }

  // --- upload (yourphr#736, #735) ---------------------------------------------------------------

  /** Whether an upload in this format would be converted — the Sources page asks before offering (yourphr#397). */
  converterStatus(ctx: ApiContext, formatId: string): ConverterStatus {
    ctx.requireAuthenticated();
    const converter = (this.options.converters ?? []).find((c) => c.formatId === formatId);
    return converter?.status() ?? { enabled: false, ready: false, setup_hint: `Import from ${formatId} is not part of this build.` };
  }

  /**
   * The source an upload lands in: the caller's existing upload source for the same patient, or a
   * new one.
   *
   * Reused, not one-per-file as Go had it, because this store refuses a cross-source id collision
   * where Go's (source, type, id) key quietly duplicated. One-per-file here would make a re-upload
   * an empty new source beside a list of refusals, and a second C-CDA document for the same person
   * would lose its Patient (the converter mints the same deterministic id for both). Reusing the
   * source makes a re-upload what a resync is: records updated in place. It also picks up a Go
   * upload source carried over by the migration, which already holds those very records.
   *
   * Only a file that names its patient can be matched. One that names none gets a source of its
   * own — a guess at which person a patientless file belongs to is exactly the guess not to make.
   */
  private async uploadSourceFor(ctx: ApiContext, patient: string, filename: string, now: number): Promise<ConnectedSource> {
    if (patient !== '') {
      const held = (await this.list(ctx)).find((s) => s.platformType === MANUAL_PLATFORM_TYPE && s.patient === patient && s.display !== MANUAL_SOURCE_DISPLAY);
      if (held) return held;
    }
    const day = new Date(now * 1000).toISOString().slice(0, 10);
    return this.add(ctx, {
      userId: ctx.username,
      display: filename === '' ? `Uploaded ${day}` : `Uploaded ${filename}`,
      fhirBaseUrl: '',
      tokenUrl: '',
      clientId: '',
      patient,
      resourceTypes: [],
      accessToken: '',
      refreshToken: '',
      expiresAt: 0,
      platformType: MANUAL_PLATFORM_TYPE,
      environment: 'production',
    });
  }

  /**
   * An uploaded file, imported (Go's CreateManualSource, yourphr#736). Converted first when a
   * converter claims it (C-CDA, yourphr#735), then read as FHIR and written through the same
   * `storeEntries` a sync page uses. The whole file is read BEFORE a source is created, so a file
   * that cannot be read leaves nothing behind. A job is recorded either way, as for a sync.
   */
  async importUpload(ctx: ApiContext, upload: { filename: string; bytes: Buffer }, now = Math.floor(Date.now() / 1000)): Promise<{ source: Record<string, unknown>; data: UploadReport }> {
    ctx.requireAuthenticated();
    // Before any conversion work, not just at add(): the shared demo account may not bring outside data in (yourphr#496).
    if (this.engine.has('demo')) this.engine.managers.demo.refuseConnect(ctx);
    const filename = cleanFilename(upload.filename);

    let bytes = upload.bytes;
    const converter = (this.options.converters ?? []).find((c) => c.canHandle(bytes, filename));
    if (converter) bytes = await converter.convert(bytes);

    let parsed;
    try {
      parsed = parseFhirUpload(bytes);
    } catch (err) {
      if (err instanceof UploadFormatError) throw new ApiError(400, `${filename || 'the file'} could not be imported: ${err.message}`, { error_code: 'upload_unreadable' });
      throw err;
    }
    if (parsed.resources.length === 0) throw new ApiError(400, `${filename || 'the file'} holds no FHIR records`, { error_code: 'upload_empty' });

    const source = await this.uploadSourceFor(ctx, patientOf(parsed.resources), filename, now);
    const publicId = `source-${source.id}`;
    const report = emptySyncReport();
    report.skipped.push(...parsed.skipped);
    this.options.events?.publish(source.userId, { event_type: 'source_sync', source_id: publicId });
    let job: JobRecord;
    try {
      try {
        await storeEntries(parsed.resources.map((resource) => ({ resource })), this.engine.managers.records.writer(ctx, publicId), report, new Set());
        await this.provider.markSynced(source.id, now);
        job = { sourceId: source.id, outcome: 'success', received: report.received, created: report.created, updated: report.updated, error: '', startedAt: now, finishedAt: now };
      } catch (err) {
        job = { sourceId: source.id, outcome: 'failure', received: report.received, created: report.created, updated: report.updated, error: (err as Error).message.slice(0, 512), startedAt: now, finishedAt: now };
      }
      job = await this.engine.managers.jobs.record(ctx, job);
    } finally {
      this.options.events?.publish(source.userId, { event_type: 'source_complete', source_id: publicId });
    }
    const data: UploadReport = { format: converter?.formatId ?? 'fhir', received: report.received, created: report.created, updated: report.updated, collisions: report.collisions.length, skipped: report.skipped.length };
    this.log(`upload: source ${source.id} (${data.format}): received ${data.received}, created ${data.created}, updated ${data.updated}, collisions ${data.collisions}, skipped ${data.skipped}`);
    if (job.outcome !== 'success') throw new ApiError(500, `the import stopped part-way: ${job.error}`, { error_code: 'upload_failed' });
    return { source: sourceShape((await this.provider.byId(source.id)) ?? source, job), data };
  }

  /** Disconnect (Go's #437): the tokens go, the records stay; the worker skips it. */
  async disconnect(ctx: ApiContext, publicId: string): Promise<boolean> {
    const s = await this.get(ctx, publicId);
    if (!s) return false;
    await this.provider.clearTokens(s.id);
    return true;
  }

  /**
   * Disconnects every source of the caller the predicate names — consent revocation's rule. The
   * count is what this call actually disconnected: a source already disconnected is skipped rather
   * than counted again, so a second revocation reports 0 instead of repeating the first one's
   * number (the yourphr#528 family — a counter that overstates is a counter that lies).
   */
  async disconnectWhere(ctx: ApiContext, predicate: (source: ConnectedSource) => boolean): Promise<number> {
    let disconnected = 0;
    for (const s of await this.list(ctx)) {
      if (!predicate(s) || isDisconnected(s)) continue;
      await this.provider.clearTokens(s.id);
      disconnected++;
    }
    return disconnected;
  }

  /**
   * Go's rule on consent revocation (yourphr#596, #619): the sources that required the legal
   * consent are disconnected with it — tokens cleared, the rows kept so the page can say why.
   */
  disconnectConsentRequired(ctx: ApiContext): Promise<number> {
    return this.disconnectWhere(ctx, (s) => providerRequiresLegalConsent(s.display, s.fhirBaseUrl, s.platformType));
  }

  /** The source's records go through the Records door; then the source and its job history. */
  async remove(ctx: ApiContext, publicId: string): Promise<number | undefined> {
    const s = await this.get(ctx, publicId);
    if (!s) return undefined;
    const rows = await this.engine.managers.records.removeSource(ctx, publicId);
    await this.engine.managers.jobs.removeForSource(s.id);
    await this.provider.remove(s.id);
    return rows;
  }

  /** The records go, the source stays — Go's "clear data" (yourphr#594). */
  async removeData(ctx: ApiContext, publicId: string): Promise<number | undefined> {
    const s = await this.get(ctx, publicId);
    return s ? this.engine.managers.records.removeSource(ctx, publicId) : undefined;
  }

  /** Account deletion: every source the caller owns, with its history. The records are the Records manager's to remove. */
  async removeAll(ctx: ApiContext): Promise<number> {
    const owned = await this.list(ctx);
    for (const s of owned) {
      await this.engine.managers.jobs.removeForSource(s.id);
      await this.provider.remove(s.id);
    }
    return owned.length;
  }

  async exportBundle(ctx: ApiContext, publicId: string): Promise<{ filename: string; bundle: unknown } | undefined> {
    const s = await this.get(ctx, publicId);
    if (!s) return undefined;
    const bundle = await this.engine.managers.records.exportSource(ctx, publicId);
    const slug = s.display.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'source';
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return { filename: `yourphr-${slug}-${stamp}.json`, bundle };
  }

  // --- dynamic clients (yourphr#540) -----------------------------------------------------------

  async saveDynamicClient(ctx: ApiContext, sourceId: number, client: DynamicClient): Promise<void> {
    if (!(await this.owned(ctx, sourceId))) throw new ApiError(404, 'source not found');
    await this.provider.saveDynamicClient(sourceId, client);
  }

  async dynamicClientFor(ctx: ApiContext, sourceId: number): Promise<DynamicClient | undefined> {
    if (!(await this.owned(ctx, sourceId))) return undefined;
    return this.provider.dynamicClientFor(sourceId);
  }

  // --- sync ------------------------------------------------------------------------------------

  /**
   * "Sync now" (yourphr#594): the scheduled sync, run early, for one of the caller's sources.
   * Answers as Go does — the source with its fresh job, and the rows the upsert touched.
   */
  async syncNow(ctx: ApiContext, publicId: string, now = Math.floor(Date.now() / 1000)): Promise<{ source: Record<string, unknown>; data: number } | undefined> {
    const s = await this.get(ctx, publicId);
    if (!s) return undefined;
    const job = await this.syncOne(ctx, s, now);
    if (job.outcome !== 'success') throw new ApiError(502, job.error || 'sync failed');
    return { source: sourceShape((await this.provider.byId(s.id)) ?? s, job), data: job.created + job.updated };
  }

  /** The initial import after connecting: in the background, as Go's is; the page follows it on the event stream. */
  syncInBackground(ctx: ApiContext, source: ConnectedSource): void {
    void this.syncOne(ctx, source).catch((err: Error) => this.log(`initial sync failed for source ${source.id}: ${err.message}`));
  }

  /**
   * One worker pass: refresh what is near expiry, then sync every connected source, isolating
   * failures. Deterministic (`now` injected) so the harness needs no real clock.
   */
  async pass(now = Math.floor(Date.now() / 1000)): Promise<PassReport> {
    const report: PassReport = { refreshAttempted: 0, refreshed: 0, synced: 0, failed: 0 };
    for (const source of await this.provider.list()) {
      if (isDisconnected(source)) continue; // disconnected on purpose (yourphr#594): nothing to refresh, nothing to fetch with
      const ctx = ApiContext.system('worker', source.userId, this.engine);
      // Expired and unrefreshable: the worker can do nothing but hammer the provider with a dead
      // token (yourphr#706). Say so once, record one failure job so the Sources page shows why the
      // sync stopped, then stay quiet until a reconnect changes the tokens. A user-triggered Sync
      // still goes through syncNow and reports its own honest error.
      if (source.expiresAt < now && source.refreshToken === '') {
        if (!this.unrefreshable.has(source.id)) {
          this.unrefreshable.add(source.id);
          this.log(`token-refresh: source ${source.id} (${source.display}): access token expired and no refresh token is available; reconnect the source — its scheduled sync is paused until then`);
          await this.engine.managers.jobs.record(ctx, { sourceId: source.id, outcome: 'failure', received: 0, created: 0, updated: 0, error: 'access token expired and no refresh token is available; reconnect the source', startedAt: now, finishedAt: now });
        }
        continue;
      }
      this.unrefreshable.delete(source.id);
      const job = await this.syncOne(ctx, source, now, report);
      if (job.outcome === 'success') report.synced++;
      else report.failed++;
    }
    this.log(`token-refresh: attempted ${report.refreshAttempted}, refreshed ${report.refreshed}`);
    return report;
  }

  /**
   * The types worth asking this source for now: its stored CapabilityStatement narrows the
   * scope-derived list, and a statement older than a week (or never read) is read again first
   * (yourphr#756). Never widens, never fatal — a server that will not answer `/metadata` simply
   * leaves the list as it was, with a note.
   */
  private async typesToFetch(source: ConnectedSource, accessToken: string, now: number, notes: string[]): Promise<string[]> {
    if (source.platformType === MANUAL_PLATFORM_TYPE) return source.resourceTypes; // nobody fetches an upload
    // What the server GRANTED wins over what was stored at connect (yourphr#757): a re-consent can
    // change it, and the refresh above keeps it current. '' means the server never stated one.
    const wanted = source.grantedScopes === '' ? source.resourceTypes : resourceTypesFromScopes(source.grantedScopes);
    let capability = decodeCapability(source.capability);
    if (!capability || now - capability.readAt > CAPABILITY_MAX_AGE_SECONDS) {
      const read = await this.client.readCapability(source, accessToken, now);
      if (read.capability) {
        capability = read.capability;
        this.capabilityWarned.delete(source.id);
        await this.provider.updateCapability(source.id, encodeCapability(read.capability));
      } else {
        if (!this.capabilityWarned.has(source.id)) {
          this.capabilityWarned.add(source.id);
          notes.push(`could not read the provider's capability statement (${read.reason})${capability ? '; using the one last read' : '; asking for every granted type'}`);
        }
      }
    }
    if (!capability) return wanted;
    const { keep, dropped } = narrowTypes(capability, wanted);
    if (dropped.length) notes.push(`not asking for ${dropped.map((d) => `${d.type} (${d.reason})`).join(', ')}`);
    return keep;
  }

  /** One source, refresh-then-sync, the job recorded either way. */
  private async syncOne(ctx: ApiContext, source: ConnectedSource, now = Math.floor(Date.now() / 1000), report?: PassReport): Promise<JobRecord> {
    const publicId = `source-${source.id}`;
    this.options.events?.publish(source.userId, { event_type: 'source_sync', source_id: publicId });
    try {
      // --- refresh, only near expiry, accounted separately ---
      let accessToken = source.accessToken;
      if (source.expiresAt < now + REFRESH_MARGIN_SECONDS) {
        if (report) report.refreshAttempted++;
        if (source.refreshToken === '') {
          this.log(`token-refresh: source ${source.id} (${source.display}): access token expired and no refresh token is available; reconnect the source`);
        } else {
          try {
            const fresh = await this.client.refresh(source, now);
            if (fresh.tokenUrl !== source.tokenUrl) await this.provider.updateTokenUrl(source.id, fresh.tokenUrl); // discovered once, persisted (yourphr#584)
            await this.provider.updateTokens(source.id, fresh.accessToken, fresh.refreshToken, fresh.expiresAt);
            // A re-consent can widen or narrow the grant, and the refresh restates it (yourphr#757).
            if (fresh.scope !== '' && fresh.scope !== source.grantedScopes) {
              await this.provider.updateGrantedScopes(source.id, fresh.scope);
              this.log(`grant: source ${source.id} (${source.display}): the provider restated it as ${fresh.scope}`);
              source = { ...source, grantedScopes: fresh.scope };
            }
            accessToken = fresh.accessToken;
            if (report) report.refreshed++;
          } catch (err) {
            this.log(`token-refresh: source ${source.id} (${source.display}): ${(err as Error).message}`);
          }
        }
      }
      // --- sync, one source's failure never reaching the next ---
      const writer = this.engine.managers.records.writer(ctx, publicId);
      let received = 0;
      let created = 0;
      let updated = 0;
      let job: JobRecord;
      // Each type is fetched on its own (yourphr#753, Go parity). A real server refuses some types
      // routinely — Epic answers 403 for a type the app was not granted and 400 for a search it
      // will not run without a category — and one refusal used to abandon every type after it,
      // importing nothing. Now a refused type is skipped and NAMED in the job; only a 401 ends the
      // sync, because every later request would carry the same refused token.
      const skipped: string[] = [];
      /** What a type had to be asked differently for — a category fan-out (yourphr#754), say. */
      const notes: string[] = [];
      let fatal = '';
      let succeeded = 0;
      if (source.resourceTypes.length === 0 && source.platformType !== MANUAL_PLATFORM_TYPE) {
        fatal = 'nothing to sync: the catalog entry\'s scopes name no patient/<Type> read scope (e.g. patient/*.read)';
      }

      // What this server serves (yourphr#756): read once at connect, re-read when stale, and used
      // only to NARROW — a type the server does not have, or cannot search by patient, is not asked
      // for at all rather than refused every cycle. An unreadable statement changes nothing.
      const types = fatal ? [] : await this.typesToFetch(source, accessToken, now, notes);

      // The budget for this source's whole sync (yourphr#759): each type may spend up to the
      // per-type cap, and no more than what the sync has left. Exhausting it truncates the rest
      // LOUDLY — a partial import that looks complete is the failure worth avoiding.
      let pagesLeft = this.options.maxPagesPerSync ?? Number.MAX_SAFE_INTEGER;
      const notFetched: string[] = [];
      for (const resourceType of types) {
        if (pagesLeft <= 0) { notFetched.push(resourceType); continue; }
        try {
          const r = await this.client.fetchPages(source, resourceType, accessToken, writer, Math.min(this.options.maxPages, pagesLeft));
          received += r.received;
          created += r.created;
          updated += r.updated;
          pagesLeft -= r.pages ?? 0;
          if (r.truncated) notes.push(`${resourceType}: stopped at the page cap — this provider has more than the budget allows`);
          if (r.detail) notes.push(`${resourceType}: ${r.detail}`);
          succeeded++;
        } catch (err) {
          const message = `${resourceType}: ${(err as Error).message}`;
          if (err instanceof FhirHttpError && err.status === 401) {
            fatal = `${message} — the provider refused the access token; reconnect the source`;
            break;
          }
          skipped.push(message);
        }
      }
      if (notFetched.length) notes.push(`the page budget ran out: ${notFetched.join(', ')} not fetched this cycle`);
      const ok = !fatal && (succeeded > 0 || types.length === 0);
      const detail = [fatal, ...(skipped.length ? [`skipped ${skipped.length} of ${types.length} types: ${skipped.join('; ')}`] : []), ...notes].filter(Boolean).join('; ');
      if (ok) await this.provider.markSynced(source.id, now);
      job = { sourceId: source.id, outcome: ok ? 'success' : 'failure', received, created, updated, error: detail.slice(0, 512), startedAt: now, finishedAt: now };
      // One line per sync, success or not: the job row alone was the only trace, and the container
      // log said nothing when an import came back empty.
      this.log(`sync: source ${source.id} (${source.display}): ${job.outcome}, ${received} received (${created} new, ${updated} updated)${detail ? ` — ${detail.slice(0, 1024)}` : ''}`);
      return await this.engine.managers.jobs.record(ctx, job);
    } finally {
      this.options.events?.publish(source.userId, { event_type: 'source_complete', source_id: publicId });
    }
  }

  // --- operator views --------------------------------------------------------------------------

  /** Go's AdminMetricsResponse over the job history: no scrape endpoint here, counters from what ran. */
  async adminMetrics(ctx: ApiContext): Promise<Record<string, unknown>> {
    ctx.require('admin-read');
    const bySource = new Map((await this.provider.list()).map((s) => [s.id, s]));
    const jobs = await this.engine.managers.jobs.all(ctx);
    const jobsTotal: Record<string, number> = {};
    const resourcesTotal: Record<string, number> = {};
    let durationCount = 0;
    let durationSum = 0;
    for (const j of jobs) {
      const s = bySource.get(j.sourceId);
      const key = `${j.outcome === 'success' ? 'success' : 'failed'}|${s?.platformType || 'unknown'}|${s?.environment || 'unknown'}`;
      jobsTotal[key] = (jobsTotal[key] ?? 0) + 1;
      resourcesTotal[key] = (resourcesTotal[key] ?? 0) + j.received;
      durationCount++;
      durationSum += Math.max(0, j.finishedAt - j.startedAt);
    }
    const iso = (seconds: number): string => new Date(seconds * 1000).toISOString();
    return {
      scrape_enabled: false,
      scrape_path: '/metrics',
      scrape_note: 'This stack exposes no Prometheus scrape endpoint; the counters below come from the sync job history.',
      process: { jobs_total: jobsTotal, resources_total: resourcesTotal, duration_count: durationCount, duration_sum_seconds: durationSum },
      recent_jobs: jobs.slice(0, 10).map((j) => ({
        id: String(j.id),
        job_status: j.outcome === 'success' ? 'STATUS_DONE' : 'STATUS_FAILED',
        created_at: iso(j.startedAt),
        done_time: iso(j.finishedAt),
        source_id: `source-${j.sourceId}`,
        summary: { outcome: j.outcome === 'success' ? 'success' : 'failed', duration_ms: Math.max(0, j.finishedAt - j.startedAt) * 1000, total_resources: j.received, ...(j.error ? { error_message: j.error } : {}) },
      })),
    };
  }

  // --- migration (yourphr#584) -----------------------------------------------------------------

  /**
   * One-way import by the migration tool: an existing (user, base, patient) source is skipped and
   * reported, never overwritten. tokenUrl lands '' — discovered on first need, so the import stays
   * offline. Tokens land verbatim; expiry carries so a still-valid access token keeps working.
   */
  async importLegacy(ctx: ApiContext, sources: (NewSource & { legacyId: string })[]): Promise<SourceImportReport> {
    if (ctx.system === '') throw new ApiError(403, 'legacy import is the migration tool\'s alone');
    const report: SourceImportReport = { imported: [], skippedExisting: [], needsReconnect: [], idMap: {} };
    const existing = new Map((await this.provider.list()).map((s) => [`${s.userId}|${s.fhirBaseUrl}|${s.patient}`, s.id]));
    for (const { legacyId, ...source } of sources) {
      const key = `${source.userId}|${source.fhirBaseUrl}|${source.patient}`;
      const label = `${source.userId}:${source.display}`;
      const held = existing.get(key);
      if (held !== undefined) {
        report.skippedExisting.push(label);
        report.idMap[legacyId] = held;
        continue;
      }
      const added = await this.provider.add({ ...source, tokenUrl: '' });
      existing.set(key, added.id);
      report.idMap[legacyId] = added.id;
      report.imported.push(label);
      if (source.refreshToken === '') report.needsReconnect.push(label);
    }
    return report;
  }

  /** Sources live in the app database, which the backup coordinator copies whole. */
  async backup(): Promise<BackupData> {
    return { manager: this.name, takenAt: new Date().toISOString() };
  }

  async restore(): Promise<void> { /* restored with the app database */ }
}
