/**
 * Records — the one door (yourphr#608, #609). Every read, write, count, export and removal of a
 * FHIR record for any account goes through here, and the 70+ FHIR resource types are ONE
 * resource: Condition, Observation and Claim are rows in the record store, not doors of their own
 * (the architecture doc's "trap, now concrete").
 *
 * The manager takes the request context on every call and acts for `ctx.username`; the provider
 * behind it (PHI storage, one-active) does the work and returns. The reconciled and classified
 * views (conditions, allergies, immunizations, medications, the IPS, provenance, recent activity,
 * the typed query) are methods here because they are what the record pages read, and a view
 * computed by a free function over a store handle is a second door in all but name.
 */
import type { Bundle, Resource } from '@medplum/fhirtypes';
import { randomUUID } from 'node:crypto';
import { NEEDS_REVIEW, RECORD_ORIGIN } from '../../patient-entry/index.js';
import { IDENTITY_ASSERTION, demographicsOf, evidenceFor, identifierConflicts, labelFor, type IdentityAnswer, type SourceIdentity } from './identity.js';
import type { SearchRequest, WithId } from '@medplum/core';
import { BaseManager, type BackupData } from '../../framework/BaseManager.js';
import type { Engine } from '../../framework/Engine.js';
import { ApiError, type ApiContext } from '../../framework/ApiContext.js';
import type { BaseFavoritesProvider, Favorite } from '../providers/BaseFavoritesProvider.js';
import type { BaseRecordsProvider, RecordsWriter, StoredRecord } from '../providers/BaseRecordsProvider.js';
import { reconcileConditions, type ClassifiedCondition, type InputResource } from '../../conditions/index.js';
import { classifyAllergies, type ClassifiedAllergy } from '../../allergies/index.js';
import { classifyImmunizations, type ClassifiedImmunization } from '../../immunizations/index.js';
import { reconcile as reconcileMedications, type MedInput, type ReconciledMedication } from '../../medication/index.js';
import { buildIps, type IpsDocument } from '../../ips/index.js';
import type { RecordProvenance } from '../../provenance/index.js';
import { dateFor, toResourceFhir } from '../../server.js';

declare module '../../framework/Engine.js' {
  interface ManagerRegistry {
    records: RecordsManager;
  }
}

export interface QueryAggregation { field: string; fn?: string }
export interface QueryRequest {
  use?: string;
  select?: string[];
  from: string;
  where?: Record<string, string | string[]>;
  limit?: number;
  offset?: number;
  aggregations?: { count_by?: QueryAggregation; group_by?: QueryAggregation; order_by?: QueryAggregation };
}
export interface AggregationRow { label: string; value: string | number }

export interface RecentItem {
  source_id: string;
  source_resource_type: string;
  source_resource_id: string;
  title: string;
  date?: string;
}

const PARAM_NAME = /^[a-z][a-z0-9-]*$/i;

export class RecordsManager extends BaseManager {
  readonly name = 'records' as const;
  /** Reads no configuration today; declared empty rather than pretending (the engine validates what is declared). */
  override readonly dependsOn = [] as const;
  /** Maps a source id to its display name; '' when unknown — never invent. Set by the app until Sources is a manager. */
  sourceDisplay: (sourceId: string) => Promise<string> | string = () => '';

  constructor(engine: Engine, private readonly provider: BaseRecordsProvider, private readonly favoritesProvider?: BaseFavoritesProvider) {
    super(engine);
  }

  override async initialize(config: Record<string, unknown> = {}): Promise<void> {
    await this.provider.initialize();
    await this.favoritesProvider?.initialize();
    await super.initialize(config);
  }

  override async shutdown(): Promise<void> {
    await this.provider.close();
    await super.shutdown();
  }

  private who(ctx: ApiContext): string {
    ctx.requireAuthenticated();
    return ctx.username;
  }

  // --- the chart, and what is held out of it (yourphr#696) ---

  /**
   * Is this record kept but NOT yet a chart fact?
   *
   * A record the person wrote that could not be fully understood — an uncoded measurement, half a
   * blood pressure, a date nobody could read — is stored exactly as they said it and tagged
   * `needs-review`. It is theirs and it is visible, but it must not be counted, searched, listed or
   * exported as though a clinician could rely on it. Quarantine, not deletion.
   */
  static needsReview(resource: unknown): boolean {
    const tags = (resource as { meta?: { tag?: { system?: string; code?: string }[] } })?.meta?.tag ?? [];
    return tags.some((t) => t.system === RECORD_ORIGIN && t.code === NEEDS_REVIEW);
  }

  /** The rows that speak for the chart: everything the person holds, minus what awaits review. */
  private chartOnly<T extends { resource: unknown }>(rows: T[]): T[] {
    return rows.filter((r) => !RecordsManager.needsReview(r.resource));
  }

  /**
   * What is waiting for the person to resolve (yourphr#762).
   *
   * Computed from the records themselves rather than a queue table: the tag says a record is
   * waiting and its notes say why, in the words the person was shown when they saved it. One store,
   * so the list can never fall out of step with the records — and a record that travels carries its
   * own explanation.
   */
  async awaitingReview(ctx: ApiContext): Promise<{ source_id: string; source_resource_type: string; source_resource_id: string; title: string; date?: string; reasons: string[] }[]> {
    const out: { source_id: string; source_resource_type: string; source_resource_id: string; title: string; date?: string; reasons: string[] }[] = [];
    for (const row of await this.provider.list(this.who(ctx))) {
      if (!RecordsManager.needsReview(row.resource)) continue;
      const shaped = toResourceFhir(row.resource, row.sourceId);
      const date = String(shaped['sort_date'] ?? '').slice(0, 10);
      out.push({
        source_id: row.sourceId,
        source_resource_type: row.resourceType,
        source_resource_id: row.id,
        title: String(shaped['sort_title'] ?? '') || row.resourceType,
        ...(date ? { date } : {}),
        reasons: ((row.resource as { note?: { text?: string }[] }).note ?? []).map((n) => n.text ?? '').filter(Boolean),
      });
    }
    return out.sort((a, b) => a.source_resource_id.localeCompare(b.source_resource_id));
  }

  /**
   * The person says "yes, that is right as written" — the record becomes a chart fact.
   *
   * Only the tag is removed. The notes stay, because why it was once uncertain is part of the
   * record's story, and the store keeps the previous version, so the moment it entered the chart is
   * visible in its history. Nothing missing is filled in here: confirming an undated record leaves
   * it undated. Supplying the missing piece is an ordinary edit, not this.
   */
  async confirmReview(ctx: ApiContext, id: string): Promise<{ id: string; outcome: 'created' | 'updated' }> {
    const stored = await this.provider.readById(this.who(ctx), id);
    if (!stored) throw new ApiError(404, 'not found');
    if (!RecordsManager.needsReview(stored.resource)) throw new ApiError(409, 'this record is not waiting for review');
    const resource = stored.resource as { meta?: { tag?: { system?: string; code?: string }[] } };
    const kept = (resource.meta?.tag ?? []).filter((t) => !(t.system === RECORD_ORIGIN && t.code === NEEDS_REVIEW));
    const confirmed = { ...resource, meta: { ...(resource.meta ?? {}), ...(kept.length ? { tag: kept } : { tag: undefined }) } };
    // Written back where it already lives. Confirming is not authoring: a record does not change
    // which source it came from because someone agreed with it.
    const outcome = await this.writer(ctx, stored.sourceId).upsert(confirmed as Resource);
    return { id: stored.id, outcome };
  }

  /**
   * The person says "no, drop it" — the record goes, and leaves no trace (yourphr#762, decided
   * 2026-09-23).
   *
   * No tombstone, no audit row naming what was removed. A quarantined record was never a chart
   * fact: it is something the person typed that nobody confirmed, held out of every read path
   * precisely because it does not speak for their health. Keeping a shadow of it would make a
   * mistyped entry permanent in a system whose premise is that the records are theirs.
   *
   * Only what is waiting for review can be discarded this way. A record already in the chart, or
   * one a provider sent, is a different act and is refused here.
   */
  async discardReview(ctx: ApiContext, id: string): Promise<{ id: string }> {
    const stored = await this.provider.readById(this.who(ctx), id);
    if (!stored) throw new ApiError(404, 'not found');
    if (!RecordsManager.needsReview(stored.resource)) throw new ApiError(409, 'this record is not waiting for review');
    await this.provider.removeRecord(this.who(ctx), stored.resourceType, stored.id);
    return { id: stored.id };
  }

  // --- the record pages ---

  /** GET /resource/fhir?sourceResourceType=…[&sourceID=…] — YourPHR's resource_fhir rows. */
  async list(ctx: ApiContext, resourceType: string, options: { limit?: number; sourceId?: string } = {}): Promise<Record<string, unknown>[]> {
    const userId = this.who(ctx);
    const bundle = await this.provider.search(userId, { resourceType: resourceType as never, count: options.limit ?? 100000, total: 'accurate' });
    const sourceOf = await this.provider.sourceOf(userId, resourceType);
    return (bundle.entry ?? [])
      .map((e) => e.resource as Resource)
      .filter((r) => !RecordsManager.needsReview(r))
      .filter((r) => !options.sourceId || sourceOf.get(r.id ?? '') === options.sourceId)
      .map((r) => toResourceFhir(r, sourceOf.get(r.id ?? '') ?? ''));
  }

  /** GET /resource/fhir/:source/:id — addressed by id without its type, as YourPHR does. */
  async detail(ctx: ApiContext, id: string): Promise<Record<string, unknown>> {
    const stored = await this.provider.readById(this.who(ctx), id);
    if (!stored) throw new ApiError(404, 'not found');
    return toResourceFhir(stored.resource, stored.sourceId);
  }

  async search<T extends Resource>(ctx: ApiContext, request: SearchRequest<T>): Promise<Bundle<WithId<T>>> {
    return this.provider.search(this.who(ctx), request);
  }

  /** GET /summary's counts. */
  async countsByType(ctx: ApiContext, sourceId?: string): Promise<{ resource_type: string; count: number }[]> {
    const userId = this.who(ctx);
    const counted = await this.provider.countByType(userId, sourceId);
    // What awaits review is stored but is not a chart fact, so it is not counted as one.
    const inQuarantine = new Map<string, number>();
    for (const row of await this.provider.list(userId, sourceId ? { sourceId } : {})) {
      if (RecordsManager.needsReview(row.resource)) inQuarantine.set(row.resourceType, (inQuarantine.get(row.resourceType) ?? 0) + 1);
    }
    return counted
      .map((c) => ({ resource_type: c.resourceType, count: c.count - (inQuarantine.get(c.resourceType) ?? 0) }))
      .filter((c) => c.count > 0);
  }

  async typesHeld(ctx: ApiContext): Promise<string[]> {
    return this.provider.typesHeld(this.who(ctx));
  }

  /** The dashboard's recent activity: newest records across every type, Go's list-item shape. */
  async recent(ctx: ApiContext, limit: number): Promise<RecentItem[]> {
    const items = this.chartOnly(await this.provider.list(this.who(ctx))).map((r) => {
      const shaped = toResourceFhir(r.resource, r.sourceId);
      const date = String(shaped['sort_date'] ?? '').slice(0, 10);
      return { source_id: r.sourceId, source_resource_type: r.resourceType, source_resource_id: r.id, title: String(shaped['sort_title'] ?? ''), ...(date ? { date } : {}) };
    });
    items.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
    return items.slice(0, limit);
  }

  private async inputs(ctx: ApiContext, resourceType: string): Promise<InputResource[]> {
    return this.chartOnly(await this.provider.list(this.who(ctx), { resourceType }))
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((r) => ({ sourceResourceType: resourceType, sourceResourceId: r.id, sourceId: r.sourceId, raw: r.resource }));
  }

  async conditions(ctx: ApiContext): Promise<ClassifiedCondition[]> { return reconcileConditions(await this.inputs(ctx, 'Condition')); }
  async allergies(ctx: ApiContext): Promise<ClassifiedAllergy[]> { return classifyAllergies(await this.inputs(ctx, 'AllergyIntolerance')); }
  async immunizations(ctx: ApiContext): Promise<ClassifiedImmunization[]> { return classifyImmunizations(await this.inputs(ctx, 'Immunization')); }

  async medications(ctx: ApiContext): Promise<ReconciledMedication[]> {
    const inputs: MedInput[] = [];
    for (const type of ['MedicationRequest', 'MedicationStatement', 'MedicationDispense']) {
      for (const r of this.chartOnly(await this.provider.list(this.who(ctx), { resourceType: type }))) inputs.push({ resource: r.resource, sourceId: r.sourceId });
    }
    return reconcileMedications(inputs);
  }

  async ips(ctx: ApiContext, now = new Date()): Promise<IpsDocument> {
    const userId = this.who(ctx);
    return buildIps({ search: (request) => this.provider.search(userId, request) }, now);
  }

  async provenance(ctx: ApiContext, resourceType: string, id: string): Promise<RecordProvenance | undefined> {
    const userId = this.who(ctx);
    const stored = await this.provider.read(userId, resourceType, id);
    if (!stored) return undefined;
    const history = await this.provider.history(userId, resourceType, id);
    const display = stored.sourceId === '' ? 'This instance (manual entry or upload)' : (await this.sourceDisplay(stored.sourceId)) || stored.sourceId;
    return {
      resourceType, id, sourceId: stored.sourceId, sourceDisplay: display,
      firstReceivedAt: history.firstReceivedAt ?? stored.lastUpdated, lastConfirmedAt: stored.lastUpdated, timesSeen: Math.max(history.versions, 1),
    };
  }

  /**
   * The typed query (POST /query): where (comma = OR, parameters AND; tokens as code, system|code,
   * system|; date prefixes), limit/offset, group_by with count or max/min(sort_date), count_by.
   */
  async query(ctx: ApiContext, query: QueryRequest): Promise<Record<string, unknown>[] | AggregationRow[]> {
    const userId = this.who(ctx);
    if (!/^[A-Z][A-Za-z]+$/.test(query.from ?? '')) throw new ApiError(400, 'from must name a resource type');
    const where = Object.entries(query.where ?? {}).map(([param, raw]) => {
      if (!PARAM_NAME.test(param)) throw new ApiError(400, `invalid search parameter: ${param}`);
      return { param, alternatives: (Array.isArray(raw) ? raw : [raw]).flatMap((s) => String(s).split(',')) };
    });
    const rows = await this.provider.indexedSearch(userId, query.from, where);
    const sortDate = (r: StoredRecord): string => String(dateFor(r.resource) ?? '');

    const agg = query.aggregations;
    let groupBy = agg?.group_by;
    let orderBy = agg?.order_by;
    if (agg?.count_by) {
      groupBy = agg.count_by.field === '*' ? { field: 'source_resource_type' } : agg.count_by;
      orderBy = { field: '*', fn: 'count' };
    }
    if (!groupBy) {
      rows.sort((a, b) => sortDate(b).localeCompare(sortDate(a)));
      const offset = query.offset ?? 0;
      return rows.slice(offset, offset + (query.limit ?? 100)).map((r) => toResourceFhir(r.resource, r.sourceId));
    }
    if (!PARAM_NAME.test(groupBy.field) && groupBy.field !== 'source_resource_type') throw new ApiError(400, `invalid aggregation field: ${groupBy.field}`);
    const byDate = orderBy !== undefined && orderBy.field !== '*';
    if (byDate && orderBy!.field !== 'sort_date') throw new ApiError(400, `unsupported order_by field: ${orderBy!.field} (sort_date only)`);
    const groups = new Map<string, { count: number; max: string; min: string }>();
    for (const r of rows) {
      const labels = groupBy.field === 'source_resource_type' ? [query.from] : await this.provider.indexedValues(userId, query.from, r.id, groupBy.field);
      const date = sortDate(r);
      for (const label of labels) {
        const g = groups.get(label) ?? { count: 0, max: '', min: '' };
        g.count++;
        if (date !== '' && (g.max === '' || date > g.max)) g.max = date;
        if (date !== '' && (g.min === '' || date < g.min)) g.min = date;
        groups.set(label, g);
      }
    }
    const out: AggregationRow[] = [...groups.entries()].map(([label, g]) => ({ label, value: byDate ? ((orderBy!.fn ?? 'max') === 'min' ? g.min : g.max) : g.count }));
    out.sort((a, b) => (typeof a.value === 'number' && typeof b.value === 'number' ? b.value - a.value : String(b.value).localeCompare(String(a.value))));
    return out;
  }

  // --- per source (the Sources page; Sources stays a store until its own child) ---

  async sourceCounts(ctx: ApiContext, sourceId: string): Promise<{ source_id: string; resource_type: string; count: number }[]> {
    return (await this.provider.countByType(this.who(ctx), sourceId)).map((c) => ({ source_id: sourceId, resource_type: c.resourceType, count: c.count }));
  }

  /**
   * The person this account's own records are about (yourphr#696).
   *
   * A record the person writes has to say whose it is — `subject`, and `performer` when they
   * measured it themselves. That is the PGHD pattern: the resource states who asserted it, rather
   * than a flag beside it. But an account holds one `Patient` per connected source, because that is
   * what each provider sent, and identity is LOCAL: Epic's `Patient/123` and a clinic's
   * `Patient/456` are different resources about the same human.
   *
   * So the account's own `manual` source carries one person record, and it learns identifiers from
   * the sources the person has CONFIRMED are about them (yourphr#761). Each identifier keeps __the
   * system that issued it__: an MRN is exclusive to the organisation that issued it (it is the
   * number on that hospital's wristband), so recording "Epic knows this person as E12345" is a
   * fact, while re-stamping it as a YourPHR number would not be.
   *
   * Confirmation is the point. Until #761 this learned from EVERY source, which quietly assumed
   * that every portal someone can read is a portal about them — and portals grant proxy access, so
   * a parent reading a child's record had the child's MRN land on their own person record. A SMART
   * launch proves the login and names the Patient the token was issued for; it does not say the two
   * are the same human. The person says that, once, per source.
   *
   * What this deliberately does NOT do: merge clinical data, rewrite a provider's Patient, or
   * resolve a disagreement between two sources.
   */
  async selfPatient(ctx: ApiContext): Promise<{ reference: string; id: string }> {
    const userId = this.who(ctx);
    const manual = `source-${(await this.engine.managers.sources.manualSource(ctx)).id}`;

    // Every identifier the connected sources have told us about this person, each under its own
    // issuing system. Sorted so the record does not churn on every call.
    const learned = new Map<string, { system: string; value: string }>();
    const confirmed = await this.identityAnswers(ctx);
    for (const held of await this.provider.list(userId, { resourceType: 'Patient' })) {
      if (held.sourceId === manual) continue; // our own record is not evidence about itself
      if (confirmed.get(held.id)?.answer !== 'self') continue; // unanswered, or someone they care for
      for (const identifier of ((held.resource as { identifier?: { system?: string; value?: string }[] }).identifier ?? [])) {
        const system = (identifier.system ?? '').trim();
        const value = (identifier.value ?? '').trim();
        if (system === '' || value === '') continue; // an identifier with no system names nothing
        learned.set(`${system}|${value}`, { system, value });
      }
    }
    const identifier = [...learned.values()].sort((a, b) => `${a.system}|${a.value}`.localeCompare(`${b.system}|${b.value}`));

    const held = (await this.provider.list(userId, { resourceType: 'Patient', sourceId: manual }))
      .sort((a, b) => a.lastUpdated.localeCompare(b.lastUpdated))[0];
    const id = held?.resource?.id ?? randomUUID();
    const existing = (held?.resource as { identifier?: unknown[] } | undefined)?.identifier ?? [];

    // Written on first use, and again only when what we have learned actually changed.
    if (!held || JSON.stringify(existing) !== JSON.stringify(identifier)) {
      await this.writer(ctx, manual).upsert({
        resourceType: 'Patient',
        id,
        ...(identifier.length ? { identifier } : {}),
        meta: { tag: [{ system: RECORD_ORIGIN, code: 'patient-reported', display: 'Patient-reported (YourPHR)' }] },
      } as Resource);
    }
    return { reference: `Patient/${id}`, id };
  }

  /**
   * What the person has said about each source's Patient: theirs, or someone they care for
   * (yourphr#761).
   *
   * Read from Provenance records in their own manual source — one per answer, naming the source
   * Patient it is about. Nothing is assumed from their absence: no answer means the question has
   * not been put yet, which is what the review screen is for.
   */
  private async identityAnswers(ctx: ApiContext): Promise<Map<string, { answer: IdentityAnswer; at: string }>> {
    const manual = `source-${(await this.engine.managers.sources.manualSource(ctx)).id}`;
    const out = new Map<string, { answer: IdentityAnswer; at: string }>();
    for (const held of await this.provider.list(this.who(ctx), { resourceType: 'Provenance', sourceId: manual })) {
      const p = held.resource as { target?: { reference?: string }[]; recorded?: string; activity?: { coding?: { system?: string; code?: string }[] } };
      const code = (p.activity?.coding ?? []).find((c) => c.system === IDENTITY_ASSERTION)?.code;
      const target = (p.target ?? [])[0]?.reference ?? '';
      if ((code !== 'self' && code !== 'not-self') || !target.startsWith('Patient/')) continue;
      const id = target.slice('Patient/'.length);
      const at = p.recorded ?? '';
      // The latest answer stands: someone may correct themselves.
      if (!out.has(id) || at >= (out.get(id)?.at ?? '')) out.set(id, { answer: code, at });
    }
    return out;
  }

  /**
   * Every connected source's identity, what is known about it, and what the person has said
   * (yourphr#761).
   *
   * The account's own manual source is not in this list: a record the person typed is theirs by
   * construction. Nothing here merges anything — it reports.
   */
  async sourceIdentities(ctx: ApiContext): Promise<SourceIdentity[]> {
    const userId = this.who(ctx);
    const manualId = (await this.engine.managers.sources.manualSource(ctx)).id;
    const sources = (await this.engine.managers.sources.list(ctx)).filter((s) => s.id !== manualId);
    const answers = await this.identityAnswers(ctx);

    const held: { source: (typeof sources)[number]; patient: StoredRecord | undefined }[] = [];
    for (const source of sources) {
      const patients = await this.provider.list(userId, { resourceType: 'Patient', sourceId: `source-${source.id}` });
      held.push({ source, patient: patients.sort((a, b) => a.id.localeCompare(b.id))[0] });
    }

    const identities: SourceIdentity[] = held
      .filter((h) => h.patient !== undefined)
      .map(({ source, patient }) => {
        const demographics = demographicsOf(patient!.resource);
        // Real sources routinely have no display name — an upload, and anything carried over from
        // the Go stack — so what to call one is decided once, here (yourphr#761).
        const label = labelFor(source.display, demographics.name);
        const uploaded = source.platformType === 'manual';
        // The token named this very record — the evidence a hospital MPI cannot have. An upload
        // carries no such statement, whatever the file contains.
        const authenticated = !uploaded && source.patient !== '' && source.patient === patient!.id;
        const others = held
          .filter((o) => o.patient !== undefined && o.source.id !== source.id)
          .map((o) => {
            const theirs = demographicsOf(o.patient!.resource);
            return { label: labelFor(o.source.display, theirs.name), demographics: theirs };
          });
        const { evidence, suggested, conflicts } = evidenceFor({ label, authenticated, uploaded, demographics, others });
        return {
          sourceId: `source-${source.id}`,
          display: source.display,
          label,
          patientId: patient!.id,
          demographics,
          answer: answers.get(patient!.id)?.answer ?? '',
          suggested,
          evidence,
          conflicts,
        };
      });

    // A number issued by one organisation turning up under another's system is worth a person's
    // attention, and is reported against the identities the person has confirmed as their own.
    const confirmed = identities.filter((i) => i.answer === 'self');
    const clashes = identifierConflicts(
      confirmed.map((i) => ({
        label: i.label,
        identifiers: (((held.find((h) => h.patient?.id === i.patientId)?.patient?.resource as { identifier?: { system?: string; value?: string }[] })?.identifier) ?? [])
          .map((id) => ({ system: (id.system ?? '').trim(), value: (id.value ?? '').trim() })),
      })),
    );
    for (const identity of confirmed) identity.conflicts = [...identity.conflicts, ...clashes];
    return identities.sort((a, b) => a.label.localeCompare(b.label));
  }

  /**
   * The person answers: this source's records are about me, or about someone I care for
   * (yourphr#761).
   *
   * Recorded as a Provenance — who said it, when, about which Patient — in their own manual source,
   * so the statement is a record of its own and the provider's Patient is never rewritten. The
   * answer changes what the person record learns; it changes no clinical record's attribution.
   */
  async assertIdentity(ctx: ApiContext, sourceId: string, answer: IdentityAnswer): Promise<{ sourceId: string; answer: IdentityAnswer }> {
    if (answer !== 'self' && answer !== 'not-self') throw new ApiError(400, 'the answer is either self or not-self');
    const identity = (await this.sourceIdentities(ctx)).find((i) => i.sourceId === sourceId);
    if (!identity) throw new ApiError(404, 'no such source identity');

    const manual = `source-${(await this.engine.managers.sources.manualSource(ctx)).id}`;
    await this.writer(ctx, manual).upsert({
      resourceType: 'Provenance',
      id: randomUUID(),
      target: [{ reference: `Patient/${identity.patientId}` }],
      recorded: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      activity: {
        coding: [{ system: IDENTITY_ASSERTION, code: answer, display: answer === 'self' ? 'The account holder says this is their own record' : 'The account holder says this record is about someone else' }],
      },
      agent: [{ who: { reference: (await this.selfPatient(ctx)).reference } }],
      meta: { tag: [{ system: RECORD_ORIGIN, code: 'patient-reported', display: 'Patient-reported (YourPHR)' }] },
    } as Resource);

    // What the person record knows follows from the answer, so it is rebuilt here rather than at
    // the next read: an identifier learned from a source they have just disowned must go.
    await this.selfPatient(ctx);
    return { sourceId, answer };
  }

  /**
   * The machines the person says they measure themselves with (yourphr#764).
   *
   * Only the ones they named themselves: a Device a hospital sent describes an implant or a piece of
   * their equipment, not something the person picks from a list when entering a reading.
   */
  async ownDevices(ctx: ApiContext): Promise<{ id: string; name: string }[]> {
    const manual = `source-${(await this.engine.managers.sources.manualSource(ctx)).id}`;
    return this.chartOnly(await this.provider.list(this.who(ctx), { resourceType: 'Device', sourceId: manual }))
      .map((held) => ({
        id: held.id,
        name: ((held.resource as { deviceName?: { name?: string }[] }).deviceName ?? []).map((n) => n.name ?? '').find((n) => n !== '') ?? '',
      }))
      .filter((d) => d.name !== '')
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * The Device record for a machine the person named, made once and reused after that (yourphr#764).
   *
   * It carries the name they typed and nothing else. A cuff called "Omron" is not evidence of a
   * manufacturer, a model or a serial number, so none is recorded — a device record that claims more
   * than the person said would be the same invention this entry path refuses everywhere else.
   *
   * Reuse is by the name as written, ignoring case and surrounding space, within the person's own
   * devices. Two readings they both attributed to "Omron cuff" came from one cuff.
   */
  async deviceFor(ctx: ApiContext, name: string): Promise<{ reference: string; id: string }> {
    const stated = name.trim();
    if (stated === '') throw new ApiError(400, 'a device needs a name');
    const existing = (await this.ownDevices(ctx)).find((d) => d.name.toLowerCase() === stated.toLowerCase());
    if (existing) return { reference: `Device/${existing.id}`, id: existing.id };

    const manual = `source-${(await this.engine.managers.sources.manualSource(ctx)).id}`;
    const id = randomUUID();
    await this.writer(ctx, manual).upsert({
      resourceType: 'Device',
      id,
      // `user-friendly-name` is FHIR's own type for what someone calls a device, as opposed to a
      // manufacturer's model name — which is what this is, and all it is.
      deviceName: [{ name: stated, type: 'user-friendly-name' }],
      patient: { reference: (await this.selfPatient(ctx)).reference },
      meta: { tag: [{ system: RECORD_ORIGIN, code: 'patient-reported', display: 'Patient-reported (YourPHR)' }] },
    } as Resource);
    return { reference: `Device/${id}`, id };
  }

  /** The reference to use for a device the caller names, by id or by name. Empty when they named none. */
  async deviceReference(ctx: ApiContext, byId: string, byName: string): Promise<string> {
    if (byId.trim() !== '') {
      const held = (await this.ownDevices(ctx)).find((d) => d.id === byId.trim());
      // A device id that is not one of theirs is a client mistake, not a fact to record.
      if (!held) throw new ApiError(400, 'that is not one of your devices');
      return `Device/${held.id}`;
    }
    if (byName.trim() === '') return ''; // they named no device, which is an answer
    return (await this.deviceFor(ctx, byName)).reference;
  }

  async patientOf(ctx: ApiContext, sourceId: string): Promise<Record<string, unknown> | null> {
    const patients = (await this.provider.list(this.who(ctx), { resourceType: 'Patient', sourceId })).sort((a, b) => b.lastUpdated.localeCompare(a.lastUpdated));
    return patients[0] ? toResourceFhir(patients[0].resource, sourceId) : null;
  }

  async exportSource(ctx: ApiContext, sourceId: string): Promise<{ resourceType: 'Bundle'; type: 'collection'; total: number; entry: { resource: unknown }[] }> {
    const entry = (await this.provider.list(this.who(ctx), { sourceId })).map((r) => ({ resource: r.resource as unknown }));
    return { resourceType: 'Bundle', type: 'collection', total: entry.length, entry };
  }

  /** Removes every record a source wrote for the caller: rows, index, history. Returns the row count. */
  async removeSource(ctx: ApiContext, sourceId: string): Promise<number> {
    return this.provider.removeBySource(this.who(ctx), sourceId);
  }

  /** Everything the caller holds, then the handle — the account is going. */
  async removeAll(ctx: ApiContext): Promise<number> {
    const userId = this.who(ctx);
    const n = await this.provider.removeAll(userId);
    await this.favoritesProvider?.removeAll(userId);
    await this.provider.release(userId);
    return n;
  }

  // --- find anything by words (yourphr#599) ---

  /**
   * GET /secure/resources/search?q=…: the caller's records whose human-readable text matches every
   * word, best match first, in the dashboard's ResourceListItem shape plus a snippet. Under two
   * characters answers nothing (Go's rule for the same box). Isolation is the owner seam: the
   * provider searches one account's text and nothing else.
   */
  async searchText(ctx: ApiContext, q: string, page: { limit?: number; page?: number } = {}): Promise<(RecentItem & { snippet: string })[]> {
    const userId = this.who(ctx);
    const query = q.trim();
    if (query.length < 2) return [];
    const limit = Math.min(Math.max(page.limit ?? 20, 1), 100);
    const offset = Math.max(page.page ?? 0, 0) * limit;
    const hits = await this.provider.textSearch(userId, query, { limit, offset });
    const items: (RecentItem & { snippet: string })[] = [];
    for (const hit of hits) {
      const stored = await this.provider.read(userId, hit.resourceType, hit.id);
      if (!stored) continue;
      if (RecordsManager.needsReview(stored.resource)) continue; // kept, but not yet a chart fact
      const shaped = toResourceFhir(stored.resource, stored.sourceId);
      const date = String(shaped['sort_date'] ?? '').slice(0, 10);
      items.push({ source_id: stored.sourceId, source_resource_type: stored.resourceType, source_resource_id: stored.id, title: String(shaped['sort_title'] ?? '') || stored.resourceType, ...(date ? { date } : {}), snippet: hit.snippet });
    }
    return items;
  }

  // --- the resource graph (yourphr#605): Go's MedicalHistory graph, scoped to what the page reads ---

  /**
   * POST /secure/resource/graph/MedicalHistory. Go builds a directed graph of every record (vertices)
   * and reference (edges), reverses edges into the graph's "source" types so Encounters are roots,
   * then flattens each requested root: every record reachable from it, in either direction, except
   * Binary, deduplicated, newest first. Here the edges are the search index's reference values —
   * a query, not a crawl — walked both ways from each requested record. Only MedicalHistory exists;
   * the page asks for its Encounters and reads `related_resources` off each.
   */
  async graph(ctx: ApiContext, graphType: string, ids: { source_id?: string; source_resource_type?: string; source_resource_id?: string }[]): Promise<{ results: Record<string, Record<string, unknown>[]> }> {
    const userId = this.who(ctx);
    if (graphType !== 'MedicalHistory') throw new ApiError(400, `unsupported graph type ${JSON.stringify(graphType)} — only MedicalHistory exists here`);
    if (!Array.isArray(ids) || ids.length === 0) throw new ApiError(400, 'resource_ids is required');
    const byDateDesc = (a: Record<string, unknown>, b: Record<string, unknown>): number => String(b['sort_date'] ?? '').localeCompare(String(a['sort_date'] ?? ''));
    const results: Record<string, Record<string, unknown>[]> = {};
    for (const id of ids) {
      const resourceType = String(id.source_resource_type ?? '');
      const resourceId = String(id.source_resource_id ?? '');
      if (!resourceType || !resourceId) continue;
      const root = await this.provider.read(userId, resourceType, resourceId);
      if (!root) continue; // not this account's, or gone — silently absent, as Go's IN query leaves it
      const rootKey = `${resourceType}/${resourceId}`;
      const visited = new Set<string>([rootKey]);
      const queue = [rootKey];
      const related: Record<string, unknown>[] = [];
      while (queue.length > 0) {
        const current = queue.shift()!;
        const [type, rid] = current.split('/') as [string, string];
        const neighbours = new Set<string>(await this.provider.referencesFrom(userId, type, rid));
        for (const r of await this.provider.referencedBy(userId, current)) neighbours.add(`${r.resourceType}/${r.id}`);
        for (const next of neighbours) {
          if (visited.has(next) || next.startsWith('Binary/')) continue;
          visited.add(next);
          const [nType, nId] = next.split('/') as [string, string];
          const stored = await this.provider.read(userId, nType, nId);
          if (!stored) continue; // a dangling reference: the record was never synced
          related.push(toResourceFhir(stored.resource, stored.sourceId));
          queue.push(next);
        }
      }
      related.sort(byDateDesc);
      (results[resourceType] ??= []).push({ ...toResourceFhir(root.resource, root.sourceId), related_resources: related });
    }
    for (const list of Object.values(results)) list.sort(byDateDesc);
    return { results };
  }

  // --- favourites (yourphr#616): an annotation on a record, through the same door ---

  /** Only Practitioner is starred — the one kind the UI stars, so a typo cannot star the world. */
  static supportsFavorites(resourceType: string): boolean {
    return resourceType === 'Practitioner';
  }

  private favorites_(): BaseFavoritesProvider {
    if (!this.favoritesProvider) throw new ApiError(501, 'favourites are not available on this instance');
    return this.favoritesProvider;
  }

  private checkFavorite(fav: Favorite): void {
    if (!fav.source_id || !fav.resource_type || !fav.resource_id) throw new ApiError(400, 'invalid request payload');
    if (!RecordsManager.supportsFavorites(fav.resource_type)) throw new ApiError(400, 'only Practitioner resources are supported');
  }

  async favorites(ctx: ApiContext, resourceType: string): Promise<Favorite[]> {
    const userId = this.who(ctx);
    if (!RecordsManager.supportsFavorites(resourceType)) throw new ApiError(400, 'only Practitioner resources are supported');
    return this.favorites_().list(userId, resourceType);
  }

  async addFavorite(ctx: ApiContext, fav: Favorite, at = new Date()): Promise<Favorite> {
    const userId = this.who(ctx);
    this.checkFavorite(fav);
    await this.favorites_().add(userId, fav, at);
    return fav;
  }

  async removeFavorite(ctx: ApiContext, fav: Favorite): Promise<boolean> {
    const userId = this.who(ctx);
    this.checkFavorite(fav);
    return this.favorites_().remove(userId, fav);
  }

  // --- writes: the worker and the migration tool ---

  /** A writer bound to the caller's account and one source — what a sync pass or an import writes through. */
  writer(ctx: ApiContext, sourceId: string): RecordsWriter {
    return this.provider.writer(this.who(ctx), sourceId);
  }

  /**
   * Save a record the PATIENT wrote (yourphr#683).
   *
   * Distinct from `writer()` above, which the worker and the migration use: those write on behalf
   * of a provider that asserted something. This writes on behalf of the person, through their own
   * `manual` source, so provenance stays truthful and a hand-entered practitioner can never be
   * mistaken for one Epic sent.
   *
   * Upsert by the resource's own id, which is what makes create and update the same operation —
   * the Angular app POSTs a new Practitioner and PUTs an edited one, and both are "this is what I
   * say about this record now".
   */
  async savePatientRecord(ctx: ApiContext, resource: Resource): Promise<{ id: string; outcome: 'created' | 'updated' }> {
    ctx.requireAuthenticated();
    if (!resource || typeof resource !== 'object') throw new ApiError(400, 'a resource is required');
    const type = (resource as { resourceType?: unknown }).resourceType;
    if (typeof type !== 'string' || type === '') throw new ApiError(400, 'the resource needs a resourceType');
    const id = (resource as { id?: unknown }).id;
    if (typeof id !== 'string' || id.trim() === '') throw new ApiError(400, 'the resource needs an id');

    // An edit lands where the record already lives when that is one of the caller's OWN manual
    // sources (yourphr#736). Before manualSource matched exactly, a migrated instance could file a
    // hand-entered record under an older manual source; sending its edit to "Added by you" instead
    // would be refused as a cross-source collision and the patient could never correct it. A record
    // held by a synced provider is not theirs to overwrite, and still goes to their own source —
    // where the store refuses the collision, as it should.
    const sources = this.engine.managers.sources;
    const held = await this.provider.read(this.who(ctx), type, id);
    const target = held && held.sourceId !== '' && (await sources.isManual(ctx, held.sourceId)) ? held.sourceId : `source-${(await sources.manualSource(ctx)).id}`;
    const outcome = await this.writer(ctx, target).upsert(resource);
    return { id, outcome };
  }

  /**
   * The records that REFER to one resource — what the practitioner-history page calls "history"
   * (yourphr#683): the encounters that name this practitioner.
   *
   * Reads the same edge the medical-history graph walks, so the two agree by construction rather
   * than by two implementations of "related".
   */
  async referencing(ctx: ApiContext, resourceType: string, id: string, onlyType?: string): Promise<RecentItem[]> {
    const userId = this.who(ctx);
    const out: RecentItem[] = [];
    for (const ref of await this.provider.referencedBy(userId, `${resourceType}/${id}`)) {
      if (onlyType && ref.resourceType !== onlyType) continue;
      const stored = await this.provider.read(userId, ref.resourceType, ref.id);
      if (!stored) continue;
      const shaped = toResourceFhir(stored.resource, stored.sourceId);
      const date = String(shaped['sort_date'] ?? '').slice(0, 10);
      out.push({ source_id: stored.sourceId, source_resource_type: stored.resourceType, source_resource_id: stored.id, title: String(shaped['sort_title'] ?? '') || stored.resourceType, ...(date ? { date } : {}) });
    }
    return out.sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
  }

  async exists(ctx: ApiContext, resourceType: string, id: string): Promise<boolean> {
    return (await this.provider.read(this.who(ctx), resourceType, id)) !== undefined;
  }

  // --- the base contract ---

  async integrityOk(): Promise<boolean> {
    return this.provider.integrityOk();
  }

  /** The admin's Database card: where the PHI store lives and its size. */
  storage(ctx: ApiContext): { location: string; sizeBytes: number } {
    ctx.require('admin-read');
    return this.provider.storage();
  }

  async backup(options: { destination: string; key: string; maxBackups?: number; now?: Date; alsoExport?: unknown[] }): Promise<BackupData & { file: string; sizeBytes: number; pruned: string[] }> {
    const result = await this.provider.backup(options);
    return { manager: this.name, takenAt: (options.now ?? new Date()).toISOString(), files: [result.file], ...result };
  }

  /** The base contract (yourphr#615): the backup named in `data.files` is staged under this store's key and applied at the next start — a live file is never overwritten. */
  async restore(data: BackupData, options: { key: string }): Promise<void> {
    const file = data.files?.[0];
    if (!file) throw new ApiError(400, 'a records restore needs the backup file to stage');
    await this.provider.stageRestore(file, options.key);
  }
}
