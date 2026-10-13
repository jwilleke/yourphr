import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ExploreComponent } from './explore.component';
import {HTTP_CLIENT_TOKEN} from '../../dependency-injection';
import { HttpClient, provideHttpClient, withInterceptorsFromDi, withXhr } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ReportHeaderComponent } from 'src/app/components/report-header/report-header.component';
import { LoadingSpinnerComponent } from 'src/app/components/loading-spinner/loading-spinner.component';
import { RouterTestingModule } from '@angular/router/testing';
import { AuthService } from 'src/app/services/auth.service';
import { FastenApiService } from 'src/app/services/fasten-api.service';
import { of } from 'rxjs';
import { Source } from 'src/app/models/fasten/source';

describe('ExploreComponent', () => {
  let component: ExploreComponent;
  let fixture: ComponentFixture<ExploreComponent>;
  let authService: jasmine.SpyObj<AuthService>;
  let fastenApi: jasmine.SpyObj<FastenApiService>;

  const productionSource = { id: 'prod-1', platform_type: 'epic', environment: 'production', endpoint_id: 'e', patient: '', client_id: '', access_token: '', expires_at: 0 } as Source;
  const sandboxSource = { id: 'sand-1', platform_type: 'epic', environment: 'sandbox', endpoint_id: 'e', patient: '', client_id: '', access_token: '', expires_at: 0 } as Source;

  beforeEach(async () => {
    authService = jasmine.createSpyObj('AuthService', ['IsAdmin']);
    authService.IsAdmin.and.resolveTo(true);
    fastenApi = jasmine.createSpyObj('FastenApiService', ['getSources', 'getSummary', 'getResources', 'getSelfPatient']);
    fastenApi.getSelfPatient.and.returnValue(of({patient: null, sourceLabel: ''}));
    fastenApi.getSources.and.returnValue(of([productionSource, sandboxSource]));
    fastenApi.getSummary.and.returnValue(of({ sources: [], patients: [], resource_type_counts: [] }));
    fastenApi.getResources.and.returnValue(of([]));

    await TestBed.configureTestingModule({
    declarations: [ExploreComponent, ReportHeaderComponent],
    imports: [LoadingSpinnerComponent, RouterTestingModule],
    providers: [
        { provide: AuthService, useValue: authService },
        { provide: FastenApiService, useValue: fastenApi },
        {
            provide: HTTP_CLIENT_TOKEN,
            useClass: HttpClient,
        },
        provideHttpClient(withXhr(), withInterceptorsFromDi()),
        provideHttpClientTesting(),
    ]
})
    .compileComponents();

    fixture = TestBed.createComponent(ExploreComponent);
    component = fixture.componentInstance;
  });

  async function init(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    // markForCheck(): the awaited data arrives OUTSIDE change detection, and Angular 22's
    // fixture.detectChanges() no longer marks the fixture dirty implicitly — so the first
    // pass renders the stale value and the verification pass reports NG0100 (yourphr#482).
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
  }

  it('should create', async () => {
    await init();
    expect(component).toBeTruthy();
  });

  it('shows every connected source, with no admin-only switch on the page (#904)', async () => {
    await init();
    expect(component.connectedSources.map(s => s.source.id).sort()).toEqual(['prod-1', 'sand-1']);
    expect(fixture.nativeElement.querySelector('#exploreShowSandbox')).toBeNull();
  });
});
