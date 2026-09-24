/**
 * Which source identities are the same person, and on what evidence (yourphr#761).
 *
 * YourPHR holds one `Patient` per connected source, because that is what each provider sent.
 * Identity is LOCAL: Epic's `Patient/123` and a clinic's `Patient/456` are different resources, and
 * nothing in the base spec says they are the same human. Sameness is __asserted__, never inferred.
 *
 * Who does the asserting matters. A hospital MPI matches on demographics because that is all it
 * has; a PHR has something stronger — the account holder __authenticated__ to the portal, and the
 * SMART token named the Patient it was issued for. That is evidence a hospital cannot get. It is
 * still not proof of sameness, because portals grant __proxy__ access: a parent signs in to their
 * own account and reads a child's record. The token proves they may read that record, not that they
 * are the person in it.
 *
 * So the person is asked once per source — and the answer is prefilled from the evidence, so the
 * common case is a confirmation rather than a decision. Nothing about their chart changes until
 * they answer.
 *
 * The assertion is recorded as a __Provenance__ about that source's Patient: who said it (the
 * person), when, and in words, what it rested on. Provenance carries a negative as naturally as a
 * positive, which `Linkage` cannot — see the notes on #761 for why no Linkage is written.
 */

/** This instance's code system for an identity assertion the account holder made. */
export const IDENTITY_ASSERTION = 'https://yourphr.org/fhir/CodeSystem/identity-assertion';

/** What the person answered about one source's Patient. */
export type IdentityAnswer = 'self' | 'not-self';

export interface PatientDemographics {
  name: string;
  birthDate: string;
  gender: string;
}

export interface SourceIdentity {
  sourceId: string;
  display: string;
  /** The Patient that source sent, as it arrived. Empty when it sent none. */
  patientId: string;
  demographics: PatientDemographics;
  /** 'self', 'not-self', or '' when nobody has answered yet. */
  answer: IdentityAnswer | '';
  /** What the answer would be, offered as the preselected one. '' when the evidence says nothing. */
  suggested: IdentityAnswer | '';
  /** What is known, in the person's words — shown beside the question. */
  evidence: string[];
  /** Disagreements worth a person's attention. Never resolved here, only surfaced. */
  conflicts: string[];
}

/** The name a Patient states, as one line. Only what the record says — no initials invented. */
export function displayName(patient: unknown): string {
  const names = (patient as { name?: { text?: string; family?: string; given?: string[] }[] })?.name ?? [];
  for (const n of names) {
    if (n.text) return n.text.trim();
    const joined = [...(n.given ?? []), n.family ?? ''].filter(Boolean).join(' ').trim();
    if (joined !== '') return joined;
  }
  return '';
}

export function demographicsOf(patient: unknown): PatientDemographics {
  const p = (patient ?? {}) as { birthDate?: string; gender?: string };
  return { name: displayName(patient), birthDate: (p.birthDate ?? '').trim(), gender: (p.gender ?? '').trim() };
}

/** Two demographics agree on a field only when both state it and they match. */
const differs = (a: string, b: string): boolean => a !== '' && b !== '' && a.toLowerCase() !== b.toLowerCase();

/**
 * What the record itself says about this source identity, in the person's words.
 *
 * `authenticated` means the connection was made by signing in to that portal and the token named
 * this Patient. It is the strongest signal available here and still not proof — hence the question.
 */
export function evidenceFor(input: {
  display: string;
  authenticated: boolean;
  uploaded: boolean;
  demographics: PatientDemographics;
  others: { display: string; demographics: PatientDemographics }[];
}): { evidence: string[]; suggested: IdentityAnswer | ''; conflicts: string[] } {
  const evidence: string[] = [];
  const conflicts: string[] = [];

  if (input.authenticated) {
    evidence.push(`You signed in to ${input.display} yourself, and the connection was issued for this record.`);
  } else if (input.uploaded) {
    evidence.push(`This came from a file you uploaded. A file says nothing about whose record it is, so nobody has checked.`);
  } else {
    evidence.push(`Nothing is known about how this record reached ${input.display}.`);
  }

  const stated = [
    input.demographics.name !== '' ? input.demographics.name : '',
    input.demographics.birthDate !== '' ? `born ${input.demographics.birthDate}` : '',
  ].filter(Boolean).join(', ');
  if (stated !== '') evidence.push(`${input.display} has this record as ${stated}.`);

  // Corroboration, and only that: matching demographics never make an identity, and differing ones
  // never settle it either — people change names, and portals hold old ones.
  for (const other of input.others) {
    const d = other.demographics;
    if (differs(d.birthDate, input.demographics.birthDate)) {
      conflicts.push(`${other.display} has a different date of birth (${d.birthDate}) from ${input.display} (${input.demographics.birthDate}).`);
    }
    if (differs(d.gender, input.demographics.gender)) {
      conflicts.push(`${other.display} states a different sex (${d.gender}) from ${input.display} (${input.demographics.gender}).`);
    }
    if (differs(d.name, input.demographics.name)) {
      conflicts.push(`${other.display} has this person as ${d.name}, and ${input.display} as ${input.demographics.name}.`);
    }
  }

  // Prefilled, never decided: an authenticated connection is offered as "this is me" for the person
  // to confirm. Anything weaker is offered as nothing at all.
  return { evidence, suggested: input.authenticated ? 'self' : '', conflicts };
}

/**
 * The same identifier VALUE issued under two different systems, across the identities the person
 * has confirmed as themselves (yourphr#761).
 *
 * An MRN is exclusive to the organisation that issued it, so the same number under two systems is
 * either a coincidence or a mistake — and which one it is is not for this instance to decide.
 */
export function identifierConflicts(
  identities: { display: string; identifiers: { system: string; value: string }[] }[],
): string[] {
  const byValue = new Map<string, { display: string; system: string }[]>();
  for (const identity of identities) {
    for (const { system, value } of identity.identifiers) {
      if (system === '' || value === '') continue;
      byValue.set(value, [...(byValue.get(value) ?? []), { display: identity.display, system }]);
    }
  }
  const out: string[] = [];
  for (const [value, held] of byValue) {
    const systems = new Set(held.map((h) => h.system));
    if (systems.size > 1) {
      out.push(`The number ${value} appears under ${systems.size} different issuing systems (${held.map((h) => h.display).join(', ')}). A medical record number belongs to the organisation that issued it, so this is worth a look.`);
    }
  }
  return out.sort();
}
