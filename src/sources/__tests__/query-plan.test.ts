import { describe, expect, it } from 'vitest';
import { FhirHttpError } from '../../sync/index.js';
import { categorySearches, plainSearch, refusalReason, refusalWantsMoreParameters } from '../query-plan.js';
import { CATEGORY_CODES, REQUIRED_COMBINATIONS, US_CORE_SOURCE, categoryIsCombinable } from '../us-core-search.js';

/** Epic's actual refusal, kept verbatim from the 2026-09-22 live sandbox run (yourphr#754). */
const EPIC_REQUIRES_CATEGORY = JSON.stringify({
  resourceType: 'OperationOutcome',
  issue: [{ severity: 'fatal', code: 'required', diagnostics: 'This resource requires a category for searching' }],
});

describe('the US Core tables', () => {
  it('records where they came from, so a refresh is a deliberate act', () => {
    expect(US_CORE_SOURCE).toMatchObject({ version: '9.0.0', url: expect.stringContaining('us-core-server.json') });
  });

  it('knows patient+category for the six types US Core declares it for, and not for the others', () => {
    for (const type of ['Observation', 'Condition', 'DiagnosticReport', 'DocumentReference', 'CarePlan', 'ServiceRequest']) {
      expect(categoryIsCombinable(type), type).toBe(true);
    }
    for (const type of ['Immunization', 'Encounter', 'Procedure', 'AllergyIntolerance', 'Patient', 'Unheard-of']) {
      expect(categoryIsCombinable(type), type).toBe(false);
    }
  });

  it('carries Observation\'s required combinations as US Core publishes them', () => {
    const combos = (REQUIRED_COMBINATIONS['Observation'] ?? []).map((c) => c.join('+'));
    expect(combos).toContain('category+patient');
    expect(combos).toContain('code+patient');
  });
});

describe('what to ask first', () => {
  it('is the plain patient search — a required combination is what a server SUPPORTS, not what it demands', () => {
    // Epic answered Condition, DiagnosticReport and DocumentReference to a plain search in the live
    // run, so fanning out by default would be more requests for the same records — and would drop a
    // record that carries no category at all.
    expect(plainSearch('p-1')).toEqual({ params: { patient: 'p-1' }, category: '' });
  });
});

describe('what to ask after a refusal', () => {
  it('fans Observation out across the US Core categories, once each', () => {
    const plans = categorySearches('Observation', 'p-1');
    expect(plans.map((p) => p.category)).toEqual(CATEGORY_CODES['Observation']);
    expect(plans[0]).toEqual({ params: { patient: 'p-1', category: 'laboratory' }, category: 'laboratory' });
  });

  it('has nothing to try for a type US Core does not combine with category', () => {
    expect(categorySearches('Immunization', 'p-1')).toEqual([]);
    expect(categorySearches('Encounter', 'p-1')).toEqual([]);
  });

  it('has nothing to try for a combinable type whose categories nobody has needed yet — an empty list means "do not fan out", not "unknown"', () => {
    expect(CATEGORY_CODES['CarePlan']).toBeUndefined();
    expect(categorySearches('CarePlan', 'p-1')).toEqual([]);
  });
});

describe('recognising the refusal worth a second attempt', () => {
  it('accepts an OperationOutcome that says a parameter is required — Epic\'s, verbatim', () => {
    expect(refusalWantsMoreParameters(new FhirHttpError(400, 'HTTP 400 …', EPIC_REQUIRES_CATEGORY))).toBe(true);
    expect(refusalReason(new FhirHttpError(400, 'HTTP 400 …', EPIC_REQUIRES_CATEGORY))).toBe('This resource requires a category for searching');
  });

  it('refuses everything else: a bare 400, a 403, a 404, a 5xx, a non-FHIR body, a thrown string', () => {
    const otherOutcome = JSON.stringify({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'invalid', diagnostics: 'bad date' }] });
    expect(refusalWantsMoreParameters(new FhirHttpError(400, 'HTTP 400 …', otherOutcome))).toBe(false); // a malformed request stays malformed
    expect(refusalWantsMoreParameters(new FhirHttpError(400, 'HTTP 400 …', '<html>gateway</html>'))).toBe(false);
    expect(refusalWantsMoreParameters(new FhirHttpError(403, 'HTTP 403 …', EPIC_REQUIRES_CATEGORY))).toBe(false); // not granted: asking again cannot help
    expect(refusalWantsMoreParameters(new FhirHttpError(404, 'HTTP 404 …', ''))).toBe(false);
    expect(refusalWantsMoreParameters(new FhirHttpError(503, 'HTTP 503 …', ''))).toBe(false);
    expect(refusalWantsMoreParameters(new Error('socket hang up'))).toBe(false);
    expect(refusalWantsMoreParameters('nope')).toBe(false);
  });

  it('says nothing when the server explained nothing', () => {
    expect(refusalReason(new FhirHttpError(400, 'HTTP 400 …', ''))).toBe('');
    expect(refusalReason(new Error('socket hang up'))).toBe('');
  });
});
