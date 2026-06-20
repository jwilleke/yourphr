import {Provenance} from './provenance';

// Classified is the Layer-1 synthesized view-model attached to a resource at read time
// (backend handler attachClassification → ResourceBase.Classified). It is a loose SUPERSET of the
// per-resource Classified* structs (condition, allergyintolerance, immunization, procedure,
// diagnosticreport, encounter, careplan) — each populates the fields relevant to it; the rest stay
// undefined. The synthesis rules live ONLY in the Go classifiers; the frontend never re-derives them.
// Consumed by the fhir-card detail view (#308) and the /medical-history rows (#315/#351).
export interface Classified {
  state?: string;          // legible status (Active / Completed / Stopped / Final / …)
  verification?: string;   // AllergyIntolerance (Confirmed / Presumed / Unconfirmed / Refuted)
  category?: string;       // legible category (Laboratory / Office visit / …)
  source?: string;         // Immunization primarySource attribution (Recorded by provider / Reported)
  intent?: string;         // CarePlan intent
  selfReported?: boolean;
  title?: string;
  provenance?: Provenance; // "who said/did this" — same object as the resource's provenance
}
