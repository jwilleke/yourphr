import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AuthSigninComponent } from './auth-signin.component';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import {RouterTestingModule} from '@angular/router/testing';
import {RouterModule} from '@angular/router';
import {FormsModule} from '@angular/forms';
import {HTTP_CLIENT_TOKEN} from '../../dependency-injection';
import { HttpClient, provideHttpClient, withInterceptorsFromDi, withXhr } from '@angular/common/http';

describe('AuthSigninComponent', () => {
  let component: AuthSigninComponent;
  let fixture: ComponentFixture<AuthSigninComponent>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
    declarations: [AuthSigninComponent],
    imports: [FormsModule, RouterTestingModule],
    providers: [
        {
            provide: HTTP_CLIENT_TOKEN,
            useClass: HttpClient,
        },
        provideHttpClient(withXhr(), withInterceptorsFromDi()),
        provideHttpClientTesting(),
    ]
})
    .compileComponents();

    fixture = TestBed.createComponent(AuthSigninComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // The demo button gates entry to a SHARED account, so anything other than an explicit
  // demo.enabled:true from the instance must leave it hidden (#495).
  describe('demo mode', () => {
    const instanceRequest = () => httpMock.expectOne((req) => req.url.endsWith('/instance/public'));

    it('shows the demo button when the instance publishes demo.enabled', () => {
      instanceRequest().flush({success: true, data: {'demo.enabled': true}});
      fixture.detectChanges();

      expect(component.demoEnabled).toBeTrue();
    });

    it('hides the demo button when demo.enabled is absent', () => {
      instanceRequest().flush({success: true, data: {'operator.name': 'YourPHR'}});
      fixture.detectChanges();

      expect(component.demoEnabled).toBeFalse();
    });

    it('hides the demo button when demo.enabled is a truthy non-boolean', () => {
      instanceRequest().flush({success: true, data: {'demo.enabled': 'true'}});
      fixture.detectChanges();

      expect(component.demoEnabled).toBeFalse();
    });

    it('hides the demo button when the instance endpoint fails', () => {
      instanceRequest().error(new ProgressEvent('network error'));
      fixture.detectChanges();

      expect(component.demoEnabled).toBeFalse();
    });

    // #498. Opposite default to demo mode: signup has always been open, so only an explicit false
    // may hide the link — an absent key or a failed request must leave it offered.
    it('offers signup when the instance says nothing about it', () => {
      instanceRequest().flush({success: true, data: {'operator.name': 'YourPHR'}});
      fixture.detectChanges();

      expect(component.signupEnabled).toBeTrue();
    });

    it('hides signup only when the instance explicitly closed it', () => {
      instanceRequest().flush({success: true, data: {'signup.enabled': false}});
      fixture.detectChanges();

      expect(component.signupEnabled).toBeFalse();
    });

    it('still offers signup when the instance endpoint fails', () => {
      instanceRequest().error(new ProgressEvent('network error'));
      fixture.detectChanges();

      expect(component.signupEnabled).toBeTrue();
    });

    it('posts no credentials when entering the demo', () => {
      instanceRequest().flush({success: true, data: {'demo.enabled': true}});
      fixture.detectChanges();

      component.demoSignin();

      const demoRequest = httpMock.expectOne((req) => req.url.endsWith('/auth/demo-signin'));
      expect(demoRequest.request.method).toBe('POST');
      // The password is configuration verified server-side; it must never be in this bundle.
      expect(JSON.stringify(demoRequest.request.body)).toBe('{}');
      demoRequest.flush({success: true, data: 'a-session-token'});
    });
  });
});
