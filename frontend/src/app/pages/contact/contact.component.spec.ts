import {ComponentFixture, TestBed, waitForAsync} from '@angular/core/testing';
import {RouterTestingModule} from '@angular/router/testing';
import {of, throwError} from 'rxjs';

import {ContactComponent} from './contact.component';
import {FastenApiService} from '../../services/fasten-api.service';
import {AuthService} from '../../services/auth.service';

describe('ContactComponent', () => {
  let component: ContactComponent;
  let fixture: ComponentFixture<ContactComponent>;
  let apiSpy: jasmine.SpyObj<FastenApiService>;
  let authSpy: jasmine.SpyObj<AuthService>;

  const info = (over: Partial<{name: string; contact_email: string; contact_url: string}> = {}) =>
    of({name: '', contact_email: '', contact_url: '', demo_enabled: false, demo_admin_enabled: false, demo_admin_session: false, password_min_length: 8, password_max_length: 69, password_deny_common: true, password_deny_username: true, username_min_length: 3, signup_enabled: true, agent_token_enabled: false, ...over});

  beforeEach(waitForAsync(() => {
    apiSpy = jasmine.createSpyObj('FastenApiService', ['getPublicInstanceInfo', 'getInstanceInfo']);
    apiSpy.getPublicInstanceInfo.and.returnValue(info());
    apiSpy.getInstanceInfo.and.returnValue(info());
    authSpy = jasmine.createSpyObj('AuthService', ['IsAuthenticated']);
    authSpy.IsAuthenticated.and.returnValue(Promise.resolve(false));
    TestBed.configureTestingModule({
      imports: [ContactComponent, RouterTestingModule],
      providers: [
        {provide: FastenApiService, useValue: apiSpy},
        {provide: AuthService, useValue: authSpy},
      ],
    }).compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(ContactComponent);
    component = fixture.componentInstance;
  });

  it('should create', async () => {
    await component.ngOnInit();
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('renders every operator field the Instance card provides', async () => {
    apiSpy.getPublicInstanceInfo.and.returnValue(info({
      name: 'Nerds by the Hour',
      contact_email: 'admin@yourphr.org',
      contact_url: 'https://example.org/help',
    }));
    await component.ngOnInit();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Nerds by the Hour');
    expect(text).toContain('admin@yourphr.org');
    expect(fixture.nativeElement.querySelector('a[href="mailto:admin@yourphr.org"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('a[href="https://example.org/help"]')).not.toBeNull();
  });

  it('shows only the fields that are set', async () => {
    apiSpy.getPublicInstanceInfo.and.returnValue(info({contact_email: 'admin@yourphr.org'}));
    await component.ngOnInit();
    fixture.detectChanges();

    expect(component.hasOperatorContact).toBeTrue();
    expect(fixture.nativeElement.textContent).not.toContain('Operated by');
    expect(fixture.nativeElement.querySelector('a[href="mailto:admin@yourphr.org"]')).not.toBeNull();
  });

  // Says so plainly rather than substituting a project address — the maintainers are a different
  // party from the operator and cannot act on anyone's records.
  it('states plainly when the operator published nothing', async () => {
    await component.ngOnInit();
    fixture.detectChanges();

    expect(component.hasOperatorContact).toBeFalse();
    expect(fixture.nativeElement.textContent).toContain('has not published contact details');
  });

  // Guards against a flash of "not configured" while the request is still in flight.
  it('does not claim "not published" before the response arrives', () => {
    expect(component.loaded).toBeFalse();
  });

  it('still shows project contacts when the endpoint fails', async () => {
    apiSpy.getPublicInstanceInfo.and.returnValue(throwError(() => new Error('boom')));
    await component.ngOnInit();
    fixture.detectChanges();

    expect(component.loaded).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain('github.com/jwilleke/yourphr/issues');
  });

  // The operator holds the records; the project does not. Conflating them would send a patient
  // to people who cannot help and should not see their data.
  it('separates instance contacts from project contacts', async () => {
    await component.ngOnInit();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('This instance');
    expect(text).toContain('The YourPHR project');
    expect(text).toContain('no access to your records');
  });

  // #459: an anonymous visitor uses the public endpoint, which does not carry the address.
  it('uses the public endpoint when signed out', async () => {
    authSpy.IsAuthenticated.and.returnValue(Promise.resolve(false));
    await component.ngOnInit();

    expect(apiSpy.getPublicInstanceInfo).toHaveBeenCalled();
    expect(apiSpy.getInstanceInfo).not.toHaveBeenCalled();
  });

  it('uses the authenticated endpoint when signed in, which carries the address', async () => {
    authSpy.IsAuthenticated.and.returnValue(Promise.resolve(true));
    apiSpy.getInstanceInfo.and.returnValue(info({contact_email: 'admin@yourphr.org'}));

    await component.ngOnInit();
    fixture.detectChanges();

    expect(apiSpy.getInstanceInfo).toHaveBeenCalled();
    expect(apiSpy.getPublicInstanceInfo).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('a[href="mailto:admin@yourphr.org"]')).not.toBeNull();
  });

  // The page is reachable logged-out on purpose; an auth check that throws must not blank it.
  it('falls back to the public endpoint when the auth check fails', async () => {
    authSpy.IsAuthenticated.and.returnValue(Promise.reject(new Error('boom')));

    await component.ngOnInit();

    expect(apiSpy.getPublicInstanceInfo).toHaveBeenCalled();
  });
});
