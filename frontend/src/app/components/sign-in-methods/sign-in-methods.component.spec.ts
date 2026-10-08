import {ComponentFixture, TestBed} from '@angular/core/testing';
import {of} from 'rxjs';
import {SignInMethodsComponent} from './sign-in-methods.component';
import {FastenApiService} from '../../services/fasten-api.service';
import {PasskeyService} from '../../services/passkey.service';

// #876: Profile → Sign-in methods.
describe('SignInMethodsComponent', () => {
  let fixture: ComponentFixture<SignInMethodsComponent>;
  let api: jasmine.SpyObj<FastenApiService>;

  function setup(methods: any, supported = true, onHost = 'phr.example.org'): HTMLElement {
    api = jasmine.createSpyObj('FastenApiService', ['getSignInMethods', 'registerPasskeyOptions', 'confirmPasskeyOptions', 'addPasskey', 'renamePasskey', 'removePasskey']);
    api.getSignInMethods.and.returnValue(of(methods));
    const passkeys = jasmine.createSpyObj('PasskeyService', ['supported', 'usableOn', 'suggestedName', 'assert', 'create', 'describeError']);
    passkeys.supported.and.returnValue(supported);
    passkeys.usableOn.and.callFake((host: string | null) => supported && host === onHost);
    passkeys.suggestedName.and.returnValue(Promise.resolve('Chrome on Mac'));
    TestBed.configureTestingModule({imports: [SignInMethodsComponent], providers: [{provide: FastenApiService, useValue: api}, {provide: PasskeyService, useValue: passkeys}]});
    fixture = TestBed.createComponent(SignInMethodsComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const row = {id: 'p1', username: 'molly', kind: 'passkey', subject: 's', label: 'Work laptop', createdAt: '2026-10-08T10:00:00Z'};

  it('lists the password and each passkey, never asking where passkeys are off', () => {
    const el = setup({hasPassword: true, passkeyHost: 'phr.example.org', credentials: [row]});
    expect(el.textContent).toContain('Password');
    expect(el.textContent).toContain('Work laptop');
    expect(el.textContent).toContain('works only on phr.example.org');
    expect(el.querySelector('[data-testid="passkey-add"]')).not.toBeNull();
  });

  it('on another name for the server, says where passkeys work instead of offering one that would fail', () => {
    const el = setup({hasPassword: true, passkeyHost: 'phr.example.org', credentials: [row]}, true, '192.168.1.5');
    expect(el.querySelector('[data-testid="passkey-add"]')).toBeNull();
    expect(el.querySelector('[data-testid="passkey-elsewhere"]')?.textContent).toContain('only on phr.example.org');
    expect(el.textContent).toContain('Work laptop');
  });

  it('shows nothing on an instance without passkeys and none enrolled', () => {
    const el = setup({hasPassword: true, passkeyHost: null, credentials: []});
    expect(el.querySelector('[data-testid="sign-in-methods"]')).toBeNull();
  });

  it('refuses an empty name before asking the server anything', async () => {
    setup({hasPassword: true, passkeyHost: 'phr.example.org', credentials: []});
    const c = fixture.componentInstance;
    c.newLabel = '  ';
    c.password = 'pw';
    await c.addWithPassword();
    expect(c.error).toContain('Give this passkey a name');
    expect(api.registerPasskeyOptions).not.toHaveBeenCalled();
  });
});
