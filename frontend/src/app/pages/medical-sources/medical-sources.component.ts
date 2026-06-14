import {Component, EventEmitter, OnInit, Optional, Output, ViewChild} from '@angular/core';
import {ConnectGatewayService} from '../../services/connect-gateway.service';
import {FastenApiService} from '../../services/fasten-api.service';
import {ConnectGatewaySourceMetadata} from '../../models/connect-gateway/connect-gateway-source-metadata';
import {Source} from '../../models/fasten/source';
import {NgbModal} from '@ng-bootstrap/ng-bootstrap';
import {ActivatedRoute} from '@angular/router';
import {environment} from '../../../environments/environment';
import {BehaviorSubject, forkJoin, Observable, of, Subject} from 'rxjs';
import {
  ConnectGatewaySourceSearch,
  ConnectGatewaySourceSearchAggregation,
  ConnectGatewayBrandListDisplayItem
} from '../../models/connect-gateway/connect-gateway-source-search';
import {debounceTime, distinctUntilChanged, pairwise, startWith} from 'rxjs/operators';
import {MedicalSourcesFilter, MedicalSourcesFilterService} from '../../services/medical-sources-filter.service';
import {FormControl, FormGroup} from '@angular/forms';
import * as _ from 'lodash';
import {PatientAccessBrand} from '../../models/patient-access-brands';
import {FormRequestHealthSystemComponent} from '../../components/form-request-health-system/form-request-health-system.component';
import {extractErrorFromResponse} from '../../../lib/utils/error_extract';
import {SmartAuthorizeResponse} from '../../models/fasten/smart-authorize';
import {SmartConnectRequest} from '../../models/fasten/smart-connect-request';

// Max time to wait for the user to finish logging in at the provider (the relay-poll phase, across
// retries) before giving up. A first provider login (read consent, pick account, authorize) can be
// slow — e.g. CMS Blue Button — so allow several minutes. This does NOT bound the data download,
// which runs inline after login completes (see source.go).
export const sourceConnectWindowTimeout = 4*60*1000 // 4 minutes

// Epic's public SMART on FHIR sandbox (synthetic patients, no PHI). FHIR base + scopes are
// stable, public, and non-secret; the client_id is bring-your-own — each user registers their
// own patient-facing app at https://fhir.epic.com. See docs/vendors/epic-sandbox.md.
export const EPIC_SANDBOX = {
  api_endpoint_base_url: 'https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4',
  scopes: 'launch/patient patient/*.read openid fhirUser offline_access',
  display: 'Epic Sandbox',
}

export class SourceListItem {
  source?: Source
  brand: ConnectGatewayBrandListDisplayItem | PatientAccessBrand
  searchHighlights?: string[]
}

@Component({
    selector: 'app-medical-sources',
    templateUrl: './medical-sources.component.html',
    styleUrls: ['./medical-sources.component.scss'],
    standalone: false
})
export class MedicalSourcesComponent implements OnInit {
  loading = false

  environment_name = environment.environment_name

  uploadedFile: File[] = []
  uploadErrorMsg = ""
  // true from the moment the bundle is sent until the server has accepted it and queued the import
  // (the import itself then runs in the background — progress shows on the Connected Sources list).
  uploadInProgress = false
  dragActive = false

  searchTermUpdate = new BehaviorSubject<string>("");
  status: Record<string, undefined | "token" | "authorize"> = {}

  //aggregation/filter data & limits
  globalLimits: {
    // aggregations: ConnectGatewaySourceSearchAggregations | undefined,
  } = {
    // categories: [],
    // aggregations: undefined,
  }




  //source of truth for current state
  //TODO: see if we can remove this without breaking search/filtering
  filterForm = this.filterService.filterForm;

  //modal
  modalSelectedBrandListItem: ConnectGatewayBrandListDisplayItem | PatientAccessBrand = null;
  modalCloseResult = '';


  // CCDA-FHIR modal
  @ViewChild('ccdaWarningModalRef') ccdaWarningModalRef : any;

  // BYO SMART source connect modal (EPIC #20, issue #52)
  @ViewChild('smartConnectModal') smartConnectModalRef : any;
  // template-driven form model
  smartForm = {
    api_endpoint_base_url: '',
    client_id: '',
    client_secret: '',
    scopes: 'launch/patient patient/*.read openid fhirUser offline_access',
    display: '',
  }
  smartConnecting = false
  smartErrorMsg = ''
  smartSuccessMsg = ''
  // toggled to destroy/recreate <app-medical-sources-connected> so it re-loads after a connect
  showConnectedList = true

  constructor(
    private connectGatewayApi: ConnectGatewayService,
    private fastenApi: FastenApiService,
    private activatedRoute: ActivatedRoute,
    private filterService: MedicalSourcesFilterService,
    private modalService: NgbModal,

  ) {
  }

  ngOnInit(): void {

  }



  //OLD FUNCTIONS
  //
  //
  // private populateAvailableSourceList(results: ConnectGatewaySourceSearch): void {
  //   console.log("AGGREGATIONS!!!!!", results.aggregations)
  //   this.totalAvailableSourceList = results.hits.total.value
  //   if(results.hits.hits.length == 0){
  //     this.scrollComplete = true
  //     console.log("scroll complete")
  //     return
  //   }
  //   this.scrollId = results._scroll_id
  //   this.availableSourceList = this.availableSourceList.concat(results.hits.hits.map((result) => {
  //     return {metadata: result._source}
  //   }).filter((item) => {
  //     return !this.connectedSourceList.find((connectedItem) => connectedItem.metadata.source_type == item.metadata.source_type)
  //   }))
  // }
  //


  // /**
  //  * after pressing the logo (connectModalHandler button), this function will display a modal with information about the source
  //  * @param $event
  //  * @param sourceType
  //  */
  public connectModalHandler(contentModalRef, sourceListItem: SourceListItem) :void {
    console.log("TODO: connect Handler")


    this.modalSelectedBrandListItem = sourceListItem.brand
    this.modalService.open(contentModalRef, {ariaLabelledBy: 'modal-basic-title'}).result.then((result) => {
      this.modalSelectedBrandListItem = null
      this.modalCloseResult = `Closed with: ${result}`;
    }, (reason) => {
      this.modalSelectedBrandListItem = null
    });
  }

  // /**
  //  * after pressing the connect button in the Modal, this function will generate an authorize url for this source, and redirect the user.
  //  * @param $event
  //  * @param sourceType
  //  */
  public connectHandler($event, brandId: string, portalId: string, endpointId: string): void {

    ($event.currentTarget as HTMLButtonElement).disabled = true;
    this.status[brandId] = "authorize"
    this.status[endpointId] = "authorize"

    this.connectGatewayApi.getConnectGatewaySource(endpointId)
      .then(async (sourceMetadata: ConnectGatewaySourceMetadata) => {
        sourceMetadata.brand_id = brandId
        sourceMetadata.portal_id = portalId

        const authorizationUrl = await this.connectGatewayApi.generateSourceAuthorizeUrl(sourceMetadata)

        // redirect to the connect gateway with uri's (or open a new window in desktop mode)
        this.connectGatewayApi.redirectWithOriginAndDestination(authorizationUrl.toString(), sourceMetadata).subscribe((desktopRedirectData) => {
          if(!desktopRedirectData){
            return //wait for redirect
          }

          //Note: this code will only run in Desktop mode (with popups)
          //in non-desktop environments, the user is redirected in the same window, and this code is never executed.

          //always close the modal
          this.modalService.dismissAll()

          //redirect the browser back to this page with the code in the query string parameters
          this.connectGatewayApi.redirectWithDesktopCode(desktopRedirectData.state, desktopRedirectData.codeData)
        })
      });
  }



  /**
   * this function is used to process manually "uploaded" FHIR bundle files, adding them to the database.
   * @param event
   */
  // Native file <input> change: read files, then reset value so re-selecting the same file fires again.
  public onBundleInput(input: HTMLInputElement) {
    this.handleBundleFiles(input.files)
    input.value = ""
  }

  // Drag-and-drop onto the upload zone.
  public onBundleDrop(event: DragEvent) {
    event.preventDefault()
    this.dragActive = false
    this.handleBundleFiles(event.dataTransfer?.files ?? null)
  }

  private handleBundleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) { return }
    this.uploadSourceBundleHandler(Array.from(fileList))
  }

  public async uploadSourceBundleHandler(files: File[]) {
    this.uploadErrorMsg = ""
    let processingFile = files[0] as File
    this.uploadedFile = [processingFile]

    // C-CDA / CCD documents are converted to FHIR on the server (#254) by the self-hosted
    // fhir-converter — the raw document is uploaded as-is and never leaves this instance.
    // (Previously the browser shipped the CCDA to a third-party cloud; that path is gone.)
    if(this.isCcdaFile(processingFile)){
      const shouldConvert = await this.showCcdaWarningModal()
      if(!shouldConvert){
        this.uploadedFile = []
        return
      }
    }

    //TODO: handle manual bundles.
    this.uploadInProgress = true
    this.fastenApi.createManualSource(processingFile).subscribe(
      (respData) => {
      },
      (err) => {
        console.log(err)
        this.uploadInProgress = false
        this.uploadErrorMsg = "Error uploading file: " + (extractErrorFromResponse(err)|| "Unknown Error")
      },
      () => {
        this.uploadInProgress = false
        this.uploadedFile = []
      }
    )
  }

  // Detects a C-CDA / CCD document upload by MIME type or file extension. The browser does not
  // always set a reliable `type` for .ccd/.cda, so extension is the primary signal.
  private isCcdaFile(file: File): boolean {
    const name = (file.name || "").toLowerCase()
    return file.type === "text/xml" || file.type === "application/xml" ||
      name.endsWith(".xml") || name.endsWith(".ccd") || name.endsWith(".ccda") || name.endsWith(".cda")
  }

  showCcdaWarningModal(): Promise<boolean> {


    return this.modalService.open(this.ccdaWarningModalRef).result.then<boolean>(
      (result) => {
        //convert button clicked, .close()
        return true //convert from CCDA -> FHIR.
      }
    ).catch((reason) => {
      // x or cancel button clicked, .dismiss()
      return false
    })
  }

  // -------- Bring-Your-Own SMART source connect flow (EPIC #20, issue #52) --------

  // Opens the BYO SMART connect modal, resetting per-attempt status.
  public openSmartConnectModal(): void {
    this.smartErrorMsg = ''
    this.smartSuccessMsg = ''
    this.smartConnecting = false
    this.modalService.open(this.smartConnectModalRef, {ariaLabelledBy: 'smart-connect-title'})
  }

  // Pre-fills the BYO SMART modal with Epic's public sandbox endpoint + scopes, then opens it.
  // client_id stays empty on purpose: each user registers their own patient-facing app at
  // fhir.epic.com (bring-your-own client_id). See docs/vendors/epic-sandbox.md.
  public openEpicSandboxModal(): void {
    this.smartForm = {
      api_endpoint_base_url: EPIC_SANDBOX.api_endpoint_base_url,
      client_id: '',
      client_secret: '', // Epic is a public/PKCE client — no secret
      scopes: EPIC_SANDBOX.scopes,
      display: EPIC_SANDBOX.display,
    }
    this.openSmartConnectModal()
  }

  // Forces <app-medical-sources-connected> to be destroyed and recreated so it re-runs its
  // ngOnInit load (it appends sources on init, so a fresh instance is the simplest correct refresh).
  private refreshConnectedList(): void {
    this.showConnectedList = false
    setTimeout(() => { this.showConnectedList = true }, 0)
  }

  // Runs the 6-step BYO SMART connect flow: authorize -> popup login -> connect (poll/exchange).
  // The backend never exposes tokens to the browser. connectSource polls our relay (~30s) for the
  // auth code; since login can outlast one poll, retry up to 3 total attempts before surfacing an error.
  public async connectSmartSource(): Promise<void> {
    if (this.smartConnecting) { return } //guard against double-submit

    this.smartErrorMsg = ''
    this.smartSuccessMsg = ''

    const apiEndpoint = (this.smartForm.api_endpoint_base_url || '').trim()
    const clientId = (this.smartForm.client_id || '').trim()
    const clientSecret = (this.smartForm.client_secret || '').trim()
    const scopes = (this.smartForm.scopes || '').trim()
    const display = (this.smartForm.display || '').trim()

    if (!apiEndpoint || !clientId || !scopes) {
      this.smartErrorMsg = 'FHIR base URL, Client ID and Scopes are all required.'
      return
    }

    const redirectUri = `${environment.relay_endpoint_base}/callback`

    // Open the login popup SYNCHRONOUSLY, inside the click handler, so the browser doesn't block
    // it. window.open() called *after* an `await` loses the user-gesture and gets blocked — that
    // was the flaky "no popup opened". We point this already-open window at the authorize URL once
    // the backend returns it.
    const popup = window.open('', '_blank')
    if (!popup) {
      this.smartErrorMsg = 'Your browser blocked the login popup. Please allow popups for this site, then try Connect again.'
      return
    }
    try {
      popup.document.write('<!doctype html><title>Connecting…</title><p style="font:14px sans-serif;padding:1rem">Preparing secure sign-in…</p>')
    } catch (_) { /* ignore — popup not navigable yet */ }

    this.smartConnecting = true
    try {
      // Ask the backend for the PKCE authorize URL (it does SMART discovery).
      const authorize: SmartAuthorizeResponse = await this.fastenApi.authorizeSource({
        api_endpoint_base_url: apiEndpoint,
        client_id: clientId,
        scopes: scopes,
        redirect_uri: redirectUri,
      }).toPromise()

      if (!authorize?.authorize_url || !authorize?.state || !authorize?.code_verifier) {
        popup.close()
        this.smartErrorMsg = 'Authorization failed: the server did not return a valid authorize URL.'
        return
      }

      // Send the already-open popup to the provider login; it redirects to our relay /callback.
      popup.location.href = authorize.authorize_url

      // Step 5: complete the connection. The backend polls the relay for the code, exchanges it,
      // stores the source and runs the initial sync.
      const connectReq: SmartConnectRequest = {
        api_endpoint_base_url: apiEndpoint,
        client_id: clientId,
        client_secret: clientSecret || undefined, // confidential clients (e.g. Blue Button); omit for public/PKCE
        scopes: scopes,
        redirect_uri: redirectUri,
        state: authorize.state,
        code_verifier: authorize.code_verifier,
        display: display || undefined,
      }

      // Each backend /source/connect call polls the relay ~30s for the auth code, then (once it
      // arrives) completes the token exchange + initial sync inline. A slow first login at the
      // provider can outlast one poll, so retry across the full sourceConnectWindowTimeout. Only the
      // relay-poll timeout is retried — at that point nothing has been created, so it is safe; any
      // other error (discovery, token exchange, sync) is terminal and stops immediately.
      // The login-wait window is operator-tunable backend config (web.smart_connect.login_wait_seconds),
      // delivered in the authorize response so it changes without a frontend rebuild. Fall back to the
      // baked-in default if an older backend doesn't supply it.
      const windowMs = (authorize.login_wait_seconds && authorize.login_wait_seconds > 0)
        ? authorize.login_wait_seconds * 1000
        : sourceConnectWindowTimeout
      const backendPollMs = 30 * 1000
      const maxAttempts = Math.ceil(windowMs / backendPollMs)
      let lastErr: any = null
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          await this.fastenApi.connectSource(connectReq).toPromise()
          lastErr = null
          break
        } catch (err) {
          lastErr = err
          const msg = extractErrorFromResponse(err) || ''
          if (!/authorization code from relay|timed out/i.test(msg)) {
            break // terminal error — not a login-still-in-progress timeout
          }
        }
      }

      if (lastErr) {
        this.smartErrorMsg = 'Connection failed: ' + (extractErrorFromResponse(lastErr) || 'Unknown Error') + ' Please complete the login in the popup window and try again.'
        return
      }

      // Step 6: success.
      this.smartSuccessMsg = 'Source connected successfully. Your records are being imported.'
      this.refreshConnectedList()
      this.modalService.dismissAll()
    } catch (err) {
      this.smartErrorMsg = 'Authorization failed: ' + (extractErrorFromResponse(err) || 'Unknown Error')
    } finally {
      this.smartConnecting = false
    }
  }

}
