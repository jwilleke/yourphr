import { describe, expect, it } from 'vitest';
import { localDayOf, parseOffsetTimestamp } from '../time.js';

describe('parseOffsetTimestamp', () => {
  it('keeps the offset and the local day, and refuses a bare timestamp', () => {
    const stamped = parseOffsetTimestamp('2026-08-24T23:30:00-04:00', 'start');
    expect(stamped.offset).toBe('-04:00');
    expect(stamped.utc).toBe('2026-08-25T03:30:00Z');
    expect(stamped.localDay).toBe('2026-08-24');
    expect(localDayOf(Date.parse(stamped.utc), stamped.offset)).toBe('2026-08-24');
    expect(() => parseOffsetTimestamp('2026-08-24T23:30:00', 'start')).toThrow(/explicit offset/);
    expect(() => parseOffsetTimestamp('2026-08-24', 'start')).toThrow(/explicit offset/);
  });

  it('a positive offset can put the local day after the UTC day', () => {
    const stamped = parseOffsetTimestamp('2026-08-25T01:30:00+05:30', 'start');
    expect(stamped.utc).toBe('2026-08-24T20:00:00Z');
    expect(stamped.localDay).toBe('2026-08-25');
  });
});
