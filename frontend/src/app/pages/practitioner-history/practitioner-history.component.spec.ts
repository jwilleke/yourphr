import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PractitionerHistoryComponent } from './practitioner-history.component';
import { RouterTestingModule } from '@angular/router/testing';
import { of } from 'rxjs';
import { ReportHeaderComponent } from 'src/app/components/report-header/report-header.component';
import { ActivatedRoute } from '@angular/router';
import { HTTP_CLIENT_TOKEN } from 'src/app/dependency-injection';
import { HttpClient, provideHttpClient, withInterceptorsFromDi, withXhr } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { MedicalHistoryComponent } from '../medical-history/medical-history.component';

describe('PractitionerHistoryComponent', () => {
  let mockedFastenApiService;
  let component: PractitionerHistoryComponent;
  let fixture: ComponentFixture<PractitionerHistoryComponent>;

  beforeEach(async () => {
    mockedFastenApiService = jasmine.createSpyObj('FastenApiService', [
      'getResources',
      'getResourceGraph',
      'getSummary',
    ]);
    await TestBed.configureTestingModule({
    declarations: [PractitionerHistoryComponent, ReportHeaderComponent, MedicalHistoryComponent],
    imports: [RouterTestingModule],
    providers: [
        {
            provide: ActivatedRoute,
            useValue: {
                snapshot: {
                    paramMap: { get: (key: string) => 'test-practitioner-id' },
                },
                params: of({ id: 'test-practitioner-id' }),
            },
        },
        {
            provide: HTTP_CLIENT_TOKEN,
            useClass: HttpClient,
        },
        provideHttpClient(withInterceptorsFromDi()),
        // The TESTING backend: without it these specs fire real XHRs at the karma server, which
        // 404. Angular 22 surfaces those unhandled responses as an error thrown in afterAll, which
        // tears down the whole browser session rather than failing one spec.
        provideHttpClientTesting(),
    ]
}).compileComponents();
    mockedFastenApiService.getResourceGraph.and.returnValue(
      of({ Condition: [], Encounter: [] })
    );
    mockedFastenApiService.getResources.and.returnValue(of([]));
    mockedFastenApiService.getSummary.and.returnValue(of({ sources: [] }));

    fixture = TestBed.createComponent(PractitionerHistoryComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
