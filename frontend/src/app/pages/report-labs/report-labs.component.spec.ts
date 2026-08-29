import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ReportLabsComponent } from './report-labs.component';
import {FastenApiService} from '../../services/fasten-api.service';
import {of} from 'rxjs';
import {RouterTestingModule} from '@angular/router/testing';
import { ReportHeaderComponent } from 'src/app/components/report-header/report-header.component';
import { LoadingSpinnerComponent } from 'src/app/components/loading-spinner/loading-spinner.component';

describe('ReportLabsComponent', () => {
  let component: ReportLabsComponent;
  let fixture: ComponentFixture<ReportLabsComponent>;
  let mockedFastenApiService

  beforeEach(async () => {

    mockedFastenApiService = jasmine.createSpyObj('FastenApiService', ['getResources', 'queryResources', 'getSummary'])
    await TestBed.configureTestingModule({
      declarations: [ ReportLabsComponent, ReportHeaderComponent ],
      imports: [RouterTestingModule, LoadingSpinnerComponent, RouterTestingModule],
      providers: [{
        provide: FastenApiService,
        useValue: mockedFastenApiService
      }]
    })
    .compileComponents();
    mockedFastenApiService.getResources.and.returnValue(of([]));
    // A ResponseWrapper, not a bare array: findLabResultCodesSortedByLatest() pipes
    // `response.data`, so `of([])` handed it undefined and `data.map(...)` threw. That throw
    // happened in a subscription outliving the spec, so Angular 22 reports it as an error in
    // afterAll — which tears down the whole browser session rather than failing one test.
    mockedFastenApiService.queryResources.and.returnValue(of({data: []}));
    mockedFastenApiService.getSummary.and.returnValue(of({sources: []}));

    fixture = TestBed.createComponent(ReportLabsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
