/**
 * phr — yourPHR as an ngdpbase add-on (jwilleke/yourphr#920).
 *
 * "Your medical records, immediately and in your hands — for free."
 *
 * This first version proves the shape, nothing more:
 *   - /api/phr/whoami answers who is signed in, through ngdpbase's own sign-in;
 *   - [{PhrWelcome}] draws inside ngdpbase's page layout;
 *   - the "My Health Records" page is seeded;
 *   - each user turns health records on in /profile (off until they do);
 *   - the PHR vault (one per user, encrypted) is declared in config.
 * No records, no PHI, no database yet.
 *
 * ngdpbase hands the add-on its tools as the third argument of register()
 * (ngdpbase#1813, v5.10.0). The add-on never imports ngdpbase's code; its
 * types come from @jwilleke/ngdpbase-types, a development dependency.
 *
 * Configuration keys:
 *   ngdpbase.addons.phr.enabled — true/false (defaults to false)
 *   ngdpbase.system-category.phr — the PHR vault, owned by phr (ngdpbase#1559)
 *
 * The exported `name` MUST equal `ngdpbase.slug` in package.json (#927).
 */
import type { ActorContext, AddonHost, ConsentManager, Decision, IdentityManager, OriginalKeep, PolicyDecisionPoint, WikiEngine } from '@jwilleke/ngdpbase-types';
import { openPhrStore, type PhrRecordStore } from './managers/PhrRecordStore.js';
import { PhrManager } from './managers/PhrManager.js';
import { NOTE_FORM, NOTE_FORM_ID, noteFormHandler } from './forms/noteForm.js';
import { mountApi } from './routes/api.js';
import { ccdaShim, fhirShim } from './importers/shims.js';
import { healthRecordsReceiver } from './importers/receiver.js';
import { createPhrWelcomePlugin } from './plugins/PhrWelcomePlugin.js';
import { createPhrRecordsPlugin } from './plugins/PhrRecordsPlugin.js';
import { profileSectionHtml, saveProfileSection } from './profile.js';
import { healthRecordsOnFor, type AddonsManagerLike as PersonSwitchReader, type UserLike } from './preferences.js';

// PluginManager, AddonsManager and the forms add-on aren't in core's public types yet (asked of ngdpbase); only the calls phr makes.
interface FormsDataManagerLike { registerShippedForm(addon: string, definition: unknown, ctx: unknown): Promise<unknown> }
interface FormsAddonLike { registerHandler(formId: string, handler: (submission: { data: Record<string, unknown> }, context: { req: unknown }) => Promise<unknown>): void }
interface PluginManagerLike { registerPlugin(name: string, plugin: unknown): Promise<void> }
// Core's attachment door (not in core's public types yet): only the call phr makes.
interface AttachmentManagerLike {
  uploadAttachment(bytes: Buffer, info: { originalName: string; mimeType: string; size: number; mediaType?: string }, ctx: ActorContext,
    options: { private: boolean; store: string; description?: string; keep?: OriginalKeep }): Promise<{ identifier: string }>;
}
interface AddonsManagerLike {
  registerDashboardCard?(card: { addonName: string; title: string; icon: string; adminUrl: string }): void;
}

let unavailable: string | null = 'not registered yet';
let engineRef: WikiEngine | null = null;
let hostRef: AddonHost | null = null;
let records: PhrManager | null = null;

/** The one door to health records, for phr's routes, plugins and jobs. Null until phr has started. */
export function phrRecords(): PhrManager | null {
  return records;
}
/** Is phr on for this user? Core's answer (AddonsManager.enabledAddonsFor, ngdpbase#1963). */
const healthRecordsOn = healthRecordsOnFor(() => engineRef?.getManager<PersonSwitchReader>('AddonsManager'));

/**
 * DEVELOPMENT ONLY: the made-up-records loader, on a local test site that asks
 * for it. dev/ is not in the published package, so on a real site the import
 * below fails and nothing is mounted, whatever the configuration says.
 */
async function maybeMountDevSeed(engine: WikiEngine, config: Record<string, unknown>, tools: AddonHost): Promise<void> {
  if (config['dev-seed'] !== true || !engine.app) return;
  const base = String(engine.getManager<{ getProperty(k: string, d?: unknown): unknown }>('ConfigurationManager')?.getProperty('ngdpbase.application.base-url', '') ?? '');
  let host = '';
  try { host = new URL(base).hostname; } catch { return; }
  if (host !== 'localhost' && !host.endsWith('.localhost')) {
    tools.logger.warn('[phr] dev-seed is set but this is not a localhost site; ignored');
    return;
  }
  try {
    const dev = await import('./dev/seedSynthetic.js');
    dev.mountDevSeed(engine.app, engine, tools, phrRecords);
  } catch {
    // Not in the published package: nothing to mount.
  }
}

/**
 * The "Add a note" form, on core's forms add-on (an optional dependency): shipped
 * as phr's own form and handled by PhrManager. Without the forms add-on, notes
 * can still be added through phr's API, and the page says the form isn't there.
 */
async function registerNoteForm(engine: WikiEngine, tools: AddonHost): Promise<void> {
  const forms = engine.getManager<FormsDataManagerLike>('FormsDataManager');
  const formsAddon = engine.getManager<FormsAddonLike>('FormsAddon');
  if (!forms || !formsAddon) {
    tools.logger.warn('[phr] the forms add-on is off, so the "Add a note" form is not offered');
    return;
  }
  // The form's version is phr's package version: a newer phr replaces it (ngdpbase#1973).
  await forms.registerShippedForm('phr', NOTE_FORM, tools.systemContext('phr: register its note form'));
  formsAddon.registerHandler(NOTE_FORM_ID, noteFormHandler(phrRecords, (req) => tools.ApiContext.from(req as never, engine)));
}

/**
 * phr's own terms and privacy policy (pages/phr-*.md), through core's
 * ConsentManager (ngdpbase#1603): a user accepts both before their health
 * records switch turns on, and again when phr raises a document's version.
 * The paths are where phr is used, so a new version is asked there.
 */
export const PHR_CONSENT = {
  documents: ['phr-terms-of-service', 'phr-privacy-policy'],
  paths: ['/api/phr', '/view/My%20Health%20Records', '/view/my-health-records']
};
function registerConsent(engine: WikiEngine, tools: AddonHost): void {
  const consent = engine.getManager<ConsentManager>('ConsentManager');
  if (!consent) throw new Error("ngdpbase's ConsentManager is not available (phr needs ngdpbase 5.26.0 or later)");
  consent.registerAddonDocuments('phr', PHR_CONSENT);
  tools.logger.info('[phr] terms and privacy policy registered with ConsentManager');
}

/**
 * phr on ngdpbase's import engine (ICE, ngdpbase#1979): its FHIR and C-CDA
 * shims, and its receiver, the door to health records. The engine owns files,
 * fingerprints and status; a user starts an import from core's import
 * screen, /import (ngdpbase#2021), linked from My Health Records. Names are
 * declared in package.json's manifest.
 */
function registerImport(engine: WikiEngine, tools: AddonHost, decide: (ctx: ActorContext, request: { action: string }) => Promise<Decision>): void {
  const consent = engine.getManager<ConsentManager>('ConsentManager');
  tools.registerReceiver(healthRecordsReceiver({
    records: phrRecords,
    healthRecordsOn,
    decide,
    pendingConsent: async (username) => consent ? consent.pendingFor(username, 'phr') : [],
    keepInVault: async (file, ctx, keep) => {
      const attachments = engine.getManager<AttachmentManagerLike>('AttachmentManager');
      if (!attachments) throw new Error("ngdpbase's AttachmentManager is not available");
      // The user's own PHR vault (system category `phr`, encrypted per user).
      const stored = await attachments.uploadAttachment(file.bytes,
        { originalName: file.name, mimeType: file.mediaType ?? 'application/octet-stream', size: file.bytes.length, ...(file.mediaType ? { mediaType: file.mediaType } : {}) },
        // `keep`: core's one-time allowance for this original, phr's vault only (ngdpbase#2061).
        ctx, { private: true, store: 'phr', description: 'Original file of a health-records import', keep });
      return stored.identifier;
    }
  }));
  tools.registerShim(fhirShim());
  tools.registerShim(ccdaShim());
}

/** An owner @id's username (identity record `identifier`), cached; null for no account. */
function ownerUsernames(identities: IdentityManager, tools: AddonHost): (ownerId: string) => Promise<string | null> {
  const known = new Map<string, string | null>();
  const ctx = tools.systemContext('phr: name the owner of a health record in its audit entry');
  return async (ownerId) => {
    if (known.has(ownerId)) return known.get(ownerId) ?? null;
    const identifier = (await identities.getById(ctx, ownerId).catch(() => null))?.identifier;
    const username = identifier && !identifier.startsWith('person:') ? identifier : null;
    known.set(ownerId, username);
    return username;
  };
}

/**
 * Rows keyed by username, from before phr keyed by identity @id, move to the
 * user's @id: core's IdentityManager, as the system context. Idempotent. A
 * username with no account, or an @id that already holds records, is left
 * as it is and counted. Logs counts only, never usernames.
 */
async function rekeyOwners(store: PhrRecordStore, identities: IdentityManager, tools: AddonHost): Promise<void> {
  try {
    const old = store.ownersNotKeyedById();
    if (old.length === 0) return;
    const ctx = tools.systemContext('phr: key health records by identity @id instead of username');
    let moved = 0;
    let left = 0;
    for (const username of old) {
      const id = (await identities.getByUserIdentifier(ctx, username))?.['@id'];
      if (!id) { left++; continue; }
      try { store.rekeyOwner(username, id); moved++; } catch { left++; }
    }
    tools.logger.info(`[phr] re-keyed ${moved} user(s) to identity @id${left ? `; ${left} left as they were (no account, or already holding records)` : ''}`);
  } catch (err) {
    tools.logger.error(`[phr] re-keying owners to identity @id failed: ${String(err)}`);
  }
}

const PhrAddon = {
  name: 'phr',
  version: '0.0.6',
  description: 'yourPHR: your health records, in your hands',
  author: 'jwilleke',
  dependencies: [] as string[],
  // Loaded first when present: its "Add a note" form is phr's (forms/noteForm.ts).
  optionalDependencies: ['forms'],

  async register(engine: WikiEngine, _config: Record<string, unknown> = {}, host?: AddonHost): Promise<void> {
    // phr is site-critical (config/default-config.json): anything that stops it
    // starting is thrown, so core puts the site in maintenance and tells admins
    // why, instead of a yourPHR running without its records.
    if (!host) throw new Error('ngdpbase passed no host tools (phr needs ngdpbase 5.20.0 or later)');
    const tools = host;
    engineRef = engine;
    hostRef = tools;
    if (!engine.app) throw new Error('the engine has no web app to mount on');

    const store = openPhrStore(engine.getManager('DatabaseManager'));
    const pdp = engine.getManager<PolicyDecisionPoint>('PolicyDecisionPoint');
    if (!pdp) throw new Error("ngdpbase's PolicyDecisionPoint is not available");
    const auditSink = engine.getManager<Parameters<AddonHost['recordAuditEvent']>[0]>('AuditManager');
    // Core's decide takes any ActorContext, a user's or a background job's,
    // and makes the subject itself (ngdpbase#2022). phr never converts it.
    const decide = (ctx: ActorContext | null, request: { action: string }) => pdp.decide(ctx, request);
    const consentForGate = engine.getManager<ConsentManager>('ConsentManager');
    const identities = engine.getManager<IdentityManager>('IdentityManager');
    if (!identities) throw new Error("ngdpbase's IdentityManager is not available (phr needs ngdpbase 5.30.1 or later)");
    records = new PhrManager({
      store,
      decide,
      // phr keys every record by the user's identity @id, never the username
      // (ngdpbase identity model). actorOf(ctx).user is the account acted on:
      // under a proxy grant, the represented user.
      identityOf: async (ctx) => (await identities.getByUserIdentifier(ctx, tools.actorOf(ctx).user))?.['@id'] ?? null,
      // The audit names the record's owner by username until core moves audit
      // to @id (ngdpbase#2041). Looked up from the stored owner @id as the
      // system context: a refused caller may not read another user's identity
      // record, but the attempt is still recorded against that owner.
      usernameOf: ownerUsernames(identities, tools),
      // A user's records stay out of reach until they have turned health
      // records on and accepted phr's current terms.
      optedIn: async (caller) => {
        const subject = caller.subject;
        if (!subject) return 'not signed in';
        if (!(await healthRecordsOn(subject))) return 'health records are off';
        const pending = consentForGate ? await consentForGate.pendingFor(subject.username, 'phr') : [];
        return pending.length > 0 ? "phr's terms are not accepted" : null;
      },
      recordAudit: (event) => tools.recordAuditEvent(auditSink, event),
      host: tools
    });
    // Records written before phr keyed owners by identity @id are re-keyed once,
    // in the background so the site starts at once (ngdpbase identity model).
    void rekeyOwners(store, identities, tools);

    // Reachable as engine.getManager('PhrManager'): the forms add-on's
    // "fetch:PhrManager.toFormOptions()" fills the note form's record list (ngdpbase guide §6).
    engine.registerManager('PhrManager', records);

    mountApi(engine.app, engine, tools, healthRecordsOn, phrRecords);
    await maybeMountDevSeed(engine, _config, tools);
    await registerNoteForm(engine, tools);
    registerConsent(engine, tools);
    registerImport(engine, tools, decide);
    const plugins = engine.getManager<PluginManagerLike>('PluginManager');
    await plugins?.registerPlugin('PhrWelcome', createPhrWelcomePlugin(healthRecordsOn));
    await plugins?.registerPlugin('PhrRecords', createPhrRecordsPlugin(phrRecords, healthRecordsOn));
    engine.getManager<AddonsManagerLike>('AddonsManager')?.registerDashboardCard?.({
      addonName: 'phr',
      title: 'Health records',
      icon: 'fas fa-notes-medical',
      adminUrl: '/view/My%20Health%20Records'
    });

    unavailable = null;
    tools.logger.info('[phr] Ready');
  },

  /** The "Health records" switch in /profile (ngdpbase#534). */
  profileSection(user: UserLike): { title: string; html: string } | null {
    return unavailable ? null : { title: 'Health records', html: profileSectionHtml(user) };
  },

  async saveProfileSection(ctx: ActorContext, body: Record<string, unknown>): Promise<void> {
    if (unavailable || !hostRef) return;
    await saveProfileSection(hostRef.setEnabledForPerson, ctx, body);
  },

  /** Shown on Admin → Add-ons. */
  status(): { healthy: boolean; message: string } {
    return unavailable ? { healthy: false, message: `phr is off: ${unavailable}` } : { healthy: true, message: 'Ready' };
  }
};

export default PhrAddon;
