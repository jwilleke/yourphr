import { waitForAsync, ComponentFixture, TestBed } from '@angular/core/testing';

import { HttpClient, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterModule } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { IconsModule } from 'src/app/icon-module';
import { HTTP_CLIENT_TOKEN } from '../../dependency-injection';
import { AuthService } from '../../services/auth.service';
import { HeaderComponent } from './header.component';
import { of } from 'rxjs';
import { UserRegisteredClaims } from '../../models/fasten/user-registered-claims';

describe('HeaderComponent', () => {
  let component: HeaderComponent;
  let fixture: ComponentFixture<HeaderComponent>;
  let mockedAuthService;

  beforeEach(waitForAsync(() => {
    mockedAuthService = jasmine.createSpyObj(
      'AuthService',
      {
        'getCurrentUser': of(new UserRegisteredClaims()),
        'IsAdmin': of(false)
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
        provideHttpClient(withInterceptorsFromDi()),
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
});
