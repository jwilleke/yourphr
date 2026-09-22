/**
 * Connected-source storage (yourphr#612): what a member DID connect — OAuth credentials included —
 * and the dynamic client that may ride with a source (yourphr#540's DCR). The manager decides;
 * this stores and returns. Every operation that reads credentials is here so the lint can see it.
 */
export interface ConnectedSource {
  id: number;
  userId: string;
  display: string;
  fhirBaseUrl: string;
  tokenUrl: string;
  clientId: string;
  patient: string;
  resourceTypes: string[];
  accessToken: string;
  refreshToken: string;
  /** unix seconds; 0 = unknown, treated as expired so the first pass refreshes. */
  expiresAt: number;
  lastSyncAt: number;
  /** Go's platform_type / environment; '' when unknown — never guessed (yourphr#594). */
  platformType: string;
  environment: string;
  /**
   * The distilled CapabilityStatement this server published, as JSON (yourphr#756); '' when it has
   * never been read, or was read and could not be used. A cache of what the server said, never a
   * source of truth — see src/sources/capability.ts.
   */
  capability: string;
}

export type NewSource = Omit<ConnectedSource, 'id' | 'lastSyncAt' | 'platformType' | 'environment' | 'capability'> & Partial<Pick<ConnectedSource, 'platformType' | 'environment' | 'capability'>>;

export interface DynamicClient {
  clientId: string;
  clientSecret: string;
  registrationAccessToken: string;
  registrationClientUri: string;
}

export abstract class BaseSourcesProvider {
  abstract initialize(): Promise<void>;
  abstract add(source: NewSource): Promise<ConnectedSource>;
  abstract byId(id: number): Promise<ConnectedSource | undefined>;
  abstract list(): Promise<ConnectedSource[]>;
  abstract count(): Promise<number>;
  abstract clearTokens(id: number): Promise<void>;
  abstract updateCapability(id: number, capability: string): Promise<void>;
  abstract updateTokenUrl(id: number, tokenUrl: string): Promise<void>;
  abstract updateTokens(id: number, accessToken: string, refreshToken: string, expiresAt: number): Promise<void>;
  abstract markSynced(id: number, at: number): Promise<void>;
  abstract remove(id: number): Promise<void>;
  abstract saveDynamicClient(sourceId: number, client: DynamicClient): Promise<void>;
  abstract dynamicClientFor(sourceId: number): Promise<DynamicClient | undefined>;
}
