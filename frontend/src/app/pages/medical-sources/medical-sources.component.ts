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
import {PlatformService} from '../../services/platform.service';
import {FormRequestHealthSystemComponent} from '../../components/form-request-health-system/form-request-health-system.component';
import {extractErrorFromResponse} from '../../../lib/utils/error_extract';
import {SmartAuthorizeResponse} from '../../models/fasten/smart-authorize';
import {SmartConnectRequest} from '../../models/fasten/smart-connect-request';

export const sourceConnectWindowTimeout = 24*5000 //wait 2 minutes (5 * 24 = 120)

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
    private platformApi: PlatformService,
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

        // redirect to lighthouse with uri's (or open a new window in desktop mode)
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

    if(processingFile.type == "text/xml"){

      const shouldConvert = await this.showCcdaWarningModal()
      if(shouldConvert){
        try {
          const convertedFile = await this.platformApi.convertCcdaToFhir(processingFile).toPromise()
          processingFile = convertedFile
        } catch(err){
          console.error(err)
          this.uploadErrorMsg = "Error converting file: " + (extractErrorFromResponse(err) || "Unknown Error")
          this.uploadedFile = []
          return
        }

      } else {
        this.uploadedFile = []
        return
      }

    }

    //TODO: handle manual bundles.
    this.fastenApi.createManualSource(processingFile).subscribe(
      (respData) => {
      },
      (err) => {
        console.log(err)
        this.uploadErrorMsg = "Error uploading file: " + (extractErrorFromResponse(err)|| "Unknown Error")
      },
      () => {
        this.uploadedFile = []
      }
    )
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
      // stores the source and runs the initial sync. Retry up to 3 total attempts because login
      // may take longer than a single ~30s poll window.
      const connectReq: SmartConnectRequest = {
        api_endpoint_base_url: apiEndpoint,
        client_id: clientId,
        scopes: scopes,
        redirect_uri: redirectUri,
        state: authorize.state,
        code_verifier: authorize.code_verifier,
        display: display || undefined,
      }

      let lastErr: any = null
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await this.fastenApi.connectSource(connectReq).toPromise()
          lastErr = null
          break
        } catch (err) {
          lastErr = err
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
