import { TestBed } from '@angular/core/testing';

import { FastenApiService } from './fasten-api.service';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import {HTTP_CLIENT_TOKEN} from '../dependency-injection';
import { HttpClient, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import {DashboardWidgetQuery} from '../models/widget/dashboard-widget-query';

describe('FastenApiService', () => {
  let service: FastenApiService;

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
    service = TestBed.inject(FastenApiService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

});
