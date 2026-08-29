import { CommonModule } from "@angular/common";
import { ChangeDetectorRef, Component, Input, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { NgbCollapseModule } from "@ng-bootstrap/ng-bootstrap";
import * as _ from "lodash";
import { ImmunizationModel } from '../../../../../lib/models/resources/immunization-model';
import { BadgeComponent } from "../../common/badge/badge.component";
import { TableRowItem, TableRowItemDataType } from '../../common/table/table-row-item';
import { TableComponent } from "../../common/table/table.component";
import { FhirCardComponentInterface } from '../../fhir-card/fhir-card-component-interface';

@Component({
    imports: [NgbCollapseModule, CommonModule, BadgeComponent, TableComponent, RouterModule],
    selector: 'fhir-immunization',
    templateUrl: './immunization.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrls: ['./immunization.component.scss']
})
export class ImmunizationComponent implements OnInit, FhirCardComponentInterface {
  @Input() displayModel: ImmunizationModel
  @Input() showDetails = true
  @Input() isCollapsed = false

  tableData: TableRowItem[] = []

  constructor(public changeRef: ChangeDetectorRef, public router: Router) {}

  ngOnInit(): void {

    this.tableData.push(
      {
        // US Core MS: statusReason — only present when a dose was not given (status=not-done)
        label: 'Status reason',
        data: this.displayModel?.status_reason,
        data_type: TableRowItemDataType.CodableConcept,
        enabled: !!this.displayModel?.status_reason,
      },
      {
        // US Core MS: primarySource — was this recorded from the primary source, or reported?
        label: 'Primary source',
        data: this.displayModel?.primary_source ? 'Yes' : 'No',
        enabled: this.displayModel?.primary_source !== undefined && this.displayModel?.primary_source !== null,
      },
      {
        label: 'Manufacturer',
        data: this.displayModel?.manufacturer_text,
        enabled: !!this.displayModel?.manufacturer_text,
      },
      {
        // Previously mislabeled "Manufacturer Text" with a broken expression that dropped the
        // lot number; this is the lot number (+ expiration when present).
        label: 'Lot number',
        data: this.displayModel?.lot_number_expiration_date
          ? `${this.displayModel?.lot_number} (expires ${this.displayModel?.lot_number_expiration_date})`
          : this.displayModel?.lot_number,
        enabled: this.displayModel?.has_lot_number,
      },
      {
        label: 'Dosage',
        data:
        [
          _.get(this.displayModel?.dose_quantity, 'value'),
          _.get(this.displayModel?.dose_quantity, 'unit') || _.get(this.displayModel?.dose_quantity, 'code'),
        ].join(' '),
        enabled: this.displayModel?.has_dose_quantity,
      },
      {
        label: 'Patient',
        data: this.displayModel?.patient,
        data_type: TableRowItemDataType.Reference,
        enabled: !!this.displayModel?.patient,
      },
    {
      label: 'Requester',
      data: this.displayModel?.requester,
      data_type: TableRowItemDataType.Reference,
      enabled: !!this.displayModel?.requester,
    },
    {
      label: 'Performer',
      data: this.displayModel?.performer,
      data_type: TableRowItemDataType.Reference,
      enabled: !!this.displayModel?.performer,
    },
    {
      label: 'Route',
      data: this.displayModel?.route,
      data_type: TableRowItemDataType.CodingList,
      enabled: this.displayModel?.has_route,
    },
      {
      label: 'Location',
      data: this.displayModel?.location,
      enabled: !!this.displayModel?.location,
    },
    {
      label: 'Site',
      data: this.displayModel?.site,
      data_type: TableRowItemDataType.CodingList,
      enabled: this.displayModel?.has_site,
    })

  }
  markForCheck(){
    this.changeRef.markForCheck()
  }

}
