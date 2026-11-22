// The contract returned by GET /api/secure/medications/reconciled. The server maps its reconciled
// rows to this shape in ONE place, toWireMedication() in src/medication/index.ts (yourphr#1025), with
// the detail fields built in src/medication/details.ts; change them together. Hand-maintained.
// strength, frequency, sig, purpose, prescriber and originalCodings are mapped from the FHIR and each
// has its coded companion (ingredients, dosageInstruction, reasons, prescriberReference) carrying the
// codings as recorded (system, code, display; Quantities with their UCUM system/code). Every field is
// OMITTED when the records are silent — never null, never invented. patientDisplay and provenance
// have no server source yet; the page falls back for each.

export interface MedicationCoding {
  system?: string;
  code?: string;
  display?: string;
}

// FHIR datatypes as the server copies them — codings kept exactly as recorded.
export interface MedicationCodeableConcept {
  text?: string;
  coding?: MedicationCoding[];
}

export interface MedicationQuantity {
  value?: number;
  comparator?: string;
  unit?: string;
  system?: string;   // e.g. http://unitsofmeasure.org — only when the record stated it
  code?: string;
}

export interface MedicationRatio {
  numerator?: MedicationQuantity;
  denominator?: MedicationQuantity;
}

export interface MedicationReference {
  reference?: string;
  type?: string;
  display?: string;
  identifier?: { system: string; value: string }[];   // NPI only
}

export interface MedicationDosage {
  sequence?: number;
  text?: string;
  patientInstruction?: string;
  additionalInstruction?: MedicationCodeableConcept[];
  timing?: { code?: MedicationCodeableConcept; repeat?: Record<string, unknown>; event?: string[] };
  asNeeded?: boolean;
  asNeededFor?: MedicationCodeableConcept[];
  site?: MedicationCodeableConcept;
  route?: MedicationCodeableConcept;
  method?: MedicationCodeableConcept;
  doseAndRate?: {
    type?: MedicationCodeableConcept;
    doseQuantity?: MedicationQuantity;
    doseRange?: { low?: MedicationQuantity; high?: MedicationQuantity };
    rateQuantity?: MedicationQuantity;
    rateRatio?: MedicationRatio;
    rateRange?: { low?: MedicationQuantity; high?: MedicationQuantity };
  }[];
  frequency?: string;   // this one instruction's frequency in words
}

export interface MedicationIngredient {
  item?: MedicationCodeableConcept;
  itemReference?: MedicationReference;
  isActive?: boolean;
  strengthRatio?: MedicationRatio;
  strengthQuantity?: MedicationQuantity;
  strengthCodeableConcept?: MedicationCodeableConcept;
  strength?: string;
}

export interface MedicationReason {
  concept?: MedicationCodeableConcept;   // reasonCode, or the referenced Condition's code
  reference?: MedicationReference;
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
  purpose?: string;
  prescriber?: string;
  strength?: string;
  medication?: MedicationCodeableConcept;
  medicationReference?: MedicationReference;
  dosageInstruction?: MedicationDosage[];
  reasons?: MedicationReason[];
  prescriberReference?: MedicationReference;
  ingredients?: MedicationIngredient[];
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
  strength?: string;           // per-unit strength, e.g. "325 mg" — Medication.ingredient, else read off the RxNorm name; its own column, not the dose
  rxNormCode?: string;
  state: string;            // Active | Suspended | Past | Unknown
  stateConflict?: boolean;
  dose?: string;
  frequency?: string;          // Dosage.timing (code, else repeat) + asNeeded, every instruction
  sig?: string;                // Dosage.text / patientInstruction, else coded dose + route + frequency
  purpose?: string;            // reasonCode text, or the referenced Condition's name
  prescriber?: string;         // requester / informationSource (never a Patient), resolved when possible
  lastActivity?: string;
  originalCodings?: MedicationCoding[];   // every drug coding the contributors gave (RxNorm, NDC, SNOMED…)
  dosageInstruction?: MedicationDosage[];       // the FHIR behind frequency/sig
  reasons?: MedicationReason[];                 // the FHIR behind purpose
  prescriberReference?: MedicationReference;    // the FHIR behind prescriber
  ingredients?: MedicationIngredient[];         // the FHIR behind strength
  contributors?: MedicationContributor[];
  provenance?: MedicationProvenance;   // "who said this" — nil when no resolver ran
}
