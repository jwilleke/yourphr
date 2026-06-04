import { TestBed } from '@angular/core/testing';

import { NlmClinicalTableSearchService } from './nlm-clinical-table-search.service';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import {HTTP_CLIENT_TOKEN} from '../dependency-injection';
import { HttpClient, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';

describe('NlmClinicalTableSearchService', () => {
  let service: NlmClinicalTableSearchService;

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
    service = TestBed.inject(NlmClinicalTableSearchService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
