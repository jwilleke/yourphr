import {ChangeDetectorRef, Component, Input, OnInit, ChangeDetectionStrategy} from '@angular/core';
import {NgbCollapseModule} from '@ng-bootstrap/ng-bootstrap';
import {CommonModule} from '@angular/common';
import {Router, RouterModule} from '@angular/router';
import {BadgeComponent} from '../../common/badge/badge.component';
import {TableComponent} from '../../common/table/table.component';
import {TableRowItem, TableRowItemDataType} from '../../common/table/table-row-item';
import {FhirCardComponentInterface} from '../../fhir-card/fhir-card-component-interface';
import {CareTeamModel} from '../../../../../lib/models/resources/care-team-model';

@Component({
    imports: [NgbCollapseModule, CommonModule, BadgeComponent, TableComponent, RouterModule],
    selector: 'fhir-care-team',
    templateUrl: './care-team.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrls: ['./care-team.component.scss']
})
export class CareTeamComponent implements OnInit, FhirCardComponentInterface {
  @Input() displayModel: CareTeamModel | null
  @Input() showDetails = true
  @Input() isCollapsed = false

  tableData: TableRowItem[] = []

  constructor(public changeRef: ChangeDetectorRef, public router: Router) {}

  ngOnInit(): void {
    // US Core MS: participant.role + participant.member — the people on the team.
    const participants = (this.displayModel?.participants || [])
      .map((p) => {
        const who = p.display || p.reference?.reference
        if (!who) { return null }
        return p.role ? `${p.role}: ${who}` : who
      })
      .filter(Boolean)
      .join(', ')

    this.tableData = [
      {
        // US Core MS: subject (Patient)
        label: 'Patient',
        data: this.displayModel?.subject,
        data_type: TableRowItemDataType.Reference,
        enabled: !!this.displayModel?.subject,
      },
      {
        label: 'Members',
        data: participants,
        enabled: participants.length > 0,
      },
      {
        label: 'Managing organization',
        data: this.displayModel?.managing_organization,
        data_type: TableRowItemDataType.Reference,
        enabled: !!this.displayModel?.managing_organization,
      },
      {
        label: 'Period end',
        data: this.displayModel?.period_end,
        enabled: !!this.displayModel?.period_end,
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
