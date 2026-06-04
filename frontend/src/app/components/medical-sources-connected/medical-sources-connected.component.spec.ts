import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MedicalSourcesConnectedComponent } from './medical-sources-connected.component';
import {HTTP_CLIENT_TOKEN} from '../../dependency-injection';
import { HttpClient, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import {RouterTestingModule} from '@angular/router/testing';
import { LoadingSpinnerComponent } from '../loading-spinner/loading-spinner.component';

describe('MedicalSourcesConnectedComponent', () => {
  let component: MedicalSourcesConnectedComponent;
  let fixture: ComponentFixture<MedicalSourcesConnectedComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
    declarations: [MedicalSourcesConnectedComponent],
    imports: [RouterTestingModule, LoadingSpinnerComponent],
    providers: [
        {
            provide: HTTP_CLIENT_TOKEN,
            useClass: HttpClient,
        },
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
    ]
})
    .compileComponents();

    fixture = TestBed.createComponent(MedicalSourcesConnectedComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should handle nanosecond and microsecond token expirations', () => {
    const tokenResponse = {
      token_type: "Bearer",
      expires_in: "3600",
      // Dummy values — this test only exercises expires_in; the token strings are
      // unused by the assertion. Kept obviously-fake so secret scanners don't flag them.
      access_token: "fake-access-token-for-test",
      refresh_token: "fake-refresh-token-for-test",
      patient: "a-80000.xxxx"
    }

    const expiresAt = component.getAccessTokenExpiration(tokenResponse)
    expect(expiresAt.toString().length).toEqual(10)
  })

});
