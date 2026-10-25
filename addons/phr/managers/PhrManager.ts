/**
 * PhrManager — the one door to health records (operator decision 2026-10-15:
 * "access to records goes through one door, and core decides").
 *
 * Routes, page plugins, jobs, importers and exports call PhrManager; nothing
 * else in phr touches phr.db (PhrRecordStore is the only code with SQL).
 * PhrManager decides nothing itself: every call goes through `access()`,
 * which
 *   1. asks core's decision point (the PDP) about the action,
 *   2. checks the owner — the user the records are about — against the
 *      caller (interim rule, replaced by core's owner rule in ngdpbase#1823),
 *   3. refuses or allows, and records an audit event either way, carrying
 *      the owner (the user's access view is built from these), and only then
 *   4. hands the work a store handle bound to that owner.
 *
 * The owner is never taken from the request body or URL as authority: a call
 * names whose records it wants, and the door checks that name; the store
 * handle then only ever touches that owner's rows. Under a proxy grant core
 * makes the subject the user represented, so "owner = subject" lets Jim
 * act for Mom within her grant, and the audit names Jim as the actor.
 */
import type { ActorContext, AddonHost, AuditEvent, Decision, PermissionSubject } from '@jwilleke/ngdpbase-types';
import { PhrRecordStore, StoreError, type OwnerHandle, type StoredRecord } from './PhrRecordStore.js';
import type { PhrFileData } from '../importers/shims.js';
import { localiseRecords } from './localIds.js';
import type { SearchFilter } from './fhirIndex.js';
import { NOTE_MAX_CHARS, NOTE_SOURCE, buildNote, isPatientNote, noteAbout, type NoteTarget } from './notes.js';
import { NOT_RECORD_KINDS, kindName, recordDate, recordName, recordValue, shownAsRecord } from '../display.js';

/** What importing one file did, in counts. Never record content. */
export interface FileImportReport {
  created: number;
  updated: number;
  unchanged: number;
  /** Records without an id, or Bundle entries without a resource. */
  skipped: number;
  /** Records the store refused as conflicting with what it holds. */
  conflicts: number;
}

/**
 * The caller (only what the door uses): core's ApiContext for a request, or
 * the context an import run carries, a user's or a background job's.
 */
export interface PhrCaller {
  readonly subject: ActorContext | null;
  readonly ipAddress: string | undefined;
  /** Core's refusal: 401 or 403 (and a step-up prompt, if one is ever configured). Always throws. */
  enforceDeny(permission: string, decision: Decision): Promise<never>;
}

/** The actions phr declares as permissions (config/default-config.json), each with its audit event. */
export type PhrAction = 'phr-read' | 'phr-write' | 'phr-delete';

export type Decide = (subject: ActorContext | null, request: { action: string }) => Promise<Decision>;
export type RecordAudit = (event: AuditEvent) => Promise<unknown>;

export interface PhrManagerDeps {
  store: PhrRecordStore;
  /** Core's PolicyDecisionPoint.decide. */
  decide: Decide;
  /** core's recordAuditEvent, bound to the audit sink. */
  recordAudit: RecordAudit;
  host: Pick<AddonHost, 'addonAuditEventName' | 'actorOf'>;
  /**
   * Has the user this caller acts as turned health records on, and accepted
   * phr's current terms and privacy policy? Null when they have; otherwise the
   * reason. The door refuses every read and write until they have.
   */
  optedIn: (caller: PhrCaller) => Promise<string | null>;
  /**
   * The identity @id (a `urn:uuid`) of the user this context acts as: core's
   * IdentityManager.getByUserIdentifier(ctx, actorOf(ctx).user). Under a
   * proxy grant that is the represented user. phr keys every record by it,
   * never by username (ngdpbase identity model). Null when there is none.
   */
  identityOf: (ctx: ActorContext) => Promise<string | null>;
  /**
   * The username of the user an owner @id names (the identity record's
   * `identifier`), for the audit's `metadata.owner`: core's per-user audit
   * view matches that field against the username until identity model step 6
   * (ngdpbase#2041) moves audit to @id. Null when the @id names no account.
   */
  usernameOf: (ownerId: string) => Promise<string | null>;
}

/** What a call is about: whose records (an identity @id), and which (a kind, and for one record its id). */
interface Target { owner: string; resourceType: string; id?: string }
/** A call's target before the door resolves it: no owner means the caller's own record. */
type Asked = Omit<Target, 'owner'> & { owner?: string };

const refusedOwner: Decision = { permit: false, applicable: true, reason: 'not-the-owner' };

export class PhrManager {
  constructor(private readonly deps: PhrManagerDeps) {}

  /** The user this caller acts as: themselves, or the user a proxy grant represents. */
  private subjectName(caller: PhrCaller): string | null {
    const subject = caller.subject;
    if (!subject) return null;
    const name = subject.username;
    if (typeof name !== 'string' || name === '') return null;
    // A request's subject says whether it signed in. A job's context names the
    // user it runs for and is never anonymous; core's PDP has already decided it.
    return !('isAuthenticated' in subject) || subject.isAuthenticated === true ? name : null;
  }

  /** The identity @id of the user this caller acts as, or null for no signed-in user. */
  private async me(caller: PhrCaller): Promise<string | null> {
    if (this.subjectName(caller) === null || !caller.subject) return null;
    return this.deps.identityOf(caller.subject);
  }

  /**
   * The door. Every public method goes through here, and nothing reaches the
   * store any other way.
   */
  private async access<T>(caller: PhrCaller, action: PhrAction, asked: Asked, work: (h: OwnerHandle) => T): Promise<T> {
    const me = await this.me(caller);
    const target: Target = { ...asked, owner: asked.owner ?? me ?? '' };
    const decision = await this.deps.decide(caller.subject, { action });
    if (!decision.permit) {
      await this.audit(caller, action, target, 'deny', decision.reason);
      return caller.enforceDeny(action, decision);
    }
    // Interim owner rule (until core decides it, ngdpbase#1823): only the owner,
    // or someone core has made the owner's subject (a proxy), may touch the
    // records. Owners are identity @ids, compared as such.
    if (target.owner === '' || me === null || target.owner !== me) {
      await this.audit(caller, action, target, 'deny', refusedOwner.reason);
      return caller.enforceDeny(action, refusedOwner);
    }
    // Nothing of a user's health record is reachable until they have opted in.
    const notYet = await this.deps.optedIn(caller);
    if (notYet !== null) {
      const refusal: Decision = { permit: false, applicable: true, reason: 'not-opted-in' };
      await this.audit(caller, action, target, 'deny', refusal.reason);
      return caller.enforceDeny(action, refusal);
    }
    await this.audit(caller, action, target, 'allow');
    return work(this.deps.store.forOwner(target.owner));
  }

  private async audit(caller: PhrCaller, action: PhrAction, target: Target, result: 'allow' | 'deny', reason?: string): Promise<void> {
    const who = caller.subject
      ? this.deps.host.actorOf(caller.subject)
      : { user: 'unknown', ipAddress: caller.ipAddress, metadata: { actorMissing: true } };
    const { metadata, ...fields } = who as { user: string; actor?: string; ipAddress?: string; metadata?: Record<string, unknown> };
    const owner = target.owner ? await this.deps.usernameOf(target.owner) : null;
    const event: AuditEvent = {
      eventType: this.deps.host.addonAuditEventName(action),
      action,
      result,
      severity: result === 'deny' ? 'medium' : 'low',
      resourceType: `phr-record:${target.resourceType}`,
      resource: target.id ? `${target.resourceType}/${target.id}` : target.resourceType,
      ...(reason ? { reason } : {}),
      ...fields,
      // Never record content: the owner, the kind and the id only. The owner is
      // the username of the stored owner (@id), never taken from the request:
      // core's "entries about me" view matches it (ngdpbase#2041 moves it to @id).
      ipAddress: fields.ipAddress,
      metadata: { ...(metadata ?? {}), ...(owner ? { owner } : {}) }
    };
    await this.deps.recordAudit(event);
  }

  /** One record. Undefined when it doesn't exist (or was removed). */
  async read(caller: PhrCaller, resourceType: string, id: string, owner?: string): Promise<StoredRecord | undefined> {
    const target = { owner, resourceType, id };
    return this.access(caller, 'phr-read', target, (h) => h.read(resourceType, id));
  }

  /** One kind of a user's records, newest first. A refusal is a refusal, never an empty list. */
  async list(caller: PhrCaller, resourceType: string, owner?: string): Promise<StoredRecord[]> {
    const target = { owner, resourceType };
    return this.access(caller, 'phr-read', target, (h) => h.list(resourceType));
  }

  async history(caller: PhrCaller, resourceType: string, id: string, owner?: string): Promise<StoredRecord[]> {
    const target = { owner, resourceType, id };
    return this.access(caller, 'phr-read', target, (h) => h.history(resourceType, id));
  }

  /** One kind of a user's records matching every filter (FHIR search parameters), newest first. */
  async search(caller: PhrCaller, resourceType: string, filters: readonly SearchFilter[], page?: { count?: number; offset?: number }, owner?: string): Promise<{ total: number; records: StoredRecord[] }> {
    const target = { owner, resourceType };
    return this.access(caller, 'phr-read', target, (h) => h.search(resourceType, filters, page));
  }

  /** A user's records whose words match, any kind. */
  async findText(caller: PhrCaller, query: string, limit?: number, owner?: string): Promise<StoredRecord[]> {
    const target = { owner, resourceType: 'text-search' };
    return this.access(caller, 'phr-read', target, (h) => h.findText(query, limit));
  }

  /** What a user holds, at a glance: counts by kind and the newest records. One door call. */
  async overview(caller: PhrCaller, recentLimit = 10, owner?: string): Promise<{ counts: { resourceType: string; count: number }[]; recent: StoredRecord[] }> {
    const target = { owner, resourceType: 'overview' };
    return this.access(caller, 'phr-read', target, (h) => ({ counts: h.countsByType(), recent: h.recent(recentLimit, NOT_RECORD_KINDS) }));
  }

  /**
   * A user's note about one of their records, stored as its own record
   * (a patient-entered Communication). Refused if the record isn't theirs or
   * doesn't exist; the note's text is never audited.
   */
  async addNote(caller: PhrCaller, about: NoteTarget, text: string, owner?: string): Promise<StoredRecord> {
    const words = text.trim();
    if (words === '') throw new StoreError(400, 'a note needs some words');
    if (words.length > NOTE_MAX_CHARS) throw new StoreError(400, `a note is at most ${NOTE_MAX_CHARS} characters`);
    const target = { owner, resourceType: 'Communication' };
    const viaProxy = (caller.subject as { viaProxy?: { actor?: string } } | null)?.viaProxy?.actor;
    return this.access(caller, 'phr-write', target, (h) => {
      if (!h.read(about.resourceType, about.id)) throw new StoreError(404, 'that record was not found');
      // The note names users by their sign-in names, a label for users to read; the record is keyed by @id.
      const named = caller.subject?.username ?? '';
      const author = viaProxy ? { username: viaProxy, actingFor: named } : { username: named };
      return h.put(buildNote(about, words, author), NOTE_SOURCE);
    });
  }

  /** A user's notes, grouped by the record each is about ("Type/id"), newest first. */
  async notes(caller: PhrCaller, owner?: string): Promise<Map<string, StoredRecord[]>> {
    const target = { owner, resourceType: 'Communication' };
    return this.access(caller, 'phr-read', target, (h) => {
      const byRecord = new Map<string, StoredRecord[]>();
      for (const n of h.list('Communication', 1000)) {
        if (!isPatientNote(n.resource)) continue;
        const about = noteAbout(n.resource);
        if (!about) continue;
        byRecord.set(about, [...(byRecord.get(about) ?? []), n]);
      }
      return byRecord;
    });
  }

  /**
   * The choices for the "Which record?" dropdown of phr's note form, for this
   * viewer only (core's forms add-on calls this with the viewer, and again on
   * submit, refusing any value it didn't offer). Value "Type/id", label in
   * plain words. A viewer who may not read records gets no choices.
   */
  async toFormOptions(_args: Record<string, string>, viewer: unknown): Promise<{ value: string; label: string }[]> {
    const who = viewer as (PermissionSubject & { ipAddress?: string }) | null | undefined;
    if (!who || who.isAuthenticated !== true) return [];
    const caller: PhrCaller = { subject: who, ipAddress: who.ipAddress, enforceDeny: async () => { throw new StoreError(403, 'not allowed'); } };
    try {
      const { recent } = await this.overview(caller, 200);
      return recent
        .filter((r) => shownAsRecord(r.resourceType))
        .map((r) => {
          const name = recordName(r.resource) ?? 'Name not stated';
          const value = recordValue(r.resource);
          const date = recordDate(r.resource) ?? 'date not stated';
          return { value: `${r.resourceType}/${r.id}`, label: `${name}${value ? ` — ${value}` : ''} (${kindName(r.resourceType, 1)}, ${date})` };
        });
    } catch {
      return [];
    }
  }

  /** Add or update a record for the owner, from a named source. */
  async write(caller: PhrCaller, resource: Record<string, unknown>, sourceId: string, owner?: string): Promise<StoredRecord> {
    const resourceType = typeof resource.resourceType === 'string' ? resource.resourceType : '';
    const id = typeof resource.id === 'string' ? resource.id : undefined;
    const target = { owner, resourceType, id };
    return this.access(caller, 'phr-write', target, (h) => h.put(resource, sourceId));
  }

  /**
   * Import one file's records (ngdpbase's import engine hands them here, one
   * file at a time): one door call, one audit event and one transaction for
   * the file, never one per record. Idempotent: the same record content makes
   * no new version. Each record gets phr's own id and a Provenance keeping the
   * original (yourphr#784).
   */
  async importFile(caller: PhrCaller, file: PhrFileData, sourceId = 'folder', owner?: string): Promise<FileImportReport> {
    const target = { owner, resourceType: 'records-import' };
    return this.access(caller, 'phr-write', target, (h) => h.inTransaction(() => this.writeFile(h, file, sourceId)));
  }

  /**
   * Write one file's records for the handle's owner: phr's own id for each
   * and a Provenance keeping the original (yourphr#784). Records without an
   * id are skipped; a conflicting one is counted, never overwritten.
   */
  private writeFile(h: OwnerHandle, file: PhrFileData, sourceId: string): FileImportReport {
    const report: FileImportReport = { created: 0, updated: 0, unchanged: 0, skipped: file.skippedEntries, conflicts: 0 };
    const withIds = file.resources.map((r) => typeof r.id === 'string' && r.id !== '');
    const kept = file.resources.filter((_r, i) => withIds[i]);
    const keptUrls = file.fullUrls?.filter((_u, i) => withIds[i]);
    report.skipped += file.resources.length - kept.length;
    const local = localiseRecords(kept, keptUrls, `urn:yourphr:source:${sourceId}`);
    for (const [i, resource] of local.resources.entries()) {
      try {
        const r = h.put(resource, sourceId);
        report[r.outcome]++;
        if (r.outcome !== 'unchanged') h.put(local.provenanceFor(i, r.lastUpdated), sourceId);
      } catch (err) {
        if (err instanceof StoreError && err.status === 409) { report.conflicts++; continue; }
        throw err;
      }
    }
    return report;
  }

  async remove(caller: PhrCaller, resourceType: string, id: string, owner?: string): Promise<boolean> {
    const target = { owner, resourceType, id };
    return this.access(caller, 'phr-delete', target, (h) => h.remove(resourceType, id));
  }
}
