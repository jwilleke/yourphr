import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SandboxComponent } from './sandbox.component';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { HTTP_CLIENT_TOKEN } from '../../dependency-injection';
import { HttpClient, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { LoadingSpinnerComponent } from 'src/app/components/loading-spinner/loading-spinner.component';
import { MedicalSourcesConnectedComponent } from 'src/app/components/medical-sources-connected/medical-sources-connected.component';
import { AdminBackLinkComponent } from 'src/app/components/admin-back-link/admin-back-link.component';
import { of } from 'rxjs';

describe('SandboxComponent', () => {
  let component: SandboxComponent;
  let fixture: ComponentFixture<SandboxComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
    declarations: [SandboxComponent, MedicalSourcesConnectedComponent],
    imports: [RouterTestingModule, FormsModule, ReactiveFormsModule, LoadingSpinnerComponent, AdminBackLinkComponent],
    providers: [
        {
            provide: HTTP_CLIENT_TOKEN,
            useClass: HttpClient,
        },
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
    ]
})
    .compileComponents();

    fixture = TestBed.createComponent(SandboxComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    spyOn(component['fastenApi'], 'listSandboxProviders').and.returnValue(of([]));
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  // On init the page loads the server-configured sandbox providers (credential-free projection).
  it('ngOnInit: loads the configured sandbox providers', () => {
    spyOn(component['fastenApi'], 'listSandboxProviders').and.returnValue(of([
      { id: 'bb-id', display: 'Medicare — Blue Button 2.0 (Sandbox)', brand_logo_url: '' },
    ]));
    fixture.detectChanges();
    expect(component.sandboxProviders.length).toBe(1);
    expect(component.sandboxProviders[0].display).toContain('Blue Button');
    expect(component.loading).toBeFalse();
  });

  // The popup must be opened synchronously in the click handler; if the browser blocks it,
  // surface a clear error and don't even start the authorize call.
  it('connectSandboxProvider: errors clearly when the popup is blocked', async () => {
    spyOn(window, 'open').and.returnValue(null);
    const authSpy = spyOn(component['fastenApi'], 'authorizeSourceFromCatalog');

    await component.connectSandboxProvider({ id: 'bb-id', display: 'Blue Button', brand_logo_url: '' });

    expect(authSpy).not.toHaveBeenCalled();
    expect(component.errorMsg.toLowerCase()).toContain('popup');
    expect(component.connectingProviderId).toBeNull();
  });

  // Happy path: open a blank popup synchronously, navigate it to the authorize URL once the backend
  // responds, and drive the connect entirely by catalog id — NO client_id/secret in the request.
  it('connectSandboxProvider: one-click connect via catalog id, no credentials typed', async () => {
    const fakePopup: any = { location: { href: '' }, document: { write: () => {} }, close: () => {} };
    const openSpy = spyOn(window, 'open').and.returnValue(fakePopup);
    const authSpy = spyOn(component['fastenApi'], 'authorizeSourceFromCatalog').and.returnValue(of({
      authorize_url: 'https://provider.example/authorize?x=1',
      state: 's1',
      code_verifier: 'v1',
    } as any));
    const connectSpy = spyOn(component['fastenApi'], 'connectSourceFromCatalog').and.returnValue(of({} as any));

    await component.connectSandboxProvider({ id: 'bb-id', display: 'Blue Button', brand_logo_url: '' });

    expect(openSpy).toHaveBeenCalledWith('', '_blank');          // opened blank, synchronously
    expect(authSpy).toHaveBeenCalledWith('bb-id', jasmine.objectContaining({ redirect_uri: jasmine.any(String) }));
    expect(fakePopup.location.href).toBe('https://provider.example/authorize?x=1'); // navigated after authorize
    expect(connectSpy).toHaveBeenCalledWith('bb-id', jasmine.objectContaining({ state: 's1', code_verifier: 'v1' }));
    expect(component.successMsg.toLowerCase()).toContain('connected');
    expect(component.connectingProviderId).toBeNull();
  });
});
