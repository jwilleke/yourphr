/**
 * How a resource type is asked for, and what to do when the server refuses (yourphr#754).
 *
 * The shape of the problem. Epic and Oracle Health both refuse `Observation?patient=` with a 400
 * whose OperationOutcome says `code: required` — US Core's required combination for Observation is
 * patient + category, and a server is allowed to insist on it. Before yourphr#753 that refusal
 * ended the whole sync; since then it is skipped and named, so an Epic import arrives with no labs
 * and no vital signs. This module is what gets them back.
 *
 * Ask first, fan out on refusal — deliberately, rather than always fanning out:
 *
 *   - A required combination says what a server SHALL support, NOT what it refuses without. Epic
 *     answers a plain `Condition?patient=`, `DiagnosticReport?patient=` and
 *     `DocumentReference?patient=` — all three imported records in the 2026-09-22 live run — even
 *     though US Core lists patient+category for each. Fanning out by default would multiply every
 *     sync's requests for nothing.
 *   - A record that carries NO category matches no category search. Fanning out by default would
 *     silently drop such records on servers that would have returned them to a plain search;
 *     fanning out only where the plain search is refused cannot.
 *
 * So: one search, and if the server answers "required", ask again once per category. What each
 * type's categories are comes from US Core (`us-core-search.ts`), never from a vendor table.
 */
import { FhirHttpError } from './fetch.js';
import { CATEGORY_CODES, categoryIsCombinable } from './us-core-search.js';

/** One search to run: the query parameters, and a label for the job and the log. */
export interface PlannedSearch {
  params: Record<string, string>;
  /** '' for a plain patient search; otherwise the category it covers. */
  category: string;
}

/** The first thing to try for a type: the plain patient search every server is expected to answer. */
export function plainSearch(patient: string): PlannedSearch {
  return { params: { patient }, category: '' };
}

/**
 * The fan-out to try after a refusal — one search per category US Core gives this type, or an empty
 * list when there is nothing better to try, which keeps the original refusal as the honest answer.
 */
export function categorySearches(resourceType: string, patient: string): PlannedSearch[] {
  if (!categoryIsCombinable(resourceType)) return [];
  return (CATEGORY_CODES[resourceType] ?? []).map((category) => ({ params: { patient, category }, category }));
}

/**
 * Is this the refusal that a category fan-out answers?
 *
 * Narrow on purpose. A 400 alone is not enough — a malformed request is also a 400, and retrying it
 * nine times would be nine more malformed requests. The signal is FHIR's own: an OperationOutcome
 * whose issue code is `required`, which is what Epic returns ("this resource requires a category
 * for searching"). Anything else — 403 for a scope never granted, 404, a 5xx — is left alone.
 */
export function refusalWantsMoreParameters(err: unknown): boolean {
  if (!(err instanceof FhirHttpError) || err.status !== 400) return false;
  const issues = operationOutcomeIssues(err.body);
  return issues.some((issue) => issue.code === 'required');
}

/** The `issue` array of an OperationOutcome, or [] for a body that is not one. */
function operationOutcomeIssues(body: string): { code?: string; diagnostics?: string }[] {
  try {
    const parsed = JSON.parse(body) as { resourceType?: string; issue?: { code?: string; diagnostics?: string }[] };
    return parsed.resourceType === 'OperationOutcome' ? (parsed.issue ?? []) : [];
  } catch {
    return [];
  }
}

/** The server's own words for why it refused, for the job line. '' when it said nothing usable. */
export function refusalReason(err: unknown): string {
  if (!(err instanceof FhirHttpError)) return '';
  const said = operationOutcomeIssues(err.body).map((issue) => issue.diagnostics ?? '').filter((d) => d !== '');
  return said.join('; ').slice(0, 200);
}
