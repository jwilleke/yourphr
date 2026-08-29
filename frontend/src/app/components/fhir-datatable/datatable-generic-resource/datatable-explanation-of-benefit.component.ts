import {Component, ChangeDetectionStrategy} from '@angular/core';
import {GenericColumnDefn, DatatableGenericResourceComponent} from './datatable-generic-resource.component';
import {money} from '../../../../lib/utils/fhir-money';

/**
 * The /explore list for benefit statements (#522).
 *
 * This class existed but was never imported, never declared and never registered in the switch, so
 * every ExplanationOfBenefit list fell through to "YourPHR does not know how to display this
 * resource type (yet)" and a table of bare UUIDs. It also had no columns, so wiring it up without
 * filling these in would have produced an empty table and looked like a second bug.
 *
 * Columns answer the question somebody scanning a list of insurance statements is asking: what was
 * it for, when, and how much did it come to.
 */
@Component({
  selector: 'fhir-datatable-explanation-of-benefit',
  templateUrl: './datatable-generic-resource.component.html',
  styleUrls: ['./datatable-generic-resource.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false,
})
export class DatatableExplanationOfBenefitComponent extends DatatableGenericResourceComponent {
  columnDefinitions: GenericColumnDefn[] = [
    { title: 'Type', versions: '*', format: 'codeableConcept', getter: e => e.type },
    { title: 'Provider', versions: '*', getter: e => e.provider?.display || e.provider?.reference },
    { title: 'Service dates', versions: '*', format: 'period', getter: e => e.billablePeriod },
    // The billed total is the one number that makes a list of statements scannable. Falls back to
    // the first total the payer sent rather than showing nothing when "submitted" is absent.
    { title: 'Billed', versions: '*', getter: e => money(
        (e.total || []).find(t => t?.category?.coding?.[0]?.code === 'submitted')?.amount || e.total?.[0]?.amount
      ) },
  ]
}
