import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProviderCatalogAdminComponent } from './provider-catalog-admin.component';
import { HttpClient, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
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
        provideHttpClient(withInterceptorsFromDi()),
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
