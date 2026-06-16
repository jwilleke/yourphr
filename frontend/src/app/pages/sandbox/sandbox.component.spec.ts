import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SandboxComponent } from './sandbox.component';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { HTTP_CLIENT_TOKEN } from '../../dependency-injection';
import { HttpClient, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { LoadingSpinnerComponent } from 'src/app/components/loading-spinner/loading-spinner.component';
import { MedicalSourcesConnectedComponent } from 'src/app/components/medical-sources-connected/medical-sources-connected.component';
import { of } from 'rxjs';

describe('SandboxComponent', () => {
  let component: SandboxComponent;
  let fixture: ComponentFixture<SandboxComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
    declarations: [SandboxComponent, MedicalSourcesConnectedComponent],
    imports: [RouterTestingModule, FormsModule, ReactiveFormsModule, LoadingSpinnerComponent],
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
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // The "Use Epic Sandbox" button pre-fills the BYO SMART form with Epic's public sandbox
  // endpoint + scopes, but leaves client_id empty (each user supplies their own).
  it('openEpicSandboxModal: pre-fills the Epic sandbox endpoint + scopes and opens the modal', () => {
    const openSpy = spyOn(component['modalService'], 'open').and.returnValue({ result: Promise.resolve() } as any);

    component.openEpicSandboxModal();

    expect(component.smartForm.api_endpoint_base_url).toContain('fhir.epic.com');
    expect(component.smartForm.scopes).toContain('launch/patient');
    expect(component.smartForm.client_id).toBe('');   // bring-your-own — user supplies it
    expect(openSpy).toHaveBeenCalled();
  });

  // The "Use Blue Button Sandbox" button pre-fills the BYO SMART form with CMS Blue Button 2.0's
  // endpoint + its restricted scope set, leaving client_id AND client_secret empty (confidential
  // client — each user supplies both). BB2.0 rejects the wildcard / fhirUser / offline_access scopes.
  it('openBlueButtonSandboxModal: pre-fills the BB2.0 endpoint + restricted scopes and opens the modal', () => {
    const openSpy = spyOn(component['modalService'], 'open').and.returnValue({ result: Promise.resolve() } as any);

    component.openBlueButtonSandboxModal();

    expect(component.smartForm.api_endpoint_base_url).toBe('https://sandbox.bluebutton.cms.gov/v2/fhir');
    expect(component.smartForm.scopes).toContain('patient/ExplanationOfBenefit.read');
    expect(component.smartForm.scopes).toContain('patient/Coverage.read');
    expect(component.smartForm.scopes).not.toContain('*');              // no wildcard — invalid_scope
    expect(component.smartForm.scopes).not.toContain('offline_access'); // not offered by BB2.0
    expect(component.smartForm.client_id).toBe('');     // bring-your-own
    expect(component.smartForm.client_secret).toBe(''); // confidential — user supplies the secret
    expect(openSpy).toHaveBeenCalled();
  });

  // SMART Health IT is the open sandbox: prefills the long /sim/ launcher URL and a throwaway
  // client_id (the form requires non-empty), no secret.
  it('openSmartHealthItModal: prefills the launcher URL + a client_id, no secret', () => {
    const openSpy = spyOn(component['modalService'], 'open').and.returnValue({ result: Promise.resolve() } as any);

    component.openSmartHealthItModal();

    expect(component.smartForm.api_endpoint_base_url).toContain('launch.smarthealthit.org');
    expect(component.smartForm.api_endpoint_base_url).toContain('/sim/'); // required launch-options segment
    expect(component.smartForm.client_id).toBeTruthy();   // open sandbox ignores it but form needs non-empty
    expect(component.smartForm.client_secret).toBe('');
    expect(openSpy).toHaveBeenCalled();
  });

  // Oracle/Cerner: prefills the public sandbox tenant base + scopes, client_id BYO, no secret.
  it('openOracleCernerModal: prefills the Cerner sandbox base + scopes, no secret', () => {
    const openSpy = spyOn(component['modalService'], 'open').and.returnValue({ result: Promise.resolve() } as any);

    component.openOracleCernerModal();

    expect(component.smartForm.api_endpoint_base_url).toContain('sandboxcerner.com');
    expect(component.smartForm.scopes).toContain('patient/*.read');
    expect(component.smartForm.client_id).toBe('');     // bring-your-own
    expect(component.smartForm.client_secret).toBe(''); // public/PKCE
    expect(openSpy).toHaveBeenCalled();
  });

  // athenahealth: prefills scopes + display but deliberately leaves the FHIR base URL blank — it is
  // site-specific and must not be hard-coded.
  it('openAthenahealthModal: prefills scopes but leaves the site-specific base URL blank', () => {
    const openSpy = spyOn(component['modalService'], 'open').and.returnValue({ result: Promise.resolve() } as any);

    component.openAthenahealthModal();

    expect(component.smartForm.api_endpoint_base_url).toBe(''); // site-specific — entered by hand
    expect(component.smartForm.scopes).toContain('launch/patient');
    expect(component.smartForm.display).toBe('athenahealth');
    expect(openSpy).toHaveBeenCalled();
  });

  function fillSmartForm() {
    component.smartForm.api_endpoint_base_url = 'https://launch.smarthealthit.org/v/r4/fhir';
    component.smartForm.client_id = 'test-client';
    component.smartForm.scopes = 'launch/patient patient/*.read openid fhirUser offline_access';
  }

  // The popup must be opened synchronously in the click handler; if the browser blocks it,
  // surface a clear error and don't even start the authorize call.
  it('connectSmartSource: errors clearly when the popup is blocked', async () => {
    fillSmartForm();
    spyOn(window, 'open').and.returnValue(null);
    const authSpy = spyOn(component['fastenApi'], 'authorizeSource');

    await component.connectSmartSource();

    expect(authSpy).not.toHaveBeenCalled();
    expect(component.smartErrorMsg.toLowerCase()).toContain('popup');
    expect(component.smartConnecting).toBeFalse();
  });

  // Happy path: open a blank popup synchronously, then navigate it to the authorize URL once the
  // backend responds (proves we don't call window.open *after* the await).
  it('connectSmartSource: opens popup synchronously then navigates it to the authorize URL', async () => {
    fillSmartForm();
    const fakePopup: any = { location: { href: '' }, document: { write: () => {} }, close: () => {} };
    const openSpy = spyOn(window, 'open').and.returnValue(fakePopup);
    spyOn(component['fastenApi'], 'authorizeSource').and.returnValue(of({
      authorize_url: 'https://provider.example/authorize?x=1',
      state: 's1',
      code_verifier: 'v1',
    } as any));
    spyOn(component['fastenApi'], 'connectSource').and.returnValue(of({} as any));

    await component.connectSmartSource();

    expect(openSpy).toHaveBeenCalledWith('', '_blank');          // opened blank, synchronously
    expect(fakePopup.location.href).toBe('https://provider.example/authorize?x=1'); // navigated after authorize
    expect(component.smartSuccessMsg.toLowerCase()).toContain('connected');
    expect(component.smartConnecting).toBeFalse();
  });
});
