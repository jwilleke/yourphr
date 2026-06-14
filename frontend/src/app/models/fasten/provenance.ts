// Resolved provenance ("who said this") — mirrors the backend pkg/provenance.Provenance contract.
// Cross-cutting: the same shape attaches to medications, conditions, and (once #271 lands) every
// record. `display` is always a complete human label — a clinician/organization name, "Self-reported"
// (Patient-asserted), or the honest "Source: <name>" floor. Never a fabricated author.
export interface Provenance {
  kind: string;     // practitioner | self-reported | organization | provenance | source
  display: string;
  level: number;    // ladder rung the answer came from (1 strongest)
}
