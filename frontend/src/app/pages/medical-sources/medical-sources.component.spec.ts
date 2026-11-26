import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MedicalSourcesComponent } from './medical-sources.component';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import {RouterTestingModule} from '@angular/router/testing';
import {HTTP_CLIENT_TOKEN} from '../../dependency-injection';
import { HttpClient, provideHttpClient, withInterceptorsFromDi, withXhr } from '@angular/common/http';
import {FormsModule, ReactiveFormsModule} from '@angular/forms';
import { LoadingSpinnerComponent } from 'src/app/components/loading-spinner/loading-spinner.component';
import { MedicalSourcesConnectedComponent } from 'src/app/components/medical-sources-connected/medical-sources-connected.component';

describe('MedicalSourcesComponent', () => {
  let component: MedicalSourcesComponent;
  let fixture: ComponentFixture<MedicalSourcesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
    declarations: [MedicalSourcesComponent, MedicalSourcesConnectedComponent],
    imports: [RouterTestingModule, FormsModule, ReactiveFormsModule, LoadingSpinnerComponent],
    providers: [
        {
            provide: HTTP_CLIENT_TOKEN,
            useClass: HttpClient,
        },
        provideHttpClient(withXhr(), withInterceptorsFromDi()),
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

  // Provider catalog picker (#306): on init it loads the credential-free connectable list and renders
  // a button per enabled provider.
  function flushConnectable(data: unknown[]): void {
    const httpMock = TestBed.inject(HttpTestingController);
    const req = httpMock.expectOne((r) => r.url.includes('/secure/provider-catalog/connectable'));
    expect(req.request.method).toBe('GET');
    req.flush({ success: true, data });
    // markForCheck(): flush() delivers the response OUTSIDE change detection, and Angular 22's
    // detectChanges() no longer marks the fixture dirty implicitly, so the first pass would
    // render the stale value and the verification pass reports NG0100 (yourphr#482).
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
  }

  it('loads the connectable provider picker on init and renders a button per provider', () => {
    flushConnectable([
      { id: 'a', display: 'Medicare — Blue Button 2.0 (Sandbox)' },
      { id: 'b', display: 'Epic (Sandbox)' },
    ]);

    expect(component.connectableProviders.length).toBe(2);
    const html: string = fixture.nativeElement.textContent;
    expect(html).toContain('Epic (Sandbox)');
    expect(html).toContain('Medicare — Blue Button 2.0 (Sandbox)');
    // A display name that happens to contain "Sandbox" is not a feature flag (yourphr#674).
    expect(component.hasSandboxProviders).toBe(false);
    expect(fixture.nativeElement.querySelector('[data-sandbox-notice]')).toBeNull();
    // Note: not calling httpMock.verify() — the <app-medical-sources-connected> child issues its own
    // GET /source on init, which is orthogonal to this test.
  });

  it('shows the sandbox safety notice only when a listed provider is environment=sandbox (yourphr#674)', () => {
    flushConnectable([
      { id: 'a', display: 'Epic (Sandbox)', environment: 'sandbox' },
      { id: 'b', display: 'SMART Health IT (Sandbox)', environment: 'sandbox' },
    ]);

    expect(component.hasSandboxProviders).toBe(true);
    const notice = fixture.nativeElement.querySelector('[data-sandbox-notice]');
    expect(notice).not.toBeNull();
    expect(notice.textContent).toContain('cannot access real patient information');
    expect(fixture.nativeElement.querySelectorAll('[data-sandbox-provider-label]').length).toBe(2);
    expect(fixture.nativeElement.textContent).toContain('Sandbox credentials only');
  });

  it('does not show the sandbox safety notice for production providers, even if a name says Sandbox (yourphr#674)', () => {
    flushConnectable([
      { id: 'a', display: 'Hospital Sandbox Lab', environment: 'production' },
    ]);

    expect(component.hasSandboxProviders).toBe(false);
    expect(component.isSandboxProvider(component.connectableProviders[0])).toBe(false);
    expect(fixture.nativeElement.querySelector('[data-sandbox-notice]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-sandbox-provider-label]')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('cannot access real patient information');
  });

  // A portal download is a zip; several record files can be picked together (#786). Each is uploaded
  // in turn, and a zip goes straight up — no "convert?" prompt, no converter status round-trip.
  it('uploads every selected file in turn, a zip without asking anything', async () => {
    const httpMock = TestBed.inject(HttpTestingController);
    const zip = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'Requested-Records.zip', { type: 'application/zip' });
    const json = new File(['{"resourceType":"Patient","id":"p"}'], 'patient.json', { type: 'application/json' });
    const done = component.uploadSourceBundleHandler([zip, json]);

    const upload = (name: string) => (r: { url: string; body: unknown }) => r.url.includes('/secure/source/manual') && (r.body as FormData).get('file') instanceof File && ((r.body as FormData).get('file') as File).name === name;
    await new Promise((r) => setTimeout(r));
    httpMock.expectOne(upload('Requested-Records.zip')).flush({ success: true, data: { importing: true } }, { status: 202, statusText: 'Accepted' });
    await new Promise((r) => setTimeout(r));
    httpMock.expectOne(upload('patient.json')).flush({ success: true, data: { importing: true } }, { status: 202, statusText: 'Accepted' });
    await done;

    httpMock.expectNone((r) => r.url.includes('cda-converter/status'));
    expect(component.uploadErrorMsg).toBe('');
    // Set and walk away (#913): the page says the import is under way; the counts arrive as a notice.
    expect(component.uploadResultMsg).toContain('Requested-Records.zip: importing in the background');
    expect(component.uploadResultMsg).toContain('patient.json: importing in the background');
    expect(component.uploadInProgress).toBe(false);
  });
});
