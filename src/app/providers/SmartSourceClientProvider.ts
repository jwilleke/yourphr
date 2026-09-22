/** The SMART on FHIR source client (yourphr#612, #613) over src/smart (authorize, exchange, refresh) and src/sync (paging). */
import { randomUUID } from 'node:crypto';
import { SmartClient, generateVerifier, type Endpoints } from '../../smart/index.js';
import { FhirHttpError, syncFrom, syncResource } from '../../sync/index.js';
import { categorySearches, plainSearch, refusalReason, refusalWantsMoreParameters } from '../../sources/query-plan.js';
import { BaseSourceClientProvider, SourceClientError, type AuthorizationResult, type AuthorizationStart, type FetchReport, type RefreshedTokens, type SmartApp } from './BaseSourceClientProvider.js';
import type { ConnectedSource } from './BaseSourcesProvider.js';
import type { RecordsWriter } from './BaseRecordsProvider.js';

export class SmartSourceClientProvider extends BaseSourceClientProvider {
  readonly name = 'smart';
  constructor(private readonly options: { allowInternal?: boolean } = {}) { super(); }

  private clientFor(app: SmartApp, redirectUri: string): SmartClient {
    return new SmartClient({ fhirBaseUrl: app.fhirBaseUrl, clientId: app.clientId, clientSecret: app.clientSecret || undefined, redirectUri, scopes: app.scopes, allowInternal: this.options.allowInternal });
  }

  private async discover(client: SmartClient, app: SmartApp): Promise<Endpoints> {
    let endpoints: Endpoints;
    try {
      endpoints = await client.discover();
    } catch (err) {
      throw new SourceClientError('discovery', `SMART discovery failed: ${(err as Error).message}`);
    }
    return app.authorizeUrlOverride ? { ...endpoints, authorization: app.authorizeUrlOverride } : endpoints;
  }

  async beginAuthorization(app: SmartApp, redirectUri: string): Promise<AuthorizationStart> {
    const client = this.clientFor(app, redirectUri);
    const endpoints = await this.discover(client, app);
    const state = randomUUID();
    const codeVerifier = generateVerifier();
    return { authorizeUrl: client.authorizeUrl(endpoints, state, codeVerifier), state, codeVerifier };
  }

  async completeAuthorization(app: SmartApp, redirectUri: string, code: string, codeVerifier: string): Promise<AuthorizationResult> {
    const client = this.clientFor(app, redirectUri);
    const endpoints = await this.discover(client, app);
    try {
      const token = await client.exchangeCode(endpoints, code, codeVerifier);
      return {
        tokenUrl: endpoints.token,
        accessToken: token.accessToken,
        refreshToken: token.refreshToken ?? '',
        expiresAt: token.expiresAt ? Math.floor(token.expiresAt.getTime() / 1000) : 0,
        patient: (token.patient ?? '').trim(),
      };
    } catch (err) {
      throw new SourceClientError('exchange', `token exchange failed: ${(err as Error).message}`);
    }
  }

  async refresh(source: ConnectedSource, nowSeconds: number): Promise<RefreshedTokens> {
    const client = new SmartClient({ fhirBaseUrl: source.fhirBaseUrl, clientId: source.clientId, redirectUri: 'unused-for-refresh', scopes: [], allowInternal: this.options.allowInternal });
    // A migrated source arrives without a token endpoint (Go re-discovered every time, yourphr#584): discover once.
    const tokenUrl = source.tokenUrl === '' ? (await client.discover()).token : source.tokenUrl;
    const endpoints: Endpoints = { authorization: 'unused-for-refresh', token: tokenUrl };
    const token = await client.refresh(endpoints, source.refreshToken);
    return {
      accessToken: token.accessToken,
      refreshToken: token.refreshToken ?? source.refreshToken, // some providers rotate, some repeat — keep whichever is newest
      expiresAt: token.expiresAt ? Math.floor(token.expiresAt.getTime() / 1000) : nowSeconds + 3600,
      tokenUrl,
    };
  }

  async fetchPages(source: ConnectedSource, resourceType: string, accessToken: string, writer: RecordsWriter, maxPages: number): Promise<FetchReport> {
    const patient = encodeURIComponent(source.patient);
    // Patient is READ by id, never searched: `Patient?patient=` names a parameter Patient does not
    // have, and Epic refuses it (yourphr#753; Go read it by id too).
    if (resourceType === 'Patient') {
      const one = await syncResource(`${source.fhirBaseUrl}/Patient/${patient}`, { writer, accessToken, allowInternal: this.options.allowInternal });
      return { received: one.received, created: one.created, updated: one.updated };
    }

    const search = async (params: Record<string, string>): Promise<FetchReport> => {
      const query = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
      const r = await syncFrom(`${source.fhirBaseUrl}/${resourceType}?${query}&_count=100`, { writer, accessToken, maxPages, allowInternal: this.options.allowInternal });
      return { received: r.received, created: r.created, updated: r.updated };
    };

    try {
      return await search(plainSearch(source.patient).params);
    } catch (err) {
      // A server may insist on more than `patient` — Epic and Oracle Health both refuse an
      // unqualified Observation search, as US Core allows (yourphr#754). Asking once per category
      // is the second attempt; anything else keeps the original refusal.
      const fanOut = refusalWantsMoreParameters(err) ? categorySearches(resourceType, source.patient) : [];
      if (fanOut.length === 0) throw err;

      const total: FetchReport = { received: 0, created: 0, updated: 0 };
      const refused: string[] = [];
      for (const plan of fanOut) {
        try {
          const part = await search(plan.params);
          total.received += part.received;
          total.created += part.created;
          total.updated += part.updated;
        } catch (inner) {
          // One category refused must not cost the other eight; a category the server has nothing
          // for is normal. Only a token the server rejects ends the type, as it ends the sync.
          if (inner instanceof FhirHttpError && inner.status === 401) throw inner;
          refused.push(`${plan.category} (${inner instanceof FhirHttpError ? `HTTP ${inner.status}` : (inner as Error).message.slice(0, 60)})`);
        }
      }
      if (refused.length === fanOut.length) throw err; // nothing worked: the first refusal is the honest answer
      const said = refusalReason(err);
      total.detail = `asked by category after ${said === '' ? 'a refusal' : `"${said}"`}: ${fanOut.length - refused.length} of ${fanOut.length} answered`
        + (refused.length ? `, refused ${refused.join(', ')}` : '');
      return total;
    }
  }
}
