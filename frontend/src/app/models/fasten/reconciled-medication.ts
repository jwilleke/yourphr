// The contract returned by GET /api/secure/medications/reconciled. The server maps its reconciled
// rows to this shape in ONE place, toWireMedication() in src/medication/index.ts (yourphr#1025);
// change the two together. Hand-maintained. Fields marked optional that the server has no source for
// (patientDisplay, strength, frequency, sig, purpose, prescriber, provenance, originalCodings) are
// absent today and the page falls back for each.

export interface MedicationCoding {
  system?: string;
  code?: string;
  display?: string;
}

export interface MedicationContributor {
  resourceType: string;
  sourceResourceId: string;
  status?: string;   // raw FHIR status
  state?: string;    // classified state (empty if the type carries no state signal)
  date?: string;
  dose?: string;
  frequency?: string;
  sig?: string;
}

// "Who said this" — the resolved provenance for the row (backend pkg/provenance.Provenance).
// `display` is always a complete human label: a clinician/organization name, "Self-reported"
// (Patient-asserted), or the honest floor "Source: <name>". Never a fabricated author.
export interface MedicationProvenance {
  kind: string;     // practitioner | self-reported | organization | provenance | source
  display: string;
  level: number;    // ladder rung the answer came from (1 strongest)
}

export interface ReconciledMedication {
  key: string;
  title: string;               // raw RxNorm name (clinical)
  patientDisplay?: string;     // RxTerms patient-friendly NAME (#387); falls back to title when absent
  strength?: string;           // RxTerms per-unit strength, e.g. "325 mg" (#387) — its own column, not the dose
  rxNormCode?: string;
  state: string;            // Active | Suspended | Past | Unknown
  stateConflict?: boolean;
  dose?: string;
  frequency?: string;
  sig?: string;
  purpose?: string;
  prescriber?: string;
  lastActivity?: string;
  originalCodings?: MedicationCoding[];
  contributors?: MedicationContributor[];
  provenance?: MedicationProvenance;   // "who said this" — nil when no resolver ran
}
