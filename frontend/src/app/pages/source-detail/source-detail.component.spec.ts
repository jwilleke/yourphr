import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SourceDetailComponent } from './source-detail.component';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import {RouterTestingModule} from '@angular/router/testing';
import {ActivatedRoute, convertToParamMap, RouterModule} from '@angular/router';
import {HTTP_CLIENT_TOKEN} from '../../dependency-injection';
import { HttpClient, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { FhirDatatableModule } from 'src/app/components/fhir-datatable/fhir-datatable.module';

describe('SourceDetailComponent', () => {
  let component: SourceDetailComponent;
  let fixture: ComponentFixture<SourceDetailComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
    declarations: [SourceDetailComponent],
    imports: [RouterTestingModule, RouterModule, FhirDatatableModule],
    providers: [
        {
            provide: ActivatedRoute,
            useValue: { snapshot: { paramMap: convertToParamMap({ 'source_id': 'b64.c291cmNlOmF0aGVuYTphLTgwMDAwLkUtMTQ1NDU' }) } }
        },
        {
            provide: HTTP_CLIENT_TOKEN,
            useClass: HttpClient,
        },
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
    ]
})
    .compileComponents();

    fixture = TestBed.createComponent(SourceDetailComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
