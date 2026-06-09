import {ChangeDetectorRef, Component, Input, OnInit} from '@angular/core';
import {FhirCardComponentInterface} from '../../fhir-card/fhir-card-component-interface';
import {TableRowItem, TableRowItemDataType} from '../../common/table/table-row-item';
import {Router, RouterModule} from '@angular/router';
import {MedicationStatementModel} from '../../../../../lib/models/resources/medication-statement-model';
import {NgbCollapseModule} from "@ng-bootstrap/ng-bootstrap";
import {CommonModule} from "@angular/common";
import {BadgeComponent} from "../../common/badge/badge.component";
import {TableComponent} from "../../common/table/table.component";
import {GlossaryLookupComponent} from '../../../glossary-lookup/glossary-lookup.component';

@Component({
    imports: [NgbCollapseModule, CommonModule, BadgeComponent, TableComponent, GlossaryLookupComponent, RouterModule],
    selector: 'fhir-medication-statement',
    templateUrl: './medication-statement.component.html',
    styleUrls: ['./medication-statement.component.scss']
})
export class MedicationStatementComponent implements OnInit, FhirCardComponentInterface {
  @Input() displayModel: MedicationStatementModel | null
  @Input() showDetails = true
  @Input() isCollapsed = false

  //these are used to populate the description of the resource. May not be available for all resources
  resourceCode?: string;
  resourceCodeSystem?: string;

  tableData: TableRowItem[] = []

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
        // medication[x] as a Reference to a Medication resource
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
        label: 'Effective',
        data: this.displayModel?.effective_date,
        enabled: !!this.displayModel?.effective_date,
      },
      {
        label: 'Asserted',
        data: this.displayModel?.date_asserted,
        enabled: !!this.displayModel?.date_asserted,
      },
      {
        label: 'Reported by',
        data: this.displayModel?.information_source,
        data_type: TableRowItemDataType.Reference,
        enabled: !!this.displayModel?.information_source,
      },
      {
        label: 'Reason',
        data: this.displayModel?.reason_code,
        data_type: TableRowItemDataType.Coding,
        enabled: !!this.displayModel?.reason_code,
      },
      {
        label: 'Dosage',
        data: this.displayModel?.dosage_text,
        enabled: !!this.displayModel?.dosage_text,
      },
      {
        label: 'Category',
        data: (this.displayModel?.categories || []).join(', '),
        enabled: !!this.displayModel?.categories?.length,
      },
    ];
  }

  constructor(public changeRef: ChangeDetectorRef, public router: Router) {}

  markForCheck(){
    this.changeRef.markForCheck()
  }
}
