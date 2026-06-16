import {Component, ViewChild} from '@angular/core';
import {FastenApiService} from '../../services/fasten-api.service';
import {NgbModal} from '@ng-bootstrap/ng-bootstrap';
import {environment} from '../../../environments/environment';
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

// CMS Blue Button 2.0 sandbox (synthetic Medicare beneficiaries — claims/insurance data, no real
// PHI). FHIR base + scopes are stable and public; client_id/secret are bring-your-own — each user
// registers their own app at https://sandbox.bluebutton.cms.gov. Two quirks vs Epic, baked in here:
//   - Confidential client: BB2.0 requires a client_secret (the user pastes theirs into the modal).
//   - Restricted scopes: NO wildcard / fhirUser / offline_access — those return invalid_scope. Use
//     the explicit per-resource read scopes for the resources BB2.0 serves.
// See docs/test-sandboxes.md §2 and docs/medicare-bluebutton.md.
export const BLUE_BUTTON_SANDBOX = {
  api_endpoint_base_url: 'https://sandbox.bluebutton.cms.gov/v2/fhir',
  scopes: 'openid profile launch/patient patient/Patient.read patient/Coverage.read patient/ExplanationOfBenefit.read',
  display: 'Blue Button 2.0 (Medicare)',
}

// Admin-only sandbox-testing page (EPIC #20). This holds the bring-your-own-client_id SMART connect
// flow — the raw FHIR-base/client_id/secret form — which is a developer/admin testing affordance,
// NOT something a patient should ever see. The patient-facing connect path is the admin-configured
// provider directory on /sources (#291). Gated by IsAdminAuthGuard in the router.
@Component({
  selector: 'app-sandbox',
  templateUrl: './sandbox.component.html',
  styleUrls: ['./sandbox.component.scss'],
  standalone: false
})
export class SandboxComponent {

  environment_name = environment.environment_name

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
    private fastenApi: FastenApiService,
    private modalService: NgbModal,
  ) {
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

  // Pre-fills the BYO SMART modal with CMS Blue Button 2.0's sandbox endpoint + scopes, then opens it.
  // client_id AND client_secret stay empty: BB2.0 is a confidential client, so each user registers
  // their own app at sandbox.bluebutton.cms.gov and pastes both values. See docs/medicare-bluebutton.md.
  public openBlueButtonSandboxModal(): void {
    this.smartForm = {
      api_endpoint_base_url: BLUE_BUTTON_SANDBOX.api_endpoint_base_url,
      client_id: '',
      client_secret: '', // BB2.0 is confidential — the user pastes their own sandbox secret
      scopes: BLUE_BUTTON_SANDBOX.scopes,
      display: BLUE_BUTTON_SANDBOX.display,
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
