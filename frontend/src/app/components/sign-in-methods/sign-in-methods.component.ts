import {Component, OnInit, ChangeDetectionStrategy} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {firstValueFrom} from 'rxjs';
import {FastenApiService, SignInMethods} from '../../services/fasten-api.service';
import {PasskeyService} from '../../services/passkey.service';

// Profile → Sign-in methods (#876), ngdpbase's card: the password and each passkey — rename, remove,
// added, last used — and adding a passkey after confirming it is you (the password, or a passkey
// you already have). Shown only where passkeys can work: the instance has them on, and this
// browser supports them.
@Component({
  standalone: true,
  imports: [CommonModule, FormsModule],
  selector: 'app-sign-in-methods',
  templateUrl: './sign-in-methods.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class SignInMethodsComponent implements OnInit {
  methods: SignInMethods | null = null;
  supported = false;
  newLabel = '';
  password = '';
  busy = false;
  error = '';
  done = '';
  editing: Record<string, string> = {};

  constructor(private api: FastenApiService, private passkeys: PasskeyService) {}

  async ngOnInit(): Promise<void> {
    this.supported = this.passkeys.supported();
    this.load();
    if (this.supported) this.newLabel = await this.passkeys.suggestedName();
  }

  load(): void {
    this.api.getSignInMethods().subscribe({
      next: (m) => this.methods = m,
      error: () => this.methods = null,
    });
  }

  /** Whether this page is on the host passkeys are tied to; anywhere else the browser refuses them. */
  get onHost(): boolean {
    return this.passkeys.usableOn(this.methods?.passkeyHost);
  }

  get passkeyRows() {
    return (this.methods?.credentials ?? []).filter((c) => c.kind === 'passkey');
  }

  // Confirm with the password typed here.
  addWithPassword(): Promise<void> {
    return this.add(() => firstValueFrom(this.api.registerPasskeyOptions({password: this.password})));
  }

  // Confirm with a passkey the person already has (decision 2 on #876).
  addWithPasskey(): Promise<void> {
    return this.add(async () => {
      const confirm = await firstValueFrom(this.api.confirmPasskeyOptions());
      const response = await this.passkeys.assert(confirm.options);
      return firstValueFrom(this.api.registerPasskeyOptions({passkey: {handle: confirm.handle, response}}));
    });
  }

  private async add(start: () => Promise<{handle: string; options: any}>): Promise<void> {
    this.error = '';
    this.done = '';
    const label = this.newLabel.trim();
    if (label === '') {
      this.error = 'Give this passkey a name, so you can tell it apart from your others.';
      return;
    }
    this.busy = true;
    try {
      const {handle, options} = await start();
      const response = await this.passkeys.create(options);
      await firstValueFrom(this.api.addPasskey(handle, response, label));
      this.password = '';
      this.done = 'Passkey added. You can now sign in with it.';
      this.load();
    } catch (err) {
      this.error = this.passkeys.describeError(err, 'Adding the passkey failed.');
    } finally {
      this.busy = false;
    }
  }

  startRename(id: string, label: string): void {
    this.editing = {...this.editing, [id]: label};
  }

  async saveRename(id: string): Promise<void> {
    this.error = '';
    try {
      await firstValueFrom(this.api.renamePasskey(id, this.editing[id] ?? ''));
      const {[id]: _gone, ...rest} = this.editing;
      this.editing = rest;
      this.load();
    } catch (err) {
      this.error = this.passkeys.describeError(err, 'Renaming failed.');
    }
  }

  async remove(id: string, label: string): Promise<void> {
    if (!confirm(`Remove the passkey "${label}"? You will no longer be able to sign in with it.`)) return;
    this.error = '';
    try {
      await firstValueFrom(this.api.removePasskey(id));
      this.load();
    } catch (err) {
      this.error = this.passkeys.describeError(err, 'Removing the passkey failed.');
    }
  }
}
