import {ChangeDetectorRef, Component, EventEmitter, Input, OnInit, Output} from '@angular/core';
import {FhirCardEditableComponentInterface} from '../../fhir-card/fhir-card-component-interface';
import {TableRowItem, TableRowItemDataType} from '../../common/table/table-row-item';
import {Router, RouterModule} from '@angular/router';
import {DiagnosticReportModel} from '../../../../../lib/models/resources/diagnostic-report-model';
import {NgbCollapseModule, NgbNavModule} from '@ng-bootstrap/ng-bootstrap';
import {CommonModule} from '@angular/common';
import {BadgeComponent} from '../../common/badge/badge.component';
import {TableComponent} from '../../common/table/table.component';
import {BinaryComponent} from '../binary/binary.component';
import {GlossaryLookupComponent} from '../../../glossary-lookup/glossary-lookup.component';
import { FastenDisplayModel } from 'src/lib/models/fasten/fasten-display-model';

@Component({
    imports: [NgbCollapseModule, NgbNavModule, CommonModule, BadgeComponent, TableComponent, RouterModule, BinaryComponent, GlossaryLookupComponent],
    selector: 'fhir-diagnostic-report',
    templateUrl: './diagnostic-report.component.html',
    styleUrls: ['./diagnostic-report.component.scss']
})
export class DiagnosticReportComponent implements OnInit, FhirCardEditableComponentInterface {
  @Input() displayModel: DiagnosticReportModel
  @Input() showDetails = true
  @Input() isCollapsed = false
  @Input() isEditable = false

  @Output() unlinkRequested: EventEmitter<FastenDisplayModel> = new EventEmitter<FastenDisplayModel>()
  @Output() editRequested: EventEmitter<FastenDisplayModel> = new EventEmitter<FastenDisplayModel>()

  active = 0

  //these are used to populate the description of the resource. May not be available for all resources
  resourceCode?: string;
  resourceCodeSystem?: string;

  tableData: TableRowItem[] = []

  constructor(public changeRef: ChangeDetectorRef, public router: Router) {}


  ngOnInit(): void {
    this.resourceCode = this.displayModel?.code_coding?.[0]?.code
    this.resourceCodeSystem = this.displayModel?.code_coding?.[0]?.system

    // US Core MS (Lab): result references → the linked Observations carry the actual values
    // (resolved via the related-resources graph); here we surface their labels/links.
    const results = (this.displayModel?.result || [])
      .map((r) => r?.display || r?.reference)
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
        label: 'Issued',
        data: this.displayModel?.issued,
        enabled: !!this.displayModel?.issued,
      },
      {
        label: 'Results',
        data: results,
        enabled: (this.displayModel?.result?.length || 0) > 0,
      },
      // {
      //   label: 'Category',
      //   data: this.displayModel?.category_coding,
      //   data_type: TableRowItemDataType.CodingList,
      //   enabled: this.displayModel?.has_category_coding,
      // },
      {
        label: 'Performer',
        data: this.displayModel?.performer,
        data_type: TableRowItemDataType.Reference,
        enabled: this.displayModel?.has_performer,
      },
      {
        label: 'Conclusion',
        data: this.displayModel?.conclusion,
        enabled: !!this.displayModel?.conclusion,
      },
    ];

    for(const categoryCodeable of (this.displayModel?.category_coding || [])){
      this.tableData.push({
        label: `Category`,
        data_type: TableRowItemDataType.CodableConcept,
        data: categoryCodeable,
        enabled: true,
      })
    }
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
