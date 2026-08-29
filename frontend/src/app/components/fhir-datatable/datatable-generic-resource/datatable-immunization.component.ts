import {Component, ChangeDetectionStrategy} from '@angular/core';
import {GenericColumnDefn, DatatableGenericResourceComponent} from './datatable-generic-resource.component';

@Component({
    selector: 'fhir-datatable-immunization',
    templateUrl: './datatable-generic-resource.component.html',
    styleUrls: ['./datatable-generic-resource.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class DatatableImmunizationComponent extends DatatableGenericResourceComponent {
  columnDefinitions: GenericColumnDefn[] = [
    { title: 'Vaccine', versions: '*', format: 'codeableConcept', getter: i => i.vaccineCode },
    { title: 'Status', versions: '*', getter: i => i.status },
    { title: 'Date Given', versions: '*', format: 'date', getter: i => i.date || i.occurrenceDateTime || i.occurrenceStringe },
    { title: 'Date Recorded', versions: '*', format: 'date', getter: i => i.recorded }
  ]
}
