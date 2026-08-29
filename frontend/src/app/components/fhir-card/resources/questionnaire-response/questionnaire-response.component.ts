import {ChangeDetectorRef, Component, Input, OnInit, ChangeDetectionStrategy} from '@angular/core';
import {NgbCollapseModule} from '@ng-bootstrap/ng-bootstrap';
import {CommonModule} from '@angular/common';
import {BadgeComponent} from '../../common/badge/badge.component';
import {TableComponent} from '../../common/table/table.component';
import {Router, RouterModule} from '@angular/router';
import {FhirCardComponentInterface} from '../../fhir-card/fhir-card-component-interface';
import {TableRowItem, TableRowItemDataType} from '../../common/table/table-row-item';
import {QuestionnaireResponseModel} from '../../../../../lib/models/resources/questionnaire-response-model';

@Component({
    imports: [NgbCollapseModule, CommonModule, BadgeComponent, TableComponent, RouterModule],
    selector: 'fhir-questionnaire-response',
    templateUrl: './questionnaire-response.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrls: ['./questionnaire-response.component.scss']
})
export class QuestionnaireResponseComponent implements OnInit, FhirCardComponentInterface {
  @Input() displayModel: QuestionnaireResponseModel
  @Input() showDetails = true
  @Input() isCollapsed = false

  tableData: TableRowItem[] = []

  constructor(public changeRef: ChangeDetectorRef, public router: Router) { }

  ngOnInit(): void {
    if (!this.displayModel) { return }
    this.tableData.push(
      {
        label: 'Questionnaire',
        data: this.displayModel?.questionnaire,
        enabled: !!this.displayModel?.questionnaire,
      },
      {
        label: 'Subject',
        data: this.displayModel?.subject,
        data_type: TableRowItemDataType.Reference,
        enabled: !!this.displayModel?.subject,
      },
      {
        label: 'Authored',
        data: this.displayModel?.authored,
        enabled: !!this.displayModel?.authored,
      },
      {
        label: 'Author',
        data: this.displayModel?.author,
        data_type: TableRowItemDataType.Reference,
        enabled: !!this.displayModel?.author,
      },
    )
  }

  markForCheck(){
    this.changeRef.markForCheck()
  }
}
