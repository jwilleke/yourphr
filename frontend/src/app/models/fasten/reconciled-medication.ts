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

export interface ReconciledMedication {
  key: string;
  title: string;
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
}
