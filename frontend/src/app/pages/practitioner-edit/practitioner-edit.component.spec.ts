import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PractitionerEditPageComponent } from './practitioner-edit.component';
import { ActivatedRoute } from '@angular/router';
import { HTTP_CLIENT_TOKEN } from 'src/app/dependency-injection';
import { HttpClient, provideHttpClient, withInterceptorsFromDi, withXhr } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';

describe('PractitionerEditComponent', () => {
  let component: PractitionerEditPageComponent;
  let fixture: ComponentFixture<PractitionerEditPageComponent>;

  beforeEach(async () => {
    TestBed.configureTestingModule({
    imports: [PractitionerEditPageComponent],
    providers: [
        {
            provide: ActivatedRoute,
            useValue: {
                snapshot: {
                    paramMap: { get: (key: string) => 'test-practitioner-id' },
                },
                params: of({ id: 'test-practitioner-id' })
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
    fixture = TestBed.createComponent(PractitionerEditPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
