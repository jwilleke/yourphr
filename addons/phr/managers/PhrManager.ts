/**
 * PhrManager — the one door to health records (operator decision 2026-10-15:
 * "access to records goes through one door, and core decides").
 *
 * Routes, page plugins, jobs, importers and exports call PhrManager; nothing
 * else in phr touches phr.db (PhrRecordStore is the only code with SQL).
 * PhrManager decides nothing itself: every call goes through `access()`,
 * which
 *   1. asks core's decision point (the PDP) about the action,
 *   2. checks the owner — the person the records are about — against the
 *      caller (interim rule, replaced by core's owner rule in ngdpbase#1823),
 *   3. refuses or allows, and records an audit event either way, carrying
 *      the owner (the person's access view is built from these), and only then
 *   4. hands the work a store handle bound to that owner.
 *
 * The owner is never taken from the request body or URL as authority: a call
 * names whose records it wants, and the door checks that name; the store
 * handle then only ever touches that owner's rows. Under a proxy grant core
 * makes the subject the person represented, so "owner = subject" lets Jim
 * act for Mom within her grant, and the audit names Jim as the actor.
 */
import type { AddonHost, AuditEvent, Decision, PermissionSubject } from '@jwilleke/ngdpbase-types';
import { PhrRecordStore, StoreError, type OwnerHandle, type StoredRecord } from './PhrRecordStore.js';
import type { FolderFile } from '../importers/recordsFolder.js';
import type { SearchFilter } from './fhirIndex.js';
import { NOTE_MAX_CHARS, NOTE_SOURCE, buildNote, isPatientNote, noteAbout, type NoteTarget } from './notes.js';
import { kindName, recordDate, recordName, recordValue } from '../display.js';

/** What an import did, in counts and per file. Never record content. */
export interface ImportReport {
  files: { imported: number; unchanged: number; unsupported: number; unreadable: number; missing: number };
  records: { created: number; updated: number; unchanged: number; skipped: number; conflicts: number };
  perFile: { path: string; status: 'imported' | 'unchanged' | 'unsupported' | 'unreadable'; records: number; reason?: string; note?: string }[];
}

/** The caller, as core's ApiContext gives it (only what the door uses). */
export interface PhrCaller {
  readonly subject: PermissionSubject | null;
  readonly ipAddress: string | undefined;
  /** Core's refusal: 401 or 403 (and a step-up prompt, if one is ever configured). Always throws. */
  enforceDeny(permission: string, decision: Decision): Promise<never>;
}

/** The actions phr declares as permissions (config/default-config.json), each with its audit event. */
export type PhrAction = 'phr-read' | 'phr-write' | 'phr-delete';

export type Decide = (subject: PermissionSubject | null, request: { action: string }) => Promise<Decision>;
export type RecordAudit = (event: AuditEvent) => Promise<unknown>;

export interface PhrManagerDeps {
  store: PhrRecordStore;
  /** Core's PolicyDecisionPoint.decide. */
  decide: Decide;
  /** core's recordAuditEvent, bound to the audit sink. */
  recordAudit: RecordAudit;
  host: Pick<AddonHost, 'addonAuditEventName' | 'actorOf'>;
}

/** What a call is about: whose records, and which (a kind, and for one record its id). */
interface Target { owner: string; resourceType: string; id?: string }

const refusedOwner: Decision = { permit: false, applicable: true, reason: 'not-the-owner' };

export class PhrManager {
  constructor(private readonly deps: PhrManagerDeps) {}

  /** The person this caller acts as: themselves, or the person a proxy grant represents. */
  private subjectName(caller: PhrCaller): string | null {
    const name = caller.subject?.username;
    return typeof name === 'string' && name !== '' && caller.subject?.isAuthenticated === true ? name : null;
  }

  /** The owner a call means: the one it names, or else the caller themselves. */
  private ownerFor(caller: PhrCaller, owner?: string): string {
    return owner ?? this.subjectName(caller) ?? '';
  }

  /**
   * The door. Every public method goes through here, and nothing reaches the
   * store any other way.
   */
  private async access<T>(caller: PhrCaller, action: PhrAction, target: Target, work: (h: OwnerHandle) => T): Promise<T> {
    const decision = await this.deps.decide(caller.subject, { action });
    if (!decision.permit) {
      await this.audit(caller, action, target, 'deny', decision.reason);
      return caller.enforceDeny(action, decision);
    }
    // Interim owner rule (until core decides it, ngdpbase#1823): only the owner,
    // or someone core has made the owner's subject (a proxy), may touch the records.
    const me = this.subjectName(caller);
    if (target.owner === '' || me === null || target.owner !== me) {
      await this.audit(caller, action, target, 'deny', refusedOwner.reason);
      return caller.enforceDeny(action, refusedOwner);
    }
    await this.audit(caller, action, target, 'allow');
    return work(this.deps.store.forOwner(target.owner));
  }

  private async audit(caller: PhrCaller, action: PhrAction, target: Target, result: 'allow' | 'deny', reason?: string): Promise<void> {
    const who = caller.subject
      ? this.deps.host.actorOf(caller.subject)
      : { user: 'unknown', ipAddress: caller.ipAddress, metadata: { actorMissing: true } };
    const { metadata, ...fields } = who as { user: string; actor?: string; ipAddress?: string; metadata?: Record<string, unknown> };
    const event: AuditEvent = {
      eventType: this.deps.host.addonAuditEventName(action),
      action,
      result,
      severity: result === 'deny' ? 'medium' : 'low',
      resourceType: `phr-record:${target.resourceType}`,
      resource: target.id ? `${target.resourceType}/${target.id}` : target.resourceType,
      ...(reason ? { reason } : {}),
      ...fields,
      // Never record content: the owner, the kind and the id only.
      ipAddress: fields.ipAddress,
      metadata: { ...(metadata ?? {}), owner: target.owner }
    };
    await this.deps.recordAudit(event);
  }

  /** One record. Undefined when it doesn't exist (or was removed). */
  async read(caller: PhrCaller, resourceType: string, id: string, owner?: string): Promise<StoredRecord | undefined> {
    const target = { owner: this.ownerFor(caller, owner), resourceType, id };
    return this.access(caller, 'phr-read', target, (h) => h.read(resourceType, id));
  }

  /** One kind of a person's records, newest first. A refusal is a refusal, never an empty list. */
  async list(caller: PhrCaller, resourceType: string, owner?: string): Promise<StoredRecord[]> {
    const target = { owner: this.ownerFor(caller, owner), resourceType };
    return this.access(caller, 'phr-read', target, (h) => h.list(resourceType));
  }

  async history(caller: PhrCaller, resourceType: string, id: string, owner?: string): Promise<StoredRecord[]> {
    const target = { owner: this.ownerFor(caller, owner), resourceType, id };
    return this.access(caller, 'phr-read', target, (h) => h.history(resourceType, id));
  }

  /** One kind of a person's records matching every filter (FHIR search parameters), newest first. */
  async search(caller: PhrCaller, resourceType: string, filters: readonly SearchFilter[], page?: { count?: number; offset?: number }, owner?: string): Promise<{ total: number; records: StoredRecord[] }> {
    const target = { owner: this.ownerFor(caller, owner), resourceType };
    return this.access(caller, 'phr-read', target, (h) => h.search(resourceType, filters, page));
  }

  /** A person's records whose words match, any kind. */
  async findText(caller: PhrCaller, query: string, limit?: number, owner?: string): Promise<StoredRecord[]> {
    const target = { owner: this.ownerFor(caller, owner), resourceType: 'text-search' };
    return this.access(caller, 'phr-read', target, (h) => h.findText(query, limit));
  }

  /** What a person holds, at a glance: counts by kind and the newest records. One door call. */
  async overview(caller: PhrCaller, recentLimit = 10, owner?: string): Promise<{ counts: { resourceType: string; count: number }[]; recent: StoredRecord[] }> {
    const target = { owner: this.ownerFor(caller, owner), resourceType: 'overview' };
    return this.access(caller, 'phr-read', target, (h) => ({ counts: h.countsByType(), recent: h.recent(recentLimit) }));
  }

  /**
   * A person's note about one of their records, stored as its own record
   * (a patient-entered Communication). Refused if the record isn't theirs or
   * doesn't exist; the note's text is never audited.
   */
  async addNote(caller: PhrCaller, about: NoteTarget, text: string, owner?: string): Promise<StoredRecord> {
    const words = text.trim();
    if (words === '') throw new StoreError(400, 'a note needs some words');
    if (words.length > NOTE_MAX_CHARS) throw new StoreError(400, `a note is at most ${NOTE_MAX_CHARS} characters`);
    const target = { owner: this.ownerFor(caller, owner), resourceType: 'Communication' };
    const viaProxy = (caller.subject as { viaProxy?: { actor?: string } } | null)?.viaProxy?.actor;
    return this.access(caller, 'phr-write', target, (h) => {
      if (!h.read(about.resourceType, about.id)) throw new StoreError(404, 'that record was not found');
      const author = viaProxy ? { username: viaProxy, actingFor: h.owner } : { username: h.owner };
      return h.put(buildNote(about, words, author), NOTE_SOURCE);
    });
  }

  /** A person's notes, grouped by the record each is about ("Type/id"), newest first. */
  async notes(caller: PhrCaller, owner?: string): Promise<Map<string, StoredRecord[]>> {
    const target = { owner: this.ownerFor(caller, owner), resourceType: 'Communication' };
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
        .filter((r) => r.resourceType !== 'Communication')
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
    const target = { owner: this.ownerFor(caller, owner), resourceType, id };
    return this.access(caller, 'phr-write', target, (h) => h.put(resource, sourceId));
  }

  /**
   * Import a records folder (yourphr#939): one door call and one audit event
   * for the whole import, not one per record. Idempotent: a file whose
   * fingerprint hasn't changed is skipped, the same record content makes no
   * new version, and a file missing from this import is flagged, never deleted.
   */
  async importFolder(caller: PhrCaller, files: readonly FolderFile[], sourceId = 'folder', owner?: string): Promise<ImportReport> {
    const target = { owner: this.ownerFor(caller, owner), resourceType: 'records-folder-import' };
    return this.access(caller, 'phr-write', target, (h) => h.inTransaction(() => {
      const report: ImportReport = {
        files: { imported: 0, unchanged: 0, unsupported: 0, unreadable: 0, missing: 0 },
        records: { created: 0, updated: 0, unchanged: 0, skipped: 0, conflicts: 0 },
        perFile: []
      };
      const before = new Map(h.sourceFiles(sourceId).map((f) => [f.path, f]));
      for (const file of files) {
        const prior = before.get(file.path);
        if (prior && prior.sha256 === file.sha256 && prior.status !== 'missing') {
          h.noteSourceFile(sourceId, { path: file.path, sha256: file.sha256, status: prior.status, records: prior.records });
          report.files.unchanged++;
          report.perFile.push({ path: file.path, status: 'unchanged', records: prior.records });
          continue;
        }
        if (file.kind !== 'fhir') {
          h.noteSourceFile(sourceId, { path: file.path, sha256: file.sha256, status: file.kind, records: 0 });
          report.files[file.kind]++;
          report.perFile.push({ path: file.path, status: file.kind, records: 0, reason: file.reason });
          continue;
        }
        let written = 0;
        report.records.skipped += file.skippedEntries;
        for (const resource of file.resources) {
          if (typeof resource.id !== 'string' || resource.id === '') { report.records.skipped++; continue; }
          try {
            const r = h.put(resource, sourceId);
            report.records[r.outcome]++;
            written++;
          } catch (err) {
            if (err instanceof StoreError && err.status === 409) { report.records.conflicts++; continue; }
            throw err;
          }
        }
        h.noteSourceFile(sourceId, { path: file.path, sha256: file.sha256, status: 'imported', records: written });
        report.files.imported++;
        report.perFile.push({ path: file.path, status: 'imported', records: written, ...(file.note ? { note: file.note } : {}) });
      }
      report.files.missing = h.markMissing(sourceId, files.map((f) => f.path));
      return report;
    }));
  }

  async remove(caller: PhrCaller, resourceType: string, id: string, owner?: string): Promise<boolean> {
    const target = { owner: this.ownerFor(caller, owner), resourceType, id };
    return this.access(caller, 'phr-delete', target, (h) => h.remove(resourceType, id));
  }
}
