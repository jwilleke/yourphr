import { Injectable, Injector } from '@angular/core';
import { HttpErrorResponse, HttpEvent, HttpHandler, HttpInterceptor, HttpRequest } from '@angular/common/http';
import {Router} from '@angular/router';
import {Observable, of, throwError} from 'rxjs';
import {catchError} from 'rxjs/operators';
import {AuthService} from './auth.service';
import {GetEndpointAbsolutePath} from '../../lib/utils/endpoint_absolute_path';
import {environment} from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})

// based on https://stackoverflow.com/questions/46017245/how-to-handle-unauthorized-requestsstatus-with-401-or-403-with-new-httpclient
export class AuthInterceptorService implements HttpInterceptor {

  constructor(private authService: AuthService, private router: Router) { }

  private handleAuthError(err: HttpErrorResponse): Observable<any> {
    //handle your auth error or rethrow
    if (err.status === 401 || err.status === 403) {
      //navigate /delete cookies or whatever
      this.authService.Logout()
      this.router.navigateByUrl(`/auth/signin`);
      // if you've caught / handled the error, you don't want to rethrow it unless you also want downstream consumers to have to handle it as well.
      return of(err.message); // or EMPTY may be appropriate here
    }
    return throwError(err);
  }

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {

    console.log("Intercepting Request", req)

    //only intercept requests to the fasten API & lighthouse, all other requests should be sent as-is
    const reqUrl = req.url.startsWith('http') ? new URL(req.url) : new URL(req.url, window.location.origin)
    const connectGatewayUrl = new URL(GetEndpointAbsolutePath(globalThis.location, environment.connect_gateway_api_endpoint_base))
    const apiUrl = new URL(GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base))

    if(
      !((reqUrl.origin == apiUrl.origin && reqUrl.pathname.startsWith(apiUrl.pathname)) ||
        (reqUrl.origin == connectGatewayUrl.origin && reqUrl.pathname.startsWith(connectGatewayUrl.pathname)))
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


    // let authToken = this.authService.GetAuthToken()
    // if(!authToken){
    //   //no authToken available, lets just handle the request as-is
    //   return next.handle(req)
    // }
    //
    // //only intercept requests to the Fasten API, Database & ConnectGateway, all other requests should be sent as-is
    // let reqUrl = new URL(req.url)
    // let connectGatewayUrl = new URL(GetEndpointAbsolutePath(globalThis.location, environment.connect_gateway_api_endpoint_base))
    // let apiUrl = new URL(GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base))
    //
    // //skip database, header is sent automatically via PouchDB
    // // let databaseUrl = new URL(GetEndpointAbsolutePath(globalThis.location, environment.couchdb_endpoint_base))
    //
    // if(
    //   (reqUrl.origin == connectGatewayUrl.origin && reqUrl.pathname.startsWith(connectGatewayUrl.pathname))
    // ){
    //   //all requests to the lighthouse require the JWT
    //   console.log("making authorized request...")
    //   // Clone the request to add the new auth header.
    //   const authReq = req.clone({headers: req.headers.set('Authorization', 'Bearer ' + this.authService.GetAuthToken())});
    //   // catch the error, make specific functions for catching specific errors and you can chain through them with more catch operators
    //   return next.handle(authReq).pipe(catchError(x=> this.handleAuthError(x))); //here use an arrow function, otherwise you may get "Cannot read property 'navigate' of undefined" on angular 4.4.2/net core 2/webpack 2.70
    // }
    // // else if(){
    // //   //TODO: only CORS requests to the API endpoint require JWT, but they also require a custom header.
    // //
    // //   //(reqUrl.origin == connectGatewayUrl.origin && reqUrl.pathname.startsWith(connectGatewayUrl.pathname)) ||
    // //   //       () ||
    // //   //       (reqUrl.origin == apiUrl.origin && reqUrl.pathname.startsWith(apiUrl.pathname))
    // //
    // // }
    //
    // return next.handle(req)

  }
}
