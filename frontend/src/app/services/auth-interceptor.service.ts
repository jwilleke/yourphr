import { Injectable, Injector } from '@angular/core';
import { HttpErrorResponse, HttpEvent, HttpHandler, HttpInterceptor, HttpRequest } from '@angular/common/http';
import {Router} from '@angular/router';
import {from, Observable, of, throwError} from 'rxjs';
import {catchError, mergeMap} from 'rxjs/operators';
import {AuthService} from './auth.service';
import {ToastService} from './toast.service';
import {ToastNotification, ToastType} from '../models/fasten/toast';
import {GetEndpointAbsolutePath} from '../../lib/utils/endpoint_absolute_path';
import {environment} from '../../environments/environment';

// A non-JSON body is still an answer worth showing — a proxy's HTML error page, say — so it becomes
// the message rather than being dropped for failing to parse.
function parseErrorBody(text: string): any {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : {error: text};
  } catch {
    return {error: text};
  }
}

@Injectable({
  providedIn: 'root'
})

// based on https://stackoverflow.com/questions/46017245/how-to-handle-unauthorized-requestsstatus-with-401-or-403-with-new-httpclient
export class AuthInterceptorService implements HttpInterceptor {

  constructor(private authService: AuthService, private router: Router, private toastService: ToastService) { }

  // 401 and 403 are different answers, and treating them alike destroyed valid sessions (#520).
  //
  // 401 means the session is missing or invalid — the only thing the backend returns when it cannot
  // identify the caller (middleware/require_auth.go). Signing out and returning to the sign-in page
  // is the correct response, because there is nothing to go back to.
  //
  // 403 means "we know who you are, and no". The demo guards (#496, #514, #516), the admin-role
  // checks, and the sign-up gate all answer 403 to a perfectly valid session. Logging the user out
  // for pressing a button they are not entitled to press is a bug: as the read-only demo admin,
  // clicking Connect on the sandbox page ended the session and bounced to sign-in.
  //
  // Rethrowing rather than swallowing matters too. `of(err.message)` completed the stream as a
  // SUCCESS, so the caller's error handler never ran and the component could not report the reason
  // even if it wanted to.
  //
  // A DOWNLOAD asks for responseType 'blob', and Angular applies that type to the ERROR body too —
  // so the JSON the server sent arrives as a Blob and `err.error.code` is undefined. Every check
  // against it silently fails, which is how the read-only demo admin pressing "Download backup" got
  // a bare "Download failed" with no reason: the refusal was never recognised here, and the
  // component had nothing to show. Read the Blob back and rebuild the response, so a caller sees
  // the same shape whether or not the request happened to want a file.
  private handleAuthError(err: HttpErrorResponse): Observable<any> {
    if (err.error instanceof Blob) {
      return from(err.error.text()).pipe(
        mergeMap((text) => this.reportAuthError(new HttpErrorResponse({
          error: parseErrorBody(text),
          headers: err.headers,
          status: err.status,
          statusText: err.statusText,
          url: err.url || undefined,
        }))),
      );
    }
    return this.reportAuthError(err);
  }

  private reportAuthError(err: HttpErrorResponse): Observable<any> {
    if (err.status === 401) {
      this.authService.Logout()
      this.router.navigateByUrl(`/auth/signin`);
      return of(err.message);
    }

    // Maintenance mode (#714): the operator is working on the records and every signed-in request
    // answers 503 until they finish. One page saying so beats a dashboard of failed cards. The
    // error is still rethrown below, so a caller's own handler runs as it would for any failure.
    if (err.status === 503 && err.error?.maintenance === true && !(this.router.url ?? '').startsWith('/maintenance')) {
      this.router.navigateByUrl('/maintenance', {state: {message: err.error?.error || ''}})
    }

    // Nothing handles the demo refusal today, and a silent no-op is its own kind of confusing — so
    // say it here. Keyed on the machine-readable code rather than the sentence, which is free to
    // change. Other 403s are left to their caller, which avoids double-reporting.
    if (err.status === 403 && err.error?.code === 'demo_account_restricted') {
      // Reporting must never REPLACE what it is reporting. When this threw — toastService was
      // undefined for months because of a stale `deps` array in app.module.ts — the TypeError
      // propagated instead of the 403, and Delete on the provider-catalog page showed
      // "Cannot read properties of undefined (reading 'show')" rather than the server's refusal.
      // The rethrow below is the contract; nothing above it is allowed to break it.
      try {
        const toastNotification = new ToastNotification()
        toastNotification.type = ToastType.Error
        toastNotification.message = err.error?.error || "this action is disabled in the public demo"
        // Stays until dismissed, like the source-connect failures. A refusal that fades after five
        // seconds is a refusal the person who pressed the button can easily never see — and then the
        // app just looks broken.
        toastNotification.autohide = false
        this.toastService.show(toastNotification)
      } catch (e) {
        console.error('could not show the refusal toast', e)
      }
    }

    return throwError(err);
  }

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {

    console.log("Intercepting Request", req)

    //only intercept requests to the fasten API, all other requests should be sent as-is (the
    //Fasten Lighthouse connect gateway is gone — no token ever leaves this instance's API, #700)
    const reqUrl = req.url.startsWith('http') ? new URL(req.url) : new URL(req.url, window.location.origin)
    const apiUrl = new URL(GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base))

    if(
      !(reqUrl.origin == apiUrl.origin && reqUrl.pathname.startsWith(apiUrl.pathname))
    ){
      return next.handle(req)
    }

    // Only attach a Bearer header if we actually have a token. In Phase 2b (#118) the session
    // is the HttpOnly cookie (sent automatically same-origin), and GetAuthToken() returns null —
    // so we send no Authorization header and let the cookie authenticate. (Sending "Bearer null"
    // would defeat the backend's cookie fallback, since the header takes precedence.)
    const token = this.authService.GetAuthToken();
    const authReq = token ? req.clone({headers: req.headers.set('Authorization', 'Bearer ' + token)}) : req;
    // catch the error, make specific functions for catching specific errors and you can chain through them with more catch operators
    return next.handle(authReq).pipe(catchError(x=> this.handleAuthError(x))); //here use an arrow function, otherwise you may get "Cannot read property 'navigate' of undefined" on angular 4.4.2/net core 2/webpack 2.70



  }
}
