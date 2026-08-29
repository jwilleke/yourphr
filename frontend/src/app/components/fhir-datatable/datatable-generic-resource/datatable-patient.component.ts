import {Component, ChangeDetectionStrategy} from '@angular/core';
import {attributeXTime} from './utils';
import {GenericColumnDefn, DatatableGenericResourceComponent} from './datatable-generic-resource.component';

@Component({
    selector: 'fhir-datatable-patient',
    templateUrl: './datatable-generic-resource.component.html',
    styleUrls: ['./datatable-generic-resource.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class DatatablePatientComponent extends DatatableGenericResourceComponent {
  columnDefinitions: GenericColumnDefn[] = [
    { title: 'Name', versions: '*', format: 'humanName', getter: p => p.name?.[0] },
    { title: 'DOB', versions: '*', getter: p => p.birthDate, format: 'date' },
  ]
}
