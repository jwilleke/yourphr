# SMART on FHIR — flow map

Derived only from this repository’s source. Paths are relative to the repo root.

---

## Packages and entry points

| Role | Path |
|---|---|
| SMART client (discover, PKCE, exchange, fetch) | `fasten-sources-stub/clients/smart/` |
| Source client (`SyncAll`) | `fasten-sources-stub/clients/factory/smart_client.go` |
| Relay HTTP service | `backend/cmd/relay/main.go` |
| Backend relay poll client + config | `backend/pkg/relay/relay.go` |
| BYO authorize / connect handlers | `backend/pkg/web/handler/source.go` |
| Catalog authorize / connect handlers | `backend/pkg/web/handler/provider_catalog.go` |
| Route registration | `backend/pkg/web/server.go` |
| Background sync job | `backend/pkg/web/handler/background_jobs.go` |
| Config defaults | `backend/pkg/config/config.go` |
| Angular API client | `frontend/src/app/services/fasten-api.service.ts` |
| Patient connect UI | `frontend/src/app/pages/medical-sources/medical-sources.component.ts` |
| Admin sandbox connect UI | `frontend/src/app/pages/sandbox/sandbox.component.ts` |
| Routes (sandbox admin-gated) | `frontend/src/app/app-routing.module.ts` |

---

## HTTP routes (backend)

Registered under JWT `secure` group in `backend/pkg/web/server.go`:

| Method | Path | Handler |
|---|---|---|
| `GET` | `/api/secure/source/relay-config` | `handler.GetRelayConfig` |
| `POST` | `/api/secure/source/authorize` | `handler.AuthorizeSource` |
| `POST` | `/api/secure/source/connect` | `handler.ConnectSource` |
| `POST` | `/api/secure/source/:sourceId/sync` | `handler.SourceSync` |
| `GET` | `/api/secure/provider-catalog/connectable` | `handler.ListConnectableProviders` |
| `GET` | `/api/secure/provider-catalog/sandbox` | `handler.ListSandboxProviders` |
| `POST` | `/api/secure/provider-catalog/:id/authorize` | `handler.AuthorizeSourceFromCatalog` |
| `POST` | `/api/secure/provider-catalog/:id/connect` | `handler.ConnectSourceFromCatalog` |

Relay process (`backend/cmd/relay/main.go`):

| Method | Path | Auth |
|---|---|---|
| `GET` | `/callback` | open |
| `GET` | `/pending` | header `X-Yourphr-Token` must match `YOURPHR_RELAY_SECRET` |
| `GET` | `/healthz` | open |
| `GET` | `/metrics` | separate port (`METRICS_PORT`, default `9090`) |

---

## Runtime flow

```text
Browser                         YourPHR backend                    Relay                    Provider
   |                                  |                              |                          |
   |-- POST …/authorize ------------->|                              |                          |
   |                                  |-- GET …/smart-configuration -|------------------------->|
   |                                  |<-- endpoints ----------------|--------------------------|
   |                                  |-- PKCE + state + AuthCodeURL                            |
   |<-- authorize_url, state,         |                              |                          |
   |    code_verifier, redirect_uri,  |                              |                          |
   |    login_wait_seconds -----------|                              |                          |
   |                                  |                              |                          |
   |-- popup GET authorize_url -------|------------------------------|------------------------->|
   |                                  |                              |                          |
   |  (user logs in at provider)      |                              |                          |
   |                                  |                              |                          |
   |  provider redirects browser ---->|------------------------------|-- GET /callback?code&state
   |                                  |                              |-- store {state→code}     |
   |                                  |                              |-- HTML "Connected"       |
   |                                  |                              |                          |
   |-- POST …/connect {state,         |                              |                          |
   |     code_verifier, redirect_uri} |                              |                          |
   |                                  |-- GET /pending?state  ------->|                          |
   |                                  |   X-Yourphr-Token            |-- take + delete code     |
   |                                  |<-- {"code":…} ---------------|                          |
   |                                  |-- POST token_endpoint -------|------------------------->|
   |                                  |   code + code_verifier       |                          |
   |                                  |<-- tokens (+ patient?) ------|--------------------------|
   |                                  |-- CreateSource (DB)          |                          |
   |                                  |-- go BackgroundJobSyncResources                         |
   |<-- {success, source,             |                              |                          |
   |     data.status=import_started} -|                              |                          |
   |                                  |-- FetchPatientData --------->|------------------------->|
   |                                  |-- UpsertRawResource          |                          |
```

UI that implements this loop:

- `MedicalSourcesComponent.connectCatalogProvider` → catalog authorize/connect
- `SandboxComponent` → same catalog authorize/connect against sandbox-listed entries

Both open a blank popup synchronously (`window.open('', '_blank')`), call authorize, set `popup.location.href = authorize.authorize_url`, then retry connect until success or the login window expires.

---

## Path A — provider catalog (used by UI)

### List

- Patient: `GET /secure/provider-catalog/connectable`  
  - Enabled entries only; __skips__ `environment == sandbox`  
  - Response is `ConnectableProvider` (id, display, logo) — no credentials  
  - `handler.ListConnectableProviders`
- Admin sandbox page: `GET /secure/provider-catalog/sandbox` (admin required)  
  - Enabled entries with `environment == sandbox` only  
  - `handler.ListSandboxProviders`

### Authorize — `handler.AuthorizeSourceFromCatalog`

1. Load enabled catalog entry by `:id` (`loadEnabledEntry`).
2. If `redirect_uri` empty → `relay.CallbackURL(appConfig)`.
3. Build `smart.Config` from __entry__ fields (`ApiEndpointBaseUrl`, `ClientId`, `Scopes`).
4. `cfg.Discover` → `GET {FHIRBaseURL}/.well-known/smart-configuration`.
5. If `entry.AuthorizeUrlOverride` non-empty, replace `ep.Authorization` (token endpoint stays from discovery).
6. `smart.GenerateVerifier()` + `uuid` state.
7. Response JSON:
   - `authorize_url` = `cfg.AuthCodeURL(ep, state, verifier)`
   - `state`, `code_verifier`, `redirect_uri`, `login_wait_seconds`

### Connect — `handler.ConnectSourceFromCatalog`

1. Load same enabled entry; require `code_verifier`; require `code` __or__ `state`.
2. Empty `redirect_uri` → `relay.CallbackURL(appConfig)` (must match authorize).
3. If `code` empty: `relay.FromConfig` → `PollUntil(ctx, state, 1s, 30s)`.
4. `smart.Config` from entry including `ClientSecret` (server-side only).
5. `Discover` → `ExchangeCode(code, code_verifier)`.
6. Patient id: `tok.Extra("patient")`, else `cfg.DiscoverPatientID`.
7. `CreateSource` with catalog platform/endpoint/environment fields.
8. `go BackgroundJobSyncResources(...)`.
9. HTTP 200: `success`, `source`, `data.status = "import_started"`.

Frontend calls: `FastenApiService.authorizeSourceFromCatalog` / `connectSourceFromCatalog`.

---

## Path B — BYO (self-describing request body)

Handlers: `AuthorizeSource`, `ConnectSource` in `source.go`.  
Angular wrappers exist (`authorizeSource`, `connectSource`) but __no page component calls them__; both UIs use Path A.

### Authorize request body (`SmartAuthorizeRequest`)

- `api_endpoint_base_url` (required)
- `client_id` (required)
- `scopes` (space-separated string → `strings.Fields`)
- `redirect_uri` (optional; default `relay.CallbackURL`)

SSRF: `validatePublicHTTPSURL(api_endpoint_base_url)` before discovery.

### Connect request body (`SmartConnectRequest`)

- `api_endpoint_base_url`, `client_id`, `code_verifier` required
- `client_secret` optional
- `code` __or__ `state` required (if only `state`, relay poll)
- `redirect_uri` optional (same default as authorize)
- `display` optional

Same exchange / patient-id / `CreateSource` / background sync sequence as catalog connect. `PlatformType` forced to `PlatformTypeEhr`.

---

## SMART client (`fasten-sources-stub/clients/smart`)

| Function | Behaviour |
|---|---|
| `Discover` | `GET {FHIRBaseURL}/.well-known/smart-configuration`; requires `authorization_endpoint` + `token_endpoint` |
| `GenerateVerifier` | 32 random bytes, base64url (RFC 7636) |
| `AuthCodeURL` | OAuth2 auth URL + `code_challenge` (S256 of verifier), `code_challenge_method=S256`, `aud={FHIRBaseURL}` |
| `ExchangeCode` | Token endpoint with `code` + `code_verifier`; confidential if `ClientSecret` set |
| `Refresh` | Refresh-token grant via `x/oauth2` TokenSource |
| `FetchEverything` / `FetchPatientData` | Capability-driven patient data fetch (see sync) |
| `DiscoverPatientID` | Used when token omits `patient` launch context |

---

## Relay

### Service (`backend/cmd/relay`)

- In-memory store: `state → code`, TTL = `defaultTTL` = __60s__
- `/callback`: require `code` + `state` (or show provider `error`); `put`; HTML “Connected”
- `/pending`: constant-time secret compare on `X-Yourphr-Token`; `take` (single-use); JSON `{"code":…}` or 404
- Janitor ticker every TTL; metrics on secondary port
- Env: `YOURPHR_RELAY_SECRET` (required), `PORT` (default `8080`), `METRICS_PORT` (default `9090`)

### Backend client (`backend/pkg/relay`)

| Symbol | Value / rule |
|---|---|
| `DefaultBaseURL` | `https://relay.nerdsbythehour.com` |
| `CallbackPath` | `/callback` |
| `ConfigKeyURL` | `relay.url` → env `YOURPHR_RELAY_URL` |
| `ConfigKeyPublicURL` | `relay.public_url` → `YOURPHR_RELAY_PUBLIC_URL` |
| `ConfigKeySecret` | `relay.secret` → `YOURPHR_RELAY_SECRET` |
| `ResolvePublicBaseURL` | public_url if set; else poll URL only if `https://`; else `DefaultBaseURL` |
| `CallbackURL` | `PublicBaseURL + "/callback"` |
| `FromConfig` | requires secret; poll base = `relay.url` or `DefaultBaseURL` |
| `Poll` | `GET {BaseURL}/pending?state=` + `X-Yourphr-Token` |
| `PollUntil` | interval + timeout; connect handlers use __1s / 30s__ |
| `Describe` | provenance for admin: `configured` / `inherited` / `default` / `unset`; `Ready = secret != ""` |

Config defaults (`config.go`):

```text
web.smart_connect.login_wait_seconds = 240
relay.url / relay.public_url / relay.secret = ""
```

---

## Frontend connect loop

`medical-sources.component.ts` / `sandbox.component.ts` (same structure):

1. Guard double-submit; open blank popup (fail if blocked).
2. `authorizeSourceFromCatalog(id)` — __no__ `redirect_uri` sent.
3. Require `authorize_url`, `state`, `code_verifier`.
4. `popup.location.href = authorize_url`.
5. Login window: `login_wait_seconds * 1000` if > 0, else __4 minutes__ (`catalogConnectWindowMs` / `sandboxConnectWindowMs`).
6. Attempts = `ceil(windowMs / 30000)` — aligns with backend 30s `PollUntil`.
7. Each attempt: `connectSourceFromCatalog` with `{ state, code_verifier, redirect_uri, display }`.
8. Retry only if error message matches `/authorization code from relay|timed out/i`; other errors terminal.

Note: `authorizeSource` (BYO) maps response without `redirect_uri`; catalog path maps `redirect_uri`.

---

## Post-connect sync

`ConnectSource*` → `BackgroundJobSyncResources` (`background_jobs.go`) → `factory.GetSourceClient` → `smartClient.SyncAll`:

1. Require FHIR base URL + patient id on credential.
2. `Discover` + `ensureValidToken` (refresh if needed).
3. `FetchPatientData` (capability: `$everything` if supported, else per-resource compartment search).
4. Each page: extract resources → `UpsertRawResource` (incremental).
5. Collect Binary attachment URLs from `DocumentReference` / `DiagnosticReport` → best-effort second pass `fetchBinaries`.
6. Persist refreshed tokens on the credential when present.

Manual re-sync: `POST /secure/source/:sourceId/sync` → same job path.

---

## Where secrets live (from code)

| Secret | Who holds it |
|---|---|
| Catalog `client_id` / `client_secret` | DB / catalog entry; filled server-side on catalog connect; not in list/connectable responses |
| BYO `client_id` / `client_secret` | Request body → `SourceCredential` |
| PKCE `code_verifier` | Generated in backend; returned once to browser; sent back on connect; not stored server-side for the dance |
| Authorization `code` | Provider → relay memory (~60s) → backend via `/pending` (or optional direct `code` field) → discarded after exchange |
| Access / refresh tokens | Provider → backend only → `SourceCredential` / DB; not returned as the browser’s exchange job |
| Relay shared secret | Relay env + app `relay.secret`; never in `GetRelayConfig` value field |

Comments in `ConnectSource` / catalog connect: __browser never handles tokens__; relay path preferred so __code never touches the browser__.

---

## Error strings (handlers / client)

| Condition | Status / error text (approx.) |
|---|---|
| Bad JSON | 400 `invalid request: …` |
| Missing required fields | 400 (path-specific message) |
| SSRF / non-public FHIR base | 400 `invalid api_endpoint_base_url: …` |
| No code and no state | 400 `one of code or state is required` |
| Relay secret unset | 503 `relay not configured: …` |
| Poll timeout / failure | 502 `could not retrieve authorization code from relay: …` |
| Discovery fail | 502 `SMART discovery failed: …` |
| Token exchange fail | 502 `token exchange failed: …` |
| No patient id | 502 (wording differs slightly BYO vs catalog) |
| Catalog missing | 404 `provider not found` |
| Catalog disabled | 403 `provider is not enabled` |
| Relay `/pending` bad secret | 401 `unauthorized` |
| Relay code missing/expired | 404 `not found` |

---

## Timing constants (code)

| Constant | Location | Value |
|---|---|---|
| Relay code TTL | `backend/cmd/relay/main.go` `defaultTTL` | 60s |
| One connect poll | `web.smart_connect.relay_poll_seconds` (default __55__, cap 60) via `relayPollTimeout` | 55s |
| Default UI login wait | `web.smart_connect.login_wait_seconds` | 240 |
| UI fallback window | `catalogConnectWindowMs` / `sandboxConnectWindowMs` | 4 min |
| UI retries | only `error_code=relay_poll_timeout` (see `smart-connect-error.ts`) | across login wait |
| FHIR HTTP client timeout | `smart.defaultFetchTimeout` | 90s |

---

## Not on the live UI path

- `frontend/src/app/services/connect-gateway.service.ts` — Fasten Lighthouse-style connect-gateway client; __not__ used by `connectCatalogProvider` / sandbox connect.
- `POST /secure/source/authorize` + `/connect` — implemented and tested; __no__ current page wires them (catalog path is what the UI runs).
