---
name: Security developer guide
description: How to write a route or manager method that authorizes, logs and fails the way this codebase requires — permissions and roles as configuration, the request context, agent tokens, the access log, outbound HTTP and PHI
dateModified: 2026-11-23
category: guides
relatedModules: [ApiContext, PolicyManager, SessionsManager, AgentTokensManager, AuditManager, DemoManager, src/http, src/log/redact]
---

# Security developer guide

What a developer has to do so that a new route or manager method authorizes, records and fails the way yourPHR requires. yourPHR holds personal health records: an unrecorded read, a leaked secret or a committed export cannot be taken back. The order every request passes through is in [api-developer-guide.md](api-developer-guide.md#what-every-request-passes-through).

## Standing rules

- The server enforces; the UI only mirrors. Every refusal is in a manager or a request guard, because the routes answer `curl` whatever the page renders.
- Every manager call that acts for someone carries an `ApiContext`, and the manager checks it: `ctx.require(permission)`, `ctx.can(permission)`, `ctx.requireAuthenticated()`, `ctx.canRead(category)`. Whose records is `ctx.username`; nothing in a request body names the account.
- A person's own records are not gated by a permission. The `user` role holds none: a person reaches only their own compartment, because every records query is scoped to `ctx.username` by the provider. Permissions gate operator actions.
- One generic refusal for every sign-in failure (`GENERIC_SIGNIN_ERROR`, "invalid username or password"), and one message once the per-account throttle trips (`THROTTLED_SIGNIN_ERROR`), whether or not the account exists (`src/framework/managers/SessionsManager.ts`).
- A 500 never carries the raw error. `serverFailure` logs it with an id and sends the id.
- No outbound request except through `src/http/`: `OutboundHttp`, `guardedFetch`, `InternalServiceHttp`, `SmtpRelay`. The SSRF guard (`src/http/ssrf.ts`) refuses internal addresses at DNS resolution, including on redirects. `npm run check:boundary` fails CI on `fetch(`, `undici`, `axios` and client imports of `node:http`, `node:https`, `node:net` or `node:dns` anywhere else in `src/`. `SPIKE_TEST_ALLOW_INTERNAL=1` lifts the guard for the harnesses only.
- Secrets never reach a log line. Values of the keys in `yourphr.config.secret-keys` are struck from every line by `src/log/redact.ts`; the boot log says how many are active and warns for any that cannot be.
- Patient data never reaches git. The rules are in [AGENTS.md](../../AGENTS.md#never-commit-personal-health-data-or-unencrypted-secrets); `npm run check:phi` (`scripts/check-no-phi.sh --all`) is the CI guard. Test credentials are generated at run time, never written as literals ([testing-and-data.md](../development/testing-and-data.md#credentials-in-tests)).

## Permissions and roles

Both are configuration, read by `PolicyManager` at boot (`src/framework/managers/PolicyManager.ts`, `src/framework/policy.ts`):

- `yourphr.auth.permissions.definitions` names each permission and what it means. A permission is `{target}-{action}`, with no scope in the name. Today: `admin-read`, `admin-system`, `user-create`, `user-read`, `user-edit`.
- `yourphr.auth.roles.definitions` maps each role to a flat, additive list of permissions. Shipped: `admin` (all five), `demo-admin` (`admin-read`), `user` (none), `anonymous` (none).
- A role that grants a permission this build does not define, or a permission name that is not `{target}-{action}`, refuses the boot. What a permission __does__ is the code's: adding a name to configuration enforces nothing.
- The role is stored per account (`auth_users.role`) and resolved through `UsersManager`; the request context gets that role's permissions.

To add a permission: add it to the definitions with a description, grant it to `admin` (and any other role that should hold it), and check it with `ctx.require('<target>-<action>')` in the manager.

## Sessions and sign-in

- A session token is HMAC-signed claims under `yourphr.auth.session.secret` (generated into `<data>/.env` on first start). The claims are the account, a session id (`sid`), the account's token generation, and the expiry times.
- __Every session has a record on the server__ ([#814](https://github.com/jwilleke/yourphr/issues/814)), in the `auth_sessions` table of the encrypted app database (`SqliteSessionsProvider`, behind `SessionsManager`). This follows ngdpbase, which keeps its sessions in a server-side store. A token is accepted only while its record exists, belongs to the same account and generation, and has not expired. So:
  - __Sign-out ends the session.__ `POST /api/auth/logout` deletes the record the token names, then clears the cookie. The same token is refused from then on, even though its signature and expiry are still good. An expired, already-ended or unsigned token still gets a cleared cookie and `200`. Ending a session needs this instance's signature on the token, so nobody can end someone else's session by guessing its id.
  - __One session at a time.__ `GET /api/secure/account/sessions` lists the caller's own live sessions (started, last renewed, expires, which one is asking). `DELETE /api/secure/account/sessions/:id` ends one of them; someone else's id is `404`. Both refuse an agent token, and ending one is refused on the shared demo account. There is no screen for these yet.
  - __Everything at once.__ A password change or "sign out everywhere" bumps the account's token generation, which ends every session; "sign out everywhere" and deleting the account also delete the records.
  - The record is the authority on expiry. A renewal moves the record's sliding expiry with the token; records past their expiry are swept at the next sign-in.
  - A token minted before #814 has no `sid` and is refused. Upgrading signs everyone out once.
  - Without a store, `SessionsManager` keeps records in memory (`MemorySessionsProvider`), so a restart signs everyone out. The harnesses use that; the app always wires the SQLite store.
- Sliding expiry (`yourphr.auth.session.sliding-seconds`) with an absolute cap (`absolute-seconds`).
- The cookie is `yourphr_session`: `HttpOnly`, `SameSite=Strict`, and `Secure` when `yourphr.web.secure-cookies` is on.
- `yourphr.auth.factors` is an __all-of__ list: every listed factor must pass.
- Passkeys (`PasskeyAuthProvider`) are on only when `yourphr.auth.passkey.enabled` is true, `yourphr.application.base-url` is https (or localhost), and the credentials store's key (`yourphr.auth.credentials.key`) is set.

## The access log and agent scopes

- `ACCESS_CATEGORIES` in `src/account/index.ts` is one list that is three things: the patient-visible access log's categories, the scopes an agent token can be given, and the labels the minting screen shows.
- `accessCategoryFor(pathname)` maps each record-reading `GET` to its category. The server records the access through `AuditManager.record` __before__ serving it; a read that cannot be recorded is refused. `npm run check:categories` fails CI on a `/api/secure/` `GET` with no category and no `EXEMPT` reason.
- An agent token (`AgentTokensManager`) is read-only: the agent gate allows only a `GET` with a category the token names. It cannot reach its own management routes. Its life is capped by `yourphr.auth.agent-token.max-ttl-hours`; there is no "never expires". Agent tokens work only while `yourphr.auth.agent-token.enabled` is on (off by default): off, minting is refused and existing tokens do not verify. An agent's read is logged under the token's own name (`ApiContext.actor`).
- A connected device's key is an agent token tied to a device grant, with its own scopes (`DEVICE_SCOPES`), which are deliberately not access categories. Its one write is `POST /api/secure/health/samples` (`writeCategoryFor`). See [devices-developer-guide.md](devices-developer-guide.md).
- Credential and account events (`CREDENTIAL_EVENT_CATEGORIES`, `ACCOUNT_EVENT_CATEGORIES`) go to the same log but are never scopes.

## Other guards

- __Demo.__ `DemoManager.refuseUnlessRead` makes the demo admin read-only by method, and refuses some reads (`DENIED_READS`, the secret reveal). See [demo-mode.md](demo-mode.md).
- __Maintenance.__ `SettingsManager.maintenanceHolds` answers 503 to signed-in requests while `yourphr.features.maintenance.enabled` is on.
- __Markdown.__ Text a person writes goes through `FilterManager`; `SecurityFilter` refuses raw HTML on save (`yourphr.filters.security.block-on-save`).
- __Headers.__ `src/security-headers.ts` sets the CSP and, when enabled, HSTS.
- __Databases on a network filesystem__ are refused at boot (`refuseNetworkFilesystem`, `src/framework/providers/sqlite-location.ts`).

## Checklist for a new route or manager method

- [ ] The manager takes `ctx` and checks a permission, or relies on `ctx.username` scoping for the caller's own data.
- [ ] A record-reading `GET` has an access category, or an `EXEMPT` reason.
- [ ] Refusals are `ApiError`s with a message a person can act on, and they do not reveal whether an account exists.
- [ ] Outbound calls go through `src/http/`.
- [ ] Any new secret is in `yourphr.config.secret-keys`.
- [ ] A test proves the refusal (401 or 403), not only the success.

## How you know you are done

- `npm run check:boundary`, `npm run check:store`, `npm run check:categories`, `npm run check:phi` pass.
- The relevant harnesses pass: `npm run auth` (which includes "a token is refused after sign-out", [#814](https://github.com/jwilleke/yourphr/issues/814)), `npm run agent-tokens`, `npm run ssrf`.
- When you change how records are scoped to an account, also run `npm run isolation -- --db <copy of a database> --a <user> --b <user>`. It needs a database holding two accounts and is not in CI.

## See also

- [architecture/agent-access-policy.md](../architecture/agent-access-policy.md): agent tokens, MCP and their threat model
- [planning/architecture-security-review.md](../planning/architecture-security-review.md): the security review and backlog
- [SECURITY.md](../../SECURITY.md): reporting a vulnerability

## Known gaps

- There is no write scope for ordinary agent tokens (`yourphr.auth.agent-token.read-only` is true and no write route has a category); only a device grant can write, and only health samples.
- Operator actions (setting, resetting or revealing a configuration value, maintenance mode) are written to the server log by `SettingsManager`, not to an audit trail of their own; an operator audit log ([#840](https://github.com/jwilleke/yourphr/issues/840)) was closed as not planned.
- [architecture/architecture.md](../architecture/architecture.md#security-posture) names the "default HS256 JWT signing key" ([#102](https://github.com/jwilleke/yourphr/issues/102)) as the dominant residual risk. The TypeScript server issues no JWTs: sessions are HMAC-signed under `yourphr.auth.session.secret`, which is generated per instance on first start.
