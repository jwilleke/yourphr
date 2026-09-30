import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { FastenApiService, AgentToken, AgentTokenPage, DeviceGrant, DeviceGrantPage } from '../../services/fasten-api.service';
import { GetEndpointAbsolutePath } from '../../../lib/utils/endpoint_absolute_path';
import { environment } from '../../../environments/environment';
import * as QRCode from 'qrcode';
import { extractErrorFromResponse } from '../../../lib/utils/error_extract';

/**
 * Settings: who you are on this instance, and the keys you have given your own AI client (#719).
 *
 * This page used to be a device-pairing screen — a QR code and a "companion mobile app" that does
 * not exist, no client repository, nothing to scan it. Four endpoints behind it were never served,
 * and its "No Expiration" option would have minted a key that never dies, which is the defect
 * #695 was filed against. None of it worked, so none of it is repaired here: it is replaced by the
 * screen the server was built for.
 *
 * What an agent token is, in the words the screen uses: a key you mint so an AI client of your
 * choosing can READ the categories you tick, until it expires. Three things follow, and the screen
 * has to say all three:
 *
 *   - __The secret is shown once.__ It rides back from the mint and is never stored, so there is no
 *     second chance to copy it. Losing it means minting another.
 *   - __Scopes are chosen, never assumed.__ An unscoped mint is refused by the server: empty is not
 *     "everything", it is nothing.
 *   - __Every token expires.__ The instance sets the ceiling; this screen offers what it allows and
 *     never a "never".
 *
 * Connected devices came back (yourphr#808) only once the server could honour them: a grant the
 * patient gives for a term, a one-time setup code, keys that can ADD samples and read nothing.
 * Off unless the instance turns them on, and the screen says a yourPHR-compatible app is needed —
 * it does not promise an app that is not there.
 */
@Component({
    selector: 'app-settings',
    templateUrl: './settings.component.html',
    styleUrls: ['./settings.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class SettingsComponent implements OnInit {
  currentUser: any = null;

  /** Off unless the instance says otherwise — the shipped default, and what the server enforces. */
  agentTokensEnabled = false;
  page: AgentTokenPage | null = null;
  loading = true;
  error = '';

  // The mint form. Scopes start empty on purpose: the person ticks what an agent may read.
  newName = '';
  chosenScopes: string[] = [];
  ttlHours = 0;
  minting = false;

  /** The cleartext, held only until they navigate away. Never stored, never re-fetchable. */
  mintedSecret = '';
  mintedName = '';

  busyTokenId = '';

  // The person's own email address (#792): editing state, and the server's refusal if any.
  editingEmail = false;
  emailDraft = '';
  savingEmail = false;
  emailError = '';

  /**
   * Connected devices (yourphr#807, #808): a phone app or scale the patient allows to ADD health
   * samples, for a term they choose. Granting and extending ask for the password again (decision
   * 3). The setup code is shown once, as a QR code and an "Open in app" link, and works once.
   * Hidden entirely when the instance has devices off (the list answers 404).
   */
  devicesEnabled = false;
  devicePage: DeviceGrantPage | null = null;
  devicesError = '';
  newDeviceLabel = '';
  newDeviceDays = 30;
  devicePassword = '';
  granting = false;
  /** The one-time setup, until the patient dismisses it. */
  deviceSetup: { label: string; code: string; qr: string; link: string } | null = null;
  /** An extend or a resume (yourphr#809) waiting for the password. */
  deviceAction: { grant: DeviceGrant; action: 'extend' | 'resume'; days: number; password: string } | null = null;
  busyDeviceId = '';

  constructor(private api: FastenApiService) { }

  ngOnInit(): void {
    this.api.getCurrentUser().subscribe({
      next: (user) => this.currentUser = user,
      error: () => this.currentUser = null,
    });
    this.api.getPublicInstanceInfo().subscribe({
      next: (info) => {
        this.agentTokensEnabled = info?.agent_token_enabled === true;
        if (this.agentTokensEnabled) {
          this.load();
        } else {
          this.loading = false;
        }
      },
      error: () => this.loading = false,
    });
    this.loadDevices();
  }

  loadDevices(): void {
    this.api.getDeviceGrants().subscribe({
      next: (page) => {
        this.devicesEnabled = true;
        this.devicePage = page;
        this.newDeviceDays = Math.min(this.newDeviceDays, page.max_days) || page.max_days;
      },
      error: () => this.devicesEnabled = false,
    });
  }

  get deviceAtLimit(): boolean {
    const held = (this.devicePage?.grants ?? []).filter((g) => g.status === 'active' || g.status === 'suspended').length;
    return !!this.devicePage && held >= this.devicePage.max_per_user;
  }

  get canGrantDevice(): boolean {
    return this.newDeviceLabel.trim() !== '' && this.devicePassword !== '' && !this.granting;
  }

  grantDevice(): void {
    if (!this.canGrantDevice) {
      return;
    }
    this.devicesError = '';
    this.granting = true;
    const label = this.newDeviceLabel.trim();
    this.api.grantDevice(label, this.newDeviceDays, this.devicePassword).subscribe({
      next: (result) => {
        this.granting = false;
        this.devicePassword = '';
        this.newDeviceLabel = '';
        const server = GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base);
        // What the device's app reads from the QR code: where to claim, and the one-time code.
        const payload = JSON.stringify({ v: 1, server, code: result.setup_code });
        const link = `yourphr-device://claim?server=${encodeURIComponent(server)}&code=${encodeURIComponent(result.setup_code)}`;
        this.deviceSetup = { label, code: result.setup_code, qr: '', link };
        QRCode.toDataURL(payload, { margin: 1, width: 240 }).then(
          (qr) => { if (this.deviceSetup?.code === result.setup_code) this.deviceSetup = { ...this.deviceSetup, qr }; },
          () => undefined,
        );
        this.loadDevices();
      },
      error: (err) => {
        this.granting = false;
        this.devicePassword = '';
        this.devicesError = extractErrorFromResponse(err) || 'Could not allow that device.';
      },
    });
  }

  dismissDeviceSetup(): void {
    this.deviceSetup = null;
  }

  startDeviceAction(grant: DeviceGrant, action: 'extend' | 'resume'): void {
    this.devicesError = '';
    this.deviceAction = { grant, action, days: this.devicePage?.max_days ?? 30, password: '' };
  }

  confirmDeviceAction(): void {
    const pending = this.deviceAction;
    if (!pending || pending.password === '') {
      return;
    }
    this.busyDeviceId = pending.grant.id;
    const call = pending.action === 'extend'
      ? this.api.extendDeviceGrant(pending.grant.id, pending.days, pending.password)
      : this.api.resumeDeviceGrant(pending.grant.id, pending.password);
    call.subscribe({
      next: () => { this.busyDeviceId = ''; this.deviceAction = null; this.loadDevices(); },
      error: (err) => {
        this.busyDeviceId = '';
        if (this.deviceAction) this.deviceAction = { ...this.deviceAction, password: '' };
        this.devicesError = extractErrorFromResponse(err) || `Could not ${pending.action} ${pending.grant.label}.`;
      },
    });
  }

  revokeDevice(grant: DeviceGrant): void {
    if (this.busyDeviceId !== '') {
      return;
    }
    this.devicesError = '';
    this.busyDeviceId = grant.id;
    this.api.revokeDeviceGrant(grant.id).subscribe({
      next: () => { this.busyDeviceId = ''; this.loadDevices(); },
      error: (err) => { this.busyDeviceId = ''; this.devicesError = extractErrorFromResponse(err) || `Could not remove ${grant.label}.`; },
    });
  }

  /** In the patient's words: what the device may do now. */
  deviceState(grant: DeviceGrant): string {
    switch (grant.status) {
      case 'active': return grant.claimed ? `Allowed until ${grant.endsAt.slice(0, 10)}` : 'Waiting for the device to connect';
      case 'suspended': return grant.lastUploadAt ? `Paused: nothing received since ${grant.lastUploadAt.slice(0, 10)}` : 'Paused: nothing received';
      case 'revoked': return 'Removed';
      default: return `Ended ${grant.endsAt.slice(0, 10)}`;
    }
  }

  startEmailEdit(): void {
    this.emailDraft = this.currentUser?.email || '';
    this.emailError = '';
    this.editingEmail = true;
  }

  cancelEmailEdit(): void {
    this.editingEmail = false;
    this.emailError = '';
  }

  /** Saves the draft; an empty draft clears the address. */
  saveEmail(value: string = this.emailDraft): void {
    this.savingEmail = true;
    this.emailError = '';
    this.api.setAccountEmail(value.trim()).subscribe({
      next: (email) => {
        this.currentUser = {...this.currentUser, email};
        this.savingEmail = false;
        this.editingEmail = false;
      },
      error: (err) => {
        this.savingEmail = false;
        this.emailError = extractErrorFromResponse(err) || 'Could not save your email address.';
      },
    });
  }

  load(): void {
    this.loading = true;
    this.api.getAgentTokens().subscribe({
      next: (page) => {
        this.page = page;
        this.ttlHours = page.default_ttl_hours || page.max_ttl_hours;
        this.loading = false;
      },
      error: (err) => {
        this.error = extractErrorFromResponse(err) || 'Could not load your keys.';
        this.loading = false;
      },
    });
  }

  toggleScope(scope: string): void {
    this.chosenScopes = this.chosenScopes.includes(scope)
      ? this.chosenScopes.filter((s) => s !== scope)
      : [...this.chosenScopes, scope];
  }

  get canMint(): boolean {
    return this.newName.trim() !== '' && this.chosenScopes.length > 0 && !this.minting;
  }

  /** Whether they already hold as many as the instance allows — asked before the server refuses. */
  get atLimit(): boolean {
    const live = (this.page?.tokens ?? []).filter((t) => t.live).length;
    return !!this.page && this.page.max_per_user > 0 && live >= this.page.max_per_user;
  }

  mint(): void {
    if (!this.canMint) {
      return;
    }
    this.error = '';
    this.minting = true;
    this.api.mintAgentToken(this.newName.trim(), this.chosenScopes, this.ttlHours).subscribe({
      next: (result) => {
        this.minting = false;
        // Shown once, and only here: the server does not keep it either.
        this.mintedSecret = result.token;
        this.mintedName = result.record?.name ?? this.newName.trim();
        this.newName = '';
        this.chosenScopes = [];
        this.load();
      },
      error: (err) => {
        this.minting = false;
        this.error = extractErrorFromResponse(err) || 'Could not create that key.';
      },
    });
  }

  dismissSecret(): void {
    this.mintedSecret = '';
    this.mintedName = '';
  }

  revoke(token: AgentToken): void {
    if (this.busyTokenId !== '') {
      return;
    }
    this.error = '';
    this.busyTokenId = token.id;
    this.api.revokeAgentToken(token.id).subscribe({
      next: () => {
        this.busyTokenId = '';
        this.load();
      },
      error: (err) => {
        this.busyTokenId = '';
        this.error = extractErrorFromResponse(err) || `Could not revoke ${token.name}.`;
      },
    });
  }

  /** Renewing issues a NEW secret and revokes the old record, so it is shown once as a mint is. */
  renew(token: AgentToken): void {
    if (this.busyTokenId !== '') {
      return;
    }
    this.error = '';
    this.busyTokenId = token.id;
    this.api.renewAgentToken(token.id).subscribe({
      next: (result) => {
        this.busyTokenId = '';
        this.mintedSecret = result.token;
        this.mintedName = result.record?.name ?? token.name;
        this.load();
      },
      error: (err) => {
        this.busyTokenId = '';
        this.error = extractErrorFromResponse(err) || `Could not renew ${token.name}.`;
      },
    });
  }

  /** "in 3 days" / "in 5 hours" / "expired", from the seconds the SERVER computed. */
  remaining(token: AgentToken): string {
    if (!token.live) {
      return token.revokedAt ? 'revoked' : 'expired';
    }
    const seconds = token.expiresInSeconds;
    if (seconds >= 172800) {
      return `in ${Math.floor(seconds / 86400)} days`;
    }
    if (seconds >= 7200) {
      return `in ${Math.floor(seconds / 3600)} hours`;
    }
    if (seconds >= 120) {
      return `in ${Math.floor(seconds / 60)} minutes`;
    }
    return 'in under a minute';
  }
}
