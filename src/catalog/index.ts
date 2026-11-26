/**
 * The provider catalog's POLICY (yourphr#603, #613): Go's connection policy, patient-facing display
 * and the two wire shapes — pure functions over a CatalogEntry. The storage and the rules about
 * writing live in CatalogManager over a catalog provider (src/app).
 */
import type { CatalogEntry, ProviderEnvironment } from '../app/providers/BaseCatalogProvider.js';
import type { CatalogWrite } from '../app/managers/CatalogManager.js';

export type { CatalogEntry, CatalogWrite, ProviderEnvironment };

// ---------------------------------------------------------------------------
// Go's connection policy (yourphr#603), resolved at read time

/** Go's markers for the Medicare family — the providers whose connection needs the legal consent. */
export function isMedicareClass(display: string, fhirBaseUrl: string, platformType: string): boolean {
  const blob = `${display}\n${fhirBaseUrl}\n${platformType}`.toLowerCase();
  return ['medicare', 'blue button', 'bluebutton', 'blue-button', 'cms.gov', 'cms.hhs.gov'].some((m) => blob.includes(m));
}

export function normalizeConsentPolicy(v: string | undefined): string {
  const s = (v ?? '').trim().toLowerCase();
  return s === 'skip' ? 'skip' : s === 'required' ? 'required' : '';
}

export function normalizePreConnectProfile(v: string | undefined): string {
  const s = (v ?? '').trim().toLowerCase();
  return s === 'none' || s === 'generic' || s === 'medicare' || s === 'auto' ? s : '';
}

export interface ConnectionPolicy {
  requiresUserConsent: boolean;
  preConnectProfile: 'none' | 'generic' | 'medicare';
  medicareClass: boolean;
}

/** Go's ResolveConnectionPolicy: consent required unless 'skip'; profile 'auto' = medicare or generic. */
export function connectionPolicy(entry: CatalogEntry): ConnectionPolicy {
  const medicareClass = isMedicareClass(entry.display, entry.fhirBaseUrl, entry.platformType);
  const consent = normalizeConsentPolicy(entry.consentPolicy) || 'required';
  let pre = normalizePreConnectProfile(entry.preConnectProfile);
  if (pre === '' || pre === 'auto') pre = medicareClass ? 'medicare' : 'generic';
  return { requiresUserConsent: consent !== 'skip', preConnectProfile: pre as ConnectionPolicy['preConnectProfile'], medicareClass };
}

/** Go's PatientFacingSourceDisplay: a production Medicare-family provider is shown as "Medicare". */
export function patientFacingDisplay(entry: CatalogEntry): string {
  if (entry.environment === 'sandbox') return entry.display;
  return isMedicareClass(entry.display, entry.fhirBaseUrl, entry.platformType) ? 'Medicare' : entry.display;
}

/** Go's ConnectableProvider shape. */
export function connectableShape(entry: CatalogEntry): Record<string, unknown> {
  const policy = connectionPolicy(entry);
  return {
    id: String(entry.id),
    display: patientFacingDisplay(entry),
    // Sandbox-ness is a property of the provider, not the instance name (yourphr#674).
    environment: entry.environment,
    brand_logo_url: entry.brandLogoUrl,
    requires_user_consent: policy.requiresUserConsent,
    pre_connect_profile: policy.preConnectProfile,
    medicare_class: policy.medicareClass,
    requires_legal_consent: policy.requiresUserConsent,
  };
}

/** Go's ProviderCatalogEntry shape, as the admin page reads and writes it. The secret never leaves. */
export function catalogEntryShape(entry: CatalogEntry): Record<string, unknown> {
  return {
    id: String(entry.id),
    display: entry.display,
    environment: entry.environment,
    api_endpoint_base_url: entry.fhirBaseUrl,
    scopes: entry.scopes,
    platform_type: entry.platformType || 'ehr',
    brand_logo_url: entry.brandLogoUrl,
    enabled: entry.enabled,
    client_id: entry.clientId,
    has_client_secret: entry.hasClientSecret,
    authorize_url_override: entry.authorizeUrlOverride,
    consent_policy: entry.consentPolicy || 'required',
    pre_connect_profile: entry.preConnectProfile || 'auto',
  };
}
