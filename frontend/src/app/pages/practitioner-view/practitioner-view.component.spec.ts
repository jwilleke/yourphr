import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PractitionerViewComponent } from './practitioner-view.component';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { HTTP_CLIENT_TOKEN } from 'src/app/dependency-injection';
import { HttpClient, provideHttpClient, withInterceptorsFromDi, withXhr } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

describe('PractitionerViewComponent', () => {
  let component: PractitionerViewComponent;
  let fixture: ComponentFixture<PractitionerViewComponent>;

  beforeEach(async () => {
    TestBed.configureTestingModule({
    imports: [PractitionerViewComponent],
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
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(PractitionerViewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
