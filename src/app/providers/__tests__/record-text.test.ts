/**
 * The human-readable text of a record (yourphr#599), and the entity-unescaping order that
 * yourphr#681 got wrong.
 *
 * The tooth here is the double-unescape: `&amp;` used to be resolved FIRST, so the pass fed its own
 * output back to itself and turned deliberately-escaped markup into live markup. These records are
 * documents other people wrote, so "the input contains an escaped tag" is an ordinary case rather
 * than an attack, and the function must not decide it meant something else.
 */
import { describe, expect, it } from 'vitest';
import { textFor } from '../record-text.js';

const narrative = (div: string): Record<string, unknown> => ({
  resourceType: 'Condition',
  id: 'c-1',
  text: { status: 'generated', div },
});

describe('record text: narrative entities', () => {
  it('does not manufacture markup from an escaped tag — the yourphr#681 regression', () => {
    // Written by whoever produced the document: the literal characters "<script>", escaped once
    // for the narrative, and escaped AGAIN because they are being shown as an example.
    const text = textFor(narrative('<div>see &amp;lt;script&amp;gt; below</div>'));
    expect(text).toContain('&lt;script&gt;');
    expect(text).not.toContain('<script>');
  });

  it('leaves no angle bracket that the input did not already contain unescaped', () => {
    const text = textFor(narrative('<p>&amp;lt;img src=x onerror=alert(1)&amp;gt;</p>'));
    expect(text).not.toMatch(/<[a-z]/i);
  });

  it('still unescapes ordinary entities once', () => {
    const text = textFor(narrative('<p>Fever &gt; 38&#176;C &amp; chills</p>'));
    expect(text).toContain('>');
    expect(text).toContain('&');
    // The ampersand is resolved last, so the text reads as written rather than as re-parsed.
    expect(text).toContain('38&#176;C');
  });

  it('resolves an ampersand that is genuinely escaped', () => {
    expect(textFor(narrative('<p>Smith &amp; Nephew</p>'))).toContain('Smith & Nephew');
  });

  it('strips tags to whitespace rather than concatenating words across them', () => {
    const text = textFor(narrative('<p>Metformin</p><p>500 MG</p>'));
    expect(text).toContain('Metformin');
    expect(text).toContain('500 MG');
    expect(text).not.toContain('Metformin500');
  });

  it('handles quotes and apostrophes without leaving a bare entity', () => {
    const text = textFor(narrative('<p>&quot;stable&quot; per patient&#39;s report</p>'));
    expect(text).toContain('"stable"');
    expect(text).toContain("patient's");
  });

  /**
   * The clinical name of a record, which is the thing a person actually searches for.
   *
   * `code` is in SKIP_KEYS to keep bare codes and identifiers out of the index — "metformin" should
   * match the medication rather than every record with those letters in an id. But it was matched by
   * KEY NAME, and in FHIR `code` is normally a CodeableConcept, so the whole subtree went: Condition,
   * Observation, Procedure, AllergyIntolerance and DiagnosticReport were all indexed with their type
   * and status and no name at all. Search returned nothing for "prediabetes" while looking like it
   * worked, which is the yourphr#598 empty-`sort_title` failure wearing a different hat.
   */
  describe('the clinical name survives, the bare code does not', () => {
    const named: [string, Record<string, unknown>, string][] = [
      ['Condition', { resourceType: 'Condition', code: { text: 'Prediabetes' } }, 'Prediabetes'],
      ['Procedure', { resourceType: 'Procedure', status: 'completed', code: { text: 'Colonoscopy' } }, 'Colonoscopy'],
      ['AllergyIntolerance', { resourceType: 'AllergyIntolerance', code: { text: 'Penicillin' } }, 'Penicillin'],
      ['DiagnosticReport', { resourceType: 'DiagnosticReport', status: 'final', code: { text: 'CBC panel' } }, 'CBC panel'],
      ['Observation', { resourceType: 'Observation', status: 'final', code: { coding: [{ display: 'Hemoglobin A1c' }] } }, 'Hemoglobin A1c'],
    ];
    for (const [type, resource, name] of named) {
      it(`indexes ${type} by its name`, () => {
        expect(textFor(resource)).toContain(name);
      });
    }

    it('keeps the bare code, the system URI and the identifier out', () => {
      const text = textFor({
        resourceType: 'Observation', status: 'final',
        code: { coding: [{ system: 'http://loinc.org', code: '4548-4', display: 'Hemoglobin A1c' }], text: 'HbA1c' },
        identifier: [{ system: 'urn:x', value: 'metformin-lookalike-id' }],
      });
      expect(text).toContain('Hemoglobin A1c');
      expect(text).toContain('HbA1c');
      expect(text).not.toContain('4548-4');
      expect(text).not.toContain('loinc.org');
      expect(text).not.toContain('metformin-lookalike-id');
    });
  });
});
