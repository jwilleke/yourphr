/**
 * `phr.health-records`: phr's receiver on ngdpbase's import engine (ICE,
 * ngdpbase#1979). The engine hands it one file's records at a time (see
 * ./shims.ts); it passes them to PhrManager.importFile, the one door to
 * health records, with the context the run carries.
 *
 * - The run's context goes to core's decision point as it is, a person's or a
 *   background job's; core turns it into a subject (ngdpbase#2022). phr never
 *   converts it.
 * - Refused, not stored, when the person hasn't turned health records on or
 *   hasn't accepted phr's current terms and privacy policy: an import may come
 *   from a core screen, where phr's own consent paths are never visited.
 * - Originals: `none` only. phr has no `keepOriginal` yet, and without one
 *   the engine's `keep` would put a health-record file in core's shared
 *   attachments. Originals go to the person's PHR vault once a background job
 *   can write there (yourphr#968, ngdpbase#1811).
 */
import type { ActorContext, Decision, IceItem, IceReceiver, ReceiveOutcome } from '@jwilleke/ngdpbase-types';
import type { PhrCaller, PhrManager } from '../managers/PhrManager.js';
import type { HealthRecordsOn } from '../preferences.js';
import { PHR_FILE_KIND, type PhrFileData } from './shims.js';

/** The import's records keep one source, so the same records from a later import land on the same phr ids. */
export const IMPORT_SOURCE_ID = 'folder';

export interface ReceiverDeps {
  /** The door, once phr has started. */
  records: () => PhrManager | null;
  healthRecordsOn: HealthRecordsOn;
  /** Core's decision point, handed the run's context as it is. */
  decide: (ctx: ActorContext, request: { action: string }) => Promise<Decision>;
  /** The phr documents this person has yet to accept at their current version (ConsentManager.pendingFor). */
  pendingConsent: (username: string) => Promise<unknown[]>;
}

/** A refusal from the door, carried out of PhrManager as a value rather than an HTTP answer. */
class Refused extends Error {}

const refused = (message: string): ReceiveOutcome => ({ status: 'refused', message });

export function healthRecordsReceiver(deps: ReceiverDeps): IceReceiver {
  /** Why this context may not import into health records, or null when it may. */
  const whyNot = async (ctx: ActorContext): Promise<string | null> => {
    if (!deps.records()) return 'health records are not available';
    if (!(await deps.healthRecordsOn(ctx))) return 'turn on health records in your profile first';
    if ((await deps.pendingConsent(ctx.username)).length > 0) return "accept yourPHR's terms and privacy policy first";
    if (!(await deps.decide(ctx, { action: 'phr-write' })).permit) return 'you may not add health records';
    return null;
  };

  return {
    name: 'health-records',
    label: 'Health records',
    accepts: [PHR_FILE_KIND],
    originals: { allowed: ['none'], default: 'none' },
    mayUse: async (ctx) => (await whyNot(ctx)) === null,
    async receive(item: IceItem, ctx: ActorContext): Promise<ReceiveOutcome> {
      const why = await whyNot(ctx);
      if (why) return refused(why);
      const phr = deps.records();
      if (!phr) return refused('health records are not available');
      const caller: PhrCaller = {
        subject: ctx,
        ipAddress: (ctx as { ipAddress?: string }).ipAddress,
        enforceDeny: async (_permission, decision) => { throw new Refused(decision.reason ?? 'refused'); }
      };
      try {
        const r = await phr.importFile(caller, item.data as PhrFileData, IMPORT_SOURCE_ID);
        const changed = r.created + r.updated;
        const message = `${r.created} new, ${r.updated} updated, ${r.unchanged} unchanged`
          + (r.skipped ? `, ${r.skipped} skipped` : '') + (r.conflicts ? `, ${r.conflicts} in conflict` : '');
        return changed > 0 ? { status: 'stored', message } : { status: 'duplicate', message };
      } catch (err) {
        if (err instanceof Refused) return refused(err.message === 'not-the-owner' ? 'only you can add to your health records' : err.message);
        throw err;
      }
    }
  };
}
