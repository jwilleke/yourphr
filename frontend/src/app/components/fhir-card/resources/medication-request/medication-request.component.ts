import {ChangeDetectorRef, Component, Input, OnInit} from '@angular/core';
import {FhirCardComponentInterface} from '../../fhir-card/fhir-card-component-interface';
import {TableRowItem, TableRowItemDataType} from '../../common/table/table-row-item';
import {Router, RouterModule} from '@angular/router';
import {MedicationRequestModel} from '../../../../../lib/models/resources/medication-request-model';
import {NgbCollapseModule} from "@ng-bootstrap/ng-bootstrap";
import {CommonModule} from "@angular/common";
import {BadgeComponent} from "../../common/badge/badge.component";
import {TableComponent} from "../../common/table/table.component";
import {GlossaryLookupComponent} from '../../../glossary-lookup/glossary-lookup.component';

@Component({
    imports: [NgbCollapseModule, CommonModule, BadgeComponent, TableComponent, GlossaryLookupComponent, RouterModule],
    selector: 'fhir-medication-request',
    templateUrl: './medication-request.component.html',
    styleUrls: ['./medication-request.component.scss']
})
export class MedicationRequestComponent implements OnInit, FhirCardComponentInterface {
  @Input() displayModel: MedicationRequestModel | null
  @Input() showDetails = true
  @Input() isCollapsed = false

  //these are used to populate the description of the resource. May not be available for all resources
  resourceCode?: string;
  resourceCodeSystem?: string;

  tableData: TableRowItem[] = []

  constructor(public changeRef: ChangeDetectorRef, public router: Router) {}

  ngOnInit(): void {

    this.resourceCode = this.displayModel?.medication_codeable_concept?.code
    this.resourceCodeSystem = this.displayModel?.medication_codeable_concept?.system

    this.tableData = [
      {
        label: 'Medication',
        data: this.displayModel?.medication_codeable_concept,
        data_type: TableRowItemDataType.Coding,
        enabled: !!this.displayModel?.medication_codeable_concept,
      },
      {
        // medication[x] as a Reference to a (US Core) Medication resource
        label: 'Medication',
        data: this.displayModel?.medication_reference,
        data_type: TableRowItemDataType.Reference,
        enabled: !this.displayModel?.medication_codeable_concept && !!this.displayModel?.medication_reference,
      },
      {
        label: 'Status',
        data: this.displayModel?.status,
        enabled: !!this.displayModel?.status,
      },
      {
        label: 'Patient',
        data: this.displayModel?.subject,
        data_type: TableRowItemDataType.Reference,
        enabled: !!this.displayModel?.subject,
      },
      {
        label: 'Encounter',
        data: this.displayModel?.encounter,
        data_type: TableRowItemDataType.Reference,
        enabled: !!this.displayModel?.encounter,
      },
      {
        label: 'Reported by',
        data: this.displayModel?.reported_reference,
        data_type: TableRowItemDataType.Reference,
        enabled: !!this.displayModel?.reported_reference,
      },
      {
        label: 'Requester',
        data: this.displayModel?.requester,
        data_type: TableRowItemDataType.Reference,
        enabled: !!this.displayModel?.requester,
      },
      {
        label: 'Created',
        data: this.displayModel?.created,
        enabled: !!this.displayModel?.created,
      },
      {
        label: 'Type of request',
        data: this.displayModel?.intent,
        enabled: !!this.displayModel?.intent,
      },
      {
        label: 'Reason',
        data: this.displayModel?.reason_code,
        data_type: TableRowItemDataType.Coding,
        enabled: !!this.displayModel?.reason_code,
      },
      {
        label: 'Dosage',
        data: this.displayModel?.dosage_instruction_text,
        enabled: !!this.displayModel?.dosage_instruction_text,
      },
      {
        // US Core MS: dispenseRequest.quantity (#283)
        label: 'Quantity',
        data: this.displayModel?.dispense_request_quantity,
        enabled: !!this.displayModel?.dispense_request_quantity,
      },
      {
        // US Core MS: dispenseRequest.numberOfRepeatsAllowed (#283)
        label: 'Refills',
        data: this.displayModel?.dispense_request_refills != null ? String(this.displayModel.dispense_request_refills) : undefined,
        enabled: this.displayModel?.dispense_request_refills != null,
      },
      {
        label: 'Category',
        data: (this.displayModel?.categories || []).join(', '),
        enabled: !!this.displayModel?.categories?.length,
      },
    ];
  }
  markForCheck(){
    this.changeRef.markForCheck()
  }
}
