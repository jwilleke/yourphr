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
    mockedFastenApiService = jasmine.createSpyObj('FastenApiService', ['getResources', 'getSummary', 'getReconciledConditions', 'getClassifiedAllergies', 'getSourceIdentities'])
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
    mockedFastenApiService.getSourceIdentities.and.returnValue(of([]));
    mockedFastenApiService.getSummary.and.returnValue(of({sources: []}));
    mockedFastenApiService.getReconciledConditions.and.returnValue(of([]));
    mockedFastenApiService.getClassifiedAllergies.and.returnValue(of([]));
    fixture = TestBed.createComponent(PatientProfileComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('loads only the SDOH / health-concern bucket into the Personal & social section', () => {
    mockedFastenApiService.getReconciledConditions.and.returnValue(of([
      {title: 'Employment', category: 'sdoh', state: 'Active', selfReported: true},
      {title: 'Diabetes', category: 'problem-list-item', state: 'Active', selfReported: false},
      {title: 'Housing', category: 'health-concern', state: 'Unknown', selfReported: false},
    ]));
    component.ngOnInit();
    expect(component.profileItems.map((p) => p.title)).toEqual(['Employment', 'Housing']);
  });

  describe('whose profile it is (yourphr#888)', () => {
    const someoneElse = {source_id: 'source-a', source_resource_id: 'p-child', resource_raw: {resourceType: 'Patient', name: [{family: 'Abbott', given: ['Barney']}]}};
    const me = {source_id: 'source-b', source_resource_id: 'p-me', resource_raw: {resourceType: 'Patient', name: [{family: 'Willeke', given: ['Jim']}]}};
    const identity = (sourceId: string, patientId: string, answer: string) => ({sourceId, patientId, answer, label: sourceId, display: '', demographics: {}, suggested: '', evidence: [], conflicts: []});

    it('shows the Patient the person confirmed as themselves, not the first one held', () => {
      mockedFastenApiService.getResources.and.callFake(() => of([someoneElse, me]));
      mockedFastenApiService.getSourceIdentities.and.returnValue(of([identity('source-a', 'p-child', 'not-self'), identity('source-b', 'p-me', 'self')]));
      component.ngOnInit();
      expect(component.patient as unknown).toBe(me);
      expect(component.patientSourceLabel).toBe('source-b');
    });

    it('shows no one, and asks, when nothing is confirmed', () => {
      mockedFastenApiService.getResources.and.callFake(() => of([someoneElse]));
      mockedFastenApiService.getSourceIdentities.and.returnValue(of([identity('source-a', 'p-child', '')]));
      component.patient = null;
      component.ngOnInit();
      fixture.detectChanges();
      expect(component.patient).toBeNull();
      expect(fixture.nativeElement.querySelector('#profile-unconfirmed')).not.toBeNull();
    });
  });
});
