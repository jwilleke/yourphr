/**
 * Catalog (yourphr#613): what this instance CAN connect to, and the door a member connects
 * through. The admin curates (the catalog is instance configuration); a member sees the
 * connectable list and runs the SMART authorization. Every rule here is one the Go stack paid for:
 *
 *   - client_secret is WRITE-ONLY (yourphr#286): accepted on create/update, preserved when an
 *     update omits it, never serialized out — an entry reports hasClientSecret instead.
 *   - Seeding is PROVISION-THEN-PRESERVE (yourphr#291/#304): a seed fills an empty row and never
 *     clobbers an operator's edit, so "restart the app" can never undo the admin screen.
 *   - Sandbox entries never reach members — connectable() is enabled PRODUCTION entries only.
 *   - Every URL is validated at WRITE time with the same SSRF rules the sync path enforces at dial
 *     time (yourphr#485): what would be refused when it syncs is refused when it is typed, and a
 *     production entry must be https.
 *   - Connecting a provider that requires the legal consent needs the consent first (Go's rule).
 */
import { BaseManager, type BackupData } from '../../framework/BaseManager.js';
import type { Engine } from '../../framework/Engine.js';
import { ApiError, type ApiContext } from '../../framework/ApiContext.js';
import { validateUrl } from '../../http/index.js';
import { type BaseCatalogProvider, type CatalogEntry, type CatalogFields, type ProviderEnvironment } from '../providers/BaseCatalogProvider.js';
import { type BaseSourceClientProvider, SourceClientError } from '../providers/BaseSourceClientProvider.js';
import { catalogEntryShape, connectableShape, connectionPolicy, normalizeConsentPolicy, normalizePreConnectProfile } from '../../catalog/index.js';
import { LOGIN_WAIT_SECONDS, RELAY_POLL_SECONDS, type RelayProvider } from '../providers/RelayProvider.js';
import { resourceTypesFromScopes } from '../../migrate/index.js';
import { encodeCapability, narrowTypes } from '../../sources/capability.js';
import { sourceShape } from './SourcesManager.js';
import type { ConnectedSource } from '../providers/BaseSourcesProvider.js';

declare module '../../framework/Engine.js' {
  interface ManagerRegistry {
    catalog: CatalogManager;
  }
}

export type { CatalogEntry, ProviderEnvironment };

/** A write as the seeds, the migration and the harnesses express it: only what they know. */
export interface CatalogWrite {
  display: string;
  environment: ProviderEnvironment;
  fhirBaseUrl: string;
  scopes: string;
  clientId?: string;
  /** Write-only. Omitted or '' on update preserves the stored secret. */
  clientSecret?: string;
  enabled?: boolean;
  authorizeUrlOverride?: string;
  platformType?: string;
  brandLogoUrl?: string;
  consentPolicy?: string;
  preConnectProfile?: string;
}

export interface CatalogImportReport {
  imported: string[];
  skippedExisting: string[];
  rejected: { display: string; reason: string }[];
}

export interface CatalogOptions {
  /** Tests only — lets loopback fakes into the catalog (the SSRF guard stays on for everything else). */
  allowInternal?: boolean;
  log?: (line: string) => void;
  /** The SMART OAuth relay (yourphr#700). Absent = no relay: callers must supply redirect_uri and code. */
  relay?: RelayProvider;
}

const MANAGE = 'admin role required to manage the provider catalog';

export class CatalogManager extends BaseManager {
  readonly name = 'catalog';
  override readonly dependsOn = ['users', 'sources'] as const;

  constructor(engine: Engine, private readonly provider: BaseCatalogProvider, private readonly client: BaseSourceClientProvider, private readonly options: CatalogOptions = {}) {
    super(engine);
  }

  override async initialize(config: Record<string, unknown> = {}): Promise<void> {
    await super.initialize(config);
    await this.provider.initialize();
  }

  // --- the rules -------------------------------------------------------------------------------

  /** The SSRF rules at write time; https for production. Throws the reason. */
  private checkUrls(fields: Pick<CatalogFields, 'fhirBaseUrl' | 'authorizeUrlOverride' | 'environment'>, allowInternal = this.options.allowInternal ?? false): void {
    for (const [field, value] of [['fhirBaseUrl', fields.fhirBaseUrl], ['authorizeUrlOverride', fields.authorizeUrlOverride]] as const) {
      if (value === '' && field === 'authorizeUrlOverride') continue;
      const checked = validateUrl(value, allowInternal);
      if (!checked.ok) throw new ApiError(400, `${field} rejected: ${checked.reason}`);
      if (fields.environment === 'production' && checked.url.protocol !== 'https:') throw new ApiError(400, `${field} must be https for a production provider`);
    }
  }

  /** A write over what is stored (or nothing): the write-only secret rule and Go's normalisations. */
  private merge(write: CatalogWrite, existing?: CatalogEntry, existingSecret = ''): CatalogFields {
    return {
      display: write.display,
      environment: write.environment,
      fhirBaseUrl: write.fhirBaseUrl,
      scopes: write.scopes,
      clientId: write.clientId ?? existing?.clientId ?? '',
      clientSecret: write.clientSecret && write.clientSecret !== '' ? write.clientSecret : existingSecret,
      enabled: write.enabled ?? existing?.enabled ?? false,
      authorizeUrlOverride: write.authorizeUrlOverride ?? existing?.authorizeUrlOverride ?? '',
      platformType: write.platformType ?? existing?.platformType ?? '',
      brandLogoUrl: write.brandLogoUrl ?? existing?.brandLogoUrl ?? '',
      consentPolicy: write.consentPolicy === undefined ? existing?.consentPolicy ?? '' : normalizeConsentPolicy(write.consentPolicy),
      preConnectProfile: write.preConnectProfile === undefined || write.preConnectProfile.trim() === '' ? existing?.preConnectProfile ?? '' : normalizePreConnectProfile(write.preConnectProfile),
    };
  }

  /** The admin's, or a named system principal's (the migration tool, a harness seed). */
  private manage(ctx: ApiContext): void {
    if (ctx.system === '') ctx.require('admin-system', MANAGE);
  }

  private async entryById(publicId: string): Promise<CatalogEntry | undefined> {
    return /^\d+$/.test(publicId) ? this.provider.byId(Number(publicId)) : undefined;
  }

  private async enabledEntry(publicId: string): Promise<CatalogEntry> {
    const e = await this.entryById(publicId);
    if (!e || !e.enabled) throw new ApiError(404, 'no such enabled catalog entry');
    return e;
  }

  /** Go's providerCatalogRequest -> a write; an update keeps what the body does not say. */
  static writeFromBody(body: Record<string, unknown>, existing?: CatalogEntry): CatalogWrite {
    const str = (k: string, fallback = ''): string => (typeof body[k] === 'string' ? (body[k] as string).trim() : fallback);
    return {
      display: str('display', existing?.display ?? ''),
      environment: str('environment', existing?.environment ?? 'production') === 'sandbox' ? 'sandbox' : 'production',
      fhirBaseUrl: str('api_endpoint_base_url', existing?.fhirBaseUrl ?? ''),
      scopes: str('scopes', existing?.scopes ?? ''),
      clientId: str('client_id', existing?.clientId ?? ''),
      clientSecret: str('client_secret'),
      enabled: typeof body['enabled'] === 'boolean' ? (body['enabled'] as boolean) : existing?.enabled ?? false,
      authorizeUrlOverride: str('authorize_url_override', existing?.authorizeUrlOverride ?? ''),
      platformType: str('platform_type', existing?.platformType ?? '') || 'ehr',
      brandLogoUrl: str('brand_logo_url', existing?.brandLogoUrl ?? ''),
      consentPolicy: str('consent_policy', existing?.consentPolicy ?? ''),
      preConnectProfile: str('pre_connect_profile', existing?.preConnectProfile ?? ''),
    };
  }

  // --- the admin's side ------------------------------------------------------------------------

  /** Every entry as stored (no secret) — the operator's views and the migration tool. */
  async entries(ctx: ApiContext): Promise<CatalogEntry[]> {
    this.manage(ctx);
    return this.provider.list();
  }

  async list(ctx: ApiContext): Promise<Record<string, unknown>[]> {
    return (await this.entries(ctx)).map(catalogEntryShape);
  }

  async get(ctx: ApiContext, publicId: string): Promise<Record<string, unknown> | undefined> {
    this.manage(ctx);
    const e = await this.entryById(publicId);
    return e ? catalogEntryShape(e) : undefined;
  }

  /** An entry as a write — the harnesses' and seeds' door; the body mapping is `create`'s. */
  async createEntry(ctx: ApiContext, write: CatalogWrite, options: { allowInternal?: boolean } = {}): Promise<CatalogEntry> {
    this.manage(ctx);
    const fields = this.merge(write);
    this.checkUrls(fields, options.allowInternal ?? this.options.allowInternal ?? false);
    return this.provider.create(fields);
  }

  async create(ctx: ApiContext, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.manage(ctx);
    const write = CatalogManager.writeFromBody(body);
    if (!write.display || !write.fhirBaseUrl || !write.clientId) throw new ApiError(400, 'display, api_endpoint_base_url, and client_id are required');
    return catalogEntryShape(await this.createEntry(ctx, write));
  }

  async updateEntry(ctx: ApiContext, id: number, write: CatalogWrite): Promise<CatalogEntry | undefined> {
    this.manage(ctx);
    const existing = await this.provider.byId(id);
    if (!existing) return undefined;
    const fields = this.merge(write, existing, await this.provider.clientSecretFor(id));
    this.checkUrls(fields);
    return this.provider.update(id, fields);
  }

  async update(ctx: ApiContext, publicId: string, body: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
    this.manage(ctx);
    const e = await this.entryById(publicId);
    if (!e) return undefined;
    const updated = await this.updateEntry(ctx, e.id, CatalogManager.writeFromBody(body, e));
    return updated ? catalogEntryShape(updated) : undefined;
  }

  /** Removes the entry. Already-connected sources are unaffected — they carry their own credentials. */
  async remove(ctx: ApiContext, publicId: string): Promise<boolean> {
    this.manage(ctx);
    const e = await this.entryById(publicId);
    return e ? this.provider.remove(e.id) : false;
  }

  /** Sandboxes are for the admin to try a provider before a member meets it (the Sandbox page). */
  async sandbox(ctx: ApiContext): Promise<Record<string, unknown>[]> {
    ctx.require('admin-read');
    return (await this.provider.list()).filter((e) => e.enabled && e.environment === 'sandbox').map(connectableShape);
  }

  /** The secret, for the admin's eyes in a harness only; the exchange reads it below the door. */
  async clientSecretFor(ctx: ApiContext, id: number): Promise<string> {
    this.manage(ctx);
    return this.provider.clientSecretFor(id);
  }

  // --- a member's side -------------------------------------------------------------------------

  /** The relay card's payload (yourphr#602): effective settings with provenance, or an honest "none". */
  relayResolved(): Record<string, unknown> {
    if (!this.options.relay) return { callback_url: '', configured: false, ready: false, public_url: '', poll_url: '', secret: '' };
    return this.options.relay.resolved() as unknown as Record<string, unknown>;
  }

  /** What members may connect to, in Go's ConnectableProvider shape: enabled PRODUCTION entries only. */
  async connectable(ctx: ApiContext): Promise<Record<string, unknown>[]> {
    ctx.requireAuthenticated();
    return (await this.provider.list()).filter((e) => e.enabled && e.environment === 'production').map(connectableShape);
  }

  private async smartApp(e: CatalogEntry) {
    return { fhirBaseUrl: e.fhirBaseUrl, clientId: e.clientId, clientSecret: await this.provider.clientSecretFor(e.id), scopes: e.scopes.split(/\s+/).filter(Boolean), authorizeUrlOverride: e.authorizeUrlOverride };
  }

  private asApiError(err: unknown): ApiError {
    if (err instanceof ApiError) return err;
    if (err instanceof SourceClientError) return new ApiError(err.stage === 'unavailable' ? 501 : 502, err.message);
    return new ApiError(502, (err as Error).message);
  }

  /** Go's authorize answer: where to send the member, and what the callback must bring back. */
  async authorize(ctx: ApiContext, publicId: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    ctx.requireAuthenticated();
    // Refuse at the FIRST step for the shared demo account (yourphr#496), not at the last: the
    // connect that follows is guarded too, but sending a visitor through a real provider's consent
    // screen to be turned away afterwards would have them hand credentials over for nothing.
    if (this.engine.has('demo')) this.engine.managers.demo.refuseConnect(ctx);
    const e = await this.enabledEntry(publicId);
    let redirectUri = typeof body['redirect_uri'] === 'string' ? (body['redirect_uri'] as string).trim() : '';
    // Go's rule, restored (yourphr#700): when the request carries no redirect_uri, derive it from
    // this deployment's relay — the frontend never compiles one in (the product's #399).
    if (redirectUri === '' && this.options.relay?.ready()) redirectUri = this.options.relay.callbackUrl();
    if (redirectUri === '') throw new ApiError(501, 'no SMART relay is configured — supply redirect_uri, or set yourphr.relay.public-url / YOURPHR_RELAY_SECRET');
    try {
      const started = await this.client.beginAuthorization(await this.smartApp(e), redirectUri);
      return {
        authorize_url: started.authorizeUrl, state: started.state, code_verifier: started.codeVerifier, redirect_uri: redirectUri,
        // The frontend's retry contract (the product's #406): poll this long per connect attempt,
        // keep retrying timeouts across the login window.
        relay_poll_seconds: RELAY_POLL_SECONDS, login_wait_seconds: LOGIN_WAIT_SECONDS,
      };
    } catch (err) {
      throw this.asApiError(err);
    }
  }

  /** The callback: exchange the code, connect the source for the caller, start the first import. */
  async connect(ctx: ApiContext, publicId: string, body: Record<string, unknown>): Promise<{ source: Record<string, unknown>; data: Record<string, unknown> }> {
    ctx.requireAuthenticated();
    const e = await this.enabledEntry(publicId);
    if (connectionPolicy(e).requiresUserConsent && (await this.engine.managers.users.consentAcceptedAt(ctx)) === '') {
      throw new ApiError(403, 'Accept the Privacy Policy and Terms of Service on Account Profile before connecting a medical source.',
        { error_code: 'legal_consent_required', privacy_policy_url: '/privacy', terms_of_service_url: '/terms' });
    }
    const str = (k: string): string => (typeof body[k] === 'string' ? (body[k] as string).trim() : '');
    const verifier = str('code_verifier');
    let code = str('code');
    if (verifier === '') throw new ApiError(400, 'code_verifier is required');
    if (code === '' && str('state') === '') throw new ApiError(400, 'one of code or state is required');
    // No code in the request: the provider redirected the patient's browser to the RELAY, so the
    // code is waiting there under the state. Poll it home (yourphr#700).
    if (code === '') {
      if (!this.options.relay) throw new ApiError(501, 'no SMART relay is configured — the callback page must send the authorization code');
      code = await this.options.relay.fetchCode(str('state'));
    }
    const redirectUri = str('redirect_uri') !== '' ? str('redirect_uri') : (this.options.relay?.ready() ? this.options.relay.callbackUrl() : '');
    if (redirectUri === '') throw new ApiError(400, 'redirect_uri is required (the one the authorization used)');
    let granted_;
    try {
      granted_ = await this.client.completeAuthorization(await this.smartApp(e), redirectUri, code, verifier);
    } catch (err) {
      throw this.asApiError(err);
    }
    if (granted_.patient === '') throw new ApiError(502, 'token had no patient id — this stack does not yet resolve one from the FHIR API');
    const patientFacing = connectableShape(e)['display'] as string;
    const display = patientFacing === e.display && str('display') !== '' ? str('display') : patientFacing;
    const sources = this.engine.managers.sources;

    // What does this server actually serve? (yourphr#756) Read its CapabilityStatement once, here,
    // where a token has just been issued — then ask only for types it has and can search by
    // patient. Narrows, never widens: a statement cannot add a type the grant did not cover. A
    // statement that cannot be read is not a failed connect; the source keeps the scope-derived
    // list and reads the statement on a later sync.
    // What the server GRANTED decides what to ask for, not what the entry requested (yourphr#757).
    // SMART requires the token response to carry `scope`; a server that omits it leaves the
    // request standing, which is the old behaviour and never worse.
    const requested = resourceTypesFromScopes(e.scopes);
    const granted = granted_.scope === '' ? [] : resourceTypesFromScopes(granted_.scope);
    const wanted = granted.length ? granted : requested;
    const notGranted = requested.filter((t) => wanted.indexOf(t) === -1);
    if (granted_.scope === '') this.options.log?.(`grant: ${display}: the token response stated no scope — asking for every type the catalog entry requested`);
    else if (notGranted.length) this.options.log?.(`grant: ${display}: requested but not granted: ${notGranted.join(', ')}`);
    const { capability, reason } = await this.client.readCapability(
      { fhirBaseUrl: e.fhirBaseUrl } as ConnectedSource, granted_.accessToken, Math.floor(Date.now() / 1000));
    const narrowed = capability ? narrowTypes(capability, wanted) : { keep: wanted, dropped: [] as { type: string; reason: string }[] };
    if (!capability) this.options.log?.(`capability: ${display}: could not read the provider's capability statement (${reason}); using the granted scopes only`);
    else if (narrowed.dropped.length) this.options.log?.(`capability: ${display}: not asking for ${narrowed.dropped.map((d) => `${d.type} (${d.reason})`).join(', ')}`);

    const source = await sources.add(ctx, {
      userId: ctx.username, display, fhirBaseUrl: e.fhirBaseUrl, tokenUrl: granted_.tokenUrl, clientId: e.clientId, patient: granted_.patient,
      resourceTypes: narrowed.keep, accessToken: granted_.accessToken, refreshToken: granted_.refreshToken, expiresAt: granted_.expiresAt,
      platformType: e.platformType || 'ehr', environment: e.environment,
      capability: capability ? encodeCapability(capability) : '',
      grantedScopes: granted_.scope,
    });
    // The initial import runs in the background, as Go's does; the page follows it on the event stream.
    sources.syncInBackground(ctx, source);
    return { source: sourceShape(source, undefined), data: { status: 'import_started' } };
  }

  // --- provisioning ----------------------------------------------------------------------------

  /**
   * Provision-then-preserve seeding (yourphr#291/#304): creates a missing entry, fills credentials
   * into a row that has none, and NEVER overwrites an operator's edits. Idempotent — safe at every
   * startup. A seed that fails the URL rules is logged and skipped, never fatal.
   */
  async seed(seeds: CatalogWrite[]): Promise<void> {
    for (const s of seeds) {
      const existing = await this.provider.byDisplay(s.display);
      if (!existing) {
        const fields = this.merge(s);
        try {
          this.checkUrls(fields);
        } catch (err) {
          this.options.log?.(`catalog seed "${s.display}" skipped: ${(err as Error).message}`);
          continue;
        }
        await this.provider.create(fields);
        continue;
      }
      if (existing.clientId === '' && (s.clientId ?? '') !== '') {
        const secret = await this.provider.clientSecretFor(existing.id);
        await this.provider.update(existing.id, { ...this.merge({ ...existing, clientSecret: undefined }, existing, secret), clientId: s.clientId ?? '', clientSecret: s.clientSecret ?? secret, enabled: s.enabled ? true : existing.enabled });
      }
    }
  }

  /** One-way by display name, for the migration principal only; an operator's existing entry is never touched. */
  async importLegacy(ctx: ApiContext, entries: CatalogWrite[], options: { allowInternal?: boolean } = {}): Promise<CatalogImportReport> {
    if (ctx.system === '') throw new ApiError(403, 'legacy import is the migration tool\'s alone');
    const report: CatalogImportReport = { imported: [], skippedExisting: [], rejected: [] };
    const existing = new Set((await this.provider.list()).map((e) => e.display));
    for (const e of entries) {
      if (existing.has(e.display)) {
        report.skippedExisting.push(e.display);
        continue;
      }
      if (e.environment !== 'sandbox' && e.environment !== 'production') {
        report.rejected.push({ display: e.display, reason: `environment "${String(e.environment)}" is neither sandbox nor production` });
        continue;
      }
      try {
        await this.createEntry(ctx, e, options);
        existing.add(e.display);
        report.imported.push(e.display);
      } catch (err) {
        report.rejected.push({ display: e.display, reason: (err as Error).message });
      }
    }
    return report;
  }

  /** The catalog lives in the app database, which the backup coordinator copies whole. */
  async backup(): Promise<BackupData> {
    return { manager: this.name, takenAt: new Date().toISOString() };
  }

  async restore(): Promise<void> { /* restored with the app database */ }
}
