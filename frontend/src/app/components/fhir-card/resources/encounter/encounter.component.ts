import {ChangeDetectorRef, Component, EventEmitter, Input, OnInit, Output} from '@angular/core';
import {NgbCollapseModule} from '@ng-bootstrap/ng-bootstrap';
import {CommonModule} from '@angular/common';
import {BadgeComponent} from '../../common/badge/badge.component';
import {TableComponent} from '../../common/table/table.component';
import {GlossaryLookupComponent} from '../../../glossary-lookup/glossary-lookup.component';
import {Router, RouterModule} from '@angular/router';
import {TableRowItem, TableRowItemDataType} from '../../common/table/table-row-item';
import {FhirCardEditableComponentInterface} from '../../fhir-card/fhir-card-component-interface';
import {EncounterModel} from '../../../../../lib/models/resources/encounter-model';
import { FastenDisplayModel } from 'src/lib/models/fasten/fasten-display-model';

@Component({
    imports: [NgbCollapseModule, CommonModule, BadgeComponent, TableComponent, GlossaryLookupComponent, RouterModule],
    selector: 'fhir-encounter',
    templateUrl: './encounter.component.html',
    styleUrls: ['./encounter.component.scss']
})
export class EncounterComponent implements OnInit, FhirCardEditableComponentInterface {
  @Input() displayModel: EncounterModel | null
  @Input() showDetails = true
  @Input() isCollapsed = false
  @Input() isEditable = false

  @Output() unlinkRequested: EventEmitter<FastenDisplayModel> = new EventEmitter<FastenDisplayModel>()
  @Output() editRequested: EventEmitter<FastenDisplayModel> = new EventEmitter<FastenDisplayModel>()

  //these are used to populate the description of the resource. May not be available for all resources
  resourceCode?: string;
  resourceCodeSystem?: string;

  tableData: TableRowItem[] = []

  constructor(public changeRef: ChangeDetectorRef, public router: Router) { }

  ngOnInit(): void {
    // US Core Encounter Must-Support: type, class, status, period, participant, reasonCode,
    // hospitalization.dischargeDisposition, location. Each row is gated on presence (detect-don't-
    // require), so a conformant Encounter shows the full set and a sparse non-US-Core one shows only
    // what it has — the title fallback (model.display) keeps it from rendering blank.
    const participants = (this.displayModel?.participant || [])
      .map((p) => {
        const name = p.display || p.text || p.reference?.reference;
        if (!name) { return null; }
        return p.role ? `${p.role}: ${name}` : name;
      })
      .filter(Boolean) as string[];

    this.tableData = [
      {
        label: 'Type',
        data: this.displayModel?.encounter_type?.[0],
        data_type: TableRowItemDataType.CodableConcept,
        enabled: !!this.displayModel?.encounter_type?.[0],
      },
      {
        label: 'Class',
        data: this.displayModel?.resource_class,
        enabled: !!this.displayModel?.resource_class,
      },
      {
        label: 'Status',
        data: this.displayModel?.resource_status,
        enabled: !!this.displayModel?.resource_status,
      },
      {
        label: 'Reason',
        data: this.displayModel?.reasonCode?.[0],
        data_type: TableRowItemDataType.CodableConcept,
        enabled: !!this.displayModel?.reasonCode?.[0],
      },
      {
        label: 'Participants',
        data: participants.join(', '),
        enabled: participants.length > 0,
      },
      {
        label: 'Discharge disposition',
        data: this.displayModel?.discharge_disposition,
        data_type: TableRowItemDataType.CodableConcept,
        enabled: !!this.displayModel?.discharge_disposition,
      },
      {
        label: 'Location',
        data: this.displayModel?.location_display,
        enabled: !!this.displayModel?.location_display,
      },
      {
        label: 'End date',
        data: this.displayModel?.period_end,
        enabled: !!this.displayModel?.period_end,
      },
    ];
  }
  markForCheck(){
    this.changeRef.markForCheck()
  }

  onUnlinkClicked() {
    this.unlinkRequested.emit(this.displayModel)
  }

  onEditClicked() {
    this.editRequested.emit(this.displayModel)
  }
}
