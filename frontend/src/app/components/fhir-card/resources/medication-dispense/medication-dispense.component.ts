import {ChangeDetectorRef, Component, Input, OnInit} from '@angular/core';
import {FhirCardComponentInterface} from '../../fhir-card/fhir-card-component-interface';
import {TableRowItem, TableRowItemDataType} from '../../common/table/table-row-item';
import {Router, RouterModule} from '@angular/router';
import {MedicationDispenseModel} from '../../../../../lib/models/resources/medication-dispense-model';
import {NgbCollapseModule} from "@ng-bootstrap/ng-bootstrap";
import {CommonModule} from "@angular/common";
import {BadgeComponent} from "../../common/badge/badge.component";
import {TableComponent} from "../../common/table/table.component";
import {GlossaryLookupComponent} from '../../../glossary-lookup/glossary-lookup.component';
import * as _ from "lodash";

@Component({
    imports: [NgbCollapseModule, CommonModule, BadgeComponent, TableComponent, GlossaryLookupComponent, RouterModule],
    selector: 'fhir-medication-dispense',
    templateUrl: './medication-dispense.component.html',
    styleUrls: ['./medication-dispense.component.scss']
})
export class MedicationDispenseComponent implements OnInit, FhirCardComponentInterface {
  @Input() displayModel: MedicationDispenseModel | null
  @Input() showDetails = true
  @Input() isCollapsed = false

  //these are used to populate the description of the resource. May not be available for all resources
  resourceCode?: string;
  resourceCodeSystem?: string;

  tableData: TableRowItem[] = []

  constructor(public changeRef: ChangeDetectorRef, public router: Router) {}

  ngOnInit(): void {
    this.resourceCode = _.get(this.displayModel?.medication_coding, 'code')
    this.resourceCodeSystem = _.get(this.displayModel?.medication_coding, 'system')

    this.tableData = [
      {
        label: 'Medication',
        data: this.displayModel?.medication_coding,
        data_type: TableRowItemDataType.Coding,
        enabled: !!this.displayModel?.medication_coding,
      },
      {
        // non-US-Core / no coding: fall back to the resolved title text
        label: 'Medication',
        data: this.displayModel?.medication_title,
        enabled: !this.displayModel?.medication_coding && !!this.displayModel?.medication_title,
      },
      {
        label: 'Status',
        data: this.displayModel?.status,
        enabled: !!this.displayModel?.status,
      },
      {
        label: 'Type',
        data: this.displayModel?.type_coding,
        data_type: TableRowItemDataType.Coding,
        enabled: !!this.displayModel?.type_coding,
      },
      {
        label: 'Patient',
        data: this.displayModel?.subject,
        data_type: TableRowItemDataType.Reference,
        enabled: !!this.displayModel?.subject,
      },
      {
        label: 'Quantity',
        data: this.displayModel?.quantity,
        enabled: !!this.displayModel?.quantity,
      },
      {
        label: 'Handed over',
        data: this.displayModel?.when_handed_over,
        enabled: !!this.displayModel?.when_handed_over,
      },
      {
        label: 'Prepared',
        data: this.displayModel?.when_prepared,
        enabled: !!this.displayModel?.when_prepared,
      },
    ];
  }
  markForCheck(){
    this.changeRef.markForCheck()
  }
}
