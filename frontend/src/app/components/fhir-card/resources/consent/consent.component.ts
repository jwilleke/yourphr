import {ChangeDetectorRef, Component, Input, OnInit, ChangeDetectionStrategy} from '@angular/core';
import {NgbCollapseModule} from '@ng-bootstrap/ng-bootstrap';
import {CommonModule} from '@angular/common';
import {Router, RouterModule} from '@angular/router';
import {BadgeComponent} from '../../common/badge/badge.component';
import {TableComponent} from '../../common/table/table.component';
import {TableRowItem, TableRowItemDataType} from '../../common/table/table-row-item';
import {FhirCardComponentInterface} from '../../fhir-card/fhir-card-component-interface';
import {ConsentModel} from '../../../../../lib/models/resources/consent-model';

@Component({
    imports: [NgbCollapseModule, CommonModule, BadgeComponent, TableComponent, RouterModule],
    selector: 'fhir-consent',
    templateUrl: './consent.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrls: ['./consent.component.scss']
})
export class ConsentComponent implements OnInit, FhirCardComponentInterface {
  @Input() displayModel: ConsentModel | null
  @Input() showDetails = true
  @Input() isCollapsed = false

  tableData: TableRowItem[] = []

  constructor(public changeRef: ChangeDetectorRef, public router: Router) {}

  ngOnInit(): void {
    this.tableData = [
      {
        label: 'Scope',
        data: this.displayModel?.scope,
        data_type: TableRowItemDataType.CodableConcept,
        enabled: !!this.displayModel?.scope,
      },
      {
        label: 'Category',
        data: this.displayModel?.category?.[0],
        data_type: TableRowItemDataType.CodableConcept,
        enabled: !!this.displayModel?.category?.[0],
      },
      {
        label: 'Patient',
        data: this.displayModel?.patient,
        data_type: TableRowItemDataType.Reference,
        enabled: !!this.displayModel?.patient,
      },
      {
        label: 'Date',
        data: this.displayModel?.date_time,
        enabled: !!this.displayModel?.date_time,
      },
      {
        label: 'Document',
        data: this.displayModel?.document_title,
        enabled: !!this.displayModel?.document_title,
      },
      {
        label: 'Document type',
        data: this.displayModel?.document_content_type,
        enabled: !!this.displayModel?.document_content_type,
      },
      {
        label: 'Policy',
        data: this.displayModel?.policy_display,
        enabled: !!this.displayModel?.policy_display,
      },
      {
        label: 'Provision',
        data: this.displayModel?.provision_type,
        enabled: !!this.displayModel?.provision_type,
      },
      {
        label: 'Provision start',
        data: this.displayModel?.provision_period_start,
        enabled: !!this.displayModel?.provision_period_start,
      },
      {
        label: 'Verified',
        data: this.displayModel?.verified === true ? 'Yes' : (this.displayModel?.verified === false ? 'No' : undefined),
        enabled: this.displayModel?.verified === true || this.displayModel?.verified === false,
      },
      {
        label: 'Verification date',
        data: this.displayModel?.verification_date,
        enabled: !!this.displayModel?.verification_date,
      },
    ]
  }

  markForCheck(){
    this.changeRef.markForCheck()
  }
}
