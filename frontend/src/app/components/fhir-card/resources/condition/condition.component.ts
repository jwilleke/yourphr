import {ChangeDetectorRef, Component, Input, OnInit} from '@angular/core';
import {NgbCollapseModule} from '@ng-bootstrap/ng-bootstrap';
import {CommonModule} from '@angular/common';
import {Router, RouterModule} from '@angular/router';
import {BadgeComponent} from '../../common/badge/badge.component';
import {TableComponent} from '../../common/table/table.component';
import {TableRowItem, TableRowItemDataType} from '../../common/table/table-row-item';
import {FhirCardComponentInterface} from '../../fhir-card/fhir-card-component-interface';
import {ConditionModel} from '../../../../../lib/models/resources/condition-model';

@Component({
    imports: [NgbCollapseModule, CommonModule, BadgeComponent, TableComponent, RouterModule],
    selector: 'fhir-condition',
    templateUrl: './condition.component.html',
    styleUrls: ['./condition.component.scss']
})
export class ConditionComponent implements OnInit, FhirCardComponentInterface {
  @Input() displayModel: ConditionModel | null
  @Input() showDetails = true
  @Input() isCollapsed = false

  tableData: TableRowItem[] = []

  constructor(public changeRef: ChangeDetectorRef, public router: Router) {}

  ngOnInit(): void {
    this.tableData = [
      {
        // US Core MS: verificationStatus (clinicalStatus is the header badge)
        label: 'Verification status',
        data: this.displayModel?.verification_status,
        enabled: !!this.displayModel?.verification_status,
      },
      {
        // US Core MS: category — problem-list-item vs health-concern
        label: 'Category',
        data: (this.displayModel?.categories || []).join(', '),
        enabled: (this.displayModel?.categories?.length || 0) > 0,
      },
      {
        // US Core MS: subject (Patient)
        label: 'Patient',
        data: this.displayModel?.subject,
        data_type: TableRowItemDataType.Reference,
        enabled: !!this.displayModel?.subject,
      },
      {
        // US Core MS: onset[x]
        label: 'Onset',
        data: this.displayModel?.onset_datetime,
        enabled: !!this.displayModel?.onset_datetime,
      },
      {
        // US Core MS: abatement[x]
        label: 'Abatement',
        data: this.displayModel?.abatement_datetime,
        enabled: !!this.displayModel?.abatement_datetime,
      },
      {
        // US Core MS: recordedDate
        label: 'Recorded date',
        data: this.displayModel?.date_recorded,
        enabled: !!this.displayModel?.date_recorded,
      },
      {
        // US Core MS: condition-assertedDate extension (#282)
        label: 'Asserted date',
        data: this.displayModel?.asserted_date,
        enabled: !!this.displayModel?.asserted_date,
      },
      {
        label: 'Severity',
        data: this.displayModel?.severity_text,
        enabled: !!this.displayModel?.severity_text,
      },
      {
        label: 'Body site',
        data: this.displayModel?.body_site?.[0],
        data_type: TableRowItemDataType.CodableConcept,
        enabled: !!this.displayModel?.has_body_site,
      },
      {
        label: 'Asserter',
        data: this.displayModel?.asserter,
        data_type: TableRowItemDataType.Reference,
        enabled: !!this.displayModel?.has_asserter,
      },
      {
        label: 'Note',
        data: this.displayModel?.note,
        enabled: !!this.displayModel?.note,
      },
      {
        // US Core MS: meta.lastUpdated (#281)
        label: 'Last updated',
        data: this.displayModel?.meta_last_updated,
        enabled: !!this.displayModel?.meta_last_updated,
      },
    ]
  }

  markForCheck(){
    this.changeRef.markForCheck()
  }
}
