import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FhirDatatableComponent } from './fhir-datatable.component';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import {FhirDatatableOutletDirective} from './fhir-datatable-outlet.directive';
import {FastenApiService} from '../../../services/fasten-api.service';
import {HTTP_CLIENT_TOKEN} from '../../../dependency-injection';
import { HttpClient, provideHttpClient, withInterceptorsFromDi, withXhr } from '@angular/common/http';
import {DatatableClaimComponent} from '../datatable-generic-resource/datatable-claim.component';
import {DatatableExplanationOfBenefitComponent} from '../datatable-generic-resource/datatable-explanation-of-benefit.component';

describe('ResourceListComponent', () => {
  let component: FhirDatatableComponent;
  let fixture: ComponentFixture<FhirDatatableComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
    declarations: [FhirDatatableComponent, FhirDatatableOutletDirective],
    imports: [],
    providers: [
        FastenApiService,
        {
            provide: HTTP_CLIENT_TOKEN,
            useClass: HttpClient,
        },
        provideHttpClient(withXhr(), withInterceptorsFromDi()),
        provideHttpClientTesting(),
    ]
})
    .compileComponents();

    fixture = TestBed.createComponent(FhirDatatableComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // The /explore LIST uses this switch, which is a separate registry from the fhir-card one. Both
  // types rendered fine as cards on the detail page while the list still showed "YourPHR does not
  // know how to display this resource type (yet)" over a column of UUIDs, because only the card
  // registry had been updated (#521, #522).
  describe('typeLookup', () => {
    it('should return a component for Claim', () => {
      expect(component.typeLookup('Claim')).toBe(DatatableClaimComponent);
    });

    it('should return a component for ExplanationOfBenefit', () => {
      expect(component.typeLookup('ExplanationOfBenefit')).toBe(DatatableExplanationOfBenefitComponent);
    });

    // Columns are what makes the list readable; a registered component with none renders an empty
    // table, which looks like a second bug rather than a fix.
    it('should give both types real columns', () => {
      expect(new DatatableClaimComponent(null, null).columnDefinitions.length).toBeGreaterThan(0);
      expect(new DatatableExplanationOfBenefitComponent(null, null).columnDefinitions.length).toBeGreaterThan(0);
    });
  });
});
