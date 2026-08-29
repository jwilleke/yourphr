import {ChangeDetectorRef, Component, Input, OnInit, ChangeDetectionStrategy} from '@angular/core';
import {NgbCollapseModule} from '@ng-bootstrap/ng-bootstrap';
import {CommonModule} from '@angular/common';
import {Router, RouterModule} from '@angular/router';
import {BadgeComponent} from '../../common/badge/badge.component';
import {TableComponent} from '../../common/table/table.component';
import {TableRowItem, TableRowItemDataType} from '../../common/table/table-row-item';
import {FhirCardComponentInterface} from '../../fhir-card/fhir-card-component-interface';
import {AdverseEventModel} from '../../../../../lib/models/resources/adverse-event-model';

@Component({
    imports: [NgbCollapseModule, CommonModule, BadgeComponent, TableComponent, RouterModule],
    selector: 'fhir-adverse-event',
    templateUrl: './adverse-event.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrls: ['./adverse-event.component.scss']
})
export class AdverseEventComponent implements OnInit, FhirCardComponentInterface {
  @Input() displayModel: AdverseEventModel | null
  @Input() showDetails = true
  @Input() isCollapsed = false

  tableData: TableRowItem[] = []

  constructor(public changeRef: ChangeDetectorRef, public router: Router) {}

  ngOnInit(): void {
    const actualityLabel =
      this.displayModel?.actuality === 'potential'
        ? 'Near miss (potential)'
        : this.displayModel?.actuality === 'actual'
          ? 'Actual event'
          : this.displayModel?.actuality;

    this.tableData = [
      {
        label: 'Actuality',
        data: actualityLabel,
        enabled: !!this.displayModel?.actuality,
      },
      {
        label: 'Event',
        data: this.displayModel?.event,
        data_type: TableRowItemDataType.CodableConcept,
        enabled: !!this.displayModel?.has_event,
      },
      {
        label: 'Event (implicated)',
        data: this.displayModel?.event_display,
        enabled: !this.displayModel?.has_event && !!this.displayModel?.event_display,
      },
      {
        label: 'Date',
        data: this.displayModel?.date,
        enabled: !!this.displayModel?.date,
      },
      {
        label: 'Outcome',
        data: this.displayModel?.outcome_display,
        enabled: !!this.displayModel?.has_outcome,
      },
      {
        label: 'Seriousness',
        data: this.displayModel?.seriousness_display,
        enabled: !!this.displayModel?.has_seriousness,
      },
      {
        label: 'Subject',
        data: this.displayModel?.subject,
        data_type: TableRowItemDataType.Reference,
        enabled: !!this.displayModel?.subject,
      },
    ]

    for (const se of (this.displayModel?.suspect_entities || [])) {
      this.tableData.push({
        label: 'Suspect entity',
        data: se.display || se.reference,
        enabled: !!(se.display || se.reference),
      })
    }
  }

  markForCheck() {
    this.changeRef.markForCheck()
  }
}
