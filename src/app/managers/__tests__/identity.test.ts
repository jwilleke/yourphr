import { describe, expect, it } from 'vitest';
import { demographicsOf, displayName, evidenceFor, identifierConflicts } from '../identity.js';

/**
 * The rules for deciding what is KNOWN about a source identity (yourphr#761). Sameness is asserted
 * by the person; everything here only decides what they are shown and what is preselected.
 */

const demographics = (name: string, birthDate = '', gender = '') => ({ name, birthDate, gender });

describe('what a Patient states about who it is', () => {
  it('reads the name the record gives, in the form it gives it', () => {
    expect(displayName({ name: [{ text: 'Jane Q. Doe' }] })).toBe('Jane Q. Doe');
    expect(displayName({ name: [{ given: ['Jane'], family: 'Doe' }] })).toBe('Jane Doe');
    expect(displayName({ name: [{ family: 'Doe' }] })).toBe('Doe');
  });

  it('says nothing when the record says nothing — no initials, no placeholder', () => {
    expect(displayName({})).toBe('');
    expect(displayName({ name: [{}] })).toBe('');
    expect(demographicsOf({ birthDate: '1971-04-02' })).toEqual({ name: '', birthDate: '1971-04-02', gender: '' });
  });
});

describe('the evidence behind one source identity', () => {
  const base = { display: 'Fake Regional Health', demographics: demographics('Jane Doe', '1971-04-02', 'female'), others: [] };

  it('offers "this is me" for a connection the person signed in to, which is the strongest signal a PHR has', () => {
    const { evidence, suggested } = evidenceFor({ ...base, authenticated: true, uploaded: false });
    expect(suggested).toBe('self');
    expect(evidence[0]).toContain('You signed in to Fake Regional Health yourself');
  });

  // A portal grants PROXY access: signing in proves they may read the record, not that they are in
  // it. So even the strongest evidence is a preselection, never an answer.
  it('offers nothing for an uploaded file, because a file says nothing about whose record it is', () => {
    const { evidence, suggested } = evidenceFor({ ...base, authenticated: false, uploaded: true });
    expect(suggested).toBe('');
    expect(evidence[0]).toContain('A file says nothing about whose record it is');
  });

  it('shows what the source states about the person, as the source states it', () => {
    const { evidence } = evidenceFor({ ...base, authenticated: true, uploaded: false });
    expect(evidence[1]).toBe('Fake Regional Health has this record as Jane Doe, born 1971-04-02.');
  });

  it('surfaces a disagreement between sources without resolving it, and without changing what is offered', () => {
    const { conflicts, suggested } = evidenceFor({
      ...base,
      authenticated: true,
      uploaded: false,
      others: [{ display: 'City Clinic', demographics: demographics('Jane Doe', '1971-09-30', 'female') }],
    });
    expect(conflicts).toEqual(['City Clinic has a different date of birth (1971-09-30) from Fake Regional Health (1971-04-02).']);
    expect(suggested).toBe('self'); // demographics corroborate; they never decide
  });

  it('calls nothing a disagreement when one side simply did not say', () => {
    const { conflicts } = evidenceFor({
      ...base,
      authenticated: true,
      uploaded: false,
      others: [{ display: 'City Clinic', demographics: demographics('', '', '') }],
    });
    expect(conflicts).toEqual([]);
  });

  it('treats a name in different letter case as the same name, not a conflict', () => {
    const { conflicts } = evidenceFor({
      ...base,
      authenticated: true,
      uploaded: false,
      others: [{ display: 'City Clinic', demographics: demographics('JANE DOE', '1971-04-02', 'Female') }],
    });
    expect(conflicts).toEqual([]);
  });
});

describe('the same number under two issuing systems', () => {
  it('is surfaced, because a medical record number belongs to the organisation that issued it', () => {
    const clashes = identifierConflicts([
      { display: 'Fake Regional Health', identifiers: [{ system: 'http://fake.example.org/mrn', value: 'E12345' }] },
      { display: 'City Clinic', identifiers: [{ system: 'http://city.example.org/mrn', value: 'E12345' }] },
    ]);
    expect(clashes).toHaveLength(1);
    expect(clashes[0]).toContain('The number E12345 appears under 2 different issuing systems');
  });

  it('is not raised for the same number under the same system, which is just the same number', () => {
    expect(identifierConflicts([
      { display: 'Fake Regional Health', identifiers: [{ system: 'http://fake.example.org/mrn', value: 'E12345' }] },
      { display: 'Fake Regional Health (old)', identifiers: [{ system: 'http://fake.example.org/mrn', value: 'E12345' }] },
    ])).toEqual([]);
  });

  it('ignores an identifier with no system — it names nothing', () => {
    expect(identifierConflicts([
      { display: 'A', identifiers: [{ system: '', value: 'E12345' }] },
      { display: 'B', identifiers: [{ system: 'http://b.example.org/mrn', value: 'E12345' }] },
    ])).toEqual([]);
  });
});
