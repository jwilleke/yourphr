/**
 * Lookups (yourphr#774, Jim 2026-09-30): the one door for reference lookups the patient's forms use.
 * Today one — clinicians in the NPI registry — and the place later ones join (organizations, the
 * lforms service once #800 settles it) rather than each growing a door of its own.
 *
 * The rule it exists for: a form never sends what a person types to another host from their
 * browser. The server asks, through a config-bound provider and the guarded HTTP client, and only
 * when the operator has bound one; otherwise it says the lookup is off and the form is plain text.
 */
import { BaseManager, type BackupData } from '../../framework/BaseManager.js';
import type { Engine } from '../../framework/Engine.js';
import { ApiError, type ApiContext } from '../../framework/ApiContext.js';
import type { BaseNpiLookupProvider, NpiClinician } from '../providers/BaseNpiLookupProvider.js';

declare module '../../framework/Engine.js' {
  interface ManagerRegistry {
    lookups: LookupsManager;
  }
}

export interface LookupAnswer<T> {
  available: boolean;
  /** Why not, in words for the form — empty when available. */
  reason: string;
  results: T[];
}

export class LookupsManager extends BaseManager {
  readonly name = 'lookups';
  override readonly dependsOn = [] as const;

  constructor(engine: Engine, private readonly npi: BaseNpiLookupProvider, private readonly log: (line: string) => void = () => undefined) {
    super(engine);
  }

  override async initialize(config: Record<string, unknown> = {}): Promise<void> {
    await super.initialize(config);
    this.log(`lookups: NPI registry provider '${this.npi.name}'${this.npi.available ? '' : ' — off; the practitioner form is plain text'}`);
  }

  /**
   * Clinicians matching what a signed-in person typed. Fewer than 2 characters asks nothing, so a
   * single keystroke is never sent anywhere. With no terms, it answers only whether the lookup is on.
   */
  async searchClinicians(ctx: ApiContext, terms: string): Promise<LookupAnswer<NpiClinician>> {
    ctx.requireAuthenticated();
    const typed = String(terms ?? '').trim();
    if (typed.length > 80) throw new ApiError(400, 'a search is at most 80 characters');
    if (!this.npi.available) return { available: false, reason: this.npi.unavailableReason, results: [] };
    if (typed.length < 2) return { available: true, reason: '', results: [] };
    try {
      return { available: true, reason: '', results: await this.npi.searchClinicians(typed, 10) };
    } catch (err) {
      // Logged without the typed name: it is what the person is recording as their clinician.
      this.log(`lookups: NPI registry lookup failed: ${(err as Error).message.replace(typed, '…')}`);
      throw new ApiError(502, 'the NPI registry could not be reached — type the details yourself, or try again');
    }
  }

  async backup(): Promise<BackupData> {
    return { manager: this.name, takenAt: new Date().toISOString() };
  }

  async restore(): Promise<void> { /* nothing of its own */ }
}
