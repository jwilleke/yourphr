// Mirrors the backend pkg/medication.ReconciledMedication contract returned by
// GET /api/secure/medications/reconciled. Hand-maintained (this endpoint is not tygo-exported).

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
  patientDisplay?: string;     // RxTerms patient-friendly name (#387); falls back to title when absent
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
