import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProviderCatalogAdminComponent } from './provider-catalog-admin.component';
import { HttpClient, provideHttpClient, withInterceptorsFromDi, withXhr } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { HTTP_CLIENT_TOKEN } from '../../dependency-injection';

describe('ProviderCatalogAdminComponent', () => {
  let component: ProviderCatalogAdminComponent;
  let fixture: ComponentFixture<ProviderCatalogAdminComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProviderCatalogAdminComponent, RouterTestingModule],
      providers: [
        { provide: HTTP_CLIENT_TOKEN, useClass: HttpClient },
        provideHttpClient(withXhr(), withInterceptorsFromDi()),
        provideHttpClientTesting(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProviderCatalogAdminComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // Loads the admin catalog on init and renders a row per entry. The secret is never returned —
  // the row reflects has_client_secret only.
  it('loads catalog entries on init and renders them', () => {
    const httpMock = TestBed.inject(HttpTestingController);
    const req = httpMock.expectOne((r) => r.url.endsWith('/secure/provider-catalog') && r.method === 'GET');
    req.flush({ success: true, data: [
      { id: 'a', display: 'Epic (Sandbox)', api_endpoint_base_url: 'https://fhir.epic.com', scopes: 'openid', client_id: 'cid', has_client_secret: false, enabled: false },
    ]});
    // markForCheck(): flush() delivers the response OUTSIDE change detection, and Angular 22's
    // detectChanges() no longer marks the fixture dirty implicitly, so the first pass would
    // render the stale value and the verification pass reports NG0100 (yourphr#482).
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    // A SECOND pass: the row views are created by this first one, so their own bindings are
    // evaluated after the parent was already checked — which Angular 22 reports as NG0100 with
    // "the view has been created after its parent ... has been dirty checked". The second pass
    // checks the now-existing rows in a settled tree.
    fixture.detectChanges();

    expect(component.entries.length).toBe(1);
    const html: string = fixture.nativeElement.textContent;
    expect(html).toContain('Epic (Sandbox)');
    expect(html).toContain('https://fhir.epic.com');
  });

  // Required-field validation blocks save (no HTTP call) when the form is empty.
  it('blocks save when required fields are missing', () => {
    const httpMock = TestBed.inject(HttpTestingController);
    httpMock.expectOne((r) => r.url.endsWith('/secure/provider-catalog')).flush({ success: true, data: [] });
    component.newEntry();
    component.save();
    expect(component.errorMsg).toContain('required');
    httpMock.expectNone((r) => r.method === 'POST');
  });
});
