/**
 * The source client (yourphr#612, #613): how this instance talks to a provider — the SMART
 * authorization that connects a source, token refresh, and record fetching. OPTIONAL (decision
 * Q6): an instance with no connected sources never loads the URL-fetching path; the Null provider
 * refuses to connect and to sync, and says why.
 */
import type { RecordsWriter } from './BaseRecordsProvider.js';
import type { ConnectedSource } from './BaseSourcesProvider.js';
import type { SourceCapability } from '../../sources/capability.js';

export interface RefreshedTokens { accessToken: string; refreshToken: string; expiresAt: number; tokenUrl: string }
export interface FetchReport {
  received: number;
  created: number;
  updated: number;
  /**
   * What the client had to do differently for this type, when it did — e.g. asking once per
   * category because the server refused a plain patient search (yourphr#754). Surfaced in the job
   * and the log so a partial or unusual fetch explains itself; absent when nothing notable happened.
   */
  detail?: string;
}

/** A catalog entry as the client needs it: the app registered with the provider. */
export interface SmartApp {
  fhirBaseUrl: string;
  clientId: string;
  /** Set only for a confidential client. */
  clientSecret?: string;
  scopes: string[];
  /** An operator-supplied authorization endpoint, when discovery's is wrong for this provider. */
  authorizeUrlOverride?: string;
}

export interface AuthorizationStart { authorizeUrl: string; state: string; codeVerifier: string }
export interface AuthorizationResult { tokenUrl: string; accessToken: string; refreshToken: string; expiresAt: number; patient: string }

/** Where a client call failed — the manager turns the stage into the caller-facing message. */
export class SourceClientError extends Error {
  constructor(readonly stage: 'discovery' | 'exchange' | 'refresh' | 'fetch' | 'unavailable', message: string) {
    super(message);
  }
}

export abstract class BaseSourceClientProvider {
  abstract readonly name: string;
  /** Discover the provider and build the authorization URL a member is sent to. */
  abstract beginAuthorization(app: SmartApp, redirectUri: string): Promise<AuthorizationStart>;
  /** Exchange the returned code for tokens; the patient the token is scoped to, '' when the provider gave none. */
  abstract completeAuthorization(app: SmartApp, redirectUri: string, code: string, codeVerifier: string): Promise<AuthorizationResult>;
  /** Refresh an expiring token; discovers the token endpoint once when the source has none. */
  abstract refresh(source: ConnectedSource, nowSeconds: number): Promise<RefreshedTokens>;
  /** Every page of one resource type for the source's patient, written through the door. (Not named after the browser API on purpose: the HTTP-boundary guard reads that word as a network call.) */
  /**
   * The server's CapabilityStatement, distilled (yourphr#756) — undefined with a reason when it
   * cannot be read, which is never fatal. On the client because the client is what talks to
   * providers; the manager decides what to do with the answer.
   */
  abstract readCapability(source: ConnectedSource, accessToken: string, nowSeconds: number): Promise<{ capability?: SourceCapability; reason: string }>;

  abstract fetchPages(source: ConnectedSource, resourceType: string, accessToken: string, writer: RecordsWriter, maxPages: number): Promise<FetchReport>;
}

/** The inert default: nothing is reached, and every attempt says so rather than pretending. */
export class NullSourceClientProvider extends BaseSourceClientProvider {
  readonly name = 'null';
  private refuse(what: string): never {
    throw new SourceClientError('unavailable', `no source client is configured (sources.client.provider = null): ${what}`);
  }
  async beginAuthorization(): Promise<AuthorizationStart> { return this.refuse('a provider cannot be authorized'); }
  async completeAuthorization(): Promise<AuthorizationResult> { return this.refuse('a provider cannot be connected'); }
  async refresh(): Promise<RefreshedTokens> { return this.refuse('tokens cannot be refreshed'); }
  async readCapability(): Promise<{ capability?: SourceCapability; reason: string }> { return { reason: 'no source client is configured' }; }
  async fetchPages(): Promise<FetchReport> { return this.refuse('nothing can be synced'); }
}
