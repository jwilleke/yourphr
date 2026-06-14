import {ChangeDetectorRef, Component, Input, OnInit} from '@angular/core';
import {DiagnosticReportModel} from '../../../../../lib/models/resources/diagnostic-report-model';
import {TableRowItem, TableRowItemDataType} from '../../common/table/table-row-item';
import {Router, RouterModule} from '@angular/router';
import {DocumentReferenceModel} from '../../../../../lib/models/resources/document-reference-model';
import {FhirCardComponentInterface} from '../../fhir-card/fhir-card-component-interface';
import {NgbCollapseModule, NgbNavModule} from '@ng-bootstrap/ng-bootstrap';
import {CommonModule} from '@angular/common';
import {BadgeComponent} from '../../common/badge/badge.component';
import {TableComponent} from '../../common/table/table.component';
import {BinaryComponent} from '../binary/binary.component';
import {GlossaryLookupComponent} from '../../../glossary-lookup/glossary-lookup.component';

@Component({
    imports: [NgbCollapseModule, NgbNavModule, CommonModule, BadgeComponent, TableComponent, RouterModule, BinaryComponent],
    selector: 'fhir-document-reference',
    templateUrl: './document-reference.component.html',
    styleUrls: ['./document-reference.component.scss']
})
export class DocumentReferenceComponent implements OnInit, FhirCardComponentInterface {
  @Input() displayModel: DocumentReferenceModel
  @Input() showDetails = true
  @Input() isCollapsed = false
  tableData: TableRowItem[] = []
  active = 0
  
  constructor(public changeRef: ChangeDetectorRef, public router: Router) {}


  ngOnInit(): void {
    this.tableData = [
      {
        label: 'Description',
        data: this.displayModel?.description,
        enabled: !!this.displayModel?.description,
      },
      {
        label: 'Category',
        data: this.displayModel?.category,
        data_type: TableRowItemDataType.CodableConcept,
        enabled: !!this.displayModel?.category,
      },
      {
        label: 'Status',
        data: this.displayModel?.status,
        enabled: !!this.displayModel?.status,
      },
      {
        label: 'Type',
        data: this.displayModel?.type_coding,
        data_type: TableRowItemDataType.Coding,
        enabled: !!this.displayModel?.type_coding,
      },
      {
        label: 'Patient',
        data: this.displayModel?.subject,
        data_type: TableRowItemDataType.Reference,
        enabled: !!this.displayModel?.subject,
      },
      {
        // US Core MS: context.encounter (#285)
        label: 'Encounter',
        data: this.displayModel?.context?.encounter,
        data_type: TableRowItemDataType.Reference,
        enabled: !!this.displayModel?.context?.encounter,
      },
      {
        // author is a list of References; render the display/reference joined (no ReferenceList row type)
        label: 'Author',
        data: (this.displayModel?.authors || []).map(a => a?.display || a?.reference).filter(Boolean).join(', '),
        enabled: !!this.displayModel?.authors?.length,
      },
      {
        label: 'Date',
        data: this.displayModel?.created_at,
        enabled: !!this.displayModel?.created_at,
      },
    ];
  }
  markForCheck(){
    this.changeRef.markForCheck()
  }
}
