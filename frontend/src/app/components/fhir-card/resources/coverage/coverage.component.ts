import {ChangeDetectorRef, Component, Input, OnInit, ChangeDetectionStrategy} from '@angular/core';
import {NgbCollapseModule} from '@ng-bootstrap/ng-bootstrap';
import {CommonModule} from '@angular/common';
import {Router, RouterModule} from '@angular/router';
import {BadgeComponent} from '../../common/badge/badge.component';
import {TableComponent} from '../../common/table/table.component';
import {TableRowItem, TableRowItemDataType} from '../../common/table/table-row-item';
import {FhirCardComponentInterface} from '../../fhir-card/fhir-card-component-interface';
import {CoverageModel} from '../../../../../lib/models/resources/coverage-model';

@Component({
    imports: [NgbCollapseModule, CommonModule, BadgeComponent, TableComponent, RouterModule],
    selector: 'fhir-coverage',
    templateUrl: './coverage.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrls: ['./coverage.component.scss']
})
export class CoverageComponent implements OnInit, FhirCardComponentInterface {
  @Input() displayModel: CoverageModel | null
  @Input() showDetails = true
  @Input() isCollapsed = false

  tableData: TableRowItem[] = []

  constructor(public changeRef: ChangeDetectorRef, public router: Router) {}

  ngOnInit(): void {
    // US Core MS: payor (Organization)
    const payors = (this.displayModel?.payors || [])
      .map((p) => p?.display || p?.reference)
      .filter(Boolean)
      .join(', ')

    this.tableData = [
      {
        // US Core MS: type
        label: 'Type',
        data: this.displayModel?.coverage_type,
        data_type: TableRowItemDataType.CodableConcept,
        enabled: !!this.displayModel?.coverage_type,
      },
      {
        // US Core MS: beneficiary (Patient)
        label: 'Beneficiary',
        data: this.displayModel?.beneficiary,
        data_type: TableRowItemDataType.Reference,
        enabled: !!this.displayModel?.beneficiary,
      },
      {
        // US Core MS: relationship
        label: 'Relationship',
        data: this.displayModel?.relationship,
        data_type: TableRowItemDataType.CodableConcept,
        enabled: !!this.displayModel?.relationship,
      },
      {
        // US Core MS: subscriberId
        label: 'Subscriber ID',
        data: this.displayModel?.subscriber_id,
        enabled: !!this.displayModel?.subscriber_id,
      },
      {
        label: 'Payor',
        data: payors,
        enabled: payors.length > 0,
      },
      {
        label: 'Dependent',
        data: this.displayModel?.dependent,
        enabled: !!this.displayModel?.dependent,
      },
      {
        label: 'Period end',
        data: this.displayModel?.period_end,
        enabled: !!this.displayModel?.period_end,
      },
    ]

    // class (group/plan): one row per class entry, labelled by its name or class-type code.
    for (const cls of (this.displayModel?.coverage_class || [])) {
      const label = cls.name || (cls.type as any)?.coding?.[0]?.code || (cls.type as any)?.text || 'Class'
      const value = cls.name && cls.value ? `${cls.value}` : (cls.value || cls.name)
      this.tableData.push({
        label,
        data: value,
        enabled: !!value,
      })
    }
  }

  markForCheck(){
    this.changeRef.markForCheck()
  }
}
