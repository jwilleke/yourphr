import {Component, Input, OnDestroy, OnInit, ChangeDetectionStrategy} from '@angular/core';
import {Source} from '../../models/fasten/source';
import {SourceListItem} from '../../pages/medical-sources/medical-sources.component';
import {ModalDismissReasons, NgbModal} from '@ng-bootstrap/ng-bootstrap';
import {FastenApiService} from '../../services/fasten-api.service';
import {forkJoin, of, Subscription} from 'rxjs';
import {ToastNotification, ToastType} from '../../models/fasten/toast';
import {ToastService} from '../../services/toast.service';
import {ActivatedRoute, Router} from '@angular/router';
import {Location} from '@angular/common';
import {EventBusService} from '../../services/event-bus.service';
import {PatientAccessBrand} from '../../models/patient-access-brands';
import {environment} from '../../../environments/environment';
import {BackgroundJobSyncData} from '../../models/fasten/background-job';
import {extractErrorFromResponse, replaceErrors} from '../../../lib/utils/error_extract';

@Component({
    selector: 'app-medical-sources-connected',
    templateUrl: './medical-sources-connected.component.html',
    styleUrls: ['./medical-sources-connected.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class MedicalSourcesConnectedComponent implements OnInit, OnDestroy {
  // environment, when set, limits the connected sources shown to that environment (#332). Nothing
  // sets it since yourphr#919: an account holds one kind of source, so /sources shows them all.
  // Unset = show everything. A source with no environment counts as production.
  @Input() environment?: string

  loading = false
  status: Record<string, undefined | "token" | "authorize" | "failed"> = {}

  modalSelectedSourceListItem:SourceListItem = null;
  modalCloseResult = '';

  connectedSourceList: SourceListItem[] = [] //source's are populated for this list

  // #337: reconcile progress when SSE is missing ("Room not found") or complete events are dropped.
  private eventSubs: Subscription[] = []
  private jobPollId: ReturnType<typeof setInterval> | null = null
  private readonly jobPollMs = 5000

  constructor(
    private fastenApi: FastenApiService,
    private modalService: NgbModal,
    private toastService: ToastService,
    private activatedRoute: ActivatedRoute,
    private router: Router,
    private location: Location,
    private eventBusService: EventBusService,
  ) { }

  // visibleSourceList applies the optional environment filter (#332). A source with no environment is
  // treated as production. When no filter is set, everything is shown.
  get visibleSourceList(): SourceListItem[] {
    if (!this.environment) { return this.connectedSourceList }
    return this.connectedSourceList.filter(item => (item.source?.environment || 'production') === this.environment)
  }

  ngOnInit(): void {
    this.loading = true
    this.fastenApi.getSources().subscribe(results => {
      this.loading = false

      //handle connected sources sources
      const connectedSources = results as Source[]
      forkJoin(connectedSources.map((source) => {
        // Local stand-in brand for the two synthetic platform types, so the card can pick its icon.
        // (Previously fetched from Fasten's Lighthouse for real brands — that path is gone, #700.)
        if(source.platform_type == 'fasten' || source.platform_type == 'manual') {
          return of({id: source.platform_type, last_updated: '', portal_ids: [], name: '', platform_type: source.platform_type})
        } else {
          return of(null)
        }
      }))
        .subscribe((connectedBrand) => {
          for(const ndx in connectedSources){
            console.log(connectedSources[ndx])
            const listItem: SourceListItem = {source: connectedSources[ndx], brand: connectedBrand[ndx]}
            this.connectedSourceList.push(listItem)
            // Resolve the patient's display name so the tile can show whose records these are
            // (e.g. "Camila Lopez") instead of just the provider icon. Best-effort: failures are ignored.
            this.loadPatientName(listItem)
            // Re-show the in-progress/failed indicator when returning to the page mid-sync. Key by
            // source.id (the template checks status[source.id] first) AND brand_id — manual sources
            // (e.g. an uploaded bundle still importing) have no brand_id, so keying only by brand_id
            // left their progress bar invisible on return even though the import was still running.
            const jobStatus = connectedSources[ndx].latest_background_job?.job_status
            if(jobStatus == "STATUS_LOCKED"){
              this.status[connectedSources[ndx].id] = "token"
              this.status[connectedSources[ndx].brand_id] = "token"
            } else if (jobStatus === "STATUS_FAILED") {
              this.status[connectedSources[ndx].id] = "failed"
              this.status[connectedSources[ndx].brand_id] = "failed"
            }
          }
          // After hydrating LOCKED jobs from the server, start reconciliation poll (#337).
          this.ensureJobPoll()
        })

    })

    // Progress events keep the spinner while a sync is running.
    this.eventSubs.push(this.eventBusService.SourceSyncMessages.subscribe((event) => {
      this.status[event.source_id] = "token"
      this.ensureJobPoll()
    }))
    // Completion must clear the spinner — this was never wired (#337), so even successful SSE
    // left status["token"] stuck after source_complete.
    this.eventSubs.push(this.eventBusService.SourceCompleteMessages.subscribe((event) => {
      this.clearSourceStatus(event.source_id)
      this.stopJobPollIfIdle()
    }))

    // If anything is mid-sync (e.g. STATUS_LOCKED after reload), poll job state until done.
    this.ensureJobPoll()
  }

  ngOnDestroy(): void {
    this.eventSubs.forEach((s) => s.unsubscribe())
    this.eventSubs = []
    this.stopJobPoll()
  }

  /** Clear in-progress / failed indicators for a source id and matching brand_id. */
  private clearSourceStatus(sourceId: string): void {
    if (!sourceId) { return }
    delete this.status[sourceId]
    const item = this.connectedSourceList.find((s) => s.source?.id === sourceId)
    if (item?.source?.brand_id) {
      delete this.status[item.source.brand_id]
    }
    if (item?.brand?.id) {
      delete this.status[item.brand.id]
    }
  }

  private hasInProgressStatus(): boolean {
    return Object.values(this.status).some((s) => s === 'token' || s === 'authorize')
  }

  private ensureJobPoll(): void {
    if (this.jobPollId || !this.hasInProgressStatus()) { return }
    this.jobPollId = setInterval(() => this.reconcileJobStatus(), this.jobPollMs)
  }

  private stopJobPoll(): void {
    if (this.jobPollId) {
      clearInterval(this.jobPollId)
      this.jobPollId = null
    }
  }

  private stopJobPollIfIdle(): void {
    if (!this.hasInProgressStatus()) {
      this.stopJobPoll()
    }
  }

  /**
   * Server-authoritative progress recovery (#337): when SSE never reached this tab, re-fetch
   * sources and clear or mark failed based on latest_background_job.job_status.
   */
  private reconcileJobStatus(): void {
    if (!this.hasInProgressStatus()) {
      this.stopJobPoll()
      return
    }
    this.fastenApi.getSources().subscribe({
      next: (results) => {
        const sources = results as Source[]
        for (const source of sources) {
          const jobStatus = source.latest_background_job?.job_status
          const inProgress = this.status[source.id] === 'token' || this.status[source.id] === 'authorize'
            || (source.brand_id && (this.status[source.brand_id] === 'token' || this.status[source.brand_id] === 'authorize'))
          if (!inProgress) { continue }

          // Refresh tile metadata (job fields) on the list item if present.
          const listItem = this.connectedSourceList.find((i) => i.source?.id === source.id)
          if (listItem?.source) {
            listItem.source.latest_background_job = source.latest_background_job
          }

          if (jobStatus === 'STATUS_FAILED') {
            this.status[source.id] = 'failed'
            if (source.brand_id) { this.status[source.brand_id] = 'failed' }
          } else if (jobStatus === 'STATUS_DONE' || jobStatus === 'STATUS_READY' || !jobStatus) {
            // Done / idle / no job — clear spinner.
            this.clearSourceStatus(source.id)
            if (source.brand_id) { delete this.status[source.brand_id] }
          }
          // STATUS_LOCKED → keep showing progress
        }
        this.stopJobPollIfIdle()
      },
      error: () => { /* keep polling; transient */ },
    })
  }

  // //https://stackoverflow.com/a/18391400/1157633
  // extractErrorFromResponse(errResp: any): string {
  //   let errMsg = ""
  //   if(errResp.name == "HttpErrorResponse" && errResp.error && errResp.error?.error){
  //     errMsg = errResp.error.error
  //   } else {
  //     errMsg = JSON.stringify(errResp, replaceErrors)
  //   }
  //   return errMsg
  // }

  // //stringify error objects
  // replaceErrors(key, value) {
  //   if (value instanceof Error) {
  //     var error = {};
  //
  //     Object.getOwnPropertyNames(value).forEach(function (propName) {
  //       error[propName] = value[propName];
  //     });
  //
  //     return error;
  //   }
  //
  //   return value;
  // }

  // loadPatientName resolves the source's Patient resource and attaches the display name to the tile
  // (e.g. "Camila Lopez"), so the connected card shows whose records these are. Best-effort.
  private loadPatientName(item: SourceListItem): void {
    const source = item.source
    if (!source?.id || !source?.patient) { return }
    this.fastenApi.getResourceBySourceId(source.id, source.patient).subscribe(
      (resource: any) => {
        const name = this.extractPatientName(resource?.resource_raw)
        if (name) { item.patientName = name }
      },
      () => { /* best-effort — no name is fine */ }
    )
  }

  // extractPatientName pulls a human-readable name from a FHIR Patient resource (HumanName): prefer
  // the official name's text, else assemble given + family. Returns "" when none is available.
  private extractPatientName(raw: any): string {
    if (typeof raw === 'string') { try { raw = JSON.parse(raw) } catch { return '' } }
    const names = raw?.name
    if (!Array.isArray(names) || names.length === 0) { return '' }
    const n = names.find((x: any) => x?.use === 'official') || names[0]
    if (n?.text) { return n.text }
    const given = Array.isArray(n?.given) ? n.given.join(' ') : (n?.given || '')
    return [given, n?.family].filter(Boolean).join(' ').trim()
  }

  ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  // Modal Window Functions
  ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

  public openModal(contentModalRef, sourceListItem: SourceListItem) {
    // Only block opening when there is NOTHING to manage yet (no connected source — i.e. a connect is
    // still in its initial popup/authorize phase). Once a source exists, ALWAYS allow the modal so the
    // user can Explore / Sync / Download / Delete it — previously a stale "loading" status (the source
    // sync indicator that never clears when SSE progress events are missed) left connected tiles
    // permanently un-openable. See the event-bus "Room not found" issue.
    if(!sourceListItem.source){
      return
    }

    this.modalSelectedSourceListItem = sourceListItem
    this.modalService.open(contentModalRef, {ariaLabelledBy: 'modal-basic-title'}).result.then((result) => {
      this.modalSelectedSourceListItem = null
      this.modalCloseResult = `Closed with: ${result}`;
    }, (reason) => {
      this.modalSelectedSourceListItem = null
      this.modalCloseResult = `Dismissed ${this.getDismissReason(reason)}`;
    });
  }



  public sourceSyncHandler(source: Source){
    this.status[source.id] = "authorize"
    this.modalService.dismissAll()

    this.fastenApi.syncSource(source.id).subscribe(
      (respData) => {
        delete this.status[source.id]
        delete this.status[source.brand_id]
        console.log("source sync response:", respData)

        const toastNotification = new ToastNotification()
        toastNotification.type = ToastType.Success
        toastNotification.message = `Successfully updated source: ${source.display}, ${respData} row(s) effected`
        this.toastService.show(toastNotification)
      },
      (err) => {
        delete this.status[source.id]
        delete this.status[source.brand_id]

        const toastNotification = new ToastNotification()
        toastNotification.type = ToastType.Error
        toastNotification.message = `An error occurred while updating source (${source.display}): ${extractErrorFromResponse(err)}`
        // Keep sync errors on screen (don't auto-hide) and link to the full details so the message can
        // actually be read/copied — Epic $everything failures were vanishing before they could be seen.
        toastNotification.autohide = false
        toastNotification.link = {text: "View Details", url: `/background-jobs`}
        this.toastService.show(toastNotification)
        console.error("source sync failed", err)

      }
    )
  }

  // sourceExportHandler downloads every record retrieved for this source as a FHIR Bundle (.json).
  // "Your medical records, immediately and in your hands." The browser saves the file; the user can
  // drop it into sample-data/. The filename comes from the server's Content-Disposition header.
  public sourceExportHandler(source: Source) {
    if (!source?.id) { return }
    this.modalService.dismissAll()
    this.fastenApi.exportSource(source.id).subscribe(
      (resp) => {
        const blob = resp.body
        if (!blob) { return }
        const disposition = resp.headers.get('Content-Disposition') || ''
        const match = /filename=([^;]+)/i.exec(disposition)
        const filename = (match && match[1].trim().replace(/^"|"$/g, '')) || `yourphr-${source.display || 'source'}.json`

        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        window.URL.revokeObjectURL(url)

        const toastNotification = new ToastNotification()
        toastNotification.type = ToastType.Success
        toastNotification.message = `Exported records from ${source.display} as ${filename}`
        this.toastService.show(toastNotification)
      },
      (err) => {
        const toastNotification = new ToastNotification()
        toastNotification.type = ToastType.Error
        toastNotification.message = `Could not export ${source.display}: ${extractErrorFromResponse(err)}`
        toastNotification.autohide = false
        this.toastService.show(toastNotification)
        console.error("source export failed", err)
      }
    )
  }

  // #437 — clear OAuth only; keep imported records and the source card.
  public sourceDisconnectHandler() {
    const source = this.modalSelectedSourceListItem?.source
    if (!source?.id) { return }
    const sourceDisplayName = source.display || this.modalSelectedSourceListItem?.brand?.name || 'unknown'
    if (!confirm(
      `Disconnect ${sourceDisplayName}?\n\n` +
      `This clears OAuth tokens so YourPHR stops syncing with the provider. ` +
      `Imported records stay on this instance until you use Remove data. ` +
      `Does not change data at Medicare/CMS or your provider.`
    )) {
      return
    }

    this.status[source.id] = 'authorize'
    this.modalService.dismissAll()

    this.fastenApi.disconnectSource(source.id).subscribe(
      () => {
        delete this.status[source.id]
        delete this.status[source.brand_id]
        // Keep the tile; zero local token fields so UI can reflect disconnected state.
        source.access_token = ''
        source.refresh_token = ''
        source.expires_at = 0

        const toastNotification = new ToastNotification()
        toastNotification.type = ToastType.Success
        toastNotification.message = `Disconnected ${sourceDisplayName}. Imported records were kept. Use Reconnect to authorize again, or Remove data to delete records.`
        this.toastService.show(toastNotification)
      },
      (err) => {
        delete this.status[source.id]
        delete this.status[source.brand_id]
        const toastNotification = new ToastNotification()
        toastNotification.type = ToastType.Error
        toastNotification.message = `Could not disconnect ${sourceDisplayName}: ${extractErrorFromResponse(err)}`
        this.toastService.show(toastNotification)
        console.error(err)
      },
    )
  }

  // #437 — delete imported FHIR for this source; keep credentials / card.
  public sourceRemoveDataHandler() {
    const source = this.modalSelectedSourceListItem?.source
    if (!source?.id) { return }
    const sourceDisplayName = source.display || this.modalSelectedSourceListItem?.brand?.name || 'unknown'
    if (!confirm(
      `Remove all records imported from ${sourceDisplayName} on this instance?\n\n` +
      `This deletes stored health data from that source on YourPHR. ` +
      `The connection may remain (or you can Reconnect). ` +
      `Does not change data at Medicare/CMS or your provider. Does not delete your account.`
    )) {
      return
    }

    this.status[source.id] = 'authorize'
    this.modalService.dismissAll()

    this.fastenApi.removeSourceData(source.id).subscribe(
      () => {
        delete this.status[source.id]
        delete this.status[source.brand_id]
        const toastNotification = new ToastNotification()
        toastNotification.type = ToastType.Success
        toastNotification.message = `Removing the records imported from ${sourceDisplayName} in the background. You can leave this page; you'll get a notice when it's done. The connection is kept.`
        this.toastService.show(toastNotification)
      },
      (err) => {
        delete this.status[source.id]
        delete this.status[source.brand_id]
        const toastNotification = new ToastNotification()
        toastNotification.type = ToastType.Error
        toastNotification.message = `Could not remove data for ${sourceDisplayName}: ${extractErrorFromResponse(err)}`
        this.toastService.show(toastNotification)
        console.error(err)
      },
    )
  }

  // Full teardown: records + soft-delete credential (#437 combined).
  public sourceDeleteHandler(){
    const source = this.modalSelectedSourceListItem.source
    const sourceDisplayName = this.modalSelectedSourceListItem?.source?.display || this.modalSelectedSourceListItem?.brand?.name || 'unknown'

    if (!confirm(
      `Disconnect ${sourceDisplayName} and remove all of its imported records?\n\n` +
      `This clears tokens, deletes records from that source on this instance, and removes the source card. ` +
      `Does not change data at Medicare/CMS or your provider. Does not delete your account.`
    )) {
      return
    }

    this.status[source.id] = "authorize"
    this.modalService.dismissAll()

    this.fastenApi.deleteSource(source.id).subscribe(
      () => {
        delete this.status[source.id]
        delete this.status[source.brand_id]

        // It has stopped syncing and is being removed in the background (#905): take the card off now
        const foundIndex = this.connectedSourceList.findIndex((connectedSource) => {
          return connectedSource?.source?.id == source.id
        }, this)
        if(foundIndex > -1){
          this.connectedSourceList.splice(foundIndex, 1)
        }

        const toastNotification = new ToastNotification()
        toastNotification.type = ToastType.Success
        toastNotification.message = `Removing ${sourceDisplayName} and its records in the background. You can leave this page; you'll get a notice when it's done.`
        this.toastService.show(toastNotification)

      },
      (err) => {
        delete this.status[source.id]
        delete this.status[source.brand_id]

        const toastNotification = new ToastNotification()
        toastNotification.type = ToastType.Error
        toastNotification.message = `Could not remove ${sourceDisplayName}: ${extractErrorFromResponse(err)}`
        this.toastService.show(toastNotification)
        console.log(err)
      })
  }

  private getDismissReason(reason: any): string {
    if (reason === ModalDismissReasons.ESC) {
      return 'by pressing ESC';
    } else if (reason === ModalDismissReasons.BACKDROP_CLICK) {
      return 'by clicking on a backdrop';
    } else {
      return `with: ${reason}`;
    }
  }
}
