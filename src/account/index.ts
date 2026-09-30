/**
 * The account's rules (yourphr#596, #614): which providers need the legal consent, and which
 * routes count as an access of a person's record. Pure functions — the consent is the users
 * provider's, the access log is the Audit manager's.
 */
export type { AccessEvent } from '../framework/providers/BaseAuditProvider.js';

/** Go's rule for which providers need the legal consent before connecting: the Medicare family. */
export function providerRequiresLegalConsent(display: string, fhirBaseUrl: string, platformType: string): boolean {
  const blob = `${display}\n${fhirBaseUrl}\n${platformType}`.toLowerCase();
  return ['medicare', 'blue button', 'bluebutton', 'blue-button', 'cms.gov', 'cms.hhs.gov'].some((m) => blob.includes(m));
}

/**
 * Every read surface an access can belong to — the access log's vocabulary, and therefore the
 * agent-token SCOPE vocabulary (yourphr#695).
 *
 * One list serving both is deliberate. ngdpbase's scopes are permission ACTION names because
 * ngdpbase has actions like `page-read` to name; this stack does not — the `user` role holds NO
 * permissions at all, and a person's access to their own records is compartmentalised by
 * `user_id` rather than gated by a permission. So there was no existing vocabulary for a scope to
 * narrow, and inventing a second one would have meant three lists to keep in step: what an agent
 * may read, what the log calls it, and what the minting screen shows the patient.
 *
 * Binding scope to the log category collapses those into one, and buys the property that matters:
 * a surface that cannot be logged cannot be scoped, so an agent can never reach a read the patient
 * would not see recorded.
 */
export const ACCESS_CATEGORIES = [
  'Summary',
  'Summary (IPS)',
  'Medications',
  'Conditions',
  'Allergies',
  'Immunizations',
  'Record search',
  'Records (FHIR)',
  'Full export',
] as const;

export type AccessCategory = (typeof ACCESS_CATEGORIES)[number];

/**
 * Credential lifecycle, in the same patient-visible log (yourphr#698 item 4).
 *
 * Deliberately NOT members of ACCESS_CATEGORIES, and the distinction is load-bearing: that list is
 * also the SCOPE vocabulary, so a category placed in it becomes something an agent token can be
 * granted. Minting is not a read surface, and a token that could be scoped to "Agent token minted"
 * would be a delegation that reaches the management surface it is supposed to be barred from.
 *
 * They live in the access log rather than in a second sink because the token store cannot answer
 * the question the review asked — "what could this credential do, and when was it stopped?" —
 * once retention drops the dead row. The log is the only record in this stack that outlives it.
 */
export const CREDENTIAL_EVENT_CATEGORIES = {
  minted: 'Agent token minted',
  renewed: 'Agent token renewed',
  revoked: 'Agent token revoked',
  // A connected device's grant (yourphr#807, #808): the patient's consent, in the same log.
  deviceGranted: 'Device permission granted',
  deviceClaimed: 'Device connected',
  deviceExtended: 'Device permission extended',
  deviceRevoked: 'Device permission revoked',
  deviceEnded: 'Device permission ended',
  deviceCopied: 'Device permission revoked: a copied key was used',
} as const;

/**
 * What a connected device may be granted (yourphr#807): its one WRITE, and the one read that
 * write needs. Deliberately NOT in ACCESS_CATEGORIES, so an ordinary agent token can never be
 * minted with them, and a device grant can never carry a read of the record. The same rule holds
 * as for reads: a surface that cannot be logged cannot be scoped — each is a log category too.
 */
export const DEVICE_SCOPES = ['Health samples (add)', 'Health samples (sync state)'] as const;
export type DeviceScope = (typeof DEVICE_SCOPES)[number];
export const isDeviceScope = (value: string): value is DeviceScope => (DEVICE_SCOPES as readonly string[]).includes(value);

/**
 * The write surfaces an agent credential can ever reach, by method and path (yourphr#807).
 * Everything absent here stays refused to every agent, whatever it holds.
 */
export function writeCategoryFor(method: string, pathname: string): DeviceScope | undefined {
  if (method === 'POST' && pathname === '/api/secure/health/samples') return 'Health samples (add)';
  return undefined;
}

/** Is this a category this build knows? A scope that is not one can never match a request. */
export function isAccessCategory(value: string): value is AccessCategory {
  return (ACCESS_CATEGORIES as readonly string[]).includes(value);
}

/** Go's accessLogCategories, for the routes this stack serves. A path not listed is not an access. */
export function accessCategoryFor(pathname: string): string | undefined {
  const exact: Record<string, string> = {
    '/api/secure/summary': 'Summary',
    '/api/secure/summary/ips': 'Summary (IPS)',
    '/api/secure/medications/reconciled': 'Medications',
    '/api/secure/conditions/reconciled': 'Conditions',
    '/api/secure/allergies/classified': 'Allergies',
    '/api/secure/immunizations/classified': 'Immunizations',
    '/api/secure/resources/recent': 'Record search',
    // Find-anything-by-words (yourphr#599) was serving results without recording them: the
    // dashboard's search box read across every resource type a person has and the access log said
    // nothing happened. Both spellings, because server.ts answers both and a category that covers
    // one of two aliases is a hole shaped like a typo.
    '/api/secure/resources/search': 'Record search',
    '/api/secure/search': 'Record search',
    '/api/secure/resource/fhir': 'Records (FHIR)',
  };
  if (exact[pathname]) return exact[pathname];
  if (/^\/api\/secure\/resource\/fhir\/[^/]+\/[^/]+$/.test(pathname)) return 'Records (FHIR)';
  // Both read FHIR resources and were served unlogged until the category check found them
  // (yourphr#798, Jim 2026-09-29: the existing category, so no new agent-token scope): a
  // practitioner's Encounters, and where one record came from.
  if (/^\/api\/secure\/practitioners\/[^/]+\/history$/.test(pathname)) return 'Records (FHIR)';
  if (/^\/api\/secure\/resource\/provenance\/[^/]+\/[^/]+$/.test(pathname)) return 'Records (FHIR)';
  if (/^\/api\/secure\/source\/[^/]+\/export$/.test(pathname)) return 'Full export';
  // A device's own read (yourphr#807): where its last upload got to. A device scope, not an access
  // category a person or an ordinary agent token can be given.
  if (pathname === '/api/secure/health/sync-state') return 'Health samples (sync state)';
  return undefined;
}

/**
 * Go's LegalConsentStatus, from the stored timestamp ('' = not accepted). The account page reads
 * these exact field names, so the shape is Go's rather than this stack's preference (yourphr#619).
 */
export function consentStatus(acceptedAt: string): Record<string, unknown> {
  return {
    accepted: acceptedAt !== '',
    ...(acceptedAt !== '' ? { accepted_at: acceptedAt } : {}),
    privacy_policy_url: '/privacy',
    terms_of_service_url: '/terms',
  };
}

/** The timestamp Go stamps a consent with: ISO 8601, whole seconds. */
export function consentNow(now = new Date()): string {
  return now.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
