import {ChangeDetectorRef, Component, Input, OnInit} from '@angular/core';
import {NgbCollapseModule} from '@ng-bootstrap/ng-bootstrap';
import {CommonModule} from '@angular/common';
import {Router, RouterModule} from '@angular/router';
import {BadgeComponent} from '../../common/badge/badge.component';
import {TableComponent} from '../../common/table/table.component';
import {TableRowItem, TableRowItemDataType} from '../../common/table/table-row-item';
import {FhirCardComponentInterface} from '../../fhir-card/fhir-card-component-interface';
import {FamilyMemberHistoryModel} from '../../../../../lib/models/resources/family-member-history-model';

@Component({
    imports: [NgbCollapseModule, CommonModule, BadgeComponent, TableComponent, RouterModule],
    selector: 'fhir-family-member-history',
    templateUrl: './family-member-history.component.html',
    styleUrls: ['./family-member-history.component.scss']
})
export class FamilyMemberHistoryComponent implements OnInit, FhirCardComponentInterface {
  @Input() displayModel: FamilyMemberHistoryModel | null
  @Input() showDetails = true
  @Input() isCollapsed = false

  tableData: TableRowItem[] = []

  constructor(public changeRef: ChangeDetectorRef, public router: Router) {}

  ngOnInit(): void {
    const deceased = typeof this.displayModel?.deceased === 'boolean'
      ? (this.displayModel?.deceased ? 'Yes' : 'No')
      : (this.displayModel?.deceased as string | undefined)

    this.tableData = [
      {
        // US Core MS: relationship
        label: 'Relationship',
        data: this.displayModel?.relationship,
        data_type: TableRowItemDataType.CodableConcept,
        enabled: !!this.displayModel?.relationship,
      },
      {
        // US Core MS: name
        label: 'Name',
        data: this.displayModel?.name,
        enabled: !!this.displayModel?.name,
      },
      {
        // US Core MS: sex
        label: 'Sex',
        data: this.displayModel?.sex,
        data_type: TableRowItemDataType.CodableConcept,
        enabled: !!this.displayModel?.sex,
      },
      {
        // US Core MS: patient
        label: 'Patient',
        data: this.displayModel?.patient,
        data_type: TableRowItemDataType.Reference,
        enabled: !!this.displayModel?.patient,
      },
      {
        label: 'Born',
        data: this.displayModel?.born_date,
        enabled: !!this.displayModel?.born_date,
      },
      {
        label: 'Age',
        data: this.displayModel?.age_string,
        enabled: !!this.displayModel?.age_string,
      },
      {
        label: 'Deceased',
        data: deceased,
        enabled: deceased !== undefined && deceased !== null && deceased !== '',
      },
    ]

    // US Core MS: condition (the family member's conditions)
    for (const cond of (this.displayModel?.conditions || [])) {
      if (cond?.code) {
        this.tableData.push({
          label: cond.outcome ? 'Condition (outcome: ' + (cond.outcome.text || cond.outcome.coding?.[0]?.display || 'recorded') + ')' : 'Condition',
          data: cond.code,
          data_type: TableRowItemDataType.CodableConcept,
          enabled: true,
        })
      }
    }
  }

  markForCheck(){
    this.changeRef.markForCheck()
  }
}
