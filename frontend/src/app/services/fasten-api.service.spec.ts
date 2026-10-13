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


  describe('getSelfPatient (yourphr#888)', () => {
    const identity = (sourceId: string, patientId: string, answer: string, label = sourceId) =>
      ({sourceId, patientId, answer, label, display: '', demographics: {}, suggested: '', evidence: [], conflicts: []});
    const answer = (patients: unknown[], identities: unknown[]) => {
      const http = TestBed.inject(HttpTestingController);
      http.expectOne(req => req.url.endsWith('/secure/resource/fhir') && req.params.get('sourceResourceType') === 'Patient').flush({success: true, data: patients});
      http.expectOne(req => req.url.endsWith('/secure/records/identities')).flush({success: true, data: identities});
    };
    const someoneElse = {source_id: 'source-a', source_resource_id: 'p-child'};
    const me = {source_id: 'source-b', source_resource_id: 'p-me'};

    it('returns the Patient answered self, not the first one held', () => {
      let got: any;
      service.getSelfPatient().subscribe((r) => got = r);
      answer([someoneElse, me], [identity('source-a', 'p-child', 'not-self'), identity('source-b', 'p-me', 'self', 'Clinic B')]);
      expect(got.patient).toEqual(jasmine.objectContaining(me));
      expect(got.sourceLabel).toBe('Clinic B');
    });

    it('returns no one when nothing is confirmed, even with a single Patient held', () => {
      let got: any;
      service.getSelfPatient().subscribe((r) => got = r);
      answer([someoneElse], [identity('source-a', 'p-child', '')]);
      expect(got).toEqual({patient: null, sourceLabel: ''});
    });
  });
});
