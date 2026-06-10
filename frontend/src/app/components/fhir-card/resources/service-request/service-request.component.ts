import {ChangeDetectorRef, Component, Input, OnInit} from '@angular/core';
import {NgbCollapseModule} from '@ng-bootstrap/ng-bootstrap';
import {CommonModule} from '@angular/common';
import {Router, RouterModule} from '@angular/router';
import {BadgeComponent} from '../../common/badge/badge.component';
import {TableComponent} from '../../common/table/table.component';
import {TableRowItem, TableRowItemDataType} from '../../common/table/table-row-item';
import {FhirCardComponentInterface} from '../../fhir-card/fhir-card-component-interface';
import {ServiceRequestModel} from '../../../../../lib/models/resources/service-request-model';

@Component({
    imports: [NgbCollapseModule, CommonModule, BadgeComponent, TableComponent, RouterModule],
    selector: 'fhir-service-request',
    templateUrl: './service-request.component.html',
    styleUrls: ['./service-request.component.scss']
})
export class ServiceRequestComponent implements OnInit, FhirCardComponentInterface {
  @Input() displayModel: ServiceRequestModel | null
  @Input() showDetails = true
  @Input() isCollapsed = false

  tableData: TableRowItem[] = []

  constructor(public changeRef: ChangeDetectorRef, public router: Router) {}

  ngOnInit(): void {
    this.tableData = [
      {
        // US Core MS: intent
        label: 'Intent',
        data: this.displayModel?.intent,
        enabled: !!this.displayModel?.intent,
      },
      {
        // US Core MS: subject (Patient)
        label: 'Patient',
        data: this.displayModel?.subject,
        data_type: TableRowItemDataType.Reference,
        enabled: !!this.displayModel?.subject,
      },
      {
        // US Core MS: occurrence[x]
        label: 'Occurrence',
        data: this.displayModel?.occurrence_datetime || this.displayModel?.occurrence_period_start,
        enabled: !!(this.displayModel?.occurrence_datetime || this.displayModel?.occurrence_period_start),
      },
      {
        label: 'Authored on',
        data: this.displayModel?.authored_on,
        enabled: !!this.displayModel?.authored_on,
      },
      {
        label: 'Requester',
        data: this.displayModel?.requester,
        data_type: TableRowItemDataType.Reference,
        enabled: !!this.displayModel?.requester,
      },
      {
        label: 'Reason',
        data: this.displayModel?.reason_code?.[0],
        data_type: TableRowItemDataType.CodableConcept,
        enabled: (this.displayModel?.reason_code?.length || 0) > 0,
      },
      {
        label: 'Priority',
        data: this.displayModel?.priority,
        enabled: !!this.displayModel?.priority,
      },
    ]

    // US Core MS: category
    for (const categoryCodeable of (this.displayModel?.category || [])) {
      this.tableData.push({
        label: 'Category',
        data: categoryCodeable,
        data_type: TableRowItemDataType.CodableConcept,
        enabled: true,
      })
    }
  }

  markForCheck(){
    this.changeRef.markForCheck()
  }
}
