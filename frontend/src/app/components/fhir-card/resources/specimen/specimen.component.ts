import {ChangeDetectorRef, Component, Input, OnInit} from '@angular/core';
import {NgbCollapseModule} from '@ng-bootstrap/ng-bootstrap';
import {CommonModule} from '@angular/common';
import {Router, RouterModule} from '@angular/router';
import {BadgeComponent} from '../../common/badge/badge.component';
import {TableComponent} from '../../common/table/table.component';
import {TableRowItem, TableRowItemDataType} from '../../common/table/table-row-item';
import {FhirCardComponentInterface} from '../../fhir-card/fhir-card-component-interface';
import {SpecimenModel} from '../../../../../lib/models/resources/specimen-model';

@Component({
    imports: [NgbCollapseModule, CommonModule, BadgeComponent, TableComponent, RouterModule],
    selector: 'fhir-specimen',
    templateUrl: './specimen.component.html',
    styleUrls: ['./specimen.component.scss']
})
export class SpecimenComponent implements OnInit, FhirCardComponentInterface {
  @Input() displayModel: SpecimenModel | null
  @Input() showDetails = true
  @Input() isCollapsed = false

  tableData: TableRowItem[] = []

  constructor(public changeRef: ChangeDetectorRef, public router: Router) {}

  ngOnInit(): void {
    this.tableData = [
      {
        // US Core MS: type
        label: 'Type',
        data: this.displayModel?.specimen_type,
        data_type: TableRowItemDataType.CodableConcept,
        enabled: !!this.displayModel?.specimen_type,
      },
      {
        // US Core MS: subject (Patient)
        label: 'Patient',
        data: this.displayModel?.subject,
        data_type: TableRowItemDataType.Reference,
        enabled: !!this.displayModel?.subject,
      },
      {
        // US Core MS: collection.collectedDateTime
        label: 'Collected',
        data: this.displayModel?.collected_datetime || this.displayModel?.collection_period_start,
        enabled: !!(this.displayModel?.collected_datetime || this.displayModel?.collection_period_start),
      },
      {
        // US Core MS: collection.bodySite
        label: 'Body site',
        data: this.displayModel?.collection_body_site,
        data_type: TableRowItemDataType.CodableConcept,
        enabled: !!this.displayModel?.collection_body_site,
      },
      {
        label: 'Collection method',
        data: this.displayModel?.collection_method,
        data_type: TableRowItemDataType.CodableConcept,
        enabled: !!this.displayModel?.collection_method,
      },
      {
        label: 'Container',
        data: this.displayModel?.container_type,
        data_type: TableRowItemDataType.CodableConcept,
        enabled: !!this.displayModel?.container_type,
      },
      {
        label: 'Received',
        data: this.displayModel?.received_time,
        enabled: !!this.displayModel?.received_time,
      },
    ]

    // US Core MS: condition
    for (const conditionCodeable of (this.displayModel?.condition || [])) {
      this.tableData.push({
        label: 'Condition',
        data: conditionCodeable,
        data_type: TableRowItemDataType.CodableConcept,
        enabled: true,
      })
    }
  }

  markForCheck(){
    this.changeRef.markForCheck()
  }
}
