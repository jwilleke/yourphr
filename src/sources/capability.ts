/**
 * What a server says it can do — its CapabilityStatement, read once at connect (yourphr#756).
 *
 * Every FHIR server publishes `<base>/metadata`: the resource types it holds and, for each, the
 * searches it accepts. v2 built its fetch plan from it; v3 dropped that and asks every provider the
 * same hard-coded list of 11 types, which is how a sync ends up requesting what a server does not
 * serve (Epic answers 403 for MedicationStatement every cycle) and never requesting what it does
 * (CarePlan, Goal, CareTeam — silently).
 *
 * Two boundaries worth stating, because they are what makes this safe to act on:
 *
 *   - It NARROWS, never widens. A type absent from the statement is not asked for; a type present
 *     is asked for only if the grant covered it. The statement cannot add reach.
 *   - It says what a server ACCEPTS, never what it INSISTS ON. Epic's carries no
 *     `search-parameter-combination` extension at all (checked 2026-09-22), which is why the
 *     required combinations come from US Core instead — see `us-core-search.ts`.
 *
 * Only a summary is kept. Epic's document is 95 KB; what a sync needs from it is a few hundred
 * bytes, and a summary is what a stored row should hold.
 */
import { OutboundHttp } from '../http/index.js';

/** The distilled statement, as stored on a source. */
export interface SourceCapability {
  /** unix seconds when it was read, so staleness is visible and a re-read is a decision. */
  readAt: number;
  /** Resource type -> the search parameter names the server advertises for it. */
  types: Record<string, string[]>;
  /** Does it advertise `Patient/$everything`? (yourphr#758 acts on this; nothing does yet.) */
  everything: boolean;
  /** '' when the statement did not say. */
  fhirVersion: string;
}

/** Read and distil `<base>/metadata`, or undefined with the reason it could not be read. */
export async function readCapability(
  fhirBaseUrl: string,
  accessToken: string,
  options: { allowInternal?: boolean; nowSeconds?: number } = {}
): Promise<{ capability?: SourceCapability; reason: string }> {
  const http = new OutboundHttp({ allowInternal: options.allowInternal });
  const url = `${fhirBaseUrl.replace(/\/$/, '')}/metadata`;
  let body: string;
  try {
    // Send the token when there is one; servers generally serve this openly (Epic does, verified
    // 2026-09-22 with no token at all), and a server that wants one then has it.
    const response = await http.get(url, { headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {} });
    if (response.status !== 200) return { reason: `HTTP ${response.status}` };
    body = response.body.toString('utf8');
  } catch (err) {
    return { reason: (err as Error).message.slice(0, 160) };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // A gateway serving an HTML error page is the common case here.
    return { reason: 'the response was not JSON' };
  }
  const statement = parsed as { resourceType?: string; fhirVersion?: string; rest?: { resource?: { type?: string; searchParam?: { name?: string }[]; operation?: { name?: string }[] }[] }[] };
  if (statement.resourceType !== 'CapabilityStatement') return { reason: `expected a CapabilityStatement, got ${String(statement.resourceType)}` };

  const types: Record<string, string[]> = {};
  let everything = false;
  for (const resource of statement.rest?.[0]?.resource ?? []) {
    if (!resource.type) continue;
    types[resource.type] = (resource.searchParam ?? []).map((p) => p.name ?? '').filter(Boolean);
    if (resource.type === 'Patient' && (resource.operation ?? []).some((op) => op.name === 'everything')) everything = true;
  }
  if (Object.keys(types).length === 0) return { reason: 'the statement declared no resources' };
  return { capability: { readAt: options.nowSeconds ?? Math.floor(Date.now() / 1000), types, everything, fhirVersion: statement.fhirVersion ?? '' }, reason: '' };
}

/**
 * Can this type be searched within one patient on this server? US Core types take `patient`; some
 * servers offer only `subject`. A type the statement does not mention at all is not searchable
 * here, which is the whole point of reading it.
 */
export function searchableByPatient(capability: SourceCapability, resourceType: string): boolean {
  const params = capability.types[resourceType];
  if (!params) return false;
  return params.includes('patient') || params.includes('subject');
}

/**
 * The types worth asking this server for, and the ones dropped with why — reported once rather than
 * refused every cycle. `Patient` is kept whenever the server has it at all, because it is READ by
 * id rather than searched (yourphr#753).
 */
export function narrowTypes(capability: SourceCapability, wanted: string[]): { keep: string[]; dropped: { type: string; reason: string }[] } {
  const keep: string[] = [];
  const dropped: { type: string; reason: string }[] = [];
  for (const type of wanted) {
    if (type === 'Patient') {
      if (capability.types['Patient']) keep.push(type);
      else dropped.push({ type, reason: 'the server does not serve it' });
      continue;
    }
    if (!capability.types[type]) dropped.push({ type, reason: 'the server does not serve it' });
    else if (!searchableByPatient(capability, type)) dropped.push({ type, reason: 'the server serves it but not by patient' });
    else keep.push(type);
  }
  return { keep, dropped };
}

/** Serialised for the row; the summary is small by design. */
export function encodeCapability(capability: SourceCapability): string {
  return JSON.stringify(capability);
}

/** undefined for '' or anything unparseable — a stored summary is a cache, never a source of truth. */
export function decodeCapability(stored: string): SourceCapability | undefined {
  if (stored === '') return undefined;
  try {
    const parsed = JSON.parse(stored) as SourceCapability;
    return parsed.types && typeof parsed.readAt === 'number' ? parsed : undefined;
  } catch {
    return undefined;
  }
}
