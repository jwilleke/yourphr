// Resolved provenance ("who said this") — mirrors the backend pkg/provenance.Provenance contract.
// Attached at read time to every resource on the generic path (#271) and carried on
// FastenDisplayModel, so any fhir-card can surface it. `display` is always a complete human label —
// a clinician/organization name, "Self-reported", or the honest "Source: <name>" floor; never fabricated.
export interface Provenance {
  kind: string;     // practitioner | self-reported | organization | provenance | source
  display: string;
  level: number;    // ladder rung the answer came from (1 strongest)
  recorded?: string; // USCDI Author Time Stamp the record stated ("" when none); never fabricated
}
