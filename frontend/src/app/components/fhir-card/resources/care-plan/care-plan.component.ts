import {ChangeDetectorRef, Component, Input, OnInit, ChangeDetectionStrategy} from '@angular/core';
import {NgbCollapseModule} from '@ng-bootstrap/ng-bootstrap';
import {CommonModule} from '@angular/common';
import {DomSanitizer, SafeHtml} from '@angular/platform-browser';
import {Router, RouterModule} from '@angular/router';
import {BadgeComponent} from '../../common/badge/badge.component';
import {TableComponent} from '../../common/table/table.component';
import {TableRowItem, TableRowItemDataType} from '../../common/table/table-row-item';
import {FhirCardComponentInterface} from '../../fhir-card/fhir-card-component-interface';
import {CarePlanModel} from '../../../../../lib/models/resources/care-plan-model';

@Component({
    imports: [NgbCollapseModule, CommonModule, BadgeComponent, TableComponent, RouterModule],
    selector: 'fhir-care-plan',
    templateUrl: './care-plan.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrls: ['./care-plan.component.scss']
})
export class CarePlanComponent implements OnInit, FhirCardComponentInterface {
  @Input() displayModel: CarePlanModel | null
  @Input() showDetails = true
  @Input() isCollapsed = false

  tableData: TableRowItem[] = []
  // US Core MS: the narrative `text` — the human-readable assessment & plan. Rendered as trusted
  // HTML (same pattern as the html datatype component); FHIR narrative is the patient's own record.
  narrative: SafeHtml | null = null

  constructor(public changeRef: ChangeDetectorRef, public router: Router, private sanitizer: DomSanitizer) {}

  ngOnInit(): void {
    if (this.displayModel?.text_div) {
      this.narrative = this.sanitizer.bypassSecurityTrustHtml(this.displayModel.text_div)
    }

    const goals = (this.displayModel?.goals || []).map((g) => g?.display || g?.reference).filter(Boolean).join(', ')
    const addresses = (this.displayModel?.addresses || []).map((a) => a?.display || a?.reference).filter(Boolean).join(', ')
    const activities = (this.displayModel?.activity || []).map((a: any) => a?.title).filter(Boolean).join(', ')

    this.tableData = [
      {
        // US Core MS: intent (required)
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
        label: 'Period end',
        data: this.displayModel?.period_end,
        enabled: !!this.displayModel?.period_end,
      },
      {
        label: 'Description',
        data: this.displayModel?.description,
        enabled: !!this.displayModel?.description,
      },
      {
        label: 'Goals',
        data: goals,
        enabled: goals.length > 0,
      },
      {
        label: 'Addresses',
        data: addresses,
        enabled: addresses.length > 0,
      },
      {
        label: 'Activities',
        data: activities,
        enabled: activities.length > 0,
      },
    ]

    // US Core MS: category (must include the assess-plan category)
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
