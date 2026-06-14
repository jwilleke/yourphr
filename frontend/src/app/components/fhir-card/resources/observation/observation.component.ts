import {ChangeDetectorRef, Component, Input, OnInit} from '@angular/core';
import { NgbCollapseModule } from '@ng-bootstrap/ng-bootstrap';
import {CommonModule} from '@angular/common';
import {BadgeComponent} from '../../common/badge/badge.component';
import {TableComponent} from '../../common/table/table.component';
import {Router, RouterModule} from '@angular/router';
import {TableRowItem, TableRowItemDataType} from '../../common/table/table-row-item';
import {ObservationModel} from '../../../../../lib/models/resources/observation-model';
import {observationProfileLabel} from '../../../../../lib/models/resources/observation-profile-registry';
import { ObservationVisualizationComponent } from '../../common/observation-visualization/observation-visualization.component';

@Component({
    imports: [CommonModule, BadgeComponent, TableComponent, RouterModule, NgbCollapseModule, ObservationVisualizationComponent],
    providers: [],
    selector: 'fhir-observation',
    templateUrl: './observation.component.html',
    styleUrls: ['./observation.component.scss']
})
export class ObservationComponent implements OnInit {
  @Input() displayModel: ObservationModel
  @Input() showDetails = true
  @Input() isCollapsed = false

  tableData: TableRowItem[] = []
  displayVisualization = true

  constructor(public changeRef: ChangeDetectorRef, public router: Router) { }

  ngOnInit(): void {
    if(!this.displayModel){
      return
    }

    const visualizationTypes = this.displayModel?.value_model?.visualizationTypes()

    // If only table is allowed, just don't display anything since we are already displaying
    // everything in tabular format.
    if (visualizationTypes.length == 1 && visualizationTypes[0] == 'table') {
      this.displayVisualization = false
    }

    this.tableData.push(
      {
        label: 'Issued on',
        data: this.displayModel?.effective_date,
        enabled: !!this.displayModel?.effective_date,
      },
      {
        label: 'Subject',
        data: this.displayModel?.subject,
        data_type: TableRowItemDataType.Reference,
        enabled: !!this.displayModel?.subject,
      },
      {
        label: 'Coding',
        data: this.displayModel?.code,
        data_type: TableRowItemDataType.CodableConcept,
        enabled: !!this.displayModel?.code,
      },
      {
        // value[x], or dataAbsentReason (buildValue resolves it). When the observation carries
        // neither a value nor a reason and has no value-bearing components (common in
        // FollowMyHealth exports), say so explicitly rather than render a blank/missing row.
        label: 'Value',
        data: this.displayModel?.value_model ? this.displayModel.value_model.display() : 'No result recorded',
        enabled: !!this.displayModel?.value_model || (this.displayModel?.components?.length || 0) === 0,
      },
      {
        // US Core MS: interpretation (e.g. High / Low / Normal)
        label: 'Interpretation',
        data: this.displayModel?.interpretation,
        data_type: TableRowItemDataType.CodableConcept,
        enabled: !!this.displayModel?.interpretation,
      },
      {
        label: 'Reference',
        data: this.displayModel?.reference_range.display(),
        enabled: !!this.displayModel?.reference_range.hasValue(),
      },
      {
        // US Core MS: specimen (#284)
        label: 'Specimen',
        data: this.displayModel?.specimen,
        data_type: TableRowItemDataType.Reference,
        enabled: !!this.displayModel?.specimen,
      },
      {
        // US Core MS: meta.lastUpdated (#281)
        label: 'Last updated',
        data: this.displayModel?.meta_last_updated,
        enabled: !!this.displayModel?.meta_last_updated,
      }
    )

    // Multi-component observations (e.g. Blood Pressure: systolic / diastolic) — US Core MS (#146).
    for (const component of (this.displayModel?.components || [])) {
      this.tableData.push({
        label: component.label,
        data: component.value_model?.display(),
        enabled: !!component.value_model,
      })
    }

    // Surface the Observation's US Core sub-profile classification. A declared meta.profile shows the
    // named profile (e.g. "Blood Pressure"); an inferred classification (category/LOINC fallback —
    // the common case for non-US-Core exports) shows the kind with an explicit "(inferred)" qualifier
    // so it's never mistaken for a declared conformance claim. Unclassifiable ('other' inferred) → nothing.
    const profileLabel = observationProfileLabel(this.displayModel?.us_core_profile)
    this.tableData.push({
      label: 'Profile',
      data: profileLabel,
      enabled: !!profileLabel,
    })
  }

  markForCheck(){
    this.changeRef.markForCheck()
  }
}
