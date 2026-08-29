import {ChangeDetectorRef, Component, Input, OnInit, ChangeDetectionStrategy} from '@angular/core';
import {NgbCollapseModule} from '@ng-bootstrap/ng-bootstrap';
import {CommonModule} from '@angular/common';
import {Router, RouterModule} from '@angular/router';
import {BadgeComponent} from '../../common/badge/badge.component';
import {TableComponent} from '../../common/table/table.component';
import {TableRowItem, TableRowItemDataType} from '../../common/table/table-row-item';
import {FhirCardComponentInterface} from '../../fhir-card/fhir-card-component-interface';
import {DeviceModel} from '../../../../../lib/models/resources/device-model';

@Component({
    imports: [NgbCollapseModule, CommonModule, BadgeComponent, TableComponent, RouterModule],
    selector: 'fhir-device',
    templateUrl: './device.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrls: ['./device.component.scss']
})
export class DeviceComponent implements OnInit, FhirCardComponentInterface {
  @Input() displayModel: DeviceModel | null
  @Input() showDetails = true
  @Input() isCollapsed = false

  tableData: TableRowItem[] = []

  constructor(public changeRef: ChangeDetectorRef, public router: Router) {}

  ngOnInit(): void {
    this.tableData = [
      {
        // US Core MS: type
        label: 'Type',
        data: this.displayModel?.get_type_coding,
        data_type: TableRowItemDataType.CodingList,
        enabled: this.displayModel?.has_type_coding,
      },
      {
        // US Core MS: patient
        label: 'Patient',
        data: this.displayModel?.patient,
        data_type: TableRowItemDataType.Reference,
        enabled: !!this.displayModel?.patient,
      },
      {
        // US Core MS: udiCarrier.deviceIdentifier
        label: 'UDI device identifier',
        data: this.displayModel?.get_udi,
        enabled: !!this.displayModel?.get_udi,
      },
      {
        label: 'UDI (human-readable)',
        data: this.displayModel?.udi_carrier_hrf,
        enabled: !!this.displayModel?.udi_carrier_hrf,
      },
      {
        label: 'Distinct identifier',
        data: this.displayModel?.distinct_identifier,
        enabled: !!this.displayModel?.distinct_identifier,
      },
      {
        label: 'Lot number',
        data: this.displayModel?.lot_number,
        enabled: !!this.displayModel?.lot_number,
      },
      {
        label: 'Serial number',
        data: this.displayModel?.serial_number,
        enabled: !!this.displayModel?.serial_number,
      },
      {
        label: 'Manufacture date',
        data: this.displayModel?.manufacture_date,
        enabled: !!this.displayModel?.manufacture_date,
      },
      {
        label: 'Expiration date',
        data: this.displayModel?.get_expiry,
        enabled: this.displayModel?.has_expiry,
      },
    ]
  }

  markForCheck(){
    this.changeRef.markForCheck()
  }
}
