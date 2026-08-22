import {Component, Input, OnInit, TemplateRef, ViewChild} from '@angular/core';
import {NgbModal} from '@ng-bootstrap/ng-bootstrap';
import {ResourceFhir} from '../../models/fasten/resource_fhir';
import {FastenApiService} from '../../services/fasten-api.service';
import * as fhirpath from 'fhirpath';
import {PractitionerModel} from '../../../lib/models/resources/practitioner-model';
import {Summary} from '../../../app/models/fasten/summary';
import { SettingsService } from 'src/app/services/settings.service';

@Component({
    selector: 'report-header',
    templateUrl: './report-header.component.html',
    styleUrls: ['./report-header.component.scss'],
    standalone: false
})
export class ReportHeaderComponent implements OnInit {
  patient: ResourceFhir = null
  primaryCare: PractitionerModel = null
  lastUpdated: Date = null
  searchEnabled: boolean = false
  @Input() reportHeaderTitle = ""
  @Input() reportHeaderSubTitle = "Organized by condition and encounters"
  @ViewChild('saveReportWarning') saveReportWarning: TemplateRef<any>
  @ViewChild('sendEmailDialog') sendEmailDialog: TemplateRef<any>

  // Send-to-email dialog state (#524)
  emailRecipient = ''
  // PDF for a person to read, FHIR JSON for a system to import. Both are "their records"; which one
  // is useful depends entirely on who is receiving it (#524).
  emailFormat: 'pdf' | 'json' = 'pdf'
  // Save Report offers the same choice for the same reason: a document to read, or a bundle another
  // system can import (#523).
  saveFormat: 'html' | 'json' = 'html'
  emailSending = false
  emailError = ''
  emailSentTo = ''

  constructor(
    private fastenApi: FastenApiService,
    private modalService: NgbModal,
    private settingsService: SettingsService,
  ) { }

  ngOnInit(): void {
    this.searchEnabled = !!this.settingsService.get('search')?.enabled;
    this.fastenApi.getSummary().subscribe((summary: Summary) => {
      if (summary.sources && summary.sources.length > 0) {
        this.lastUpdated = summary.sources.reduce((latest, source) => {
          const sourceDate = new Date(source.updated_at);
          return sourceDate > latest ? sourceDate : latest;
        }, new Date(0));
      }
    })
    this.fastenApi.getResources("Patient").subscribe(results => {
      this.patient = results[0]
      if(!this.patient) return

      const primaryCareId = fhirpath.evaluate(this.patient?.resource_raw, "Patient.generalPractitioner.reference.first()")
      if(primaryCareId){
        const primaryCareIdStr = primaryCareId.join("")
        const primaryCareIdParts = primaryCareIdStr.split("/")
        if(primaryCareIdParts.length == 2) {
          this.fastenApi.getResources(primaryCareIdParts[0], this.patient?.source_id,  primaryCareIdParts[1]).subscribe(primaryResults => {
            if (primaryResults.length > 0){
              this.primaryCare = new PractitionerModel(primaryResults[0].resource_raw)
            }
          })
        }
      }
    })
  }
  getIPSExport(event: Event){
    event.preventDefault()
    return this.fastenApi.getIPSExport("pdf")
  }

  /**
   * Save Report downloads the whole record as a self-contained HTML file (#523).
   *
   * Warn FIRST, and say what is actually at stake. A patient exporting their record is doing a
   * normal thing, but the file that lands in Downloads is their complete medical history in the
   * clear — no password, no expiry — and it will be backed up, synced and shared as casually as any
   * other download. That is worth one sentence before it happens, not a scare dialog after.
   *
   * Deliberately not a browser confirm(): it cannot say this much, and it is not styleable.
   */
  /**
   * Send the record to an address the patient chooses (#524).
   *
   * The operator's decision, and it corrects the earlier position on that issue: the app already
   * lets somebody DOWNLOAD this same file unencrypted, so refusing to email it protects nothing and
   * only makes them do by hand what they could already do. It is their data. What is owed is an
   * honest warning first — which this dialog gives — not a locked door beside an open window.
   */
  sendToEmail(event: Event){
    event.preventDefault()
    this.emailRecipient = ''
    this.emailFormat = 'pdf'
    this.emailError = ''
    this.emailSentTo = ''
    this.emailSending = false
    this.modalService.open(this.sendEmailDialog, {ariaLabelledBy: 'send-email-title'})
  }

  confirmSendEmail(){
    if (!this.emailRecipient.trim()) {
      this.emailError = 'Enter the address to send to.'
      return
    }
    this.emailSending = true
    this.emailError = ''
    this.fastenApi.sendIPSExportByEmail(this.emailRecipient.trim(), this.emailFormat).subscribe({
      next: (result) => {
        this.emailSending = false
        this.emailSentTo = result?.sent_to || this.emailRecipient.trim()
      },
      error: (err) => {
        this.emailSending = false
        // The SERVER's sentence, not a generic failure. It is the only thing that tells somebody
        // whether to fix the address, wait, or ask their administrator (#527 is what the generic
        // version costs).
        this.emailError = err?.error?.error || 'The report could not be sent.'
      },
    })
  }

  saveReport(event: Event){
    event.preventDefault()
    this.saveFormat = 'html'
    this.modalService.open(this.saveReportWarning, {ariaLabelledBy: 'save-report-title'}).result.then(
      () => this.fastenApi.getIPSExport(this.saveFormat),
      () => {}, // dismissed — nothing to do
    )
  }

}
