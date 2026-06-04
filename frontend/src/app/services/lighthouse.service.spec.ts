import { TestBed } from '@angular/core/testing';

import { LighthouseService } from './lighthouse.service';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import {RouterTestingModule} from '@angular/router/testing';
import {RouterModule} from '@angular/router';
import {HTTP_CLIENT_TOKEN} from '../dependency-injection';
import { HttpClient, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';

describe('LighthouseService', () => {
  let service: LighthouseService;

  beforeEach(() => {
    TestBed.configureTestingModule({
    imports: [],
    providers: [
        {
            provide: HTTP_CLIENT_TOKEN,
            useClass: HttpClient,
        },
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
    ]
});
    service = TestBed.inject(LighthouseService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
