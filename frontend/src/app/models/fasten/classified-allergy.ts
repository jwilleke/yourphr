// Mirrors the backend pkg/allergyintolerance.ClassifiedAllergy contract returned by
// GET /api/secure/allergies/classified. Hand-maintained (this endpoint is not tygo-exported).

import {Provenance} from './provenance';

export interface ClassifiedAllergyCoding {
  system?: string;
  code?: string;
  display?: string;
}

export interface ClassifiedAllergyReaction {
  manifestations?: string[];
  description?: string;
  severity?: string;
}

export interface ClassifiedAllergy {
  sourceResourceType: string;
  sourceResourceId: string;
  sourceId: string;
  title: string;
  state: string;          // Active | Inactive | Resolved | Unknown | RuledOut
  verification: string;   // Confirmed | Presumed | Unconfirmed | Refuted | Unknown
  selfReported: boolean;
  noKnown?: boolean;      // a "no known allergy" negation, not an allergy — exclude from counts/lists (#290)

  clinicalStatus?: string;
  verificationStatus?: string;
  type?: string;          // allergy | intolerance
  categories?: string[];  // food | medication | environment | biologic
  criticality?: string;
  reactions?: ClassifiedAllergyReaction[];
  onset?: string;
  recorded?: string;
  start?: string;         // earliest stated date (deduped across encounters)
  end?: string;           // latest stated date (deduped)
  lastActivity?: string;  // = end; sort key
  occurrences?: number;   // source records merged into this entry
  note?: string;
  standardCodings?: ClassifiedAllergyCoding[];
  provenance?: Provenance;
}
