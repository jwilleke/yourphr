import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MedicalSourcesComponent } from './medical-sources.component';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import {RouterTestingModule} from '@angular/router/testing';
import {HTTP_CLIENT_TOKEN} from '../../dependency-injection';
import { HttpClient, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import {FormsModule, ReactiveFormsModule} from '@angular/forms';
import { LoadingSpinnerComponent } from 'src/app/components/loading-spinner/loading-spinner.component';
import { MedicalSourcesFilterComponent } from 'src/app/components/medical-sources-filter/medical-sources-filter.component';
import { MedicalSourcesConnectedComponent } from 'src/app/components/medical-sources-connected/medical-sources-connected.component';
import { of } from 'rxjs';

describe('MedicalSourcesComponent', () => {
  let component: MedicalSourcesComponent;
  let fixture: ComponentFixture<MedicalSourcesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
    declarations: [MedicalSourcesComponent, MedicalSourcesFilterComponent, MedicalSourcesConnectedComponent],
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

    fixture = TestBed.createComponent(MedicalSourcesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
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
