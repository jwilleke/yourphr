import {Component, ChangeDetectionStrategy} from '@angular/core';
import {GenericColumnDefn, DatatableGenericResourceComponent} from './datatable-generic-resource.component';
import {money} from '../../../../lib/utils/fhir-money';

/**
 * The /explore list for claims (#521).
 *
 * Claim had no datatable component at all, so the list showed the unknown-resource warning above a
 * column of UUIDs.
 *
 * "Amount claimed" rather than "Amount": a Claim states what was BILLED to the insurer, not what the
 * patient owes, and a column header is exactly where that distinction gets lost.
 */
@Component({
  selector: 'fhir-datatable-claim',
  templateUrl: './datatable-generic-resource.component.html',
  styleUrls: ['./datatable-generic-resource.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false,
})
export class DatatableClaimComponent extends DatatableGenericResourceComponent {
  columnDefinitions: GenericColumnDefn[] = [
    { title: 'Type', versions: '*', format: 'codeableConcept', getter: c => c.type },
    { title: 'Billed by', versions: '*', getter: c => c.provider?.display || c.provider?.reference },
    { title: 'Submitted', versions: '*', format: 'date', getter: c => c.created },
    { title: 'Amount claimed', versions: '*', getter: c => money(c.total) },
  ]
}
