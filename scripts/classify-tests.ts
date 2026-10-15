/**
 * Classifier harness (yourphr#578). Synthetic records only, no PHI.
 *
 * The living regression is the Epic HOV case (docs/EHR-vendors/epic/notes.md): a vendor-local
 * Encounter.class must never surface its cryptic display as the category while the record carries
 * its own human text.
 *
 *   npm run classify
 */
import { classify, legibleClass } from '../src/classify/index.js';
import type { Resource } from '@medplum/fhirtypes';

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function main(): void {
  // --- THE Epic HOV regression, alive ---
  const hov = classify({
    resourceType: 'Encounter', id: 'hov', status: 'finished',
    class: { code: '4', display: 'HOV' },
    type: [{ text: 'Outpatient' }],
    period: { start: '2024-03-05T10:00:00Z' },
  } as unknown as Resource)!;
  check('Epic HOV: the vendor-local class display NEVER surfaces as the category',
    hov.category === 'Outpatient' && !JSON.stringify(hov).includes('"HOV"'));
  check('and the title is the encounter\'s own human text', hov.title === 'Outpatient');

  const amb = classify({ resourceType: 'Encounter', id: 'amb', status: 'finished', class: { system: 'v3', code: 'AMB' } } as unknown as Resource)!;
  check('a known v3 class maps to its legible word', amb.category === 'Office visit');

  const classless = classify({ resourceType: 'Encounter', id: 'nc', status: 'finished' } as unknown as Resource)!;
  check('no stated class -> empty category, never a guess', classless.category === '');

  const localOnly = classify({ resourceType: 'Encounter', id: 'lo', status: 'finished', class: { code: '9', display: 'ZZZ' } } as unknown as Resource)!;
  check('a local class with NO human text falls back to its display as last resort', localOnly.category === 'ZZZ');

  check('the v3 map matches the Go table', legibleClass('EMER') === 'Emergency' && legibleClass('VR') === 'Telehealth' && legibleClass('unknown-code') === '');

  // --- per-type goldens ---
  const condition = classify({
    resourceType: 'Condition', id: 'c1',
    code: { coding: [{ system: 'http://snomed.info/sct', code: '38341003', display: 'Hypertension' }], text: 'Hypertension' },
    clinicalStatus: { coding: [{ code: 'active' }] },
    recordedDate: '2024-01-10',
  } as unknown as Resource)!;
  check('Condition: title/state/date are the record\'s own words',
    condition.title === 'Hypertension' && condition.state === 'Active' && condition.date === '2024-01-10');
  check('and no raw code appears anywhere in the classification',
    !JSON.stringify(condition).includes('38341003'));

  const imm = classify({ resourceType: 'Immunization', id: 'i1', status: 'completed', vaccineCode: { text: 'Influenza, seasonal' }, occurrenceDateTime: '2023-10-01' } as unknown as Resource)!;
  check('Immunization: completed reads as Given', imm.state === 'Given' && imm.title === 'Influenza, seasonal');

  const allergy = classify({ resourceType: 'AllergyIntolerance', id: 'a1', code: { text: 'Penicillin allergy' }, clinicalStatus: { coding: [{ code: 'active' }] }, category: ['medication'] } as unknown as Resource)!;
  check('Allergy: state from clinicalStatus, category from the record', allergy.state === 'Active' && allergy.category === 'medication');

  const report = classify({ resourceType: 'DiagnosticReport', id: 'd1', status: 'final', code: { text: 'CBC panel' }, effectiveDateTime: '2024-02-02T08:00:00Z' } as unknown as Resource)!;
  check('DiagnosticReport: final is Final, date is the date part', report.state === 'Final' && report.date === '2024-02-02');

  // --- honesty rules ---
  const nameless = classify({ resourceType: 'Condition', id: 'n1' } as unknown as Resource)!;
  check('a nameless record is Unnamed with empty state/date — absent is a fact',
    nameless.title === 'Unnamed Condition' && nameless.state === '' && nameless.date === '');

  const retracted = classify({ resourceType: 'Condition', id: 'r1', status: 'entered-in-error', code: { text: 'oops' } } as unknown as Resource);
  check('an entered-in-error record is excluded entirely', retracted === undefined);

  const unbacked = classify({ resourceType: 'Basic', id: 'b1' } as unknown as Resource);
  check('an unbacked type is honestly unclassified, not vaguely labeled', unbacked === undefined);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
}

main();
