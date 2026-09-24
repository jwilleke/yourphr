import {Component, Input, OnInit, ChangeDetectionStrategy} from '@angular/core';
import {ResourceFhir} from '../../models/fasten/resource_fhir';
import {EncounterModel} from '../../../lib/models/resources/encounter-model';
import {RecResourceRelatedDisplayModel} from '../../../lib/utils/resource_related_display_model';
import {DiagnosticReportModel} from '../../../lib/models/resources/diagnostic-report-model';
import {FastenDisplayModel} from '../../../lib/models/fasten/fasten-display-model';
import {MedicalRecordWizardComponent} from '../medical-record-wizard/medical-record-wizard.component';
import {NgbModal} from '@ng-bootstrap/ng-bootstrap';

@Component({
    selector: 'app-report-medical-history-timeline-panel',
    templateUrl: './report-medical-history-timeline-panel.component.html',
    styleUrls: ['./report-medical-history-timeline-panel.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class ReportMedicalHistoryTimelinePanelComponent implements OnInit {
  @Input() resourceFhir: ResourceFhir
  displayModel: EncounterModel
  showRaw = false // "Details (raw FHIR)" debug toggle

  constructor(private modalService: NgbModal) { }

  toggleRaw(): void {
    this.showRaw = !this.showRaw
  }

  // typeBadge is the honest FHIR resource type shown on the card (replaces a hardcoded, misleading
  // "Primary" badge that implied a primary-care relationship it never represented).
  get typeBadge(): string {
    return this.resourceFhir?.source_resource_type || ''
  }

  ngOnInit(): void {
    if (!this.resourceFhir) {
      return;
    }

    const parsed = RecResourceRelatedDisplayModel(this.resourceFhir)
    this.displayModel = parsed.displayModel as EncounterModel
  }

  diagnosticReportLink(diagnosticReportRaw: FastenDisplayModel): string {
    const diagnosticReport = diagnosticReportRaw as DiagnosticReportModel
    return diagnosticReport?.is_category_lab_report ?
      '/labs/report/'+ diagnosticReport?.source_id + '/' + diagnosticReport?.source_resource_type + '/' + diagnosticReport?.source_resource_id :
      '/explore/'+ diagnosticReport?.source_id + '/resource/' + diagnosticReport?.source_resource_id + '/'
  }


  // openMedicalRecordWizard() is gone with the button (#684): the wizard's submit path is not
  // served, so the flow failed after the person had typed everything. It returns when it has a
  // server side.

}
