import {Component, ChangeDetectionStrategy} from '@angular/core';
import {GenericColumnDefn, DatatableGenericResourceComponent} from './datatable-generic-resource.component';

@Component({
    selector: 'fhir-datatable-medication',
    templateUrl: './datatable-generic-resource.component.html',
    styleUrls: ['./datatable-generic-resource.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class DatatableMedicationComponent extends DatatableGenericResourceComponent {
  columnDefinitions: GenericColumnDefn[] = [
    { title: 'Medication', versions: '*', format: 'codeableConcept', getter: c => c.code },
    { title: 'Date Prescribed', versions: '*', format: 'date', getter: c => c.authoredOn },
    { title: 'Status', 'versions': '*', getter: c => c.status }
  ]
}
