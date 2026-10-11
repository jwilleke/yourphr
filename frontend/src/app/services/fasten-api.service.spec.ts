import { TestBed } from '@angular/core/testing';

import { FastenApiService } from './fasten-api.service';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import {HTTP_CLIENT_TOKEN} from '../dependency-injection';
import { HttpClient, provideHttpClient, withInterceptorsFromDi, withXhr } from '@angular/common/http';
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
        provideHttpClient(withXhr(), withInterceptorsFromDi()),
        provideHttpClientTesting(),
    ]
});
    service = TestBed.inject(FastenApiService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('encodes a contained Procedure identity as a path segment, not a URL fragment', () => {
    service.getResourceBySourceId('source-1', 'implant#placement').subscribe();
    const http = TestBed.inject(HttpTestingController);
    const request = http.expectOne(req => req.url.endsWith('/secure/resource/fhir/source-1/implant%23placement'));
    request.flush({success: true, data: {source_resource_id: 'implant#placement'}});
    http.verify();
  });

});
