import {Component, ChangeDetectionStrategy} from '@angular/core';
import {GenericColumnDefn, DatatableGenericResourceComponent} from './datatable-generic-resource.component';
import {attributeXTime} from './utils';

@Component({
    selector: 'fhir-datatable-device',
    templateUrl: './datatable-generic-resource.component.html',
    styleUrls: ['./datatable-generic-resource.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class DatatableDeviceComponent extends DatatableGenericResourceComponent {
  columnDefinitions: GenericColumnDefn[] = [
    { title: 'Device', versions: '*', getter: d => d.deviceName?.[0]?.name || d.type?.coding?.[0]?.display || d.type?.text },
    { title: 'Manufacturer', versions: '*', getter: d => d.manufacturer },
    { title: 'Model', versions: '*', getter: d => d.modelNumber },
    { title: 'Type', versions: '*', format: 'codeableConcept', getter: d => d.type },
    // R4 udiCarrier is an array; also fall back to distinctIdentifier / serial (implantable devices).
    { title: 'Unique ID', versions: '*', getter: d =>
        d.udi?.name ||
        d.udiCarrier?.[0]?.deviceIdentifier ||
        d.udiCarrier?.deviceIdentifier ||
        d.distinctIdentifier ||
        d.serialNumber },
  ]
}
