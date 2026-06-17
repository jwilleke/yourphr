import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MedicalSourcesComponent } from './medical-sources.component';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import {RouterTestingModule} from '@angular/router/testing';
import {HTTP_CLIENT_TOKEN} from '../../dependency-injection';
import { HttpClient, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import {FormsModule, ReactiveFormsModule} from '@angular/forms';
import { LoadingSpinnerComponent } from 'src/app/components/loading-spinner/loading-spinner.component';
import { MedicalSourcesFilterComponent } from 'src/app/components/medical-sources-filter/medical-sources-filter.component';
import { MedicalSourcesConnectedComponent } from 'src/app/components/medical-sources-connected/medical-sources-connected.component';

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

  // The bring-your-own SMART connect flow moved to the admin-only /sandbox page
  // (SandboxComponent) — its tests live in sandbox.component.spec.ts.

  // Provider catalog picker (#306): on init it loads the credential-free connectable list and renders
  // a button per enabled provider.
  it('loads the connectable provider picker on init and renders a button per provider', () => {
    const httpMock = TestBed.inject(HttpTestingController);
    const req = httpMock.expectOne((r) => r.url.includes('/secure/provider-catalog/connectable'));
    expect(req.request.method).toBe('GET');
    req.flush({ success: true, data: [
      { id: 'a', display: 'Medicare — Blue Button 2.0 (Sandbox)' },
      { id: 'b', display: 'Epic (Sandbox)' },
    ]});
    fixture.detectChanges();

    expect(component.connectableProviders.length).toBe(2);
    const html: string = fixture.nativeElement.textContent;
    expect(html).toContain('Epic (Sandbox)');
    expect(html).toContain('Medicare — Blue Button 2.0 (Sandbox)');
    // Note: not calling httpMock.verify() — the <app-medical-sources-connected> child issues its own
    // GET /source on init, which is orthogonal to this test.
  });
});
