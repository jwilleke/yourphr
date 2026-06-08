import {ChangeDetectorRef, Component, Input, OnInit} from '@angular/core';
import { NgbCollapseModule } from '@ng-bootstrap/ng-bootstrap';
import {CommonModule} from '@angular/common';
import {BadgeComponent} from '../../common/badge/badge.component';
import {TableComponent} from '../../common/table/table.component';
import {Router, RouterModule} from '@angular/router';
import {TableRowItem, TableRowItemDataType} from '../../common/table/table-row-item';
import {ObservationModel} from '../../../../../lib/models/resources/observation-model';
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
        label: 'Value',
        data: this.displayModel?.value_model?.display(),
        enabled: !!this.displayModel?.value_model,
      },
      {
        label: 'Reference',
        data: this.displayModel?.reference_range.display(),
        enabled: !!this.displayModel?.reference_range.hasValue(),
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

    // Surface the declared US Core profile — only when the resource actually claims one via
    // meta.profile (we don't present an inferred classification as if it were declared).
    this.tableData.push({
      label: 'US Core Profile',
      data: this.displayModel?.us_core_profile?.profile?.display,
      enabled: !this.displayModel?.us_core_profile?.inferred && !!this.displayModel?.us_core_profile?.profile,
    })
  }

  markForCheck(){
    this.changeRef.markForCheck()
  }
}
