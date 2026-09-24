import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { FastenApiService, AgentToken, AgentTokenPage } from '../../services/fasten-api.service';
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
