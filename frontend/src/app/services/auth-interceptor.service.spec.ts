import {TestBed} from '@angular/core/testing';
import {HTTP_INTERCEPTORS, HttpClient, HttpErrorResponse, HttpHandler, HttpRequest} from '@angular/common/http';
import {HttpClientTestingModule, HttpTestingController} from '@angular/common/http/testing';
import {Router} from '@angular/router';
import {throwError} from 'rxjs';
import {AuthInterceptorService} from './auth-interceptor.service';
import {AuthService} from './auth.service';
import {ToastService} from './toast.service';
import {environment} from '../../environments/environment';

// #520: a 403 used to log the user out and bounce them to the sign-in page, because the interceptor
// treated it like a 401. It is not the same thing — the backend answers 401 when it cannot identify
// the caller, and 403 when it can and the answer is still no (the demo guards, the admin-role
// checks). Destroying a valid session because someone pressed a button they are not entitled to
// press is the bug; these tests pin both halves.
describe('AuthInterceptorService', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let authService: jasmine.SpyObj<AuthService>;
  let router: jasmine.SpyObj<Router>;
  let toastService: ToastService;

  const apiUrl = `${environment.fasten_api_endpoint_base}/secure/admin/config`;

  beforeEach(() => {
    const authSpy = jasmine.createSpyObj('AuthService', ['GetAuthToken', 'Logout']);
    authSpy.GetAuthToken.and.returnValue(null);
    authSpy.Logout.and.returnValue(Promise.resolve());
    const routerSpy = jasmine.createSpyObj('Router', ['navigateByUrl']);

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        {provide: AuthService, useValue: authSpy},
        {provide: Router, useValue: routerSpy},
        ToastService,
        {provide: HTTP_INTERCEPTORS, useClass: AuthInterceptorService, multi: true},
      ],
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    authService = TestBed.inject(AuthService) as jasmine.SpyObj<AuthService>;
    router = TestBed.inject(Router) as jasmine.SpyObj<Router>;
    toastService = TestBed.inject(ToastService);
  });

  afterEach(() => httpMock.verify());

  // No done() here: on a 401 the interceptor swallows the error and emits a plain string, which
  // Angular's HttpClient pipeline drops because it is not an HttpEvent — so the subscriber never
  // fires at all. Harmless in practice (the app has already navigated away), but it means this case
  // has to be asserted on the side effects rather than on the stream.
  it('signs the user out on a 401, because the session really is gone', () => {
    http.get(apiUrl).subscribe({next: () => {}, error: () => {}});

    httpMock.expectOne(apiUrl).flush({success: false}, {status: 401, statusText: 'Unauthorized'});

    expect(authService.Logout).toHaveBeenCalled();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/auth/signin');
  });

  // The reported symptom: as the read-only demo admin, pressing Connect ended the session.
  it('does NOT sign the user out on a 403', (done) => {
    http.get(apiUrl).subscribe({
      next: () => done.fail('a 403 must reach the caller as an error'),
      error: (err) => {
        expect(err.status).toBe(403);
        done();
      },
    });

    httpMock.expectOne(apiUrl).flush(
      {success: false, code: 'demo_account_restricted', error: 'the public demo\'s admin account is read-only'},
      {status: 403, statusText: 'Forbidden'});

    expect(authService.Logout).not.toHaveBeenCalled();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('reports a demo refusal, since no component handles that code', (done) => {
    http.get(apiUrl).subscribe({next: () => done(), error: () => done()});

    httpMock.expectOne(apiUrl).flush(
      {success: false, code: 'demo_account_restricted', error: 'this action is disabled in the public demo'},
      {status: 403, statusText: 'Forbidden'});

    expect(toastService.toasts.length).toBe(1);
    expect(toastService.toasts[0].message).toContain('disabled in the public demo');
  });

  // The download case. Asking for a Blob makes Angular hand the ERROR body back as a Blob too, so
  // the JSON the server sent is unreadable by anything checking err.error.code — the refusal went
  // unrecognised and the page printed "Download failed — check the server logs" instead of the
  // reason. Reported live on /web/admin/database as the read-only demo admin.
  it('decodes a JSON refusal delivered as a Blob, so downloads report the reason too', (done) => {
    http.post(apiUrl, {}, {responseType: 'blob', observe: 'response'}).subscribe({
      next: () => done.fail('should error'),
      error: (err) => {
        // The caller gets a usable object, not a Blob it would have to decode itself.
        expect(err.error.code).toBe('demo_account_restricted');
        expect(err.error.error).toContain('read-only');
        expect(toastService.toasts.length).toBe(1);
        done();
      },
    });

    const body = new Blob(
      [JSON.stringify({success: false, code: 'demo_account_restricted', error: 'the demo admin is read-only'})],
      {type: 'application/json'});
    httpMock.expectOne(apiUrl).flush(body, {status: 403, statusText: 'Forbidden'});
  });

  // A proxy returning an HTML error page is still an answer; failing to parse must not erase it.
  it('keeps a non-JSON blob body as the message', (done) => {
    http.post(apiUrl, {}, {responseType: 'blob', observe: 'response'}).subscribe({
      next: () => done.fail('should error'),
      error: (err) => {
        expect(err.error.error).toContain('Gateway');
        done();
      },
    });

    httpMock.expectOne(apiUrl).flush(new Blob(['<h1>502 Bad Gateway</h1>'], {type: 'text/html'}),
      {status: 502, statusText: 'Bad Gateway'});
  });

  // The provider-catalog Delete report. app.module.ts registered this interceptor with an explicit
  // `deps: [AuthService, Router]` — two entries against a three-argument constructor — so the real
  // app ran with `toastService` undefined while this spec, which registers it without `deps`, was
  // green. Reporting then threw, and the TypeError REPLACED the 403 on its way to the component:
  // the page showed "Cannot read properties of undefined (reading 'show')" instead of the refusal.
  //
  // The deps array is gone, but the contract worth pinning is the stronger one — the caller gets
  // its HTTP error even when reporting is broken.
  it('propagates the HTTP error even when the toast service is missing', (done) => {
    const interceptor = new AuthInterceptorService(authService, router, undefined as any);
    const req = new HttpRequest<any>('GET', apiUrl);
    const refusal = new HttpErrorResponse({
      error: {code: 'demo_account_restricted', error: 'the demo admin is read-only'},
      status: 403,
      statusText: 'Forbidden',
      url: apiUrl,
    });
    const handler: HttpHandler = {handle: () => throwError(refusal)};

    interceptor.intercept(req, handler).subscribe({
      next: () => done.fail('should error'),
      error: (err) => {
        expect(err.status).toBe(403);
        expect(err.error.code).toBe('demo_account_restricted');
        done();
      },
    });
  });

  // #714: maintenance mode answers every signed-in request with 503 and the operator's message.
  it('sends a person to the maintenance page on a maintenance 503, without signing them out', (done) => {
    http.get(apiUrl).subscribe({
      next: () => done.fail('should error'),
      error: (err) => {
        expect(err.status).toBe(503);
        expect(router.navigateByUrl).toHaveBeenCalledWith('/maintenance', {state: {message: 'Back soon'}});
        expect(authService.Logout).not.toHaveBeenCalled();
        done();
      },
    });

    httpMock.expectOne(apiUrl).flush({success: false, error: 'Back soon', maintenance: true},
      {status: 503, statusText: 'Service Unavailable'});
  });

  // A 503 from a proxy or a restarting pod is not maintenance; it stays with the caller.
  it('leaves any other 503 to the caller', (done) => {
    http.get(apiUrl).subscribe({next: () => done.fail('should error'), error: () => done()});

    httpMock.expectOne(apiUrl).flush('upstream unavailable', {status: 503, statusText: 'Service Unavailable'});

    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  // Other 403s belong to their caller — toasting here as well would report them twice.
  it('leaves a non-demo 403 to the caller', (done) => {
    http.get(apiUrl).subscribe({
      next: () => done.fail('should error'),
      error: () => done(),
    });

    httpMock.expectOne(apiUrl).flush({success: false, error: 'admin role required'},
      {status: 403, statusText: 'Forbidden'});

    expect(toastService.toasts.length).toBe(0);
    expect(authService.Logout).not.toHaveBeenCalled();
  });
});
