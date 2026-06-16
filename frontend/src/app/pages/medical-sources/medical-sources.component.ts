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

  // gates <app-medical-sources-connected> rendering
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

}
