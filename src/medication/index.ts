/**
 * Medication reconciliation (yourphr#580; Phase 4 of yourphr#542) — MedicationRequest /
 * MedicationStatement / MedicationDispense collapsed into one patient-legible current-medications
 * list, cross-source. A pure derivation over raw FHIR, ported rule-for-rule from the Go package:
 *
 *   - States come ONLY from explicit signals: status, or an explicit past end date. Absent means
 *     Unknown — shown, never assumed Active. For a medication list, a wrong "Active" is a
 *     clinical hazard, not a display bug.
 *   - Dedup is at the clinical-drug level: RxNorm code when present, else the EXACT normalized
 *     display text — never fuzzy, because under-merge is safe and wrong-merge is dangerous. A
 *     nameless resource keys to itself and is never merged blindly.
 *   - Field precedence: prescribed (Request) > self-reported (Statement) > dispense record.
 *   - CONFLICTS ARE SURFACED, NEVER SILENTLY RESOLVED: when sources disagree on state, the row is
 *     flagged, the badge follows the most recently DATED stated contributor (else the deterministic
 *     Active > Suspended > Past priority), and every contributor stays visible as evidence.
 */
import type { Resource } from '@medplum/fhirtypes';
import { conceptText } from '../conditions/index.js';
import type { Coding } from '../conditions/index.js';
import { medicationConcept, medicationDetails, type MedicationDetails, type Resolver } from './details.js';

export type { Resolver } from './details.js';

export const RXNORM = 'http://www.nlm.nih.gov/research/umls/rxnorm';

export type MedState = 'Active' | 'Suspended' | 'Past' | 'Unknown';

export interface MedInput {
  resource: Resource;
  sourceId: string;
  /**
   * Resolves the record's references (Medication, Practitioner, Organization, Condition) within
   * its own source. Optional: without it only contained resources and reference displays are used.
   */
  resolve?: Resolver;
}

/**
 * One record's evidence. Beyond the reconciler's own fields it carries what the record says about
 * frequency, sig, purpose, prescriber and strength — the legible line AND the FHIR behind it
 * (`dosageInstruction`, `reasons`, `prescriberReference`, `ingredients`, `medication`), codings
 * intact, every one omitted when the record is silent (src/medication/details.ts).
 */
export interface Contributor extends MedicationDetails {
  resourceType: string;
  id: string;
  sourceId: string;
  status: string;
  state: MedState | '';
  date: string;
  dose: string;
}

export interface ReconciledMedication {
  /**
   * The row's identity: the dedup key it was grouped under (`rxnorm:<code>`, `text:<name>` or
   * `self:<type>/<id>`). Unique within one answer by construction, and stable across calls for the
   * same records, so the page can key its expanded rows on it (yourphr#1025).
   */
  key: string;
  name: string;
  rxNormCode: string;
  state: MedState;
  /** True when stated contributor states disagree — surfaced, never resolved away. */
  stateConflict: boolean;
  dose: string;
  /** Distinct sources that said anything about this drug. */
  sourceIds: string[];
  contributors: Contributor[];
  /** Per-unit strength, e.g. "325 mg" — from Medication.ingredient, else read off the drug name. */
  strength?: string;
  /** Frequency in words, from Dosage.timing (code, else repeat) and asNeeded. */
  frequency?: string;
  /** Instructions: Dosage.text / patientInstruction, else the coded dose, route and frequency. */
  sig?: string;
  /** Why it is taken: reasonCode text, or the referenced Condition's name, or the reference display. */
  purpose?: string;
  /** Who prescribed it: requester (Request) / informationSource (Statement), resolved when possible. */
  prescriber?: string;
  /** Every coding (system, code, display) the contributors gave the drug — RxNorm, NDC, SNOMED — as recorded. */
  originalCodings?: Coding[];
  /** The FHIR behind `frequency`/`sig`, from the same contributor. */
  dosageInstruction?: MedicationDetails['dosageInstruction'];
  /** The FHIR behind `purpose`, from the same contributor. */
  reasons?: MedicationDetails['reasons'];
  /** The FHIR behind `prescriber`, from the same contributor. */
  prescriberReference?: MedicationDetails['prescriberReference'];
  /** The FHIR behind `strength` (Medication.ingredient), from the same contributor. */
  ingredients?: MedicationDetails['ingredients'];
}

type Raw = Record<string, any>;

function rxCode(cc: Raw | undefined): string {
  for (const coding of cc?.['coding'] ?? []) {
    if (coding?.system === RXNORM && coding?.code) return coding.code;
  }
  return '';
}

/** Explicit-status classification. Dispense/Medication carry no state signal ('' — not Unknown). */
function stateOf(resource: Raw): MedState | '' {
  const type = resource['resourceType'];
  if (type !== 'MedicationRequest' && type !== 'MedicationStatement') {
    return '';
  }
  switch ((resource['status'] ?? '').toLowerCase()) {
    case 'active': return 'Active';
    case 'on-hold': return 'Suspended';
    case 'completed': case 'stopped': case 'cancelled': case 'not-taken': return 'Past';
    default: {
      // An explicit PAST end date is an explicit signal (the one non-status source of Past).
      const end: string | undefined = resource['effectivePeriod']?.end ?? resource['dosageInstruction']?.[0]?.timing?.repeat?.boundsPeriod?.end;
      if (end && end < new Date().toISOString()) return 'Past';
      return 'Unknown';
    }
  }
}

function doseOf(resource: Raw): string {
  const dosage = resource['dosageInstruction']?.[0] ?? resource['dosage']?.[0];
  if (!dosage) return '';
  if (typeof dosage.text === 'string' && dosage.text !== '') return dosage.text;
  const q = dosage.doseAndRate?.[0]?.doseQuantity;
  return q?.value !== undefined ? `${q.value} ${q.unit ?? ''}`.trim() : '';
}

function dateOf(resource: Raw): string {
  return resource['authoredOn'] ?? resource['effectiveDateTime'] ?? resource['whenHandedOver'] ?? resource['dateAsserted'] ?? '';
}


const TYPE_PRECEDENCE: Record<string, number> = {
  MedicationRequest: 0,
  MedicationStatement: 1,
  MedicationDispense: 2,
  Medication: 3,
};

function dedupKey(name: string, code: string, fallbackId: string): string {
  if (code !== '') return `rxnorm:${code}`;
  const norm = name.toLowerCase().split(/\s+/).filter(Boolean).join(' ');
  if (norm !== '') return `text:${norm}`;
  return `self:${fallbackId}`; // nameless: never merged blindly
}

function resolveState(contributors: Contributor[]): { state: MedState; conflict: boolean } {
  const stated = contributors.filter((c) => c.state !== '' && c.state !== 'Unknown');
  const distinct = new Set(stated.map((c) => c.state));
  if (distinct.size === 0) return { state: 'Unknown', conflict: false };
  if (distinct.size === 1) return { state: stated[0]!.state as MedState, conflict: false };

  // Conflict: most recently DATED stated contributor drives the badge; undated falls back to the
  // deterministic priority. The flag is the point — the disagreement stays visible.
  const dated = stated.filter((c) => c.date !== '').sort((a, b) => b.date.localeCompare(a.date));
  if (dated.length > 0) return { state: dated[0]!.state as MedState, conflict: true };
  const priority: MedState[] = ['Active', 'Suspended', 'Past'];
  for (const p of priority) {
    if (distinct.has(p)) return { state: p, conflict: true };
  }
  return { state: 'Unknown', conflict: true };
}

export function reconcile(inputs: MedInput[]): ReconciledMedication[] {
  const groups = new Map<string, { key: string; name: string; code: string; contributors: Contributor[] }>();

  for (const input of inputs) {
    const raw = input.resource as Raw;
    if ((raw['status'] ?? '').toLowerCase() === 'entered-in-error') continue;
    const type = raw['resourceType'];
    if (!(type in TYPE_PRECEDENCE)) continue;

    const concept = medicationConcept(raw, input.resolve);
    const name = conceptText(concept) || '';
    const code = rxCode(concept);
    const key = dedupKey(name, code, `${type}/${raw['id']}`);

    let group = groups.get(key);
    if (!group) {
      group = { key, name: name || `Unnamed medication`, code, contributors: [] };
      groups.set(key, group);
    }
    if (group.name === 'Unnamed medication' && name !== '') group.name = name;
    if (group.code === '' && code !== '') group.code = code;
    group.contributors.push({
      resourceType: type,
      id: raw['id'] ?? '',
      sourceId: input.sourceId,
      status: raw['status'] ?? '',
      state: stateOf(raw),
      date: dateOf(raw),
      dose: doseOf(raw),
      ...medicationDetails(raw, input.resolve),
    });
  }

  const rows: ReconciledMedication[] = [];
  for (const group of groups.values()) {
    const ordered = [...group.contributors].sort(
      (a, b) => (TYPE_PRECEDENCE[a.resourceType] ?? 9) - (TYPE_PRECEDENCE[b.resourceType] ?? 9)
    );
    const { state, conflict } = resolveState(ordered);
    const dose = ordered.map((c) => c.dose).find((d) => d !== '') ?? '';
    // Each detail follows the same precedence as dose — the first contributor that states it — and
    // its FHIR comes from that same contributor, so the line and the codes never disagree.
    const first = (has: (c: Contributor) => unknown): Contributor | undefined => ordered.find((c) => has(c));
    const byDosage = first((c) => c.frequency || c.sig);
    const byReason = first((c) => c.purpose);
    const byPrescriber = first((c) => c.prescriber);
    const byStrength = first((c) => c.strength);
    const codings = new Map<string, Coding>();
    for (const c of ordered) {
      for (const coding of c.medication?.coding ?? []) {
        const k = `${coding.system ?? ''}|${coding.code ?? ''}|${coding.code ? '' : coding.display ?? ''}`;
        if (!codings.has(k)) codings.set(k, coding);
      }
    }
    rows.push({
      key: group.key,
      name: group.name,
      rxNormCode: group.code,
      state,
      stateConflict: conflict,
      dose,
      sourceIds: [...new Set(ordered.map((c) => c.sourceId).filter(Boolean))],
      contributors: ordered,
      ...(byStrength?.strength ? { strength: byStrength.strength } : {}),
      ...(byDosage?.frequency ? { frequency: byDosage.frequency } : {}),
      ...(byDosage?.sig ? { sig: byDosage.sig } : {}),
      ...(byReason?.purpose ? { purpose: byReason.purpose } : {}),
      ...(byPrescriber?.prescriber ? { prescriber: byPrescriber.prescriber } : {}),
      ...(codings.size ? { originalCodings: [...codings.values()] } : {}),
      ...(byDosage?.dosageInstruction ? { dosageInstruction: byDosage.dosageInstruction } : {}),
      ...(byReason?.reasons ? { reasons: byReason.reasons } : {}),
      ...(byPrescriber?.prescriberReference ? { prescriberReference: byPrescriber.prescriberReference } : {}),
      ...(byStrength?.ingredients ? { ingredients: byStrength.ingredients } : {}),
    });
  }

  // Deterministic, patient-first order: Active, conflicts next (they need attention), then the rest;
  // alphabetical inside each band.
  const band = (r: ReconciledMedication) => (r.state === 'Active' ? 0 : r.stateConflict ? 1 : r.state === 'Suspended' ? 2 : r.state === 'Unknown' ? 3 : 4);
  rows.sort((a, b) => band(a) - band(b) || a.name.localeCompare(b.name));
  return rows;
}

/** A contributor as the medications page reads it: `sourceResourceId` is the record's id. */
export interface WireContributor extends Contributor {
  sourceResourceId: string;
}

/**
 * The shape GET /api/secure/medications/reconciled sends (yourphr#1025).
 *
 * The Angular page was written against the Go contract (`frontend/src/app/models/fasten/
 * reconciled-medication.ts`): it reads `key`, `title`, `lastActivity` and
 * `contributors[].sourceResourceId`, none of which the TypeScript reconciler produced, so every name
 * was blank, one click expanded every row, and the last-activity sort did nothing. This is the ONE
 * place the two are reconciled. It is additive: `name`, `sourceIds` and `contributors[].id` stay,
 * because agents and the MCP server read the same route.
 *
 * `strength`, `frequency`, `sig`, `purpose`, `prescriber` and `originalCodings` come from the FHIR
 * (src/medication/details.ts), each with its coded companion (`ingredients`, `dosageInstruction`,
 * `reasons`, `prescriberReference`) and each omitted when the records are silent. Still absent, with
 * no source here: `patientDisplay` (RxTerms) and `provenance`; the page falls back
 * (`patientDisplay || title`, `'—'`).
 */
export interface WireMedication extends Omit<ReconciledMedication, 'contributors'> {
  title: string;
  /** The latest contributor date, as the record wrote it; absent when no contributor is dated. */
  lastActivity?: string;
  contributors: WireContributor[];
}

export function toWireMedication(med: ReconciledMedication): WireMedication {
  let lastActivity: string | undefined;
  let latest = -Infinity;
  for (const c of med.contributors) {
    const t = c.date ? Date.parse(c.date) : NaN;
    if (!Number.isNaN(t) && t > latest) {
      latest = t;
      lastActivity = c.date;
    }
  }
  return {
    ...med,
    title: med.name,
    ...(lastActivity !== undefined ? { lastActivity } : {}),
    contributors: med.contributors.map((c) => ({ ...c, sourceResourceId: c.id })),
  };
}
