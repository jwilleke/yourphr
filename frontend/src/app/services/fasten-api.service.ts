import {Inject, Injectable} from '@angular/core';
import { Practitioner } from 'src/app/models/fasten/practitioner';
import { HttpClient, HttpHeaders, HttpResponse } from '@angular/common/http';
import {Observable, of} from 'rxjs';
import { Router } from '@angular/router';
import {map} from 'rxjs/operators';
import {ResponseWrapper} from '../models/response-wrapper';
import {ReconciledMedication} from '../models/fasten/reconciled-medication';
import {ClassifiedCondition} from '../models/fasten/classified-condition';
import {ClassifiedAllergy} from '../models/fasten/classified-allergy';
import {AccountUser} from '../models/fasten/account-user';
import {ResourceListItem} from '../models/fasten/resource-list-item';
import {ServerLogs} from '../models/fasten/server-logs';
import {Source} from '../models/fasten/source';
import {User} from '../models/fasten/user';
import {ResourceFhir} from '../models/fasten/resource_fhir';
import {SourceSummary} from '../models/fasten/source-summary';
import {Summary} from '../models/fasten/summary';
import {AuthService} from './auth.service';
import {GetEndpointAbsolutePath} from '../../lib/utils/endpoint_absolute_path';
import {environment} from '../../environments/environment';
import {ValueSet} from 'fhir/r4';
import {AttachmentModel} from '../../lib/models/datatypes/attachment-model';
import {BinaryModel} from '../../lib/models/resources/binary-model';
import {HTTP_CLIENT_TOKEN} from "../dependency-injection";
import * as fhirpath from 'fhirpath';
import _ from 'lodash';
import {DashboardConfig} from '../models/widget/dashboard-config';
import {DashboardWidgetQuery} from '../models/widget/dashboard-widget-query';
import {ResourceGraphResponse} from '../models/fasten/resource-graph-response';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import {BackgroundJob, BackgroundJobSyncData} from '../models/fasten/background-job';
import {SupportRequest} from '../models/fasten/support-request';
import {SmartConnectRequest} from '../models/fasten/smart-connect-request';
import {SmartAuthorizeRequest, SmartAuthorizeResponse} from '../models/fasten/smart-authorize';
import {ConnectableProvider, ProviderCatalogEntry, ProviderCatalogEntryRequest} from '../models/fasten/provider-catalog';
import {
  List
} from 'fhir/r4';
import {FormRequestHealthSystem} from '../models/fasten/form-request-health-system';
import { UpdateResourcePayload } from '../models/fasten/resource_update';
import { Favorite } from '../pages/practitioner-list/practitioner-list.component';

@Injectable({
  providedIn: 'root'
})
export class FastenApiService {

  private _eventBus: Observable<Event>
  private _eventBusAbortController: AbortController

  constructor(@Inject(HTTP_CLIENT_TOKEN) private _httpClient: HttpClient,  private router: Router, private authService: AuthService) {
  }

  /*
  TERMINOLOGY SERVER/GLOSSARY ENDPOINTS
  */
  getGlossarySearchByCode(code: string, codeSystem: string): Observable<ValueSet> {

    const endpointUrl = new URL(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/glossary/code`);
    endpointUrl.searchParams.set('code', code);
    endpointUrl.searchParams.set('code_system', codeSystem);

    return this._httpClient.get<any>(endpointUrl.toString())
      .pipe(
        map((response: ValueSet) => {
          return response
        })
      );
  }

  getHealth(): Observable<any> {
    return this._httpClient.get<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/health`)
      .pipe(
        map((response: ResponseWrapper) => {
          return response.data
        })
      );
  }

  getEncryptionKey(): Observable<string> {
    return this._httpClient.get<{ data: string }>(
      `${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/encryption-key`
    ).pipe(
      map(response => response?.data)
    );
  }

  setupEncryptionKey(encryptionKey: string): Observable<any> {
    return this._httpClient.post<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/encryption-key`, { encryption_key: encryptionKey })
      .pipe(
        map((response: ResponseWrapper) => {
          return response.data
        })
      );
  }

  validateEncryptionKey(encryptionKey: string): Observable<any> {
    return this._httpClient.post<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/encryption-key/validate`, { encryption_key: encryptionKey })
      .pipe(
        map((response: ResponseWrapper) => {
          return response.data
        })
      );
  }

  /*
  SECURE ENDPOINTS
  */

  deleteAccount(): Observable<boolean> {
    return this._httpClient.delete<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/account/me`)
      .pipe(
        map((response: ResponseWrapper) => {
          if(response.success) {
            this.authService.Logout().then(() => {
              this.router.navigateByUrl('/auth/signup')
            })
          }
          return response.success
        })
      );
  }

  // The current system user account (Account Profile identity) — sanitized (no password hash).
  getCurrentUser(): Observable<AccountUser> {
    return this._httpClient.get<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/account/me`)
      .pipe(
        map((response: ResponseWrapper) => {
          return (response.data || {}) as AccountUser
        })
      );
  }

  // Change the current user's password. The server verifies the current password before applying.
  changePassword(currentPassword: string, newPassword: string): Observable<boolean> {
    return this._httpClient.post<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/account/password`, {
      current_password: currentPassword,
      new_password: newPassword,
    }).pipe(
      map((response: ResponseWrapper) => response.success)
    );
  }

  //TODO: Any significant API changes here should also be reflected in EventBusService

  getDashboards(): Observable<DashboardConfig[]> {
    return this._httpClient.get<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/dashboards`, )
      .pipe(
        map((response: ResponseWrapper) => {
          return response.data as DashboardConfig[]
        })
      );
  }

  getSummary(): Observable<Summary> {
    return this._httpClient.get<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/summary`, )
      .pipe(
        map((response: ResponseWrapper) => {
          return response.data as Summary
        })
      );
  }

  getReconciledMedications(): Observable<ReconciledMedication[]> {
    return this._httpClient.get<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/medications/reconciled`)
      .pipe(
        map((response: ResponseWrapper) => {
          return (response.data || []) as ReconciledMedication[]
        })
      );
  }

  getClassifiedConditions(): Observable<ClassifiedCondition[]> {
    return this._httpClient.get<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/conditions/classified`)
      .pipe(
        map((response: ResponseWrapper) => {
          return (response.data || []) as ClassifiedCondition[]
        })
      );
  }

  getClassifiedAllergies(): Observable<ClassifiedAllergy[]> {
    return this._httpClient.get<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/allergies/classified`)
      .pipe(
        map((response: ResponseWrapper) => {
          return (response.data || []) as ClassifiedAllergy[]
        })
      );
  }

  getRecentResources(limit = 5): Observable<ResourceListItem[]> {
    return this._httpClient.get<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/resources/recent`, {params: {limit}})
      .pipe(
        map((response: ResponseWrapper) => {
          return (response.data || []) as ResourceListItem[]
        })
      );
  }

  searchResources(query: string): Observable<ResourceListItem[]> {
    return this._httpClient.get<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/resources/search`, {params: {q: query}})
      .pipe(
        map((response: ResponseWrapper) => {
          return (response.data || []) as ResourceListItem[]
        })
      );
  }

  //admin-only (#170): server logs (in-memory ring buffer) for the Admin Dashboard
  getServerLogs(): Observable<ServerLogs> {
    return this._httpClient.get<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/admin/logs`)
      .pipe(
        map((response: ResponseWrapper) => {
          return response.data as ServerLogs
        })
      );
  }

  //admin-only (#170): change the running server log level at runtime (resets to config on restart).
  setServerLogLevel(level: string): Observable<{ level: string }> {
    return this._httpClient.put<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/admin/log-level`, { level })
      .pipe(map((response: ResponseWrapper) => response.data as { level: string }));
  }

  createSource(source: Source): Observable<any> {
    return this._httpClient.post<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/source`, source)
      .pipe(
        map((response: ResponseWrapper) => {
          // @ts-ignore
          return {summary: response.data, source: response.source}
        })
      );
  }

  // authorizeSource asks the backend to perform SMART on FHIR discovery and build the PKCE
  // authorize URL. The browser opens authorize_url so the user logs in at the provider; the
  // returned state + code_verifier are then passed to connectSource() to complete the exchange.
  // See backend handler.AuthorizeSource (#51) and the relay (#50).
  authorizeSource(req: SmartAuthorizeRequest): Observable<SmartAuthorizeResponse> {
    return this._httpClient.post<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/source/authorize`, req)
      .pipe(
        map((response: any) => {
          return {
            authorize_url: response.authorize_url,
            state: response.state,
            code_verifier: response.code_verifier,
            login_wait_seconds: response.login_wait_seconds,
          } as SmartAuthorizeResponse
        })
      );
  }

  // connectSource completes a SMART on FHIR connection: the backend exchanges the authorization
  // code (with PKCE verifier) for tokens, stores the source, and starts the initial sync. The
  // browser never handles tokens. See backend handler.ConnectSource (#51) and the relay (#50).
  connectSource(req: SmartConnectRequest): Observable<any> {
    return this._httpClient.post<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/source/connect`, req)
      .pipe(
        map((response: ResponseWrapper) => {
          // @ts-ignore
          return {summary: response.data, source: response.source}
        })
      );
  }

  // ---- Provider catalog (#306 / #291) -----------------------------------------------------------
  // The patient connects by picking an admin-configured provider; client_id/client_secret stay
  // backend-only and are NEVER sent from or returned to the browser. See backend handler.*Catalog*.

  // listConnectableProviders returns the enabled catalog entries as a credential-free picker
  // (id + display + logo only).
  listConnectableProviders(): Observable<ConnectableProvider[]> {
    return this._httpClient.get<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/provider-catalog/connectable`)
      .pipe(map((response: ResponseWrapper) => (response.data || []) as ConnectableProvider[]));
  }

  // listSandboxProviders returns the admin-only sandbox catalog entries as a credential-free picker
  // (id + display + logo only). Used by the /sandbox admin page for one-click connect — the sandbox
  // client_id/secret are supplied server-side (env), never typed or returned to the browser (#291).
  listSandboxProviders(): Observable<ConnectableProvider[]> {
    return this._httpClient.get<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/provider-catalog/sandbox`)
      .pipe(map((response: ResponseWrapper) => (response.data || []) as ConnectableProvider[]));
  }

  // authorizeSourceFromCatalog builds the PKCE authorize URL for a catalog entry. The request carries
  // ONLY redirect_uri — the backend fills client_id/scopes/FHIR base from the catalog server-side.
  authorizeSourceFromCatalog(catalogId: string, req: { redirect_uri: string }): Observable<SmartAuthorizeResponse> {
    return this._httpClient.post<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/provider-catalog/${encodeURIComponent(catalogId)}/authorize`, req)
      .pipe(
        map((response: any) => {
          return {
            authorize_url: response.authorize_url,
            state: response.state,
            code_verifier: response.code_verifier,
            login_wait_seconds: response.login_wait_seconds,
          } as SmartAuthorizeResponse
        })
      );
  }

  // connectSourceFromCatalog completes the connection for a catalog entry. The request carries NO
  // client_id/client_secret — the backend resolves them from the catalog and does the token exchange.
  connectSourceFromCatalog(catalogId: string, req: { state: string, code_verifier: string, redirect_uri: string, display?: string }): Observable<any> {
    return this._httpClient.post<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/provider-catalog/${encodeURIComponent(catalogId)}/connect`, req)
      .pipe(
        map((response: ResponseWrapper) => {
          // @ts-ignore
          return {summary: response.data, source: response.source}
        })
      );
  }

  // ---- Provider catalog admin CRUD (#310, admin-gated) ------------------------------------------
  // The backend enforces the admin role on every one of these; the secret is never returned.

  listProviderCatalogEntries(): Observable<ProviderCatalogEntry[]> {
    return this._httpClient.get<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/provider-catalog`)
      .pipe(map((response: ResponseWrapper) => (response.data || []) as ProviderCatalogEntry[]));
  }

  createProviderCatalogEntry(req: ProviderCatalogEntryRequest): Observable<ProviderCatalogEntry> {
    return this._httpClient.post<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/provider-catalog`, req)
      .pipe(map((response: ResponseWrapper) => response.data as ProviderCatalogEntry));
  }

  updateProviderCatalogEntry(id: string, req: ProviderCatalogEntryRequest): Observable<ProviderCatalogEntry> {
    return this._httpClient.put<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/provider-catalog/${encodeURIComponent(id)}`, req)
      .pipe(map((response: ResponseWrapper) => response.data as ProviderCatalogEntry));
  }

  deleteProviderCatalogEntry(id: string): Observable<any> {
    return this._httpClient.delete<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/provider-catalog/${encodeURIComponent(id)}`);
  }

  createManualSource(file: File): Observable<Source> {

    const formData = new FormData();
    formData.append('file', file);

    return this._httpClient.post<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/source/manual`, formData)
      .pipe(
        map((response: ResponseWrapper) => {
          return response.data as Source
        })
      );
  }

  createRelatedResourcesFastenSource(resourceList: List): Observable<Source> {

    const bundleBlob = new Blob([JSON.stringify(resourceList)], { type: 'application/json' });
    const bundleFile = new File([ bundleBlob ], 'related.json', { type: 'application/json' });

    const formData = new FormData();
    formData.append('file', bundleFile);

    return this._httpClient.post<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/resource/related`, formData)
      .pipe(
        map((response: ResponseWrapper) => {
          return response.data as Source
        })
      );
  }

  removeEncounterRelatedResource(encounterId: string, resourceId: string, resourceType: string) : Observable<any> {
    return this._httpClient.delete<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/encounter/${encounterId}/related/${resourceType}/${resourceId}`)
      .pipe(
        map((response: ResponseWrapper) => {
          return response.data
        })
      );
  }


  getSources(): Observable<Source[]> {
    return this._httpClient.get<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/source`)
      .pipe(
        map((response: ResponseWrapper) => {
          return response.data as Source[]
        })
      );
  }

  getSource(sourceId: string): Observable<Source> {
    return this._httpClient.get<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/source/${sourceId}`)
      .pipe(
        map((response: ResponseWrapper) => {
          return response.data as Source
        })
      );
  }

  getSourceSummary(sourceId: string): Observable<SourceSummary> {
    return this._httpClient.get<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/source/${sourceId}/summary`)
      .pipe(
        map((response: ResponseWrapper) => {
          return response.data as SourceSummary
        })
      );
  }

  // exportSource downloads all of a source's stored resources as a FHIR Bundle. Returns the full
  // HttpResponse<Blob> so the caller can read the server's Content-Disposition filename. The
  // auth-interceptor still attaches the JWT, so this works against the secure endpoint.
  exportSource(sourceId: string): Observable<HttpResponse<Blob>> {
    return this._httpClient.get(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/source/${sourceId}/export`,
      {responseType: 'blob', observe: 'response'});
  }

  deleteSource(sourceId: string): Observable<number> {
    return this._httpClient.delete<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/source/${sourceId}`)
      .pipe(
        map((response: ResponseWrapper) => {
          return response.data as number
        })
      );
  }

  syncSource(sourceId: string): Observable<any> {
    return this._httpClient.post<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/source/${sourceId}/sync`, {})
      .pipe(
        map((response: ResponseWrapper) => {
          return response.data
        })
      );
  }

  getResources(sourceResourceType?: string, sourceID?: string, sourceResourceID?: string, page?: number): Observable<ResourceFhir[]> {
    const queryParams = {}
    if(sourceResourceType){
      queryParams["sourceResourceType"] = sourceResourceType
    }
    if(sourceID){
      queryParams["sourceID"] = sourceID
    }

    if(sourceResourceID){
      queryParams["sourceResourceID"] = sourceResourceID
    }
    if(page !== undefined){
      queryParams["page"] = page
    }

    return this._httpClient.get<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/resource/fhir`, {params: queryParams})
      .pipe(
        map((response: ResponseWrapper) => {
          return response.data as ResourceFhir[]
        })
      );
  }

  /**
   * Retrieves the history for a specific practitioner.
   * @param practitionerId The ID of the practitioner (e.g., '1043089352').
   * @returns An Observable array of FHIR Resources representing the practitioner's history.
   */
  getPractitionerHistory(practitionerId: string): Observable<ResourceFhir[]> {
    // Construct the full URL by embedding the practitionerId directly into the path
    const endpointUrl = `${GetEndpointAbsolutePath(
      globalThis.location,
      environment.fasten_api_endpoint_base
    )}/secure/practitioners/${practitionerId}/history`;

    return this._httpClient.get<ResponseWrapper>(endpointUrl).pipe(
      map((response: any) => {
        // Extract the data array from the response, just like in your example
        return response.relatedResources as ResourceFhir[];
      })
    );
  }

  //TODO: add caching here, we dont want the same query to be run multiple times whne loading the dashboard.
  // we should also add a way to invalidate the cache when a source is synced
  //this function is special, as it returns the raw response, for processing in the DashboardWidgetComponent
  queryResources(query?: DashboardWidgetQuery): Observable<ResponseWrapper> {


    return this._httpClient.post<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/query`, query)
  }

  // requires:
  // - source_id: string
  // - source_resource_type: string
  // - source_resource_id: string
  getResourceGraph(graphType?: string, selectedResourceIds?: Partial<ResourceFhir>[]): Observable<ResourceGraphResponse> {
    if(!graphType){
      graphType = "MedicalHistory"
    }

    return this._httpClient.post<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/resource/graph/${graphType}`, {resource_ids: selectedResourceIds})
      .pipe(
        map((response: ResponseWrapper) => {
          return response.data as ResourceGraphResponse
        })
      );
  }

  getResourceBySourceId(sourceId: string, resourceId: string): Observable<ResourceFhir> {

    return this._httpClient.get<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/resource/fhir/${sourceId}/${resourceId}`)
      .pipe(
        map((response: ResponseWrapper) => {
          return response.data as ResourceFhir
        })
      );
  }

  updateResource(resourceType: string, resourceId: string, payload: UpdateResourcePayload) : Observable<ResponseWrapper> {
    return this._httpClient.patch<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/resource/fhir/${resourceType}/${resourceId}`, payload)
      .pipe(
        map((response: ResponseWrapper) => {
          return response
        })
      );
  }

  addDashboardLocation(location: string): Observable<ResponseWrapper> {
    return this._httpClient.post<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/dashboards`, {
      "location": location
    })
      .pipe(
        map((response: ResponseWrapper) => {
          return response
        })
      );
  }

  //this method allows a user to manually group related FHIR resources together (conditions, encounters, etc).
  // @deprecated - replaced by Create Manual Record Wizard
  createResourceComposition(title: string, resources: ResourceFhir[]){
    return this._httpClient.post<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/resource/composition`, {
      "resources": resources,
      "title": title,
    })
      .pipe(
        map((response: ResponseWrapper) => {
          return response.data
        })
      );
  }

  getBinaryModel(sourceId: string, attachmentModel: AttachmentModel): Observable<BinaryModel> {
    if(attachmentModel.url && !attachmentModel.data){
      //this attachment model is a refernce to a Binary model, we need to download it first.
      const urnPrefix = "urn:uuid:";
      const resourceType = "Binary"
      let resourceId = ""
      const binaryUrl = attachmentModel.url
      //strip out the urn prefix (if this is an embedded id, eg. urn:uuid:2a35e080-c5f7-4dde-b0cf-8210505708f1)
      if (binaryUrl.startsWith(urnPrefix)) {
        // PREFIX is exactly at the beginning
        resourceId = binaryUrl.slice(urnPrefix.length);
      } else if(binaryUrl.startsWith("http://") || binaryUrl.startsWith("https://") || binaryUrl.startsWith("Binary/")){
        //this is an absolute URL (which could be a FHIR url with Binary/xxx-xxx-xxx-xxx or a direct link to a file)
        const urlParts = binaryUrl.split("Binary/");
        if(urlParts.length > 1){
          //this url has a Binary/xxx-xxx-xxx-xxx part, so we can use that as the resource id
          resourceId = urlParts[urlParts.length - 1];
        } else {
          //this is a fully qualified url. we need to base64 encode the url and use that as the resource id
          resourceId = btoa(binaryUrl)
        }
      }
      return this.getResourceBySourceId(sourceId, resourceId).pipe(
        map((resourceFhir: ResourceFhir) => {
          return new BinaryModel(resourceFhir.resource_raw)
        })
      )
    } else {
      return of(new BinaryModel(attachmentModel));
    }
  }


  getBackgroundJobs(jobType?: string, status?: string,  page?: number): Observable<BackgroundJob[]> {
    const queryParams = {}
    if(jobType){
      queryParams["jobType"] = jobType
    }
    if(status){
      queryParams["status"] = status
    }

    if(page !== undefined){
      queryParams["page"] = page
    }

    return this._httpClient.get<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/jobs`, {params: queryParams})
      .pipe(
        map((response: ResponseWrapper) => {
          return response.data as BackgroundJob[]
        })
      );
  }

  //this method will persist client side errors in the database for later review & easier debugging. Primarily used for source/provider connection errors
  createBackgroundJobError(errorData: BackgroundJobSyncData){
    return this._httpClient.post<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/jobs/error`, errorData)
      .pipe(
        map((response: ResponseWrapper) => {
          return response.data
        })
      );
  }


  supportRequest(request: SupportRequest): Observable<any> {
    return this._httpClient.post<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/support/request`, request)
      .pipe(
        map((response: ResponseWrapper) => {
          // @ts-ignore
          return {}
        })
      );
  }

  requestHealthSystem(requestHealth: FormRequestHealthSystem): Observable<any> {
    return this._httpClient.post<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/support/healthsystem`, requestHealth)
      .pipe(
        map((response: ResponseWrapper) => {
          // @ts-ignore
          return {}
        })
      );
  }

  getAllUsers(): Observable<User[]> {
    return this._httpClient.get<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/users`)
      .pipe(
        map((response: ResponseWrapper) => {
          return response.data as User[]
        })
      );
  }

  getIPSExport(exportType?: string) {
    const format = exportType || "pdf"
    let contentType = "application/pdf"
    if (exportType == "html") {
      contentType = "text/html"
    }

    const httpHeaders = new HttpHeaders().set('Accept', contentType);
    const queryParams = {
      "format": format
    };

    console.log("requesting", `${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/summary/ips`);

    this._httpClient.get(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/summary/ips`, {
      params: queryParams,
      headers: httpHeaders,
      responseType: 'blob' // Request the data as a Blob
    }).subscribe((data: Blob) => {
      console.log(data)
      // Create a URL for the blob
      const fileURL = URL.createObjectURL(data);

      // Create a temporary anchor element and trigger the download
      const link = document.createElement('a');
      link.href = fileURL;
      link.setAttribute('download', `ips_summary.${exportType}`); // Set the filename for the download
      document.body.appendChild(link);
      link.click();

      // Clean up by removing the link and revoking the URL
      document.body.removeChild(link);
      URL.revokeObjectURL(fileURL);
    });
  }

  getAllPractitioners(): Observable<Practitioner[]> {
    const endpointUrl = `${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/resource/fhir?sourceResourceType=Practitioner`;
    return this._httpClient.get<any>(endpointUrl)
      .pipe(
        map((response: ResponseWrapper) => {
          const practitioners = response.data.map(item => {
            let email: string | undefined;
            let emailUse: string | undefined;
            let phone: string | undefined;
            let phoneUse: string | undefined;
            let fax: string | undefined;
            let faxUse: string | undefined;
            let primaryTelecom: any;
  
            if (item.resource_raw.telecom && Array.isArray(item.resource_raw.telecom)) {
              item.resource_raw.telecom.forEach((telecom: any) => {
                switch (telecom.system) {
                  case 'email':
                    if (!email) { 
                      email = telecom.value?.toLowerCase();
                      emailUse = telecom.use || 'work';
                    }
                    break;
                  case 'phone':
                    if (!phone) {
                      phone = telecom.value;
                      phoneUse = telecom.use || 'work';
                    }
                    break;
                  case 'fax':
                    if (!fax) { 
                      fax = telecom.value;
                      faxUse = telecom.use || 'work'; 
                    }
                    break;
                }
              });
              primaryTelecom = item.resource_raw.telecom[0];
            } else if (item.resource_raw.telecom) {
              primaryTelecom = item.resource_raw.telecom;
              switch (primaryTelecom.system) {
                case 'email':
                  email = primaryTelecom.value?.toLowerCase();
                  emailUse = primaryTelecom.use || 'work';
                  break;
                case 'phone':
                  phone = primaryTelecom.value;
                  phoneUse = primaryTelecom.use || 'work';
                  break;
                case 'fax':
                  fax = primaryTelecom.value;
                  faxUse = primaryTelecom.use || 'work';
                  break;
              }
            }
  
            let jobTitle: string | undefined;
            let organization: string | undefined;
  
            if (item.resource_raw.qualification && Array.isArray(item.resource_raw.qualification)) {
              const firstQualification = item.resource_raw.qualification[0];
              if (firstQualification?.code?.coding) {
                const coding = firstQualification.code.coding[0];
                jobTitle = coding?.display || coding?.code;
              } else if (firstQualification?.code?.text) {
                jobTitle = firstQualification.code.text;
              }

              if (firstQualification?.issuer?.display) {
                organization = firstQualification.issuer.display;
              } else if (firstQualification?.issuer?.reference) {
                organization = firstQualification.issuer.reference.replace('Organization/', '');
              }
            }
  
            if (!jobTitle && item.resource_raw.practitionerRole) {
              if (Array.isArray(item.resource_raw.practitionerRole)) {
                const role = item.resource_raw.practitionerRole[0];
                if (role?.code) {
                  jobTitle = role.code.coding?.[0]?.display || role.code.text;
                }
                if (role?.organization?.display) {
                  organization = role.organization.display;
                }
              }
            }
  
            if (!jobTitle && item.resource_raw.extension) {
              const specialtyExtension = item.resource_raw.extension.find((ext: any) => 
                ext.url?.includes('specialty') || ext.url?.includes('job') || ext.url?.includes('title')
              );
              if (specialtyExtension?.valueString) {
                jobTitle = specialtyExtension.valueString;
              } else if (specialtyExtension?.valueCoding?.display) {
                jobTitle = specialtyExtension.valueCoding.display;
              }
            }
  
            const practitioner: Practitioner = {
              source_resource_id: item.source_resource_id,
              source_id: item.source_id,
              source_resource_type: item.source_resource_type,
              full_name: item.resource_raw.name?.[0]?.text || item?.sort_title || 'N/A',
              address: item.resource_raw.address?.[0] || {
                line: [], 
                city: '', 
                state: '', 
                postalCode: '', 
                country: ''
              },
              email: email,
              emailUse: emailUse,
              phone: phone,
              phoneUse: phoneUse,
              fax: fax,
              faxUse: faxUse,
              
              jobTitle: jobTitle,
              organization: organization,
              qualification: item.resource_raw.qualification,
              
              telecom: primaryTelecom || {
                system: '', 
                value: '', 
                use: ''
              },
              
              formattedAddress: '',
              formattedTelecom: '',

              resource_raw: item.resource_raw
            };
  
            return practitioner;
          });
          
          console.log('Fetched practitioners with job title, organization, and contact use properties:', practitioners);
          return practitioners as Practitioner[];
        })
      );
  }

  deleteResourceFhir(resourceType: string, resourceId: string): Observable<any> {
    return this._httpClient.delete<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/resource/fhir/${resourceType}/${resourceId}`)
      .pipe(
        map((response: ResponseWrapper) => {
          return response
        })
      );
  }
  
  deletePractitioner(practitionerId: string): Observable<any> {
    return this.deleteResourceFhir('Practitioner', practitionerId);
  }

  createPractitioner(practitionerResource: any): Observable<any> {
    return this._httpClient.post<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/practitioners`, {
      resource: practitionerResource
    })
      .pipe(
        map((response: ResponseWrapper) => {
          return response
        })
      );
  }

  updatePractitioner(practitionerId: string, practitionerResource: any): Observable<any> {
    return this._httpClient.put<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/practitioners/${practitionerId}`, {
      resource: practitionerResource
    })
      .pipe(
        map((response: ResponseWrapper) => {
          return response
        })
      );
  }

  addFavorite(resourceType: string, resourceId: string, sourceId: string): Observable<any> {
    const endpointUrl = `${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/user/favorites`;
    return this._httpClient.post<any>(endpointUrl, {
      resource_type: resourceType,
      resource_id: resourceId,
      source_id: sourceId
    })
    .pipe(
      map((response: ResponseWrapper) => {
        return response
      })
    );
  }

  removeFavorite(resourceType: string, resourceId: string, sourceId: string): Observable<any> {
    const endpointUrl = `${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/user/favorites`;
    return this._httpClient.delete<any>(endpointUrl, {
      body: {
        resource_type: resourceType,
        resource_id: resourceId,
        source_id: sourceId
      }
    })
    .pipe(
      map((response: ResponseWrapper) => {
        return response
      })
    );
  }

  getUserFavorites(resourceType?: string): Observable<Favorite[]> {
    const endpointUrl = `${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/user/favorites`;
    const queryParams = {};
    
    if (resourceType) {
      queryParams['resource_type'] = resourceType;
    }
    
    return this._httpClient.get<any>(endpointUrl, { params: queryParams })
      .pipe(
        map((response: ResponseWrapper) => {
          return response.data;
        })
      );
    
  }
}
