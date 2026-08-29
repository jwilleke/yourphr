import {ChangeDetectorRef, Component, Input, OnInit, ChangeDetectionStrategy} from '@angular/core';
import {NgbCollapseModule} from '@ng-bootstrap/ng-bootstrap';

import {TableComponent} from '../../common/table/table.component';
import {Router, RouterModule} from '@angular/router';
import {FhirCardComponentInterface} from '../../fhir-card/fhir-card-component-interface';
import {TableRowItem, TableRowItemDataType} from '../../common/table/table-row-item';
import {ProvenanceModel} from '../../../../../lib/models/resources/provenance-model';

@Component({
    imports: [NgbCollapseModule, TableComponent, RouterModule],
    selector: 'fhir-provenance',
    templateUrl: './provenance.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrls: ['./provenance.component.scss']
})
export class ProvenanceComponent implements OnInit, FhirCardComponentInterface {
  @Input() displayModel: ProvenanceModel
  @Input() showDetails = true
  @Input() isCollapsed = false

  tableData: TableRowItem[] = []

  constructor(public changeRef: ChangeDetectorRef, public router: Router) { }

  ngOnInit(): void {
    if (!this.displayModel) { return }

    this.tableData.push({
      label: 'Recorded',
      data: this.displayModel?.recorded,
      enabled: !!this.displayModel?.recorded,
    })

    if (this.displayModel?.activity) {
      this.tableData.push({
        label: 'Activity',
        data: this.displayModel?.activity,
        data_type: TableRowItemDataType.CodableConcept,
        enabled: !!this.displayModel?.activity?.coding?.length,
      })
    }

    // agent[] — who was involved (author / transmitter / …) and on whose behalf.
    for (const agent of (this.displayModel?.agents || [])) {
      this.tableData.push({
        label: agent.type ? `Agent — ${agent.type}` : 'Agent',
        data: agent.who,
        data_type: TableRowItemDataType.Reference,
        enabled: !!agent.who,
      })
      if (agent.on_behalf_of) {
        this.tableData.push({
          label: 'On behalf of',
          data: agent.on_behalf_of,
          data_type: TableRowItemDataType.Reference,
          enabled: !!agent.on_behalf_of,
        })
      }
    }

    // target[] — the resource(s) this provenance is about.
    for (const target of (this.displayModel?.targets || [])) {
      this.tableData.push({
        label: 'Target',
        data: target,
        data_type: TableRowItemDataType.Reference,
        enabled: !!target,
      })
    }
  }

  markForCheck(){
    this.changeRef.markForCheck()
  }
}
