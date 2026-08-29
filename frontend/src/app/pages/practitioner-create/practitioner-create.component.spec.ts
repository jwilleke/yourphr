import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PractitionerCreateComponent } from './practitioner-create.component';
import { HTTP_CLIENT_TOKEN } from 'src/app/dependency-injection';
import { HttpClient, provideHttpClient, withInterceptorsFromDi, withXhr } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

describe('PractitionerCreateComponent', () => {
  let component: PractitionerCreateComponent;
  let fixture: ComponentFixture<PractitionerCreateComponent>;

  beforeEach(async () => {
    TestBed.configureTestingModule({
    imports: [PractitionerCreateComponent],
    providers: [
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
    fixture = TestBed.createComponent(PractitionerCreateComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
