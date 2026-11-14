/** RFC 3339 with an explicit offset. A bare date-time is refused; the server does not guess a zone. */

const RFC3339 = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|[+-]\d{2}:\d{2})$/;

export interface Stamped {
  /** UTC instant, whole seconds, `Z`. */
  utc: string;
  /** The offset the sender wrote: `Z` or `±HH:MM`. */
  offset: string;
  /** Calendar day in that offset, `YYYY-MM-DD`. */
  localDay: string;
}

export function offsetMinutes(offset: string): number {
  if (offset === 'Z') return 0;
  const sign = offset.startsWith('-') ? -1 : 1;
  const [hours, minutes] = offset.slice(1).split(':');
  return sign * ((Number(hours) * 60) + Number(minutes));
}

export function localDayOf(utcMs: number, offset: string): string {
  const local = new Date(utcMs + offsetMinutes(offset) * 60_000);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, '0');
  const d = String(local.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Parse a timestamp that carries its own offset. Anything else throws. */
export function parseOffsetTimestamp(value: unknown, field: string): Stamped {
  if (typeof value !== 'string' || !RFC3339.test(value.trim())) {
    throw new Error(`${field} must be RFC 3339 with an explicit offset`);
  }
  const trimmed = value.trim();
  const match = RFC3339.exec(trimmed);
  const offset = match?.[2] ?? 'Z';
  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms)) throw new Error(`${field} must be RFC 3339 with an explicit offset`);
  return {
    utc: new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    offset,
    localDay: localDayOf(ms, offset),
  };
}

export function isUri(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value);
}
