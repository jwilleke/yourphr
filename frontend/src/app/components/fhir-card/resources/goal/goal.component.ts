import {ChangeDetectorRef, Component, Input, OnInit, ChangeDetectionStrategy} from '@angular/core';
import {NgbCollapseModule} from '@ng-bootstrap/ng-bootstrap';
import {CommonModule} from '@angular/common';
import {Router, RouterModule} from '@angular/router';
import {BadgeComponent} from '../../common/badge/badge.component';
import {TableComponent} from '../../common/table/table.component';
import {TableRowItem, TableRowItemDataType} from '../../common/table/table-row-item';
import {FhirCardComponentInterface} from '../../fhir-card/fhir-card-component-interface';
import {GoalModel} from '../../../../../lib/models/resources/goal-model';

@Component({
    imports: [NgbCollapseModule, CommonModule, BadgeComponent, TableComponent, RouterModule],
    selector: 'fhir-goal',
    templateUrl: './goal.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrls: ['./goal.component.scss']
})
export class GoalComponent implements OnInit, FhirCardComponentInterface {
  @Input() displayModel: GoalModel | null
  @Input() showDetails = true
  @Input() isCollapsed = false

  tableData: TableRowItem[] = []

  constructor(public changeRef: ChangeDetectorRef, public router: Router) {}

  ngOnInit(): void {
    this.tableData = [
      {
        // US Core MS: achievementStatus
        label: 'Achievement status',
        data: this.displayModel?.achievement_status,
        data_type: TableRowItemDataType.Coding,
        enabled: !!this.displayModel?.achievement_status,
      },
      {
        // US Core MS: subject (Patient)
        label: 'Patient',
        data: this.displayModel?.subject,
        data_type: TableRowItemDataType.Reference,
        enabled: !!this.displayModel?.subject,
      },
      {
        // US Core MS: target.dueDate
        label: 'Target due date',
        data: this.displayModel?.target_due_date,
        enabled: !!this.displayModel?.target_due_date,
      },
      {
        label: 'Priority',
        data: this.displayModel?.priority,
        data_type: TableRowItemDataType.Coding,
        enabled: !!this.displayModel?.priority,
      },
      {
        label: 'Status date',
        data: this.displayModel?.status_date,
        enabled: !!this.displayModel?.status_date,
      },
    ]

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
