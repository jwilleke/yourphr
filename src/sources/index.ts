/**
 * Talking to a provider — the one entry point (yourphr#760, epic yourphr#755).
 *
 * Everything about HOW a source is reached lives under this folder: the SMART flow (discover,
 * authorize, exchange, refresh), the fetch and its paging, the query plan that decides how a type
 * must be asked for, and the capability read that says what a server serves. Nothing else in the
 * tree reaches inside it; callers import from here.
 *
 * The seam, stated so it survives:
 *
 *   - It yields resources; it never stores them. `storeEntries` and the repository writer stay in
 *     `src/sync`, and the records door stays in RecordsManager — PHI passes THROUGH a caller's
 *     writer, and nothing here holds it.
 *   - Outbound HTTP is the caller's guarded capability. Every request goes through `src/http`, so
 *     `scripts/check-http-boundary.sh` keeps its meaning; `SyncOptions.http` lets a caller hand its
 *     own instance in rather than have one made here.
 *   - What is instance-specific is NOT here: endpoints, client ids and secrets live in the provider
 *     catalog, and the relay belongs to the deployment.
 *
 * This is the shape `@jwilleke/fhir-sources` would take if it is ever extracted. It is deliberately
 * NOT a package yet: one consumer, and `source-quirks.json` does not exist because nothing has
 * earned an entry — see docs/planning/fhir-flow-plan.md, Gap 4.
 */
export { SmartClient, generateVerifier, s256Challenge, statesMatch, validateDiscoveredEndpoint, type Endpoints, type SmartConfig, type TokenResponse } from './smart.js';
export { FhirHttpError, nextPageUrl, syncFrom, syncResource } from './fetch.js';
export { categorySearches, plainSearch, refusalReason, refusalWantsMoreParameters, type PlannedSearch } from './query-plan.js';
export { decodeCapability, encodeCapability, narrowTypes, readCapability, searchableByPatient, type SourceCapability } from './capability.js';
export { CATEGORY_CODES, REQUIRED_COMBINATIONS, US_CORE_SOURCE, categoryIsCombinable } from './us-core-search.js';
