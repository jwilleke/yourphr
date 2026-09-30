/**
 * The NPI registry through NLM's Clinical Table Search (yourphr#774): `npi_idv/v3/search`, the same
 * service and fields the practitioner form used from the browser, now asked by the server.
 *
 * Through the guarded HTTP client, so the SSRF posture is the one every other outbound call answers
 * to. The person's IP address never reaches NLM; the typed name still does — that is the lookup —
 * which is why the provider is off unless the operator binds it.
 */
import { guardedFetch } from '../../http/guarded-fetch.js';
import { BaseNpiLookupProvider, type NpiClinician } from './BaseNpiLookupProvider.js';

const ENDPOINT = 'https://clinicaltables.nlm.nih.gov/api/npi_idv/v3/search';
const FIELDS = 'NPI,name.full,provider_type,addr_practice,licenses.taxonomy.code';

interface PracticeAddress { line1?: string; line2?: string; city?: string; state?: string; zip?: string; country?: string; phone?: string; fax?: string }

export class NlmNpiLookupProvider extends BaseNpiLookupProvider {
  readonly name = 'nlm';
  readonly available = true;
  readonly unavailableReason = '';

  constructor(private readonly options: { allowInternal?: boolean; timeoutMs?: number; endpoint?: string } = {}) {
    super();
  }

  async searchClinicians(terms: string, limit: number): Promise<NpiClinician[]> {
    const params = new URLSearchParams({ terms, df: FIELDS, maxList: String(limit) });
    const response = await guardedFetch(`${this.options.endpoint ?? ENDPOINT}?${params.toString()}`, {
      timeoutMs: this.options.timeoutMs ?? 10_000,
      allowInternal: this.options.allowInternal ?? false,
      maxBytes: 512 * 1024,
    });
    if (response.status !== 200) throw new Error(`npi lookup: NLM answered ${response.status}`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(response.body.toString('utf8'));
    } catch (err) {
      throw new Error(`npi lookup: NLM returned something that is not JSON (${(err as Error).message})`);
    }
    // Clinical Table Search answers [total, codes, extra, displayRows]; displayRows follow `df`.
    const rows = Array.isArray(parsed) && Array.isArray(parsed[3]) ? (parsed[3] as unknown[]) : [];
    return rows.slice(0, limit).flatMap((row): NpiClinician[] => {
      if (!Array.isArray(row)) return [];
      const [npi, name, providerType, addrJson, taxonomyCode] = row.map((v) => (typeof v === 'string' ? v : ''));
      let addr: PracticeAddress = {};
      try { addr = JSON.parse(addrJson || '{}') as PracticeAddress; } catch { addr = {}; }
      if (!npi || !name) return [];
      return [{
        npi, name, providerType: providerType ?? '', taxonomyCode: taxonomyCode ?? '',
        address: { line1: addr.line1 ?? '', line2: addr.line2 ?? '', city: addr.city ?? '', state: addr.state ?? '', zip: addr.zip ?? '', country: addr.country ?? '' },
        phone: addr.phone ?? '', fax: addr.fax ?? '',
      }];
    });
  }
}
