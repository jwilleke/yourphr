import {DatePipe} from '@angular/common';

export function validImplantDate(value: string): boolean {
  if (!/^(?!0000)\d{4}(-\d{2}(-\d{2})?)?$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (month !== undefined && (month < 1 || month > 12)) return false;
  return day === undefined || (day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate());
}

export function definitelyBefore(earlier: string, later: string): boolean {
  const upper = earlier.length === 4 ? `${earlier}-12-31`
    : earlier.length === 7 ? `${earlier}-31` : earlier;
  const lower = later.length === 4 ? `${later}-01-01`
    : later.length === 7 ? `${later}-01` : later;
  return upper < lower;
}

/** Date-only FHIR values are not instants: no missing month/day or timezone is invented. */
export function displayFhirDate(value?: string | null): string {
  if (!value) return '';
  return /^\d{4}(-\d{2}(-\d{2})?)?$/.test(value) ? value : new DatePipe('en-US').transform(value) || value;
}
