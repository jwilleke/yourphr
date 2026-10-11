import {definitelyBefore, displayFhirDate, validImplantDate} from './implant-date';

describe('implant date precision', () => {
  it('preserves year, month and date without inventing an instant', () => {
    for (const date of ['2024', '2024-02', '2024-02-29']) {
      expect(validImplantDate(date)).toBeTrue();
    }
    expect(displayFhirDate('2024')).toBe('2024');
    expect(displayFhirDate('2024-02')).toBe('Feb 2024');
    expect(displayFhirDate('2024-02-29')).toBe('Feb 29, 2024');
    expect(displayFhirDate('2026-01-01')).toBe('Jan 1, 2026');
  });
  it('rejects invalid calendar values and malformed partial dates', () => {
    for (const date of ['0000', '2024-00', '2024-13', '2023-02-29', '1900-02-29', '2024-04-31', '2024-1', ' 2024']) {
      expect(validImplantDate(date)).toBeFalse();
    }
  });
  it('rejects only chronology established by disjoint ranges', () => {
    expect(definitelyBefore('2023', '2024')).toBeTrue();
    expect(definitelyBefore('2024-05', '2024-06')).toBeTrue();
    expect(definitelyBefore('2024-02', '2024-03-01')).toBeTrue();
    expect(definitelyBefore('2024', '2024-12-31')).toBeFalse();
    expect(definitelyBefore('2024-06', '2024-06-30')).toBeFalse();
  });
});
