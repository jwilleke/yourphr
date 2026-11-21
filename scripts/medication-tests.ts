/**
 * Medication-reconciliation harness (yourphr#580). Synthetic records only, no PHI.
 *
 * The clinically load-bearing checks: nothing absent ever reads as Active, and a cross-source
 * disagreement is FLAGGED — the badge may pick the most recent stated word, but the conflict
 * and every contributor stay visible.
 *
 *   npm run medication
 */
import { reconcile, RXNORM, toWireMedication, type MedInput } from '../src/medication/index.js';
import type { Resource } from '@medplum/fhirtypes';

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const med = (over: Record<string, unknown>, sourceId = 'src-a'): MedInput =>
  ({ resource: over as unknown as Resource, sourceId });

function main(): void {
  // --- dedup: RxNorm beats text; exact text merges; nameless never merges ---
  const rows1Inputs = (): MedInput[] => [
    med({ resourceType: 'MedicationRequest', id: 'r1', status: 'active', authoredOn: '2024-01-01',
      medicationCodeableConcept: { text: 'Lisinopril 10 MG Oral Tablet', coding: [{ system: RXNORM, code: '314076' }] } }),
    med({ resourceType: 'MedicationDispense', id: 'd1', status: 'completed',
      medicationCodeableConcept: { text: 'LISINOPRIL 10mg tab', coding: [{ system: RXNORM, code: '314076' }] } }, 'src-b'),
    med({ resourceType: 'MedicationStatement', id: 's1', status: 'active',
      medicationCodeableConcept: { text: 'Metformin 500 MG' } }),
    med({ resourceType: 'MedicationStatement', id: 's2', status: 'active',
      medicationCodeableConcept: { text: '  metformin   500 mg ' } }, 'src-b'),
    med({ resourceType: 'MedicationRequest', id: 'n1', status: 'active' }),
    med({ resourceType: 'MedicationRequest', id: 'n2', status: 'active' }),
  ];
  const rows1 = reconcile(rows1Inputs());
  check('same RxNorm code merges across types and sources despite different text',
    rows1.filter((r) => r.rxNormCode === '314076').length === 1 &&
    rows1.find((r) => r.rxNormCode === '314076')!.sourceIds.join(',') === 'src-a,src-b');
  check('exact normalized text merges; the row lists both sources',
    rows1.filter((r) => r.name.toLowerCase().startsWith('metformin')).length === 1);
  check('nameless resources are NEVER merged blindly — one row each, honestly unnamed',
    rows1.filter((r) => r.name === 'Unnamed medication').length === 2);

  // --- state honesty ---
  const dispenseOnly = reconcile([med({ resourceType: 'MedicationDispense', id: 'd2', status: 'completed',
    medicationCodeableConcept: { text: 'Aspirin' } })]);
  check('a dispense record alone is Unknown — a fill is not evidence of current use',
    dispenseOnly[0]!.state === 'Unknown' && !dispenseOnly[0]!.stateConflict);

  const statusless = reconcile([med({ resourceType: 'MedicationStatement', id: 's3',
    medicationCodeableConcept: { text: 'Mystery med' } })]);
  check('no stated status is Unknown, never assumed Active', statusless[0]!.state === 'Unknown');

  const pastByDate = reconcile([med({ resourceType: 'MedicationStatement', id: 's4', status: 'weird-status',
    effectivePeriod: { end: '2020-01-01' }, medicationCodeableConcept: { text: 'Old med' } })]);
  check('an explicit past end date is the one non-status source of Past', pastByDate[0]!.state === 'Past');

  // --- THE conflict case: two sources disagree ---
  const conflict = reconcile([
    med({ resourceType: 'MedicationRequest', id: 'c1', status: 'active', authoredOn: '2024-01-01',
      medicationCodeableConcept: { text: 'Warfarin', coding: [{ system: RXNORM, code: '11289' }] } }, 'hospital'),
    med({ resourceType: 'MedicationStatement', id: 'c2', status: 'stopped', dateAsserted: '2024-06-01',
      medicationCodeableConcept: { coding: [{ system: RXNORM, code: '11289', display: 'Warfarin' }] } }, 'patient-portal'),
  ]);
  const warfarin = conflict[0]!;
  check('a cross-source disagreement is FLAGGED as a conflict, never silently resolved',
    warfarin.stateConflict === true);
  check('the badge follows the most recently DATED stated word', warfarin.state === 'Past');
  check('both contributors stay visible as evidence, both sources named',
    warfarin.contributors.length === 2 && warfarin.sourceIds.length === 2);

  const undatedConflict = reconcile([
    med({ resourceType: 'MedicationRequest', id: 'u1', status: 'active', medicationCodeableConcept: { text: 'X' } }),
    med({ resourceType: 'MedicationStatement', id: 'u2', status: 'stopped', medicationCodeableConcept: { text: 'X' } }),
  ])[0]!;
  check('an undated conflict falls back to the deterministic priority, still flagged',
    undatedConflict.state === 'Active' && undatedConflict.stateConflict === true);

  // --- precedence + hygiene ---
  const dose = reconcile([
    med({ resourceType: 'MedicationDispense', id: 'p1', status: 'completed',
      dosageInstruction: [{ text: 'dispense-dose' }], medicationCodeableConcept: { text: 'Y' } }),
    med({ resourceType: 'MedicationRequest', id: 'p2', status: 'active',
      dosageInstruction: [{ text: 'ONE tablet daily' }], medicationCodeableConcept: { text: 'Y' } }),
  ])[0]!;
  check('the prescribed dose outranks the dispense record (field precedence)', dose.dose === 'ONE tablet daily');

  const retracted = reconcile([med({ resourceType: 'MedicationRequest', id: 'e1', status: 'entered-in-error',
    medicationCodeableConcept: { text: 'Oops' } })]);
  check('entered-in-error contributes nothing', retracted.length === 0);

  const order = reconcile([
    med({ resourceType: 'MedicationStatement', id: 'o1', status: 'completed', medicationCodeableConcept: { text: 'Zeta past' } }),
    med({ resourceType: 'MedicationStatement', id: 'o2', status: 'active', medicationCodeableConcept: { text: 'Beta active' } }),
    med({ resourceType: 'MedicationStatement', id: 'o3', medicationCodeableConcept: { text: 'Alpha unknown' } }),
  ]);
  check('the list is patient-first ordered: Active before Unknown before Past',
    order.map((r) => r.name).join('|') === 'Beta active|Alpha unknown|Zeta past');

  // --- the wire contract the medications page reads (yourphr#1025) ---
  const keys = rows1.map((r) => r.key);
  check('every row has a key, unique within the answer — nameless rows included',
    keys.every((k) => typeof k === 'string' && k !== '') && new Set(keys).size === keys.length
      && rows1.find((r) => r.rxNormCode === '314076')!.key === 'rxnorm:314076');
  check('the key is stable across calls for the same records',
    reconcile(rows1Inputs()).map((r) => r.key).join('|') === keys.join('|'));
  const wire = rows1.map(toWireMedication);
  const lisinopril = wire.find((r) => r.rxNormCode === '314076')!;
  check('the wire row carries title (from name), lastActivity (latest dated contributor) and contributors[].sourceResourceId',
    wire.every((r) => r.title === r.name && r.title !== '') && lisinopril.lastActivity === '2024-01-01'
      && lisinopril.contributors.map((c) => c.sourceResourceId).join(',') === 'r1,d1');
  check('no dated contributor means no lastActivity, not an invented one; the old fields stay for agents',
    wire.find((r) => r.name.toLowerCase().startsWith('metformin'))!.lastActivity === undefined
      && lisinopril.name === 'Lisinopril 10 MG Oral Tablet' && lisinopril.contributors[0]!.id === 'r1' && lisinopril.sourceIds.length === 2);
  const latest = toWireMedication(reconcile([
    med({ resourceType: 'MedicationRequest', id: 'l1', status: 'active', authoredOn: '2023-02-01', medicationCodeableConcept: { text: 'Z' } }),
    med({ resourceType: 'MedicationDispense', id: 'l2', status: 'completed', whenHandedOver: '2025-03-04T10:00:00Z', medicationCodeableConcept: { text: 'Z' } }),
  ])[0]!);
  check('lastActivity is the latest of the contributor dates, whatever their type', latest.lastActivity === '2025-03-04T10:00:00Z');

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
}

main();
