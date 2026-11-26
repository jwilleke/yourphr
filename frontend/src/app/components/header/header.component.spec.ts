import { waitForAsync, ComponentFixture, TestBed } from '@angular/core/testing';

import { HttpClient, provideHttpClient, withInterceptorsFromDi, withXhr } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { RouterModule } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { IconsModule } from 'src/app/icon-module';
import { HTTP_CLIENT_TOKEN } from '../../dependency-injection';
import { AuthService } from '../../services/auth.service';
import { HeaderComponent } from './header.component';
import { UserRegisteredClaims } from '../../models/fasten/user-registered-claims';

describe('HeaderComponent', () => {
  let component: HeaderComponent;
  let fixture: ComponentFixture<HeaderComponent>;
  let mockedAuthService;

  beforeEach(waitForAsync(() => {
    mockedAuthService = jasmine.createSpyObj(
      'AuthService',
      {
        // GetCurrentUser/IsAdmin are now async (resolve from /me, #103 Phase 2a)
        'GetCurrentUser': Promise.resolve(new UserRegisteredClaims()),
        'IsAdmin': Promise.resolve(false)
      }
    )
    TestBed.configureTestingModule({
    declarations: [HeaderComponent],
    imports: [RouterTestingModule, RouterModule, IconsModule],
    providers: [
        {
            provide: HTTP_CLIENT_TOKEN,
            useClass: HttpClient,
        },
        {
            provide: AuthService,
            useValue: mockedAuthService
        },
        provideHttpClient(withXhr(), withInterceptorsFromDi()),
        provideHttpClientTesting()
    ]
})
      .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(HeaderComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('sets support-request flavor from /api/version, not a compiled-in name (yourphr#674)', () => {
    const httpMock = TestBed.inject(HttpTestingController);
    const req = httpMock.expectOne((r) => /\/version$/.test(r.url) || r.url.endsWith('/version'));
    expect(req.request.method).toBe('GET');
    req.flush({ success: true, data: { version: '3.22.1', environment_name: 'willeke' } });
    expect(component.newSupportRequest.flavor).toBe('willeke');
  });

  it('leaves support-request flavor empty when the instance has not named itself (yourphr#674)', () => {
    const httpMock = TestBed.inject(HttpTestingController);
    const req = httpMock.expectOne((r) => /\/version$/.test(r.url) || r.url.endsWith('/version'));
    req.flush({ success: true, data: { version: '3.22.1', environment_name: '' } });
    expect(component.newSupportRequest.flavor).toBe('');
    expect(component.newSupportRequest.flavor).not.toBe('sandbox');
    expect(component.newSupportRequest.flavor).not.toBe('prod');
  });
});
