/**
 * The patient-facing catalog row carries the provider's own environment (yourphr#674).
 * The Sources page keys its sandbox safety notice off this field, never the instance display name.
 */
import { describe, expect, it } from 'vitest';
import type { CatalogEntry } from '../../app/providers/BaseCatalogProvider.js';
import { connectableShape } from '../index.js';

function entry(overrides: Partial<CatalogEntry>): CatalogEntry {
  return {
    id: 1,
    display: 'Big Hospital',
    environment: 'production',
    fhirBaseUrl: 'https://fhir.example.org/r4',
    scopes: 'patient/*.read',
    clientId: 'cid',
    enabled: true,
    authorizeUrlOverride: '',
    platformType: 'ehr',
    brandLogoUrl: '',
    consentPolicy: '',
    preConnectProfile: '',
    hasClientSecret: true,
    ...overrides,
  };
}

describe('connectableShape', () => {
  it('includes the catalog entry\'s environment, production or sandbox', () => {
    expect(connectableShape(entry({ environment: 'production' }))).toMatchObject({
      id: '1',
      display: 'Big Hospital',
      environment: 'production',
    });
    expect(connectableShape(entry({ id: 2, display: 'Epic (Sandbox)', environment: 'sandbox' }))).toMatchObject({
      id: '2',
      display: 'Epic (Sandbox)',
      environment: 'sandbox',
    });
  });

  it('does not infer sandbox from a display name — only from environment', () => {
    const shape = connectableShape(entry({ display: 'Hospital Sandbox Lab', environment: 'production' }));
    expect(shape['environment']).toBe('production');
    expect(shape['display']).toBe('Hospital Sandbox Lab');
  });
});
