/**
 * Looking up a clinician in the US national NPI registry (yourphr#774): what fills in a genuine NPI,
 * specialty and practice address when a patient adds a practitioner, instead of free text.
 *
 * It used to run in the patient's BROWSER, straight to NLM's Clinical Table Search, carrying the
 * name they were typing and their IP address. It now runs here, through the guarded HTTP client
 * like every other outbound call, and only when the operator binds a provider. The shipped default
 * is `null`: nothing leaves the instance, and the name field is plain text.
 *
 * OPTIONAL capability with an inert default, the glossary's shape (yourphr#640).
 */

/** One clinician as the registry lists them — only what the practitioner form uses. */
export interface NpiClinician {
  npi: string;
  name: string;
  /** The registry's description of their taxonomy — "Family Medicine Physician". */
  providerType: string;
  /** NUCC provider taxonomy code, when the registry gives one. */
  taxonomyCode: string;
  address: { line1: string; line2: string; city: string; state: string; zip: string; country: string };
  phone: string;
  fax: string;
}

export abstract class BaseNpiLookupProvider {
  /** For the boot log: which lookup this instance is bound to. */
  abstract readonly name: string;
  abstract readonly available: boolean;
  /** Why it cannot answer, for the screen to show. Empty when it can. */
  abstract readonly unavailableReason: string;
  /** Up to `limit` clinicians matching what was typed. Throws only when the lookup itself fails. */
  abstract searchClinicians(terms: string, limit: number): Promise<NpiClinician[]>;
}

/** The shipped default: never reaches out. */
export class NullNpiLookupProvider extends BaseNpiLookupProvider {
  readonly name = 'null';
  readonly available = false;
  readonly unavailableReason = 'looking up clinicians in the national NPI registry is off on this instance — type the details yourself';
  async searchClinicians(): Promise<NpiClinician[]> { return []; }
}
