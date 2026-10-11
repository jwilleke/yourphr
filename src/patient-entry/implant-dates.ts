import { PatientEntryError } from './shared.js';

/** Implant dates keep their stated precision; only disjoint ranges establish chronology. */
export function implantDate(value: unknown, field: string): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || !/^(?!0000)\d{4}(-\d{2}(-\d{2})?)?$/.test(value)) {
    throw new PatientEntryError(`Enter a valid ${field} date (YYYY, YYYY-MM or YYYY-MM-DD).`);
  }
  const [year, month, day] = value.split('-').map(Number);
  const days = month ? new Date(Date.UTC(year!, month, 0)).getUTCDate() : 0;
  if ((month !== undefined && (month < 1 || month > 12)) || (day !== undefined && (day < 1 || day > days))) {
    throw new PatientEntryError(`Enter a valid ${field} date (YYYY, YYYY-MM or YYYY-MM-DD).`);
  }
  return value;
}

export function definitelyBefore(earlier: string, later: string): boolean {
  const upper = earlier.length === 4 ? `${earlier}-12-31`
    : earlier.length === 7 ? `${earlier}-31` : earlier;
  const lower = later.length === 4 ? `${later}-01-01`
    : later.length === 7 ? `${later}-01` : later;
  return upper < lower;
}
