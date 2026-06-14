// Mirrors the backend pkg/condition.ClassifiedCondition contract returned by
// GET /api/secure/conditions/classified. Hand-maintained (this endpoint is not tygo-exported).
// See docs/your-phr-dashboard/phase-1-condition-classifier-spec.md.

import {Provenance} from './provenance';

export interface ConditionCoding {
  system?: string;
  code?: string;
  display?: string;
}

export interface ClassifiedCondition {
  sourceResourceType: string;
  sourceResourceId: string;
  sourceId: string;
  title: string;
  category: string;            // problem-list-item | sdoh | health-concern
  tier: string;                // clinician | self-reported | profile
  state: string;               // Active | Remission | Resolved | Unknown | RuledOut
  selfReported: boolean;
  clinicalStatus?: string;
  verificationStatus?: string;
  onset?: string;
  recorded?: string;
  abated?: string;
  note?: string;
  standardCodings?: ConditionCoding[];
  provenance?: Provenance;   // "who said this" — nil when no resolver ran
}
