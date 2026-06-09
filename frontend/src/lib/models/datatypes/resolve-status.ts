import * as _ from "lodash";

// Resolve a status-like element to a display string regardless of conformance (#54).
//
// US Core sends these as a CodeableConcept ({coding:[{code,display}]}), but loose / non-US-Core
// exporters (e.g. Veradigm/FollowMyHealth) commonly send a text-only concept ({text}) or even a
// plain string code ("active"). This resolves all three shapes so the value always displays — a
// viewer displays the patient's data, it does not validate conformance.
//
// preferDisplay=false (default) -> code-first (preserves US Core codes like 'active');
// preferDisplay=true            -> display-first (human-readable label).
export function resolveStatus(value: any, preferDisplay = false): string | undefined {
  if (value == null) { return undefined }
  if (typeof value === 'string') { return value }
  const code = _.get(value, 'coding.0.code');
  const display = _.get(value, 'coding.0.display');
  const text = _.get(value, 'text');
  return preferDisplay ? (display || code || text) : (code || display || text);
}
