import {Component, Input, OnInit, TemplateRef, ViewChild, ChangeDetectionStrategy} from '@angular/core';
import {NgbModal} from '@ng-bootstrap/ng-bootstrap';
import {ResourceFhir} from '../../models/fasten/resource_fhir';
import {FastenApiService} from '../../services/fasten-api.service';
import * as fhirpath from 'fhirpath';
import {PractitionerModel} from '../../../lib/models/resources/practitioner-model';
import {Summary} from '../../../app/models/fasten/summary';

@Component({
    selector: 'report-header',
    templateUrl: './report-header.component.html',
    styleUrls: ['./report-header.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class ReportHeaderComponent implements OnInit {
  patient: ResourceFhir = null
  primaryCare: PractitionerModel = null
  lastUpdated: Date = null
  @Input() reportHeaderTitle = ""
  @Input() reportHeaderSubTitle = "Organized by condition and encounters"
  @ViewChild('saveReportWarning') saveReportWarning: TemplateRef<any>
  @ViewChild('sendEmailDialog') sendEmailDialog: TemplateRef<any>

  // Send-to-email dialog state (#524, #687)
  // A web page for a person to read, FHIR JSON for a system to import. Both are "their records";
  // which one is useful depends entirely on who is receiving it. PDF is not offered because this
  // stack cannot render one, and a .pdf holding something else is the defect #687 fixed.
  emailFormat: 'html' | 'json' = 'html'
  // Save Report offers the same choice for the same reason: a document to read, or a bundle another
  // system can import (#523).
  saveFormat: 'html' | 'json' = 'html'

  constructor(
    private fastenApi: FastenApiService,
    private modalService: NgbModal,
  ) { }

  ngOnInit(): void {
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
    // "pdf" until #687: the endpoint ignored the format and returned the API envelope, so this
    // saved a .pdf holding JSON. It renders a web page, which prints.
    return this.fastenApi.getIPSExport("html")
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
   * Send the record by email — with the person doing the sending (#524, #687).
   *
   * #524 settled that emailing their own summary is theirs to do and what is owed is an honest
   * warning, not a locked door beside an open window. #687 settled who sends it: this instance has
   * no mail transport (#536), so rather than a button that 404s, the dialog gives them the file and
   * the warning, and they attach it from their own address. Same outcome, nothing in the middle.
   */
  sendToEmail(event: Event){
    event.preventDefault()
    this.emailFormat = 'html'
    this.modalService.open(this.sendEmailDialog, {ariaLabelledBy: 'send-email-title'}).result.then(
      () => this.fastenApi.getIPSExport(this.emailFormat),
      () => {}, // dismissed — nothing to do
    )
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
