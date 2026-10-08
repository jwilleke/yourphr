import {ComponentFixture, TestBed} from '@angular/core/testing';
import {of} from 'rxjs';
import {provideRouter} from '@angular/router';
import {AuthService} from '../../services/auth.service';
import {SignInMethodsComponent} from './sign-in-methods.component';
import {FastenApiService} from '../../services/fasten-api.service';
import {PasskeyService} from '../../services/passkey.service';

// #876: Profile → Sign-in methods.
describe('SignInMethodsComponent', () => {
  let fixture: ComponentFixture<SignInMethodsComponent>;
  let api: jasmine.SpyObj<FastenApiService>;

  async function setup(methods: any, supported = true, onHost = 'phr.example.org', admin = false): Promise<HTMLElement> {
    api = jasmine.createSpyObj('FastenApiService', ['getSignInMethods', 'registerPasskeyOptions', 'confirmPasskeyOptions', 'addPasskey', 'renamePasskey', 'removePasskey']);
    api.getSignInMethods.and.returnValue(of(methods));
    const passkeys = jasmine.createSpyObj('PasskeyService', ['supported', 'usableOn', 'suggestedName', 'assert', 'create', 'describeError']);
    passkeys.supported.and.returnValue(supported);
    passkeys.usableOn.and.callFake((host: string | null) => supported && host === onHost);
    passkeys.suggestedName.and.returnValue(Promise.resolve('Chrome on Mac'));
    TestBed.configureTestingModule({imports: [SignInMethodsComponent], providers: [provideRouter([]), {provide: FastenApiService, useValue: api}, {provide: PasskeyService, useValue: passkeys}, {provide: AuthService, useValue: {IsAdmin: () => Promise.resolve(admin)}}]});
    fixture = TestBed.createComponent(SignInMethodsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const row = {id: 'p1', username: 'molly', kind: 'passkey', subject: 's', label: 'Work laptop', createdAt: '2026-10-08T10:00:00Z'};

  it('lists the password and each passkey, never asking where passkeys are off', async () => {
    const el = await setup({hasPassword: true, passkeyHost: 'phr.example.org', credentials: [row]});
    expect(el.textContent).toContain('Password');
    expect(el.textContent).toContain('Work laptop');
    expect(el.textContent).toContain('works only on phr.example.org');
    expect(el.querySelector('[data-testid="passkey-add"]')).not.toBeNull();
  });

  it('on another name for the server, says where passkeys work instead of offering one that would fail', async () => {
    const el = await setup({hasPassword: true, passkeyHost: 'phr.example.org', credentials: [row]}, true, '192.168.1.5');
    expect(el.querySelector('[data-testid="passkey-add"]')).toBeNull();
    expect(el.querySelector('[data-testid="passkey-elsewhere"]')?.textContent).toContain('only on phr.example.org');
    expect(el.textContent).toContain('Work laptop');
  });

  it('says passkeys are off rather than hiding (#883); a member is not sent to the admin screen', async () => {
    const el = await setup({hasPassword: true, passkeyHost: null, credentials: []});
    expect(el.querySelector('[data-testid="sign-in-methods"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="passkeys-off"]')?.textContent).toContain('not turned on');
    expect(el.querySelector('[data-testid="passkeys-off-admin"]')).toBeNull();
    expect(el.querySelector('[data-testid="passkey-add"]')).toBeNull();
  });

  it('tells an admin which setting turns passkeys on, and that it takes effect when saved', async () => {
    const el = await setup({hasPassword: true, passkeyHost: null, credentials: []}, true, 'phr.example.org', true);
    const hint = el.querySelector('[data-testid="passkeys-off-admin"]');
    expect(hint?.textContent).toContain('yourphr.application.base-url');
    expect(hint?.textContent).toContain('takes effect when saved');
    expect(hint?.querySelector('a')?.getAttribute('href')).toBe('/admin/config');
  });

  it('refuses an empty name before asking the server anything', async () => {
    await setup({hasPassword: true, passkeyHost: 'phr.example.org', credentials: []});
    const c = fixture.componentInstance;
    c.newLabel = '  ';
    c.password = 'pw';
    await c.addWithPassword();
    expect(c.error).toContain('Give this passkey a name');
    expect(api.registerPasskeyOptions).not.toHaveBeenCalled();
  });
});
