// Mirrors the backend pkg/immunization.ClassifiedImmunization contract returned by
// GET /api/secure/immunizations/classified. Hand-maintained (this endpoint is not tygo-exported).

import {Provenance} from './provenance';

export interface ClassifiedImmunizationCoding {
  system?: string;
  code?: string;
  display?: string;
}

export interface ClassifiedImmunization {
  sourceResourceType: string;
  sourceResourceId: string;
  sourceId: string;
  title: string;
  state: string;          // Completed | NotDone | Unknown
  source: string;         // Recorded by provider | Reported | Unknown
  reportOrigin?: string;

  status?: string;
  statusReason?: string;
  occurrence?: string;    // latest administration date (deduped: most recent dose)
  recorded?: string;
  doses?: number;         // administrations merged into this entry (same vaccine repeated)
  lastActivity?: string;  // latest administration/recorded date; sort key
  manufacturer?: string;
  lotNumber?: string;
  expirationDate?: string;
  note?: string;
  standardCodings?: ClassifiedImmunizationCoding[];
  provenance?: Provenance;
}
