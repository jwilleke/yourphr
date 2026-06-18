import {Component, Input, OnInit} from '@angular/core';
import {Source} from '../../models/fasten/source';
import {SourceListItem} from '../../pages/medical-sources/medical-sources.component';
import {ModalDismissReasons, NgbModal} from '@ng-bootstrap/ng-bootstrap';
import {FastenApiService} from '../../services/fasten-api.service';
import {forkJoin, of} from 'rxjs';
import {ConnectGatewayService} from '../../services/connect-gateway.service';
import {ConnectGatewaySourceMetadata} from '../../models/connect-gateway/connect-gateway-source-metadata';
import {ToastNotification, ToastType} from '../../models/fasten/toast';
import {ToastService} from '../../services/toast.service';
import {ActivatedRoute, Router} from '@angular/router';
import {Location} from '@angular/common';
import {EventBusService} from '../../services/event-bus.service';
import {SourceState} from '../../models/fasten/source-state';
import {PatientAccessBrand} from '../../models/patient-access-brands';
import {environment} from '../../../environments/environment';
import {BackgroundJobSyncData} from '../../models/fasten/background-job';
import {extractErrorFromResponse, replaceErrors} from '../../../lib/utils/error_extract';

@Component({
    selector: 'app-medical-sources-connected',
    templateUrl: './medical-sources-connected.component.html',
    styleUrls: ['./medical-sources-connected.component.scss'],
    standalone: false
})
export class MedicalSourcesConnectedComponent implements OnInit {
  loading = false
  status: Record<string, undefined | "token" | "authorize" | "failed"> = {}

  modalSelectedSourceListItem:SourceListItem = null;
  modalCloseResult = '';

  connectedSourceList: SourceListItem[] = [] //source's are populated for this list

  constructor(
    private connectGatewayApi: ConnectGatewayService,
    private fastenApi: FastenApiService,
    private modalService: NgbModal,
    private toastService: ToastService,
    private activatedRoute: ActivatedRoute,
    private router: Router,
    private location: Location,
    private eventBusService: EventBusService,
  ) { }

  ngOnInit(): void {
    this.loading = true
    this.fastenApi.getSources().subscribe(results => {
      this.loading = false

      //handle connected sources sources
      const connectedSources = results as Source[]
      forkJoin(connectedSources.map((source) => {
        //TODO: remove this, and similar code in explore.component.ts
        if(source.platform_type == 'fasten' || source.platform_type == 'manual') {
          return this.connectGatewayApi.getConnectGatewayCatalogBrand(source.platform_type)
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
        })

    })

    const callbackState = this.activatedRoute.snapshot.paramMap.get('state')
    if(callbackState) {

      const sourceInfo = this.connectGatewayApi.getSourceState(callbackState)

      console.log("handle callback redirect from source", callbackState, sourceInfo)
      this.status[sourceInfo.brand_id] = "token"

      //the structure of "availableSourceList" vs "connectedSourceList" sources is slightly different,
      //connectedSourceList contains a "source" field. The this.fastenApi.createSource() call in the callback function will set it.
      this.connectGatewayApi.getConnectGatewayCatalogBrand(sourceInfo.brand_id)
        .then((brandInfo) => {
          this.connectedSourceList.push({brand: brandInfo})
          return this.callback(sourceInfo)
        })
        .then(console.log)
    }

    this.eventBusService.SourceSyncMessages.subscribe((event) => {
      this.status[event.source_id] = "token"
    })

  }

  /**
   * if the user is redirected to this page from the connect gateway, we'll need to process the "code" to retrieve the access token & refresh token.
   * @param expectedSourceStateInfo
   */
  public async callback(expectedSourceStateInfo: SourceState) {

    //get the source metadata again
    await this.connectGatewayApi.getConnectGatewaySource(expectedSourceStateInfo.endpoint_id)
      .then(async (sourceMetadata: ConnectGatewaySourceMetadata) => {

        //get required parameters from the URI and local storage
        const callbackUrlParts = new URL(window.location.href)
        //in desktop mode, we're using fragment routing, and the callback params are in the fragment.
        const fragmentParams = new URLSearchParams(callbackUrlParts.hash.split('?')?.[1] || '')
        const callbackCode = callbackUrlParts.searchParams.get("code") || fragmentParams.get("code")
        const callbackError = callbackUrlParts.searchParams.get("error") || fragmentParams.get("error")
        const callbackErrorDescription = callbackUrlParts.searchParams.get("error_description") || fragmentParams.get("error_description")

        //reset the url, removing the params and fragment from the current url.
        const urlTree = this.router.createUrlTree(["/sources"],{
          relativeTo: this.activatedRoute,
        });
        this.location.replaceState(urlTree.toString());

        localStorage.removeItem(expectedSourceStateInfo.state)

        if(callbackError && !callbackCode){
          //TOOD: print this message in the UI
          const errMsg = "an error occurred while authenticating to this source. Please try again later"
          console.error(errMsg, callbackErrorDescription)
          throw new Error(`callback error: ${callbackError}, description: ${callbackErrorDescription}`)
        }

        console.log("callback code:", callbackCode)
        this.status[expectedSourceStateInfo.brand_id] = "token"

        let payload: any
        payload = await this.connectGatewayApi.swapOauthToken(sourceMetadata,expectedSourceStateInfo, callbackCode)

        if(!payload.access_token || payload.error){
          //if the access token is not set, then something is wrong,
          const errMsg = payload.error || "unable to retrieve access_token"
          console.error(errMsg)
          throw new Error(errMsg)
        }

        //If payload.patient is not set, make sure we extract the patient ID from the id_token or make an introspection req
        if(!payload.patient && payload.id_token){
          //
          console.log("NO PATIENT ID present, decoding jwt to extract patient")
          //const introspectionResp = await Oauth.introspectionRequest(as, client, payload.access_token)
          //console.log(introspectionResp)
          const decodedIdToken = this.jwtDecode(payload.id_token)
          //nextGen uses fhirUser instead of profile.
          payload.patient = decodedIdToken["patient"] || decodedIdToken["profile"] || decodedIdToken["fhirUser"]

          if(payload.patient && payload.patient.includes("Patient/")){
            //remove the "Patient/" or "https://example.com/fhir/Patient/" prefix if it exists
            payload.patient = payload.patient.split("Patient/")[1]
          }
        }
        //special case for flatiron id token. See https://github.com/fastenhealth/fasten-sources/issues/42
        if(!payload.patient && sourceMetadata.platform_type == 'flatiron'){
          // "pp.patient_id": "PD_05XXXXXXXXX3",
          // "pp.group_id": "GH_CXXXXXXXXXXXX9_5",
          // Becomes: PD--05XXXXXXXXX3.GH--CXXXXXXXXXXXX9--5

          const decodedAccessToken = this.jwtDecode(payload.access_token)
          const patientId = `${decodedAccessToken["pp.patient_id"]}.${decodedAccessToken["pp.group_id"]}`.replace(/_/g, '--')
          payload.patient = patientId
        }


        //get the portal information
        const portalInfo = await this.connectGatewayApi.getConnectGatewayCatalogPortal(expectedSourceStateInfo.portal_id)

        //Create FHIR Client

        const dbSourceCredential = new Source({
          id: expectedSourceStateInfo.reconnect_source_id,

          display: portalInfo.name,
          lighthouse_env_type: environment.connect_gateway_api_endpoint_base == 'https://lighthouse.fastenhealth.com/v1' ? 'prod' : 'sandbox',
          brand_id: expectedSourceStateInfo.brand_id,
          portal_id: expectedSourceStateInfo.portal_id,
          endpoint_id: expectedSourceStateInfo.endpoint_id,
          platform_type: sourceMetadata.platform_type,

          client_id:             sourceMetadata.client_id,
          patient:            payload.patient,
          access_token:          payload.access_token,
          refresh_token:          payload.refresh_token,
          id_token:              payload.id_token,

          // @ts-ignore - in some cases the getAccessTokenExpiration is a string, which cases failures to store Source in db.
          expires_at:            parseInt(this.getAccessTokenExpiration(payload)),
        })

        this.fastenApi.createSource(dbSourceCredential)
          .subscribe((resp) => {
              // const sourceSyncMessage = JSON.parse(msg) as SourceSyncMessage
              delete this.status[dbSourceCredential.brand_id]
              delete this.status[resp.source.id]
              // window.location.reload();
              // this.connectedSourceList.

              //find the index of the "inprogress" source in the connected List, and then add this source to its source metadata.
              const foundSource = this.connectedSourceList.findIndex((item) => {
                return item.source?.brand_id == dbSourceCredential.brand_id || item.brand?.id == dbSourceCredential.brand_id
              })
              this.connectedSourceList[foundSource].source = resp.source

              console.log("source sync-all response:", resp.summary)

              const toastNotification = new ToastNotification()
              toastNotification.type = ToastType.Success
              toastNotification.message = `Successfully connected external data source`

              // const upsertSummary = sourceSyncMessage.response as UpsertSummary
              // if(upsertSummary && upsertSummary.totalResources != upsertSummary.updatedResources.length){
              //   toastNotification.message += `\n (total: ${upsertSummary.totalResources}, updated: ${upsertSummary.updatedResources.length})`
              // } else if(upsertSummary){
              //   toastNotification.message += `\n (total: ${upsertSummary.totalResources})`
              // }

              this.toastService.show(toastNotification)
            },
            (err) => {
              delete this.status[dbSourceCredential.brand_id]
              // window.location.reload();

              const toastNotification = new ToastNotification()
              toastNotification.type = ToastType.Error
              toastNotification.message = `An error occurred while finalizing external data source and starting sync: '${extractErrorFromResponse(err)}'`
              toastNotification.autohide = false
              toastNotification.link = {
                text: "View Details",
                url: `/background-jobs`
              }
              this.toastService.show(toastNotification)
              console.error(err)
            });
      })
      .catch((err) => {
        delete this.status[expectedSourceStateInfo.brand_id]
        // window.location.reload();

        const toastNotification = new ToastNotification()
        toastNotification.type = ToastType.Error
        toastNotification.message = `An error occurred while initializing external data source connection: '${extractErrorFromResponse(err)}'`
        toastNotification.autohide = false
        this.toastService.show(toastNotification)
        console.error(err)

        const errData = new BackgroundJobSyncData()
        errData.source_id = expectedSourceStateInfo.reconnect_source_id
        errData.brand_id = expectedSourceStateInfo.brand_id
        errData.checkpoint_data = {
          //don't copy confidential data to the error data
          state: expectedSourceStateInfo.state,
          endpoint_id: expectedSourceStateInfo.endpoint_id,
          portal_id: expectedSourceStateInfo.portal_id,
          brand_id: expectedSourceStateInfo.brand_id,
          reconnect_source_id: expectedSourceStateInfo.reconnect_source_id,
          code_challenge_method: expectedSourceStateInfo.code_challenge_method,
          redirect_uri: expectedSourceStateInfo.redirect_uri,
        }
        errData.error_data = {
          summary: toastNotification.message,
          error: JSON.stringify(err, replaceErrors),
          stack: err.stack
        }

        //attempt to persist this error to the background job table. ignore any errors that occur during this process.
        this.fastenApi.createBackgroundJobError(errData).subscribe(console.log)

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

  /**
   * https://github.com/smart-on-fhir/client-js/blob/8f64b770dbcd0abd30646e239cd446dfa4d831f6/src/lib.ts#L311
   * Decodes a JWT token and returns it's body.
   * @param token The token to read
   * @param env An `Adapter` or any other object that has an `atob` method
   * @category Utility
   */
  private jwtDecode(token: string): Record<string, any> | null
  {
    const payload = token.split(".")[1];
    return payload ? JSON.parse(atob(payload)) : null;
  }

  /**
   * https://github.com/smart-on-fhir/client-js/blob/8f64b770dbcd0abd30646e239cd446dfa4d831f6/src/lib.ts#L334
   * Given a token response, computes and returns the expiresAt timestamp.
   * Note that this should only be used immediately after an access token is
   * received, otherwise the computed timestamp will be incorrect.
   * @param tokenResponse
   * @param env
   */
  public getAccessTokenExpiration(tokenResponse: any): number
  {
    const now = Math.floor(Date.now() / 1000);

    // Option 1 - using the expires_in property of the token response
    if (tokenResponse.expires_in) {
      return now + parseInt(tokenResponse.expires_in);
    }

    // Option 2 - using the exp property of JWT tokens (must not assume JWT!)
    if (tokenResponse.access_token) {

      const tokenBody = this.jwtDecode(tokenResponse.access_token);
      if (tokenBody && tokenBody['exp']) {
        return parseInt(tokenBody['exp']);
      }
    }

    // Option 3 - if none of the above worked set this to 5 minutes after now
    return now + 300;
  }


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
    const brandId = sourceListItem?.source?.brand_id || sourceListItem?.brand?.id


    if(
      (this.status[brandId] && this.status[brandId] != 'failed') //if this source type is currently "loading" dont open the modal window
      || !sourceListItem.source //if there's no connected source, dont open the modal window
      || (this.status[sourceListItem?.source?.id] && this.status[sourceListItem?.source?.id] != 'failed') //if this source type is currently "loading" dont open the modal window
    ){
      //if this source is currently "loading" dont open the modal window
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

  public sourceDeleteHandler(){
    const source = this.modalSelectedSourceListItem.source
    const sourceDisplayName = this.modalSelectedSourceListItem?.source?.display || this.modalSelectedSourceListItem?.brand?.name || 'unknown'

    this.status[source.id] = "authorize"
    this.modalService.dismissAll()

    this.fastenApi.deleteSource(source.id).subscribe(
      (respData) => {
        delete this.status[source.id]
        delete this.status[source.brand_id]

        //delete this source from the connnected list
        const foundIndex = this.connectedSourceList.findIndex((connectedSource) => {
          return connectedSource?.source?.id == source.id
        }, this)
        if(foundIndex > -1){
          this.connectedSourceList.splice(foundIndex, 1)
        }

        console.log("source delete response:", respData)


        const toastNotification = new ToastNotification()
        toastNotification.type = ToastType.Success
        toastNotification.message = `Successfully deleted source: ${sourceDisplayName}, ${respData} row(s) effected`
        this.toastService.show(toastNotification)

      },
      (err) => {
        delete this.status[source.id]
        delete this.status[source.brand_id]

        const toastNotification = new ToastNotification()
        toastNotification.type = ToastType.Error
        toastNotification.message = `An error occurred while deleting source (${sourceDisplayName}): ${extractErrorFromResponse(err)}`
        this.toastService.show(toastNotification)
        console.log(err)
      })
  }

  //this is similar to the connectHandler in the MedicalSourcesComponent
  //TODO: refactor this to use the connectHandler in the MedicalSourcesComponent
  public sourceReconnectHandler(selectedSourceListItem: SourceListItem){

    const endpointId = selectedSourceListItem?.source?.endpoint_id
    this.connectGatewayApi.getConnectGatewaySource(endpointId)
      .then(async (sourceMetadata: ConnectGatewaySourceMetadata) => {

        if(selectedSourceListItem?.source){
          sourceMetadata.brand_id = selectedSourceListItem.source.brand_id
          sourceMetadata.portal_id = selectedSourceListItem.source.portal_id
        }

        console.log(sourceMetadata);
        const authorizationUrl = await this.connectGatewayApi.generateSourceAuthorizeUrl(sourceMetadata, selectedSourceListItem.source.id)

        console.log('authorize url:', authorizationUrl.toString());
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
