import {Component, OnInit} from '@angular/core';
import {FastenApiService} from '../../services/fasten-api.service';
import {environment} from '../../../environments/environment';
import {extractErrorFromResponse} from '../../../lib/utils/error_extract';
import {SmartAuthorizeResponse} from '../../models/fasten/smart-authorize';
import {ConnectableProvider} from '../../models/fasten/provider-catalog';

// Max time to wait for the admin to finish logging in at the sandbox provider (the relay-poll phase,
// across retries) before giving up. A first login (consent, pick account, authorize) can be slow,
// so allow several minutes. This does NOT bound the data download, which runs inline after login.
export const sandboxConnectWindowMs = 4 * 60 * 1000 // 4 minutes

// Admin-only sandbox-testing page (EPIC #20 / #291). The sandbox providers (Blue Button, Epic, …) are
// configured server-side: their FHIR base / scopes / client_id / client_secret come from env (a k8s
// Secret), so the admin connects with ONE click and the credentials are never typed into — or returned
// to — the browser. This replaced the old bring-your-own-client_id form, which exposed creds and was
// error-prone. The patient-facing connect path is the provider directory on /sources. Gated by
// IsAdminAuthGuard in the router.
@Component({
  selector: 'app-sandbox',
  templateUrl: './sandbox.component.html',
  styleUrls: ['./sandbox.component.scss'],
  standalone: false
})
export class SandboxComponent implements OnInit {

  environment_name = environment.environment_name

  // Server-configured sandbox providers (credential-free projection: id + display + logo).
  sandboxProviders: ConnectableProvider[] = []
  loading = false
  connectingProviderId: string | null = null
  errorMsg = ''
  successMsg = ''
  // toggled to destroy/recreate <app-medical-sources-connected> so it re-loads after a connect
  showConnectedList = true

  constructor(
    private fastenApi: FastenApiService,
  ) {
  }

  ngOnInit(): void {
    this.loadSandboxProviders()
  }

  // Loads the admin-only sandbox provider list (those configured via env on the server). A failure is
  // non-fatal — the page still shows imported sources — so it is logged, not surfaced as a hard error.
  private loadSandboxProviders(): void {
    this.loading = true
    this.fastenApi.listSandboxProviders().subscribe(
      (providers) => { this.sandboxProviders = providers || [] },
      (err) => { console.log('could not load sandbox providers', err); this.loading = false },
      () => { this.loading = false },
    )
  }

  // Connects a server-configured sandbox provider by id with ONE click. The admin never sees or sends a
  // client_id/secret — the backend fills them from the env-seeded catalog entry. Mirrors the catalog
  // connect flow (popup → authorize → poll/exchange). The popup must open synchronously in the click
  // handler or the browser blocks it.
  public async connectSandboxProvider(provider: ConnectableProvider): Promise<void> {
    if (this.connectingProviderId) { return } // guard against double-submit
    this.errorMsg = ''
    this.successMsg = ''

    const redirectUri = `${environment.relay_endpoint_base}/callback`

    const popup = window.open('', '_blank')
    if (!popup) {
      this.errorMsg = 'Your browser blocked the login popup. Please allow popups for this site, then try again.'
      return
    }
    try {
      popup.document.write('<!doctype html><title>Connecting…</title><p style="font:14px sans-serif;padding:1rem">Preparing secure sign-in…</p>')
    } catch (_) { /* popup not navigable yet */ }

    this.connectingProviderId = provider.id
    try {
      const authorize: SmartAuthorizeResponse = await this.fastenApi
        .authorizeSourceFromCatalog(provider.id, {redirect_uri: redirectUri}).toPromise()

      if (!authorize?.authorize_url || !authorize?.state || !authorize?.code_verifier) {
        popup.close()
        this.errorMsg = 'Could not start the connection: the server did not return a valid sign-in URL.'
        return
      }
      popup.location.href = authorize.authorize_url

      // The backend polls the relay ~30s for the auth code then exchanges + syncs inline. A slow login
      // can outlast one poll, so retry across the login window. Only the relay-poll timeout is retried
      // (nothing is created yet, so it's safe); any other error is terminal.
      const windowMs = (authorize.login_wait_seconds && authorize.login_wait_seconds > 0)
        ? authorize.login_wait_seconds * 1000
        : sandboxConnectWindowMs
      const maxAttempts = Math.ceil(windowMs / (30 * 1000))
      let lastErr: any = null
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          await this.fastenApi.connectSourceFromCatalog(provider.id, {
            state: authorize.state,
            code_verifier: authorize.code_verifier,
            redirect_uri: redirectUri,
            display: provider.display,
          }).toPromise()
          lastErr = null
          break
        } catch (err) {
          lastErr = err
          const msg = extractErrorFromResponse(err) || ''
          if (!/authorization code from relay|timed out/i.test(msg)) { break } // terminal
        }
      }

      if (lastErr) {
        this.errorMsg = 'Connection failed: ' + (extractErrorFromResponse(lastErr) || 'Unknown Error') + ' Please complete the sign-in in the popup window and try again.'
        return
      }

      this.successMsg = `Connected to ${provider.display}. Records are being imported.`
      this.refreshConnectedList()
    } catch (err) {
      this.errorMsg = 'Connection failed: ' + (extractErrorFromResponse(err) || 'Unknown Error')
    } finally {
      this.connectingProviderId = null
    }
  }

  // Forces <app-medical-sources-connected> to be destroyed and recreated so it re-runs its
  // ngOnInit load (it appends sources on init, so a fresh instance is the simplest correct refresh).
  private refreshConnectedList(): void {
    this.showConnectedList = false
    setTimeout(() => { this.showConnectedList = true }, 0)
  }

}
