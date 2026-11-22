/**
 * The medication details the Go contract carried and the TypeScript reconciler did not (yourphr#1025
 * follow-up): frequency, instructions (sig), purpose, prescriber and strength — each as a
 * patient-legible string for the page AND as the FHIR it came from, codings intact.
 *
 * Rules, the same ones the reconciler keeps:
 *   - Only what the record says. A string is built from coded data or copied from text; a code is
 *     never invented, a UCUM system or code is never added to a Quantity that lacked one, and a
 *     missing value is OMITTED (never `null`, never a placeholder).
 *   - References resolve only through the `Resolver` the caller supplies (contained resources are
 *     resolved here). An unresolved reference falls back to its own `display`, else to nothing.
 *   - FHIR R4 first, with the R5 shapes accepted where they differ (`medication` CodeableReference,
 *     `reason[]`, `ingredient.item`, `strength[x]`, `asNeeded`/`asNeededFor`).
 */
import { conceptText, type Coding } from '../conditions/index.js';
import { displayName } from '../app/managers/identity.js';

type Raw = Record<string, any>;

export const UCUM = 'http://unitsofmeasure.org';
export const GTS_ABBREVIATION = 'http://terminology.hl7.org/CodeSystem/v3-GTSAbbreviation';
export const US_NPI = 'http://hl7.org/fhir/sid/us-npi';

/** Looks up a resource by a relative reference (`Type/id`) for the record's own source. */
export type Resolver = (reference: string) => Raw | undefined;

export interface CodeableConcept {
  text?: string;
  coding?: Coding[];
}

export interface Quantity {
  value?: number;
  comparator?: string;
  unit?: string;
  system?: string;
  code?: string;
}

export interface Ratio {
  numerator?: Quantity;
  denominator?: Quantity;
}

export interface WireReference {
  /** The literal reference as written (`Practitioner/p1`, `#med1`), when there is one. */
  reference?: string;
  /** The referenced resource type, from the resolved resource or the reference itself. */
  type?: string;
  display?: string;
  /** Standard identifiers of the resolved resource (NPI), system and value as recorded. */
  identifier?: { system: string; value: string }[];
}

export interface WireTiming {
  code?: CodeableConcept;
  /** Timing.repeat, the structured fields copied as recorded. */
  repeat?: Raw;
  event?: string[];
}

export interface WireDoseAndRate {
  type?: CodeableConcept;
  doseQuantity?: Quantity;
  doseRange?: { low?: Quantity; high?: Quantity };
  rateQuantity?: Quantity;
  rateRatio?: Ratio;
  rateRange?: { low?: Quantity; high?: Quantity };
}

export interface WireDosage {
  sequence?: number;
  text?: string;
  patientInstruction?: string;
  additionalInstruction?: CodeableConcept[];
  timing?: WireTiming;
  asNeeded?: boolean;
  asNeededFor?: CodeableConcept[];
  site?: CodeableConcept;
  route?: CodeableConcept;
  method?: CodeableConcept;
  doseAndRate?: WireDoseAndRate[];
  /** The frequency this one instruction reads as ('' parts omitted). */
  frequency?: string;
}

export interface WireIngredient {
  item?: CodeableConcept;
  itemReference?: WireReference;
  isActive?: boolean;
  strengthRatio?: Ratio;
  strengthQuantity?: Quantity;
  strengthCodeableConcept?: CodeableConcept;
  /** The strength as one line, e.g. "325 mg" or "250 mg/5 mL". */
  strength?: string;
}

export interface WireReason {
  concept?: CodeableConcept;
  reference?: WireReference;
}

/** Everything one resource says about the five details, legible and coded. */
export interface MedicationDetails {
  medication?: CodeableConcept;
  medicationReference?: WireReference;
  frequency?: string;
  sig?: string;
  dosageInstruction?: WireDosage[];
  purpose?: string;
  reasons?: WireReason[];
  prescriber?: string;
  prescriberReference?: WireReference;
  strength?: string;
  ingredients?: WireIngredient[];
}

// ---- FHIR datatypes, copied faithfully ----------------------------------------------------------

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** The object without its undefined / empty-array members; undefined when nothing is left. */
function prune<T = any>(o: object): T | undefined {
  const out = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0)));
  return Object.keys(out).length ? (out as T) : undefined;
}

export function toCoding(c: Raw | undefined): Coding | undefined {
  if (!c || typeof c !== 'object') return undefined;
  return prune({ system: str(c['system']), code: str(c['code']), display: str(c['display']) }) as Coding | undefined;
}

/** A CodeableConcept with text and every coding (system, code, display) as recorded. */
export function toConcept(cc: Raw | undefined): CodeableConcept | undefined {
  if (!cc || typeof cc !== 'object') return undefined;
  const coding = ((cc['coding'] ?? []) as Raw[]).map(toCoding).filter((c): c is Coding => c !== undefined);
  return prune({ text: str(cc['text']), coding });
}

export function toQuantity(q: Raw | undefined): Quantity | undefined {
  if (!q || typeof q !== 'object') return undefined;
  return prune({ value: num(q['value']), comparator: str(q['comparator']), unit: str(q['unit']), system: str(q['system']), code: str(q['code']) });
}

function toRange(r: Raw | undefined): { low?: Quantity; high?: Quantity } | undefined {
  if (!r || typeof r !== 'object') return undefined;
  return prune({ low: toQuantity(r['low']), high: toQuantity(r['high']) });
}

export function toRatio(r: Raw | undefined): Ratio | undefined {
  if (!r || typeof r !== 'object') return undefined;
  return prune({ numerator: toQuantity(r['numerator']), denominator: toQuantity(r['denominator']) });
}

/** "325 mg" — the value with the unit as written, else the code; nothing when there is no value. */
export function quantityText(q: Quantity | undefined): string {
  if (!q || q.value === undefined) return '';
  return [q.comparator ?? '', String(q.value), ' ', q.unit ?? q.code ?? ''].join('').trim();
}

/**
 * A strength ratio as one line. A per-unit denominator of 1 that is a dose form (a TAB, a UCUM
 * annotation like `{tbl}`, or the unity `1`) is dropped — "325 mg", not "325 mg/1 TAB"; a measured
 * denominator stays — "5 mg/mL", "250 mg/5 mL".
 */
export function ratioText(r: Ratio | undefined): string {
  const n = quantityText(r?.numerator);
  if (n === '') return '';
  const d = r?.denominator;
  if (!d || d.value === undefined) return n;
  const unit = d.unit ?? d.code ?? '';
  const measured = d.system === UCUM && d.code !== undefined && d.code !== '1' && !d.code.startsWith('{');
  if (d.value === 1) return measured && unit ? `${n}/${unit}` : n;
  return `${n}/${quantityText(d)}`;
}

// ---- references -------------------------------------------------------------------------------

function referenceType(ref: string | undefined): string | undefined {
  if (!ref || ref.startsWith('#')) return undefined;
  const parts = ref.split('?')[0]!.split('/').filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : undefined;
}

/** A relative `Type/id` for a reference (absolute URLs and `_history` trimmed), or undefined. */
export function relativeReference(ref: string | undefined): string | undefined {
  if (!ref || ref.startsWith('#')) return undefined;
  const parts = ref.split('?')[0]!.split('/').filter(Boolean);
  const h = parts.indexOf('_history');
  const usable = h >= 0 ? parts.slice(0, h) : parts;
  if (usable.length < 2) return undefined;
  const [type, id] = usable.slice(-2);
  return /^[A-Z][A-Za-z]+$/.test(type!) ? `${type}/${id}` : undefined;
}

function resolveRef(resource: Raw, ref: Raw | undefined, resolve: Resolver | undefined): Raw | undefined {
  const literal = str(ref?.['reference']);
  if (!literal) return undefined;
  if (literal.startsWith('#')) {
    const id = literal.slice(1);
    return ((resource['contained'] ?? []) as Raw[]).find((c) => c?.id === id);
  }
  const rel = relativeReference(literal);
  return rel && resolve ? resolve(rel) : undefined;
}

/** The name a resolved Practitioner / Organization / PractitionerRole / Condition goes by. */
function resourceName(target: Raw | undefined): string {
  if (!target) return '';
  switch (target['resourceType']) {
    case 'Practitioner': case 'Patient': case 'RelatedPerson': return displayName(target);
    case 'Organization': return str(target['name']) ?? '';
    case 'PractitionerRole':
      return str(target['practitioner']?.['display']) ?? str(target['organization']?.['display']) ?? conceptText(target['code']?.[0]);
    case 'Condition': case 'Observation': case 'Procedure': return conceptText(target['code']);
    case 'Medication': return conceptText(target['code']);
    default: return '';
  }
}

function toReference(ref: Raw | undefined, target: Raw | undefined, name: string): WireReference | undefined {
  if (!ref && !target) return undefined;
  const literal = str(ref?.['reference']);
  const identifier = ((target?.['identifier'] ?? []) as Raw[])
    .filter((i) => i?.system === US_NPI && str(i?.value))
    .map((i) => ({ system: US_NPI, value: String(i.value) }));
  return prune({
    reference: literal,
    type: str(target?.['resourceType']) ?? str(ref?.['type']) ?? referenceType(literal),
    display: str(name) ?? str(ref?.['display']),
    identifier,
  });
}

// ---- dosage: frequency and sig ------------------------------------------------------------------

const UNIT_WORDS: Record<string, string> = { s: 'second', min: 'minute', h: 'hour', d: 'day', wk: 'week', mo: 'month', a: 'year' };
const WHEN_WORDS: Record<string, string> = {
  MORN: 'in the morning', 'MORN.early': 'early in the morning', 'MORN.late': 'late in the morning',
  NOON: 'at noon', AFT: 'in the afternoon', 'AFT.early': 'early in the afternoon', 'AFT.late': 'late in the afternoon',
  EVE: 'in the evening', 'EVE.early': 'early in the evening', 'EVE.late': 'late in the evening',
  NIGHT: 'at night', PHS: 'after sleep', HS: 'at bedtime', WAKE: 'on waking',
  C: 'with meals', CM: 'with breakfast', CD: 'with lunch', CV: 'with dinner',
  AC: 'before meals', ACM: 'before breakfast', ACD: 'before lunch', ACV: 'before dinner',
  PC: 'after meals', PCM: 'after breakfast', PCD: 'after lunch', PCV: 'after dinner',
};
const DAY_WORDS: Record<string, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

const plural = (word: string, n: number): string => (n === 1 ? word : `${word}s`);

/** Timing.repeat as words: "twice a day", "every 4-6 hours", "once a week at bedtime". */
export function repeatText(repeat: Raw | undefined): string {
  if (!repeat || typeof repeat !== 'object') return '';
  const parts: string[] = [];
  const f = num(repeat['frequency']);
  const fMax = num(repeat['frequencyMax']);
  const p = num(repeat['period']);
  const pMax = num(repeat['periodMax']);
  const unit = UNIT_WORDS[str(repeat['periodUnit']) ?? ''];
  if (unit && p !== undefined) {
    const freq = f ?? 1;
    const times = fMax !== undefined && fMax !== freq
      ? `${freq}-${fMax} times`
      : freq === 1 ? 'once' : freq === 2 ? 'twice' : `${freq} times`;
    if (p === 1 && pMax === undefined) parts.push(`${times} a ${unit}`);
    else if (freq === 1 && fMax === undefined) parts.push(`every ${pMax !== undefined ? `${p}-${pMax}` : p} ${plural(unit, pMax ?? p)}`);
    else parts.push(`${times} every ${pMax !== undefined ? `${p}-${pMax}` : p} ${plural(unit, pMax ?? p)}`);
  }
  const days = ((repeat['dayOfWeek'] ?? []) as unknown[]).map((d) => DAY_WORDS[String(d)] ?? String(d));
  if (days.length) parts.push(`on ${days.join(', ')}`);
  const when = ((repeat['when'] ?? []) as unknown[]).map((w) => WHEN_WORDS[String(w)] ?? String(w));
  if (when.length) parts.push(when.join(', '));
  const tod = ((repeat['timeOfDay'] ?? []) as unknown[]).map((t) => String(t).slice(0, 5));
  if (tod.length) parts.push(`at ${tod.join(', ')}`);
  return parts.join(' ');
}

const REPEAT_KEYS = ['boundsDuration', 'boundsRange', 'boundsPeriod', 'count', 'countMax', 'duration', 'durationMax', 'durationUnit',
  'frequency', 'frequencyMax', 'period', 'periodMax', 'periodUnit', 'dayOfWeek', 'timeOfDay', 'when', 'offset'];

function toTiming(t: Raw | undefined): WireTiming | undefined {
  if (!t || typeof t !== 'object') return undefined;
  const r = t['repeat'];
  const repeat = r && typeof r === 'object'
    ? prune(Object.fromEntries(REPEAT_KEYS.filter((k) => r[k] !== undefined).map((k) => [k, r[k]])))
    : undefined;
  const event = ((t['event'] ?? []) as unknown[]).filter((e): e is string => typeof e === 'string');
  return prune({ code: toConcept(t['code']), repeat, event });
}

function asNeededOf(d: Raw): { asNeeded?: boolean; asNeededFor?: CodeableConcept[] } {
  const asNeededFor = [d['asNeededCodeableConcept'], ...((d['asNeededFor'] ?? []) as Raw[])].map(toConcept).filter((c): c is CodeableConcept => !!c);
  const flag = typeof d['asNeededBoolean'] === 'boolean' ? d['asNeededBoolean'] : typeof d['asNeeded'] === 'boolean' ? d['asNeeded'] : undefined;
  return { asNeeded: flag ?? (asNeededFor.length ? true : undefined), asNeededFor };
}

/** One Dosage's frequency in words: timing.code first (its text/display), else timing.repeat. */
function dosageFrequency(d: Raw, timing: WireTiming | undefined): string {
  const fromCode = conceptText(d['timing']?.['code']);
  const base = fromCode !== '' ? fromCode : repeatText(timing?.repeat);
  const { asNeeded, asNeededFor } = asNeededOf(d);
  const prn = asNeeded ? (asNeededFor?.length ? `as needed for ${asNeededFor.map((c) => conceptText(c as Raw)).filter(Boolean).join(', ')}` : 'as needed') : '';
  return [base, prn].filter(Boolean).join(', ');
}

function toDosage(d: Raw): WireDosage | undefined {
  if (!d || typeof d !== 'object') return undefined;
  const timing = toTiming(d['timing']);
  const doseAndRate = ((d['doseAndRate'] ?? []) as Raw[]).map((dr) => prune<WireDoseAndRate>({
    type: toConcept(dr?.['type']),
    doseQuantity: toQuantity(dr?.['doseQuantity']),
    doseRange: toRange(dr?.['doseRange']),
    rateQuantity: toQuantity(dr?.['rateQuantity']),
    rateRatio: toRatio(dr?.['rateRatio']),
    rateRange: toRange(dr?.['rateRange']),
  })).filter((x): x is WireDoseAndRate => x !== undefined);
  const { asNeeded, asNeededFor } = asNeededOf(d);
  return prune({
    sequence: num(d['sequence']),
    text: str(d['text']),
    patientInstruction: str(d['patientInstruction']),
    additionalInstruction: ((d['additionalInstruction'] ?? []) as Raw[]).map(toConcept).filter((c): c is CodeableConcept => !!c),
    timing,
    asNeeded,
    asNeededFor,
    site: toConcept(d['site']),
    route: toConcept(d['route']),
    method: toConcept(d['method']),
    doseAndRate,
    frequency: str(dosageFrequency(d, timing)),
  });
}

function doseText(d: WireDosage): string {
  const dr = d.doseAndRate?.[0];
  if (dr?.doseQuantity) return quantityText(dr.doseQuantity);
  if (dr?.doseRange) {
    const lo = quantityText(dr.doseRange.low);
    const hi = quantityText(dr.doseRange.high);
    return lo && hi ? `${lo} to ${hi}` : lo || hi;
  }
  return '';
}

/**
 * One Dosage's instructions: the prescriber's `text`, then the `patientInstruction` when it adds
 * something; with neither, the coded parts read back in order (dose, route, frequency) — nothing
 * added that the record did not state.
 */
function dosageSig(d: WireDosage): string {
  const said = [d.text, d.patientInstruction].filter((s): s is string => !!s);
  if (said.length) return [...new Set(said)].join('. ');
  const route = d.route ? conceptText(d.route as Raw) : '';
  return [doseText(d), route, d.frequency ?? ''].filter(Boolean).join(' ');
}

const joinDistinct = (xs: string[], sep: string): string => [...new Set(xs.filter((x) => x !== ''))].join(sep);

// ---- strength -----------------------------------------------------------------------------------

function toIngredient(ing: Raw, owner: Raw, resolve: Resolver | undefined): WireIngredient | undefined {
  if (!ing || typeof ing !== 'object') return undefined;
  // R4 item[x]; R5 item is a CodeableReference.
  const itemConcept = ing['itemCodeableConcept'] ?? ing['item']?.['concept'];
  const itemRef = ing['itemReference'] ?? ing['item']?.['reference'];
  const itemTarget = itemRef ? resolveRef(owner, itemRef, resolve) : undefined;
  const strengthRatio = toRatio(ing['strength'] ?? ing['strengthRatio']);
  const strengthQuantity = toQuantity(ing['strengthQuantity']);
  const strengthCodeableConcept = toConcept(ing['strengthCodeableConcept']);
  const strength = ratioText(strengthRatio) || quantityText(strengthQuantity) || (strengthCodeableConcept ? conceptText(strengthCodeableConcept as Raw) : '');
  return prune({
    item: toConcept(itemConcept) ?? toConcept(itemTarget?.['code']),
    itemReference: itemRef ? toReference(itemRef, itemTarget, resourceName(itemTarget)) : undefined,
    isActive: typeof ing['isActive'] === 'boolean' ? ing['isActive'] : undefined,
    strengthRatio,
    strengthQuantity,
    strengthCodeableConcept,
    strength: str(strength),
  });
}

/**
 * Strength read off an RxNorm-style clinical drug name ("Lisinopril 10 MG Oral Tablet",
 * "Amoxicillin 250 MG/5ML Oral Suspension") — the last resort when no Medication.ingredient states
 * one. Text only; no Quantity or code is built from it.
 */
export function strengthFromName(name: string): string {
  const re = /(\d+(?:\.\d+)?)\s*(MG|MCG|G|ML|UNT|UNITS?|MEQ|MMOL|IU|%)\b(?:\s*\/\s*(\d+(?:\.\d+)?)?\s*(ML|L|HR|ACTUAT|MG|G)\b)?/gi;
  const found: string[] = [];
  for (const m of name.matchAll(re)) {
    const unit = m[2]!.toLowerCase() === 'ml' ? 'mL' : m[2]!.toLowerCase();
    let s = `${m[1]} ${unit}`;
    if (m[4]) {
      const dUnit = m[4].toLowerCase() === 'ml' ? 'mL' : m[4].toLowerCase();
      s += m[3] ? `/${m[3]} ${dUnit}` : `/${dUnit}`;
    }
    found.push(s);
  }
  return found.join(' / ');
}

// ---- the one entry point ------------------------------------------------------------------------

/** The Medication a MedicationRequest/Statement/Dispense names, contained or referenced, if resolvable. */
function medicationOf(resource: Raw, resolve: Resolver | undefined): { ref?: Raw; target?: Raw } {
  const ref = resource['medicationReference'] ?? resource['medication']?.['reference'];
  if (!ref) return {};
  return { ref, target: resolveRef(resource, ref, resolve) };
}

/**
 * The concept naming the drug: the resource's own medicationCodeableConcept (R5 `medication.concept`),
 * else the resolved Medication's `code`, else the reference's display as text-only.
 */
export function medicationConcept(resource: Raw, resolve?: Resolver): Raw | undefined {
  const own = resource['medicationCodeableConcept'] ?? resource['medication']?.['concept'];
  if (own) return own;
  const { ref, target } = medicationOf(resource, resolve);
  if (target?.['code']) return target['code'];
  const display = str(ref?.['display']);
  return display ? { text: display } : undefined;
}

export function medicationDetails(resource: Raw, resolve?: Resolver): MedicationDetails {
  const type = resource['resourceType'];

  // frequency + sig — dosageInstruction (Request, Dispense) or dosage (Statement), every entry.
  const dosages = ((resource['dosageInstruction'] ?? resource['dosage'] ?? []) as Raw[])
    .map(toDosage).filter((d): d is WireDosage => d !== undefined);
  const frequency = joinDistinct(dosages.map((d) => d.frequency ?? ''), '; ');
  const sig = joinDistinct(dosages.map(dosageSig), '; ');

  // purpose — reasonCode / reasonReference (R4), reason[] CodeableReference (R5).
  const reasons: WireReason[] = [];
  for (const cc of (resource['reasonCode'] ?? []) as Raw[]) {
    const concept = toConcept(cc);
    if (concept) reasons.push({ concept });
  }
  const reasonRefs: Raw[] = [...((resource['reasonReference'] ?? []) as Raw[])];
  for (const r of (resource['reason'] ?? []) as Raw[]) {
    const concept = toConcept(r?.['concept']);
    if (concept) reasons.push({ concept });
    if (r?.['reference']) reasonRefs.push(r['reference']);
  }
  for (const ref of reasonRefs) {
    const target = resolveRef(resource, ref, resolve);
    const reason = prune({ concept: toConcept(target?.['code']), reference: toReference(ref, target, resourceName(target)) });
    if (reason) reasons.push(reason);
  }
  const purpose = joinDistinct(reasons.map((r) => (r.concept ? conceptText(r.concept as Raw) : '') || r.reference?.display || ''), '; ');

  // prescriber — requester (Request) / informationSource (Statement). A Patient or RelatedPerson
  // reporting their own medication is not a prescriber, so those are left out.
  let prescriberRef: Raw | undefined;
  if (type === 'MedicationRequest') prescriberRef = resource['requester'];
  else if (type === 'MedicationStatement') {
    const src = resource['informationSource'];
    prescriberRef = Array.isArray(src) ? src[0] : src;
  }
  let prescriber = '';
  let prescriberReference: WireReference | undefined;
  if (prescriberRef) {
    const target = resolveRef(resource, prescriberRef, resolve);
    const kind = str(target?.['resourceType']) ?? str(prescriberRef['type']) ?? referenceType(str(prescriberRef['reference']));
    if (kind !== 'Patient' && kind !== 'RelatedPerson') {
      prescriberReference = toReference(prescriberRef, target, resourceName(target));
      prescriber = prescriberReference?.display ?? '';
    }
  }

  // strength — Medication.ingredient[].strength (R4 Ratio; R5 strength[x]), contained or referenced;
  // last resort the drug's name.
  const { ref: medRef, target: medTarget } = medicationOf(resource, resolve);
  const ingredients = ((medTarget?.['ingredient'] ?? []) as Raw[])
    .map((ing) => toIngredient(ing, medTarget!, resolve))
    .filter((i): i is WireIngredient => i !== undefined);
  const concept = medicationConcept(resource, resolve);
  const active = ingredients.filter((i) => i.isActive !== false);
  const strength = joinDistinct(active.map((i) => i.strength ?? ''), ' / ') || strengthFromName(conceptText(concept));

  return prune({
    medication: toConcept(concept),
    medicationReference: medRef ? toReference(medRef, medTarget, resourceName(medTarget)) : undefined,
    frequency: str(frequency),
    sig: str(sig),
    dosageInstruction: dosages,
    purpose: str(purpose),
    reasons,
    prescriber: str(prescriber),
    prescriberReference,
    strength: str(strength),
    ingredients,
  }) ?? {};
}

/** Every relative reference a medication record may need resolved — what the caller prefetches. */
export function referencesToResolve(resource: Raw): string[] {
  const refs: (Raw | undefined)[] = [
    resource['medicationReference'], resource['medication']?.['reference'],
    resource['requester'],
    ...(Array.isArray(resource['informationSource']) ? resource['informationSource'] : [resource['informationSource']]),
    ...((resource['reasonReference'] ?? []) as Raw[]),
    ...((resource['reason'] ?? []) as Raw[]).map((r) => r?.['reference']),
  ];
  return [...new Set(refs.map((r) => relativeReference(str(r?.['reference']))).filter((r): r is string => !!r))];
}
