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
import {ClassifiedImmunization} from '../models/fasten/classified-immunization';
import {DatabaseInfo, BackupResult, BackupSettings, DirListing, BackupDestinationTest} from '../models/fasten/database-info';
import {AccountUser} from '../models/fasten/account-user';
import {AccessEvent} from '../models/fasten/access-event';
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
import {formatHumanName} from '../../lib/models/datatypes/human-name-model';
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
import {RelayConfig} from '../models/fasten/relay-config';
import {InstanceSettings} from '../models/fasten/instance-settings';
import {AdminConfig, RevealedConfigValue} from '../models/fasten/admin-config';
import {LegalDocument} from '../models/fasten/legal-document';
import {LegalConsentStatus} from '../models/fasten/legal-consent';
import {AdminMetrics} from '../models/fasten/admin-metrics';
import {CDAConverterStatus} from '../models/fasten/cda-converter-status';
import {ConnectableProvider, ProviderCatalogEntry, ProviderCatalogEntryRequest} from '../models/fasten/provider-catalog';
import {
  List
} from 'fhir/r4';
import {FormRequestHealthSystem} from '../models/fasten/form-request-health-system';
import { UpdateResourcePayload } from '../models/fasten/resource_update';
import { Favorite } from '../pages/practitioner-list/practitioner-list.component';

import { TypesenseDocument, TypesenseSearchResponse, TypesenseSearchSummaryResponse } from '../models/typesense/typesense-result-model';
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

  // The current user's complete access log (#563): who accessed which category of their records on
  // which day. Reading the log itself is not a record access, so it does not log itself.
  getAccessLog(): Observable<AccessEvent[]> {
    return this._httpClient.get<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/account/access-log`)
      .pipe(map((response: ResponseWrapper) => (response.data || []) as AccessEvent[]));
  }

  // Ends every session for the current user, this browser included (#508). The server bumps the
  // user's token generation, which invalidates every JWT already issued — the only way to evict a
  // stolen session, since session tokens are otherwise stateless.
  signOutEverywhere(): Observable<boolean> {
    return this._httpClient.post<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/account/sign-out-everywhere`, {})
      .pipe(map((response: ResponseWrapper) => response.success));
  }

  // An admin sets another user's password (#511). The generated value comes back exactly once — the
  // server stores only the hash — so the caller must show it immediately or reset again.
  adminResetUserPassword(userId: string): Observable<{username: string, password: string}> {
    return this._httpClient.post<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/users/${userId}/password`, {})
      .pipe(map((response: ResponseWrapper) => response.data as {username: string, password: string}));
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

  searchTypesenseResources(params: {
    query?: string;
    type?: string;
    page?: number;
    per_page?: number;
  }): Observable<TypesenseSearchResponse> {
       let queryParams = {};
       if (params.query) {
         queryParams['q'] = params.query;
       }
       if (params.page !== undefined) {
         queryParams['page'] = params.page;
       }
       if (params.per_page !== undefined) {
         queryParams['per_page'] = params.per_page;
       }
       if (params.type) {
         queryParams['type'] = params.type;
       }

       return this._httpClient.get<
         TypesenseSearchResponse
       >(
         `${GetEndpointAbsolutePath(
           globalThis.location,
           environment.fasten_api_endpoint_base
         )}/secure/resource/search`,
         { params: queryParams }
       );
  }

  searchSingleResource(params: {
    id?: string;
  }): Observable<{response: {resource: TypesenseDocument}}> {
       if (!params?.id) {
         return of({response: null});
       }

       return this._httpClient.get<
         {response: {resource: TypesenseDocument}}
       >(
         `${GetEndpointAbsolutePath(
           globalThis.location,
           environment.fasten_api_endpoint_base
         )}/secure/resource/search/${params.id}`,
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

  // getReconciledConditions returns the DEDUPED problem-list view (one entry per clinical concept).
  // Use this for "current problems"/problem-list presentations; getClassifiedConditions is the
  // faithful 1:1 list (every Condition, never collapsed).
  getReconciledConditions(): Observable<ClassifiedCondition[]> {
    return this._httpClient.get<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/conditions/reconciled`)
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

  getClassifiedImmunizations(): Observable<ClassifiedImmunization[]> {
    return this._httpClient.get<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/immunizations/classified`)
      .pipe(
        map((response: ResponseWrapper) => {
          return (response.data || []) as ClassifiedImmunization[]
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

  // getLegalDocument returns this instance's Privacy Policy or Terms of Service (#463).
  // Public endpoint — read before signing up, and linked from the sign-in page. Served by the
  // instance rather than yourphr.org so it works offline and reflects the operator's own text.
  getLegalDocument(kind: string): Observable<LegalDocument> {
    return this._httpClient.get<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/legal/${encodeURIComponent(kind)}`)
      .pipe(map((response: ResponseWrapper) => response.data as LegalDocument));
  }

  // getPublicInstanceInfo returns this instance's public identity for callers with NO login.
  // The backend decides what to publish from the `public` array (#457), so the payload names the
  // setting each value came from. Mapped to short names here, in one place, so components do not
  // carry config-key strings.
  // Any key absent from the response is an operator choosing not to publish it; render nothing
  // rather than substituting a fallback. Note contact_email is NOT public by default (#459).
  getPublicInstanceInfo(): Observable<InstanceInfo> {
    return this._httpClient.get<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/instance/public`)
      .pipe(map((response: ResponseWrapper) => mapInstanceInfo(response)));
  }

  // getInstanceInfo returns the same shape for a SIGNED-IN user, which additionally includes the
  // operator contact email (#459): it is withheld from anonymous callers so it is not harvested,
  // but someone with an account is entitled to reach whoever holds their records.
  getInstanceInfo(): Observable<InstanceInfo> {
    return this._httpClient.get<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/instance`)
      .pipe(map((response: ResponseWrapper) => mapInstanceInfo(response)));
  }

  /*
  ADMIN CONFIGURATION (#458) — admin-only.
  */

  // The whole merged configuration: effective value, where it came from, and whether it is
  // public. Values outside the `public` array arrive MASKED — the real value is not in this
  // response, so revealing one is a separate request.
  getAdminConfig(): Observable<AdminConfig> {
    return this._httpClient.get<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/admin/config`)
      .pipe(map((response: ResponseWrapper) => response.data as AdminConfig));
  }

  // Fetch the real value of ONE key. Deliberately one at a time: this is the request that puts a
  // secret on the wire, and the backend logs each one.
  revealAdminConfigValue(key: string): Observable<RevealedConfigValue> {
    return this._httpClient.get<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/admin/config/reveal/${encodeURIComponent(key)}`)
      .pipe(map((response: ResponseWrapper) => response.data as RevealedConfigValue));
  }

  setAdminConfigValue(key: string, value: any): Observable<boolean> {
    return this._httpClient.put<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/admin/config`, {key, value})
      .pipe(map((response: ResponseWrapper) => response.success));
  }

  // Drop an override so the setting falls back to its shipped default. Not the same as setting an
  // empty value, which is itself a legitimate choice.
  resetAdminConfigValue(key: string): Observable<boolean> {
    return this._httpClient.delete<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/admin/config/${encodeURIComponent(key)}`)
      .pipe(map((response: ResponseWrapper) => response.success));
  }

  // getVersion returns the running backend's app version and optional deployment label.
  // Public endpoint — footer shows "<environment_name>-<version>" (e.g. demo-1.18.2).
  // environment_name is runtime config (YOURPHR_WEB_ENVIRONMENT_NAME); empty when unset.
  getVersion(): Observable<{ version: string; environment_name: string }> {
    return this._httpClient.get<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/version`)
      .pipe(
        map((response: ResponseWrapper) => {
          const data = (response.data as any) || {};
          return {
            version: (data.version || 'unknown') as string,
            environment_name: (typeof data.environment_name === 'string' ? data.environment_name : '').trim(),
          };
        })
      );
  }

  // Admin Database card (#361). Info is admin-gated; the backup is the full multi-user PHI DB.
  getDatabaseInfo(): Observable<DatabaseInfo> {
    return this._httpClient.get<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/admin/database`)
      .pipe(
        map((response: ResponseWrapper) => {
          return response.data as DatabaseInfo
        })
      );
  }

  // backupDatabase writes a server-side backup into the destination folder (default: the last-used
  // location) and returns where it wrote it. Admin-gated server-side.
  backupDatabase(destination?: string): Observable<BackupResult> {
    return this._httpClient.post<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/admin/database/backup`,
      destination ? {destination} : {})
      .pipe(
        map((response: ResponseWrapper) => {
          return response.data as BackupResult
        })
      );
  }

  // downloadBackup streams a fresh backup to the browser (the on-demand "Download" action; the
  // browser's Save dialog chooses where it lands). Returns the full HttpResponse<Blob> so the caller
  // reads the Content-Disposition filename — same pattern as exportSource.
  downloadBackup(): Observable<HttpResponse<Blob>> {
    return this._httpClient.post(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/admin/database/backup/download`, {},
      {responseType: 'blob', observe: 'response'});
  }

  // setBackupSchedule persists the auto-backup settings (enable + time-of-day + days + destination +
  // retention). The worker re-reads them, so it applies without a restart.
  setBackupSchedule(settings: BackupSettings): Observable<BackupSettings> {
    return this._httpClient.post<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/admin/database/schedule`, settings)
      .pipe(
        map((response: ResponseWrapper) => {
          return response.data as BackupSettings
        })
      );
  }

  // restoreDatabase STAGES a restore from a backup in the destination folder; it is applied on the next
  // app restart. DANGER: replaces the entire database. Admin-only; requires confirmation.
  restoreDatabase(backupName: string): Observable<{staged: boolean; message: string}> {
    return this._httpClient.post<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/admin/database/restore`,
      {backup_name: backupName, confirm: true})
      .pipe(
        map((response: ResponseWrapper) => {
          return response.data as {staged: boolean; message: string}
        })
      );
  }

  // testBackupDestination proves a destination works before a schedule is allowed to use it (#468).
  // Writes a small marker file, fsyncs, reads it back and removes it — never a real backup, because
  // that would write the whole PHI database to a path nobody is sure about yet.
  //
  // Resolves (does not error) when the destination is unwritable: `writable` carries the verdict and
  // `error` the real OS message, so the caller shows the operator what to fix.
  testBackupDestination(destination?: string): Observable<BackupDestinationTest> {
    return this._httpClient.post<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/admin/database/backup/test`,
      {destination: destination || ''})
      .pipe(
        map((response: ResponseWrapper) => {
          return response.data as BackupDestinationTest
        })
      );
  }

  // browseDirectories lists subfolders of a server path (admin-only) for picking a backup destination.
  browseDirectories(path?: string): Observable<DirListing> {
    const base = `${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/admin/database/browse`
    const url = path ? `${base}?path=${encodeURIComponent(path)}` : base
    return this._httpClient.get<any>(url)
      .pipe(
        map((response: ResponseWrapper) => {
          return response.data as DirListing
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
            relay_poll_seconds: response.relay_poll_seconds,
            redirect_uri: response.redirect_uri,
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
  // NOTHING — the backend fills client_id/scopes/FHIR base from the catalog and derives redirect_uri
  // from this deployment's relay config (#399); the effective value comes back in the response.
  authorizeSourceFromCatalog(catalogId: string, req: { redirect_uri?: string } = {}): Observable<SmartAuthorizeResponse> {
    return this._httpClient.post<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/provider-catalog/${encodeURIComponent(catalogId)}/authorize`, req)
      .pipe(
        map((response: any) => {
          return {
            authorize_url: response.authorize_url,
            state: response.state,
            code_verifier: response.code_verifier,
            login_wait_seconds: response.login_wait_seconds,
            relay_poll_seconds: response.relay_poll_seconds,
            redirect_uri: response.redirect_uri,
          } as SmartAuthorizeResponse
        })
      );
  }

  // getCDAConverterStatus reports whether this server can actually convert a C-CDA/XML upload, so the
  // UI can show setup steps instead of a Convert button that is guaranteed to fail (#397).
  getCDAConverterStatus(): Observable<CDAConverterStatus> {
    return this._httpClient.get<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/source/cda-converter/status`)
      .pipe(map((response: ResponseWrapper) => response.data as CDAConverterStatus));
  }

  // getRelayConfig reports the effective OAuth relay callback URL for this deployment — the value the
  // operator must register with their FHIR vendor — and whether a relay secret is configured (#399).
  getRelayConfig(): Observable<RelayConfig> {
    return this._httpClient.get<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/source/relay-config`)
      .pipe(map((response: ResponseWrapper) => response.data as RelayConfig));
  }

  // Admin Instance card — operator contact for this deployment (persisted next to the DB).
  getInstanceSettings(): Observable<InstanceSettings> {
    return this._httpClient.get<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/admin/instance`)
      .pipe(map((response: ResponseWrapper) => response.data as InstanceSettings));
  }

  setInstanceSettings(settings: InstanceSettings): Observable<InstanceSettings> {
    return this._httpClient.put<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/admin/instance`, settings)
      .pipe(map((response: ResponseWrapper) => response.data as InstanceSettings));
  }

  // Admin Metrics card (#441) — scrape config, process counters, recent sync job summaries.
  getAdminMetrics(): Observable<AdminMetrics> {
    return this._httpClient.get<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/admin/metrics`)
      .pipe(map((response: ResponseWrapper) => response.data as AdminMetrics));
  }

  // Per-user Privacy Policy + Terms opt-in (#427) — Account Profile grant/revoke.
  getLegalConsent(): Observable<LegalConsentStatus> {
    return this._httpClient.get<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/account/legal-consent`)
      .pipe(map((response: ResponseWrapper) => response.data as LegalConsentStatus));
  }

  grantLegalConsent(): Observable<LegalConsentStatus> {
    return this._httpClient.post<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/account/legal-consent/grant`, {})
      .pipe(map((response: ResponseWrapper) => response.data as LegalConsentStatus));
  }

  revokeLegalConsent(): Observable<LegalConsentStatus> {
    return this._httpClient.post<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/account/legal-consent/revoke`, {})
      .pipe(map((response: ResponseWrapper) => response.data as LegalConsentStatus));
  }

  // connectSourceFromCatalog completes the connection for a catalog entry. The request carries NO
  // client_id/client_secret — the backend resolves them from the catalog and does the token exchange.
  // redirect_uri is optional: omit it to use the same server-derived value as the authorize call.
  connectSourceFromCatalog(catalogId: string, req: { state: string, code_verifier: string, redirect_uri?: string, display?: string }): Observable<any> {
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

  // #437 — Disconnect clears OAuth only; records stay for Explore / later Remove data.
  disconnectSource(sourceId: string): Observable<{disconnected: boolean}> {
    return this._httpClient.post<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/source/${sourceId}/disconnect`, {})
      .pipe(
        map((response: ResponseWrapper) => {
          return response.data as {disconnected: boolean}
        })
      );
  }

  getResourceSummary(): Observable<TypesenseSearchSummaryResponse> {
    return this._httpClient.get<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/resource/summary`)
      .pipe(
        map((response: TypesenseSearchSummaryResponse) => {
          return response
        })
      );
  }

  // #437 — Delete imported FHIR for this source; credentials remain (Reconnect still possible).
  removeSourceData(sourceId: string): Observable<number> {
    return this._httpClient.post<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/source/${sourceId}/remove-data`, {})
      .pipe(
        map((response: ResponseWrapper) => {
          return response.data as number
        })
      );
  }

  // Full teardown: records + soft-delete credential (combined "Disconnect & remove data").
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
  // Patient-generated vitals (#313) — POST /secure/resource/patient-entry
  createPatientEntry(payload: {
    kind?: string
    vital: string
    value?: number
    systolic?: number
    diastolic?: number
    unit?: string
    effective_date_time?: string
  }): Observable<{resource_type: string, source_resource_id: string, source_id: string, sort_title: string}> {
    return this._httpClient.post<any>(`${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/resource/patient-entry`, {
      kind: payload.kind || 'vital',
      ...payload,
    }).pipe(
      map((response: ResponseWrapper) => response.data)
    )
  }

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

  /**
   * Email the record summary to an address the patient chooses (#524).
   *
   * Returns the error the SERVER gave rather than a generic failure: the relay's reason is the only
   * thing that tells somebody whether to fix an address, wait, or ask their admin. A send that
   * reports success while nothing was delivered is the failure this must never have — the patient
   * would believe their doctor has their records.
   */
  sendIPSExportByEmail(to: string, format = 'pdf'): Observable<any> {
    const endpointUrl = `${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/secure/summary/ips/email`;
    return this._httpClient.post<any>(endpointUrl, {to, format})
      .pipe(map((response: ResponseWrapper) => response.data));
  }

  getIPSExport(exportType?: string) {
    const format = exportType || "pdf"
    let contentType = "application/pdf"
    if (exportType == "html") {
      contentType = "text/html"
    } else if (exportType == "json") {
      // The registered FHIR media type, not application/json: it is what tells a receiving system
      // what the file is (#523).
      contentType = "application/fhir+json"
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
      // Named for the person who has to find it later, not for the API that produced it.
      link.setAttribute('download', `yourphr-records.${format}`);
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
              // Built from the structured given/family parts, NOT HumanName.text: text is written by
              // whichever system produced the record, so a list rendered from it mixes "Smith, John"
              // and "John Smith" depending on the provider (#525).
              full_name: formatHumanName(item.resource_raw.name?.[0]) || item?.sort_title || 'N/A',
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

// InstanceInfo is the frontend view of an instance's identity. Every field is optional and empty
// when the operator has not set it, or when this caller is not entitled to see it.
export interface InstanceInfo {
  name: string;
  contact_email: string;
  contact_url: string;
  theme: string;
  // Public demo instance: offer one-click sign-in to the shared demo account (#495). Absent or
  // false on every ordinary install. Only the flag is published — the demo password is verified
  // server-side by /auth/demo-signin and never reaches the browser.
  demo_enabled: boolean;
  // Whether this demo also offers the READ-ONLY admin tour (#516). Same rules as demo_enabled:
  // absent or false everywhere else, and the flag alone opens nothing — the backend refuses unless
  // both it and demo mode are on, and the account it signs in cannot change anything.
  demo_admin_enabled: boolean;
  // Whether THIS session is the read-only demo admin (#516). Only ever true from the authenticated
  // endpoint, and only for that one account — every other user, including the operator's own admin
  // on the same instance, gets false. Presentation only: the API refuses the writes regardless.
  demo_admin_session: boolean;
  // The instance's password policy (#506), published so the sign-up form validates exactly what the
  // server enforces instead of hardcoding numbers that drift. Sizes and booleans only.
  password_min_length: number;
  password_max_length: number;
  password_deny_common: boolean;
  password_deny_username: boolean;
  username_min_length: number;
  // Whether self-service account creation is open (#498). Default true, so an instance that does
  // not publish the key behaves exactly as it always has. The backend enforces it regardless;
  // this only decides whether the UI offers the link. Note the FIRST account on an empty
  // instance is always allowed and becomes the owner/admin, whatever this says.
  signup_enabled: boolean;
}

// mapInstanceInfo translates backend config keys to short names. Both instance endpoints return
// the same shape, so the mapping lives here once.
function mapInstanceInfo(response: ResponseWrapper): InstanceInfo {
  const data = (response.data as any) || {};
  const str = (key: string): string => (typeof data[key] === 'string' ? data[key].trim() : '');
  // Env-supplied values arrive as strings (#453 fix), so coerce rather than trusting the type.
  const num = (value: any, fallback: number): number => {
    const parsed = typeof value === 'number' ? value : parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  return {
    name: str('operator.name'),
    contact_email: str('operator.contact_email'),
    contact_url: str('operator.contact_url'),
    theme: str('theme.name'),
    // Strictly true only. An absent key, a null, or a string must read as "not a demo" — this
    // flag gates a shared-account login, so anything ambiguous defaults to off.
    demo_enabled: data['demo.enabled'] === true,
    demo_admin_enabled: data['demo.admin.enabled'] === true,
    demo_admin_session: data['demo.admin.session'] === true,
    // Fall back to the shipped defaults when an instance predates the policy keys, so a form is
    // never built from `undefined` (which Angular's minlength silently treats as no rule at all).
    password_min_length: num(data['password.min_length'], 8),
    password_max_length: num(data['password.max_length'], 69),
    password_deny_common: data['password.deny_common'] !== false,
    password_deny_username: data['password.deny_username'] !== false,
    username_min_length: num(data['username.min_length'], 3),
    // Opposite default to demo_enabled, deliberately: signup has always been open, so an absent
    // key must not silently hide the link on an instance that never set it. Only an explicit
    // false closes it (#498).
    signup_enabled: data['signup.enabled'] !== false,
  };
}
