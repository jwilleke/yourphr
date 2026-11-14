/**
 * `phr.health-records`: phr's receiver on ngdpbase's import engine (ICE,
 * ngdpbase#1979). The engine hands it one file's records at a time (see
 * ./shims.ts); it passes them to PhrManager.importFile, the one door to
 * health records, with the context the run carries.
 *
 * - The run's context goes to core's decision point as it is, a user's or a
 *   background job's; core turns it into a subject (ngdpbase#2022). phr never
 *   converts it.
 * - Refused, not stored, when the user hasn't turned health records on or
 *   hasn't accepted phr's current terms and privacy policy: an import may come
 *   from a core screen, where phr's own consent paths are never visited.
 * - Originals are kept in the user's own encrypted PHR vault (the `phr`
 *   store), through core's attachment door, by default; the user may
 *   choose not to (yourphr#968, Jim 2026-10-25). `keepsEncrypted` makes core
 *   call `keepOriginal` during the upload, with the request's context, while
 *   the user's vault key is live (ngdpbase#2034); the run reuses it. Never
 *   `cite` or core's shared files: a health-record file stays in the vault.
 */
import type { ActorContext, Decision, IceItem, IceReceiver, OriginalKeep, ReceiveOutcome } from '@jwilleke/ngdpbase-types';
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
  /** The phr documents this user has yet to accept at their current version (ConsentManager.pendingFor). */
  pendingConsent: (username: string) => Promise<unknown[]>;
  /**
   * Keep one original file in the user's encrypted PHR vault, as `ctx`
   * (core's AttachmentManager, store `phr`), under core's one-time `keep`
   * allowance for this file (ngdpbase#2061); returns the stored file's id.
   * Throws when core refuses (no unlocked key, no permission, too large).
   */
  keepInVault: (file: { name: string; bytes: Buffer; mediaType?: string }, ctx: ActorContext, keep?: OriginalKeep) => Promise<string>;
}

/** A refusal from the door, carried out of PhrManager as a value rather than an HTTP answer. */
class Refused extends Error {}

const refused = (message: string): ReceiveOutcome => ({ status: 'refused', message });


/**
 * The file types phr keeps as originals, as core's upload door stores them
 * (it types a file by its bytes): FHIR JSON is application/json, NDJSON
 * application/x-ndjson, and XML is text/xml with an `<?xml` prolog or
 * application/xml without one.
 */
export const KEPT_TYPES = ['application/json', 'application/x-ndjson', 'application/xml', 'text/xml'];


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
    // `types` (ngdpbase#2061): core lets exactly these into the user's own
    // vault for a keep at upload; the site-wide upload list stays as it is.
    originals: { allowed: ['none', 'keep'], default: 'keep', types: KEPT_TYPES },
    keepsEncrypted: true,
    mayUse: async (ctx) => (await whyNot(ctx)) === null,
    async keepOriginal(original: IceItem, ctx: ActorContext, keep?: OriginalKeep): Promise<ReceiveOutcome> {
      const why = await whyNot(ctx);
      if (why) return refused(why);
      const bytes = original.bytes ?? Buffer.from(original.text ?? '', 'utf8');
      const name = original.name.split('/').pop() || original.name;
      // The engine types every file, including each one from inside a zip (ngdpbase#2061).
      const mediaType = original.mediaType;
      try {
        const ref = await deps.keepInVault({ name, bytes, ...(mediaType ? { mediaType } : {}) }, ctx, keep);
        return { status: 'stored', ref };
      } catch (err) {
        // Core's reason (a locked vault, a size limit) never carries the file's content.
        return refused(`the original could not be kept in your PHR vault: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
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
