/**
 * The notice an upload ends with (yourphr#913): the counts behind "it worked", in the person's words
 * (#736, #262). Moved from the Sources page when the import became set-and-walk-away.
 */
import { describe, expect, it } from 'vitest';
import { uploadSummary } from '../SourcesManager.js';

describe('uploadSummary', () => {
  const base = { format: 'fhir', received: 0, created: 0, updated: 0, unchanged: 0, collisions: 0, skipped: 0 };

  it('says what was added and refreshed', () => {
    expect(uploadSummary({ ...base, created: 3, updated: 1 })).toBe('Added 3 new records. Updated 1 record you already had from this file.');
  });

  it('says so when nothing new arrived', () => {
    expect(uploadSummary(base)).toBe('Nothing new was added.');
  });

  it('an identical re-upload says nothing changed, rather than claiming a refresh (#781)', () => {
    expect(uploadSummary({ ...base, unchanged: 2 })).toBe('You already had all 2 records in this file; nothing changed.');
    expect(uploadSummary({ ...base, unchanged: 1 })).toBe('You already had the 1 record in this file; nothing changed.');
    expect(uploadSummary({ ...base, created: 1, unchanged: 3 })).toBe('Added 1 new record. 3 records were already up to date.');
  });

  it('never hides what was left out', () => {
    expect(uploadSummary({ ...base, created: 1, collisions: 2, skipped: 1 })).toBe(
      'Added 1 new record. 2 records were left out because another of your connected sources already has them. 1 part of the file could not be read and was skipped.');
  });
});
