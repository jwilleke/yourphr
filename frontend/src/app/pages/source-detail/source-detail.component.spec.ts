import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SourceDetailComponent } from './source-detail.component';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import {RouterTestingModule} from '@angular/router/testing';
import {ActivatedRoute, convertToParamMap, RouterModule} from '@angular/router';
import {HTTP_CLIENT_TOKEN} from '../../dependency-injection';
import { HttpClient, provideHttpClient, withInterceptorsFromDi, withXhr } from '@angular/common/http';
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
        provideHttpClient(withXhr(), withInterceptorsFromDi()),
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

  describe('getPatientName (#1025)', () => {
    const withName = (name: any) => ({resource_raw: name === undefined ? {resourceType: 'Patient'} : {resourceType: 'Patient', name}} as any);

    it('formats "Family, Given" from structured name parts', () => {
      component.selectedPatient = withName([{family: 'Doe', given: ['Jane', 'Q']}]);
      expect(component.getPatientName()).toEqual('Doe, Jane Q');
    });

    it('falls back to name[0].text when there are no structured parts', () => {
      component.selectedPatient = withName([{text: 'Jane Doe'}]);
      expect(component.getPatientName()).toEqual('Jane Doe');
    });

    it('uses whichever part exists when only family or given is present', () => {
      component.selectedPatient = withName([{family: 'Doe'}]);
      expect(component.getPatientName()).toEqual('Doe');
      component.selectedPatient = withName([{given: ['Jane']}]);
      expect(component.getPatientName()).toEqual('Jane');
    });

    it('returns an empty string (never "undefined, ") when the Patient has no name', () => {
      component.selectedPatient = withName(undefined);
      expect(component.getPatientName()).toEqual('');
      component.selectedPatient = null;
      expect(component.getPatientName()).toEqual('');
    });
  });

  describe('isExternal (#1025)', () => {
    it('is false when the source has no brand_id', () => {
      component.selectedSource = {} as any;
      expect(component.isExternal()).toBeFalse();
      component.selectedSource = {brand_id: undefined} as any;
      expect(component.isExternal()).toBeFalse();
    });

    it('is false for the all-zero placeholder brand id', () => {
      component.selectedSource = {brand_id: '00000000-0000-0000-0000-000000000000'} as any;
      expect(component.isExternal()).toBeFalse();
    });

    it('is true for a real brand id', () => {
      component.selectedSource = {brand_id: 'b1a2c3d4-0000-4000-8000-000000000001'} as any;
      expect(component.isExternal()).toBeTrue();
    });
  });
});
