import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BinaryComponent } from './binary.component';
import {NgbCollapseModule} from '@ng-bootstrap/ng-bootstrap';
import {FastenApiService} from '../../../../services/fasten-api.service';
import {RouterTestingModule} from '@angular/router/testing';
import {HTTP_CLIENT_TOKEN} from '../../../../dependency-injection';
import { HttpClient, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

describe('BinaryComponent', () => {
  let component: BinaryComponent;
  let fixture: ComponentFixture<BinaryComponent>;
  let mockedFastenApiService

  beforeEach(async () => {
    mockedFastenApiService = jasmine.createSpyObj('FastenApiService', ['getBinaryModel'])

    await TestBed.configureTestingModule({
    imports: [BinaryComponent, NgbCollapseModule, RouterTestingModule],
    providers: [
        {
            provide: FastenApiService,
            useValue: mockedFastenApiService
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

    fixture = TestBed.createComponent(BinaryComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
