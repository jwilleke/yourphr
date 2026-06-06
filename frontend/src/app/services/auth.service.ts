import { HttpClient } from '@angular/common/http';
import { Inject, Injectable } from '@angular/core';
import * as Oauth from '@panva/oauth4webapi';
import { BehaviorSubject, Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { GetEndpointAbsolutePath } from '../../lib/utils/endpoint_absolute_path';
import { uuidV4 } from '../../lib/utils/uuid';
import { HTTP_CLIENT_TOKEN } from "../dependency-injection";
import { SourceState } from '../models/fasten/source-state';
import { User } from '../models/fasten/user';
import { UserRegisteredClaims } from '../models/fasten/user-registered-claims';
import { ResponseWrapper } from '../models/response-wrapper';

@Injectable({
  providedIn: 'root'
})
export class AuthService {

  FASTEN_JWT_LOCALSTORAGE_KEY = 'token';
  public IsAuthenticatedSubject = new BehaviorSubject<boolean>(false)
  constructor(@Inject(HTTP_CLIENT_TOKEN) private _httpClient: HttpClient) {
  }

  //Third-party JWT auth, used by Fasten Cloud
  public async IdpConnect(idp_type: string) {

    const state = uuidV4()
    const sourceStateInfo = new SourceState()
    sourceStateInfo.state = state
    // sourceStateInfo.source_type = idp_type
    sourceStateInfo.redirect_uri = `${window.location.href}/callback/hello`

    // generate the authorization url
    const authorizationUrl = new URL("https://wallet.hello.coop/authorize");
    authorizationUrl.searchParams.set('redirect_uri',  sourceStateInfo.redirect_uri);
    authorizationUrl.searchParams.set('response_type', "code");
    authorizationUrl.searchParams.set('response_mode', 'fragment');
    authorizationUrl.searchParams.set('state', state);
    authorizationUrl.searchParams.set('client_id', 'f5d8284d-c205-4d06-9fa4-c9fd809f30fc');
    authorizationUrl.searchParams.set('scope', 'name email openid');

    const codeVerifier = Oauth.generateRandomCodeVerifier();
    const codeChallenge = await Oauth.calculatePKCECodeChallenge(codeVerifier);
    const codeChallengeMethod = 'S256'

    sourceStateInfo.code_verifier = codeVerifier
    sourceStateInfo.code_challenge = codeChallenge
    sourceStateInfo.code_challenge_method = codeChallengeMethod

    authorizationUrl.searchParams.set('code_challenge', codeChallenge);
    authorizationUrl.searchParams.set('code_challenge_method', codeChallengeMethod);

    localStorage.setItem(state, JSON.stringify(sourceStateInfo))

    window.location.href = authorizationUrl.toString();
  }

  public async IdpCallback(idp_type: string, state: string, code: string): Promise<string> {

    const expectedSourceStateInfo = JSON.parse(localStorage.getItem(state))
    localStorage.removeItem(state)

    // @ts-expect-error
    const client: oauth.Client = {
      client_id: 'f5d8284d-c205-4d06-9fa4-c9fd809f30fc',
      token_endpoint_auth_method: 'none'
    }
    const codeVerifier = expectedSourceStateInfo.code_verifier

    const as = {
      issuer: "https://issuer.hello.coop",
      authorization_endpoint:	"https://wallet.hello.coop/authorize",
      token_endpoint:	"https://wallet.hello.coop/oauth/token",
      introspection_endpoint: "https://wallet.hello.coop/oauth/introspect"
    }

    console.log("STARTING--- Oauth.validateAuthResponse")
    const params = Oauth.validateAuthResponse(as, client, new URLSearchParams({"code": code, "state": expectedSourceStateInfo.state}), expectedSourceStateInfo.state)
    if (Oauth.isOAuth2Error(params)) {
      console.log('error', params)
      throw new Error() // Handle OAuth 2.0 redirect error
    }
    console.log("ENDING--- Oauth.validateAuthResponse")
    console.log("STARTING--- Oauth.authorizationCodeGrantRequest")
    const response = await Oauth.authorizationCodeGrantRequest(
      as,
      client,
      params,
      expectedSourceStateInfo.redirect_uri,
      codeVerifier,
    )
    const payload = await response.json()
    console.log("ENDING--- Oauth.authorizationCodeGrantRequest", payload)


    //trade Hello Idtoken for Fasten DB token.
    const fastenApiEndpointBase = GetEndpointAbsolutePath(globalThis.location,environment.fasten_api_endpoint_base)
    const resp = await this._httpClient.post<ResponseWrapper>(`${fastenApiEndpointBase}/auth/callback/${idp_type}`, payload).toPromise()

    this.setAuthToken(resp.data)

    return resp.data
  }


  //Primary auth used by self-hosted Fasten
  /**
   * Signup  (and Signin) both require an "online" user.
   * @param newUser
   * @constructor
   */
  public async Signup(newUser?: User): Promise<any> {
    const fastenApiEndpointBase = GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)
    const resp = await this._httpClient.post<ResponseWrapper>(`${fastenApiEndpointBase}/auth/signup`, newUser).toPromise()
    console.log(resp)

    this.setAuthToken(resp.data)

  }

  public async Signin(username: string, pass: string): Promise<any> {
    const currentUser = new User()
    currentUser.username = username
    currentUser.password = pass

    const fastenApiEndpointBase = GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)
    const resp = await this._httpClient.post<ResponseWrapper>(`${fastenApiEndpointBase}/auth/signin`, currentUser).toPromise()

    this.setAuthToken(resp.data)
  }

  public createUser(newUser: User): Observable<any> {
    const fastenApiEndpointBase = GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base);
    return this._httpClient.post<ResponseWrapper>(`${fastenApiEndpointBase}/secure/users`, newUser)
      .pipe(
        catchError((error) => {
          if (error.status === 400) {
            // Extract error information from the response body
            const errorBody = error.error;
            return throwError(new Error(errorBody.error || error.message));
          }
          return throwError(error);
        })
      );
  }

  //TODO: now that we've moved to remote-first database, we can refactor and simplify this function significantly.
  public async IsAuthenticated(): Promise<boolean> {
    // Phase 2b (#118): there is no JS-readable token to inspect — ask the server. A valid
    // HttpOnly session cookie makes /me succeed (200); otherwise it 401s. Server-authoritative.
    try {
      await this.GetCurrentUser()
      this.publishAuthenticationState(true)
      return true
    } catch (e) {
      this.publishAuthenticationState(false)
      return false
    }


    // //check if the authToken has expired.
    // let databaseEndpointBase = GetEndpointAbsolutePath(globalThis.location, environment.couchdb_endpoint_base)
    // try {
    //   let resp = await this._httpClient.get<any>(`${databaseEndpointBase}/_session`, {
    //     headers: new HttpHeaders({
    //       'Content-Type':  'application/json',
    //       Authorization: `Bearer ${authToken}`
    //     })
    //   }).toPromise()
    //   //  logic to check if user is logged in here.
    //   let session = resp as Session
    //   if(!session.ok || session?.info?.authenticated != "jwt" || !session.userCtx?.name){
    //     //invalid session, not jwt auth, or username is empty
    //     return false
    //   }
    //   return true
    // } catch (e) {
    //   return false
    // }
  }

  public GetAuthToken(): string {
    // Phase 2b (#118): the session is carried by the HttpOnly cookie, which JS cannot read,
    // so there's no bearer token to expose. Kept for back-compat; always null now.
    return null;
  }

  // Identity now comes from the server (GET /secure/account/me) rather than decoding the JWT
  // client-side, so it no longer needs a JS-readable token (#103 Phase 2a / #117). The browser's
  // session credential authenticates the call (Authorization header today; HttpOnly cookie after
  // Phase 2b). /me is also server-authoritative — role reflects current DB state, not a token snapshot.
  public async GetCurrentUser(): Promise<UserRegisteredClaims> {
    const fastenApiEndpointBase = GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)
    const resp = await this._httpClient.get<ResponseWrapper>(`${fastenApiEndpointBase}/secure/account/me`).toPromise()
    const data: any = (resp && resp.data) || {}

    const claims = new UserRegisteredClaims()
    claims.sub = data.username // the JWT subject is the username
    claims.id = data.id
    claims.full_name = data.full_name
    claims.email = data.email
    claims.picture = data.picture
    claims.role = data.role
    return claims
  }

  public async Logout(): Promise<any> {
    this.publishAuthenticationState(false)
    // Clear the HttpOnly session cookie server-side — it can't be cleared from JS (#103).
    // Best-effort: never let a failed request block sign-out.
    try {
      const fastenApiEndpointBase = GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)
      await this._httpClient.post<ResponseWrapper>(`${fastenApiEndpointBase}/auth/logout`, {}).toPromise()
    } catch (e) {
      // ignore — still clear the local token below
    }
    return localStorage.removeItem(this.FASTEN_JWT_LOCALSTORAGE_KEY)
    // // let remotePouchDb = new PouchDB(this.getRemoteUserDb(localStorage.getItem("current_user")), {skip_setup: true});
    // if(this.pouchDb){
    //   await this.pouchDb.logOut()
    // }
    // await this.Close()
  }

  public async IsAdmin(): Promise<boolean> {
    try {
      const currentUser = await this.GetCurrentUser();
      return !!currentUser && currentUser.role === "admin";
    } catch (e) {
      return false;
    }
  }

  /////////////////////////////////////////////////////////////////////////////////////////////////
  //Private Methods
  /////////////////////////////////////////////////////////////////////////////////////////////////

  private setAuthToken(token: string) {
    // Phase 2b (#118): the backend sets the HttpOnly session cookie on login, so the SPA no
    // longer stores the JWT (XSS can't steal what isn't in JS). Just flip the auth-state flag
    // and clear any token left over from a pre-Phase-2b session. `token` is intentionally unused.
    this.publishAuthenticationState(true)
    localStorage.removeItem(this.FASTEN_JWT_LOCALSTORAGE_KEY)
  }

  private publishAuthenticationState(authenticated){
    if(this.IsAuthenticatedSubject.value != authenticated){
      this.IsAuthenticatedSubject.next(authenticated)
    }
  }
}
