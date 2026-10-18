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
import type { AddonHost, Decision, PermissionSubject } from '@jwilleke/ngdpbase-types';
import { PhrRecordStore, type OwnerHandle, type StoredRecord } from './PhrRecordStore.js';

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
export type RecordAudit = (event: Record<string, unknown>) => Promise<unknown>;

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
    await this.deps.recordAudit({
      eventType: this.deps.host.addonAuditEventName(action),
      action,
      result,
      severity: result === 'deny' ? 'medium' : 'low',
      resourceType: `phr-record:${target.resourceType}`,
      resource: target.id ? `${target.resourceType}/${target.id}` : target.resourceType,
      ...(reason ? { reason } : {}),
      ...fields,
      // Never record content: the owner, the kind and the id only.
      metadata: { ...(metadata ?? {}), owner: target.owner }
    });
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

  /** Add or update a record for the owner, from a named source. */
  async write(caller: PhrCaller, resource: Record<string, unknown>, sourceId: string, owner?: string): Promise<StoredRecord> {
    const resourceType = typeof resource.resourceType === 'string' ? resource.resourceType : '';
    const id = typeof resource.id === 'string' ? resource.id : undefined;
    const target = { owner: this.ownerFor(caller, owner), resourceType, id };
    return this.access(caller, 'phr-write', target, (h) => h.put(resource, sourceId));
  }

  async remove(caller: PhrCaller, resourceType: string, id: string, owner?: string): Promise<boolean> {
    const target = { owner: this.ownerFor(caller, owner), resourceType, id };
    return this.access(caller, 'phr-delete', target, (h) => h.remove(resourceType, id));
  }
}
