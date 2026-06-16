# Provider catalog (admin-configured sources)

Status: in progress — backend [#304](https://github.com/jwilleke/yourphr/issues/304) (frontend picker [#306](https://github.com/jwilleke/yourphr/issues/306), umbrella [#291](https://github.com/jwilleke/yourphr/issues/291)).

## Why this exists

A patient should connect a data source by **picking it from a list** ("Connect Medicare / Blue Button", "Connect Epic", …) and logging in with **their** provider account — and should **never** see or handle a `client_id` or `client_secret`. Today the only connect path is **bring-your-own-`client_id` (BYO)**: every user registers their own developer app at the provider and pastes the credentials into the connect modal. That is developer work, wrong for a consumer/family PHR — it's the friction that made the live Blue Button bring-up ([#293](https://github.com/jwilleke/yourphr/issues/293)) painful.

The BYO model exists only because this fork **lost upstream Fasten's hosted provider catalog** — the pre-registered provider list + the **Lighthouse** OAuth relay that centrally held app credentials so users never saw them. That moved into the commercial Fasten Connect. This catalog is the **self-hosted replacement**: the admin of a YourPHR instance registers provider apps once, centrally; patients (the family on that instance) just pick and log in.

This is a load-bearing step toward going **standalone** (EPIC [#2](https://github.com/jwilleke/yourphr/issues/2)): it removes the dependence on the upstream `fasten-sources` definitions catalog (`sourceDefinitions.GetSourceDefinition`, used by `CreateReconnectSource`) by giving the instance its own owned catalog. Nothing here calls Lighthouse; the existing self-hosted relay ([#50](https://github.com/jwilleke/yourphr/issues/50)) keeps tokens off the browser.

## Roles

- **Admin** (`UserRole == "admin"`) configures catalog entries: display name, FHIR base URL, scopes, `client_id`, optional `client_secret`, brand logo, enabled flag. The admin is the one person who *does* handle credentials — once, centrally.
- **Patient** (any authenticated user) sees only **enabled** entries, as **display + id + logo** — never `client_id`/`client_secret` — and connects by id.

On a single-user self-hosted instance the admin and patient may be the same person; the separation still matters so credentials never reach the browser during a normal connect.

## Data model

`ProviderCatalogEntry` (GORM, encrypted-at-rest with the DB like `SourceCredential`):

| Field | JSON | Notes |
|---|---|---|
| `ID` | `id` | uuid (ModelBase) |
| `Display` | `display` | unique; the button label, e.g. "Connect Medicare / Blue Button" |
| `ApiEndpointBaseUrl` | `api_endpoint_base_url` | FHIR base; validated by the SSRF guard before any server-side fetch |
| `Scopes` | `scopes` | space-delimited SMART scopes |
| `ClientId` | `client_id` | **admin/CRUD responses only; redacted in the patient list** |
| `ClientSecret` | `-` | **never serialized** (`json:"-"`); DB-encrypted; confidential-client support is [#286](https://github.com/jwilleke/yourphr/issues/286) |
| `PlatformType` | `platform_type` | e.g. `ehr` |
| `BrandLogoUrl` | `brand_logo_url` | optional, for the picker |
| `Enabled` | `enabled` | patients only see enabled entries |

Responses expose `has_client_secret` (a bool derived from whether the secret is set) so the admin UI can show "confidential" without the value ever leaving the backend.

## Endpoints

Admin (gated by `UserRole == admin`):

- `POST   /api/secure/provider-catalog` — create an entry
- `GET    /api/secure/provider-catalog` — list all entries (client_id shown, secret redacted to `has_client_secret`)
- `GET    /api/secure/provider-catalog/:id` — get one
- `PUT    /api/secure/provider-catalog/:id` — update (omitting `client_secret` leaves the stored one untouched)
- `DELETE /api/secure/provider-catalog/:id` — delete

Patient (any authenticated user):

- `GET  /api/secure/provider-catalog/connectable` — enabled entries as `{id, display, brand_logo_url}` only (no credentials)
- `POST /api/secure/provider-catalog/:id/authorize` — backend loads the entry, fills `client_id`/scopes/base URL **server-side**, runs SMART discovery + PKCE, returns `{authorize_url, state, code_verifier, login_wait_seconds}`. The request body carries only `redirect_uri` (the relay callback — not a secret).
- `POST /api/secure/provider-catalog/:id/connect` — backend loads the entry, fills `client_id`/**`client_secret`**/base URL server-side, polls the relay for the code by `state`, exchanges (confidential or PKCE), resolves the patient id, stores the `SourceCredential`, starts the background sync. The request body carries only `{state, code_verifier, redirect_uri}` — **zero `client_id`/`client_secret`**.

This mirrors the existing BYO `/source/authorize` + `/source/connect` ([#51](https://github.com/jwilleke/yourphr/issues/51)) but resolves the provider config from the catalog instead of the request, so credentials stay backend-only. The BYO path stays for advanced/dev use.

## Security

- `client_secret` is sensitive credential material: `json:"-"` (never serialized to the browser), DB-encrypted at rest, never logged. Token exchange is entirely server-side via the relay; the secret never reaches the browser.
- The patient connect request contains **no** `client_id`/`client_secret` — only the catalog id, the relay `redirect_uri`, and the round-tripped `state`/`code_verifier`.
- The SSRF guard on the FHIR base URL still applies before any server-side fetch (`validatePublicHTTPSURL` at the handler, plus the `smart` client guard, [#302](https://github.com/jwilleke/yourphr/issues/302)).
- Admin-only mutation is enforced in-handler against `currentUser.Role`.

## Relationship to the upstream catalog

`CreateReconnectSource` still calls `sourceDefinitions.GetSourceDefinition` (the upstream `fasten-sources` definitions). The provider catalog is the **owned** replacement for that. Migrating the reconnect path onto the catalog — and retiring the `fasten-sources` definitions dependency — is follow-on standalone work (EPIC [#2](https://github.com/jwilleke/yourphr/issues/2)); this issue establishes the catalog + the new connect path.
