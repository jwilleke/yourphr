# Provider catalog (admin-configured sources)

__Status:__ live for patient connect and admin management (foundation [#304](https://github.com/jwilleke/yourphr/issues/304) / picker [#306](https://github.com/jwilleke/yourphr/issues/306) / sandbox env split [#291](https://github.com/jwilleke/yourphr/issues/291)).

__Related:__ as-built SMART map [`docs/SMART-flow-map.md`](../SMART-flow-map.md) · connection policy [`docs/connection-policy.md`](../connection-policy.md) · Medicare / Blue Button [`docs/medicare-bluebutton.md`](../medicare-bluebutton.md) · production catalog path [#432](https://github.com/jwilleke/yourphr/issues/432)

## Why this exists

A patient should connect a data source by __picking it from a list__ and logging in with __their__ provider account — and should __never__ see or handle a `client_id` or `client_secret`.

That used to require __bring-your-own credentials (BYO)__ for every user (register a developer app, paste secrets into the connect form). That is wrong for a family PHR. It only existed because this fork __lost upstream Fasten's hosted catalog + Lighthouse__ (which held app credentials centrally). Lighthouse moved into commercial Fasten Connect.

This catalog is the __self-hosted replacement__: the __instance admin__ registers provider apps once; users of that instance pick and log in. Nothing here calls Lighthouse. The self-hosted OAuth __relay__ ([#50](https://github.com/jwilleke/yourphr/issues/50)) keeps tokens off the browser. EPIC [#20](https://github.com/jwilleke/yourphr/issues/20) is the live-sync umbrella; `fasten-sources-stub` is [#288](https://github.com/jwilleke/yourphr/issues/288).

## Roles and UI

| Role | UI | Sees credentials? |
|---|---|---|
| __Admin__ | `/admin/provider-catalog`, `/admin/users` | Yes (once, centrally) — create/edit entries; mark test accounts |
| __Patient__ (any authenticated user) | `/sources` (often `/web/sources`) | __No__ — enabled __production__ entries only (a test account: __sandbox__ only); connect by catalog id |

On a single-user self-hosted instance admin and patient may be the same person; credentials still must not appear in the normal connect flow.

__Connected sources__ (sync, download, disconnect) also live on __`/sources`__. Account-wide controls (PP/ToS, delete account) live on __`/account-profile`__. See [`connection-policy.md`](../connection-policy.md).

## Environments: production vs sandbox

| `environment` | Shown on | Purpose |
|---|---|---|
| `production` (default) | `/sources` for every real account, the admin's included | Real enrollee path |
| `sandbox` | `/sources` for a __test account__ only | Test sandboxes; __never__ listed to a real account |

Empty/legacy rows are treated as production for back-compat.

### Test accounts ([#919](https://github.com/jwilleke/yourphr/issues/919))

Test data and real data never share an account. An admin marks an account as a __test account__ on `/admin/users` (at creation or later) — ngdpbase's `isTest` flag ([ngdpbase#1805](https://github.com/jwilleke/ngdpbase/issues/1805)), exposed as `test_account` on `/api/secure/account/me` and `ApiContext.isTest`. It is an attribute, not a role: it grants nothing.

- `GET /provider-catalog/connectable` answers the enabled __sandbox__ entries to a test account, the enabled __production__ entries to everyone else.
- `authorize` and `connect` refuse the other kind with `403` / `error_code: test_account_mismatch` — the server enforces it, not only the list.
- A test account shows a banner on every screen; its uploads and devices are labelled `sandbox`.
- At startup the server names every source whose kind does not match its account (a log line per source, and one notice on the admin home).

To test a sandbox provider, sign in to a test account and connect it from `/sources`. The old admin `/sandbox` page is gone; its address redirects to `/sources`.

## Data model

`ProviderCatalogEntry` (GORM; secrets encrypted at rest with the DB like `SourceCredential`):

| Field | JSON | Notes |
|---|---|---|
| `ID` | `id` | uuid (ModelBase) |
| `Display` | `display` | unique; admin/operator label |
| `Environment` | `environment` | `production` or `sandbox` |
| `ApiEndpointBaseUrl` | `api_endpoint_base_url` | FHIR base; SSRF-checked before server fetch |
| `Scopes` | `scopes` | space-delimited SMART scopes |
| `ClientId` | `client_id` | admin/CRUD only; __not__ on patient connectable |
| `ClientSecret` | — | __never serialized__ (`json:"-"`); DB-encrypted ([#286](https://github.com/jwilleke/yourphr/issues/286)) |
| `PlatformType` | `platform_type` | e.g. `ehr` |
| `BrandLogoUrl` | `brand_logo_url` | optional picker logo |
| `Enabled` | `enabled` | patients only see enabled production entries |
| `AuthorizeUrlOverride` | `authorize_url_override` | optional; pin authorize URL when discovery is wrong ([#338](https://github.com/jwilleke/yourphr/issues/338)) |
| `ConsentPolicy` | `consent_policy` | `required` (default) or `skip` — modular PP/ToS gate |
| `PreConnectProfile` | `pre_connect_profile` | `auto` (default), `generic`, `medicare`, `none` |

Admin responses include `has_client_secret` (bool), never the secret value.

### Patient projection (`ConnectableProvider`)

`GET …/connectable` returns credential-free fields plus __resolved__ connection policy:

| Field | Meaning |
|---|---|
| `id`, `display`, `brand_logo_url` | Picker |
| `requires_user_consent` | PP/ToS required before connect (default true) |
| `pre_connect_profile` | Resolved: `none` \| `generic` \| `medicare` |
| `medicare_class` | CMS Blue Button-class (attribution; production label __Medicare__) |
| `requires_legal_consent` | Deprecated alias of `requires_user_consent` |

__Patient-facing display:__ production Blue Button-class sources are forced to the label __`Medicare`__ ([#429](https://github.com/jwilleke/yourphr/issues/429)), even if the admin stored a longer name. Sandbox keeps operator-explicit names (e.g. `Medicare — Blue Button 2.0 (Sandbox)`).

Policy resolution and overrides: [`docs/connection-policy.md`](../connection-policy.md).

## Endpoints

Admin (`UserRole == admin`):

- `POST   /api/secure/provider-catalog` — create
- `GET    /api/secure/provider-catalog` — list all (`client_id` shown; secret → `has_client_secret`)
- `GET    /api/secure/provider-catalog/:id` — get one
- `PUT    /api/secure/provider-catalog/:id` — update (omit `client_secret` to keep stored secret)
- `DELETE /api/secure/provider-catalog/:id` — delete

Patient (any authenticated user):

- `GET  /api/secure/provider-catalog/connectable` — enabled __production__ entries only; no credentials
- `POST /api/secure/provider-catalog/:id/authorize` — server loads entry, fills `client_id`/scopes/base URL, SMART discovery + PKCE; returns `authorize_url`, `state`, `code_verifier`, `login_wait_seconds`, `relay_poll_seconds`, `redirect_uri` (server-derived from relay config when omitted)
- `POST /api/secure/provider-catalog/:id/connect` — server fills credentials, polls relay for code by `state`, token exchange, patient id, `CreateSource`, background sync. Body: `{state, code_verifier, redirect_uri?, display?}` — __no__ client credentials. Requires product PP/ToS consent unless `consent_policy=skip`.

BYO `/source/authorize` + `/source/connect` ([#51](https://github.com/jwilleke/yourphr/issues/51)) remains for advanced/dev use; the __UI path is catalog__.

## Seeding

### Historical migration templates

`DefaultProviderCatalogEntries()` still supports early migrations: sandbox templates, empty credentials, disabled, idempotent by `Display`. __No real credential is committed__ (AGENTS.md hard rule).

### Live sandbox credentials (env)

At startup, `SeedSandboxProviders` upserts entries from `SandboxProviderSeeds()` when the corresponding env client id is set (or a literal open client id for SMART Health IT):

| Display (admin/sandbox) | Env (examples) |
|---|---|
| Medicare — Blue Button 2.0 (Sandbox) | `YOURPHR_SANDBOX_BLUEBUTTON_CLIENT_ID` / `_SECRET` |
| Epic (Sandbox) | `YOURPHR_SANDBOX_EPIC_CLIENT_ID` |
| Oracle Health / Cerner (Sandbox) | `YOURPHR_SANDBOX_ORACLE_CLIENT_ID` (+ authorize override) |
| athenahealth (Sandbox) | `YOURPHR_SANDBOX_ATHENA_CLIENT_ID` / `_SECRET` |
| SMART Health IT (Sandbox) | always seeded (literal public client id) |

All of these use `environment=sandbox`, so only a __test account__ sees them on `/sources`; a real account never does.

### Production Medicare ([#432](https://github.com/jwilleke/yourphr/issues/432))

__Template (no secrets):__ migration seeds a disabled production row:

| Field | Value |
|---|---|
| Display | `Medicare` |
| Environment | `production` |
| FHIR base | `https://api.bluebutton.cms.gov/v2/fhir` |
| Scopes | `models.BlueButtonSMARTScopes` |
| Enabled | `false` until credentials are set |

__Enable without code change:__

1. __Admin UI__ — Provider Catalog → edit __Medicare__ → paste production `client_id` / `client_secret` → enable, or  
2. __Env__ — `YOURPHR_PROD_BLUEBUTTON_CLIENT_ID` + `YOURPHR_PROD_BLUEBUTTON_CLIENT_SECRET` (startup upserts and enables)

Register the instance __relay callback__ (`Admin → SMART OAuth Relay` or `GET /api/secure/source/relay-config` → `callback_url`) with the CMS production app.

Patient button label is __Medicare__. Full checklist: [`docs/medicare-bluebutton.md`](../medicare-bluebutton.md) (Production section).

## Patient connect UX (catalog path)

Default for medical sources (modular; see connection policy):

1. Account Profile: grant PP/ToS if required  
2. `/sources`: pick provider (Medicare-class shows CMS attribution when listed)  
3. Pre-connect informed modal (Cancel / Continue) unless `pre_connect_profile=none`  
4. OAuth popup → relay → connect → Connected Sources on the same page  
5. Connected Sources: __Disconnect__ (tokens only), __Remove data__, or __Disconnect & remove data__ (full teardown)

## Security

- `client_secret`: `json:"-"`, DB-encrypted, never logged; exchange is server-side via relay.  
- Patient connect request never carries client credentials.  
- FHIR base URL SSRF-checked ([#302](https://github.com/jwilleke/yourphr/issues/302)).  
- Admin mutations gated on `currentUser.Role`.  
- Production vs sandbox split prevents test sandboxes from appearing as patient sources ([#291](https://github.com/jwilleke/yourphr/issues/291)).

## Relationship to the upstream catalog

`CreateReconnectSource` may still call `sourceDefinitions.GetSourceDefinition` (stubbed `fasten-sources` definitions). The provider catalog is the __owned__ path for new connect. Migrating reconnect fully onto the catalog is follow-on under EPIC [#20](https://github.com/jwilleke/yourphr/issues/20) / [#288](https://github.com/jwilleke/yourphr/issues/288).
