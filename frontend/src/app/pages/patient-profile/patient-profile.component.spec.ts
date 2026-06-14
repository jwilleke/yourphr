import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PatientProfileComponent } from './patient-profile.component';
import {FastenApiService} from '../../services/fasten-api.service';
import {of} from 'rxjs';
import {PipesModule} from '../../pipes/pipes.module';
import { ReportHeaderComponent } from 'src/app/components/report-header/report-header.component';
import { RouterTestingModule } from '@angular/router/testing';

describe('PatientProfileComponent', () => {
  let component: PatientProfileComponent;
  let fixture: ComponentFixture<PatientProfileComponent>;
  let mockedFastenApiService

  beforeEach(async () => {
    mockedFastenApiService = jasmine.createSpyObj('FastenApiService', ['getResources', 'getSummary', 'getClassifiedConditions'])
    await TestBed.configureTestingModule({
      declarations: [ PatientProfileComponent, ReportHeaderComponent ],
      imports: [PipesModule, RouterTestingModule],
      providers: [{
        provide: FastenApiService,
        useValue: mockedFastenApiService
      }]
    })
    .compileComponents();
    // Only Patient needs an object; Immunization/AllergyIntolerance must be [] because the component
    // maps them through fhirModelFactory, which THROWS on an unknown/undefined resource type. Feeding
    // an untyped {} made that throw surface as an async unhandled error → "thrown in afterAll" →
    // ChromeHeadless DISCONNECT at a random later spec (the CI flake this fixes).
    mockedFastenApiService.getResources.and.callFake((type: string) => of(type === 'Patient' ? [{}] : []));
    mockedFastenApiService.getSummary.and.returnValue(of({sources: []}));
    mockedFastenApiService.getClassifiedConditions.and.returnValue(of([]));
    fixture = TestBed.createComponent(PatientProfileComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('loads only the SDOH / health-concern bucket into the Personal & social section', () => {
    mockedFastenApiService.getClassifiedConditions.and.returnValue(of([
      {title: 'Employment', category: 'sdoh', state: 'Active', selfReported: true},
      {title: 'Diabetes', category: 'problem-list-item', state: 'Active', selfReported: false},
      {title: 'Housing', category: 'health-concern', state: 'Unknown', selfReported: false},
    ]));
    component.ngOnInit();
    expect(component.profileItems.map((p) => p.title)).toEqual(['Employment', 'Housing']);
  });
});
