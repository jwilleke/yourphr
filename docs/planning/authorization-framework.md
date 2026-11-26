# Auth framework — plan and source of truth

> __Status: the source of truth for YourPHR's auth plan__ (Jim, 2026-09-30). It covers both halves: __authentication__ (proving who someone is: sign-in, second factors, device and agent credentials) and __authorization__ (what an identified caller may do). The separate `authentication-framework.md` was folded in here and deleted (2026-09-30). Started 2026-08-13; rewritten 2026-09-30 for the TypeScript stack. The Go-era text is in git history.
>
> __Authentication decisions live in ngdpbase.__ Since 2026-10-02 the decided authentication design — factors and their `amr` / `aal` / `acr`, per-role `required-aal`, step-up, the approval page, device grants, the authorization server — is recorded once, in ngdpbase's [authentication plan](https://github.com/jwilleke/ngdpbase/blob/master/docs/planning/authentication.md). This document does not restate it: it says what YourPHR ports, under which `yourphr.` keys, and what is YourPHR's own.
>
> __Coordinated with ngdpbase.__ ngdpbase is the framework, and YourPHR runs on its model: managers are the only door, providers are bound by configuration, and ported pieces keep ngdpbase's names and config meanings under the `yourphr.` prefix. Every capability below says where it lives today, which repository builds it first, and what flows back. See [Coordination with ngdpbase](#coordination-with-ngdpbase).

## Scope

- __In scope:__ sign-in, sessions and revocation, factors (password, passkey, TOTP, email link, Twilio Verify, Web Push), step-up re-authentication, sign-in audit, delegated credentials (agent tokens, connected devices), the RFC 8628 device flow, roles and permissions, and the UI projection of permissions.
- __Kept apart, deliberately:__ the two halves stay in separate managers. Authentication *reports* who the caller is; authorization *decides*. One "auth manager" that does both decides everything and explains nothing.
- __Out of scope: per-user data isolation.__ Records are scoped to their owner by the repository (`user_id`), not by a permission. Modelling row ownership as permissions is how RBAC systems turn into query planners.
- __Out of scope: SMART on FHIR source-connect.__ There YourPHR is an OAuth *client* fetching from Epic or Cerner. Sign-in identity (OIDC) and device authorization (RFC 8628) are the opposite direction. They are named apart from the first commit so nobody wires one into the other.

## Where we are today (TypeScript stack, v3.12.0)

| Piece | Where | What it does |
|---|---|---|
| `SessionsManager` | [src/framework/managers/SessionsManager.ts](../../src/framework/managers/SessionsManager.ts) | The one door to sessions. Throttles per account and per IP before verifying ([#509](https://github.com/jwilleke/yourphr/issues/509), [#529](https://github.com/jwilleke/yourphr/issues/529)). Runs every factor in `yourphr.auth.factors` (ALL-OF). One generic refusal ([#104](https://github.com/jwilleke/yourphr/issues/104)). HMAC-signed claims carrying the token generation, so a password change or sign-out-everywhere ends live sessions ([#528](https://github.com/jwilleke/yourphr/issues/528)). A server-side record per session (`auth_sessions`), so sign-out ends that one session ([#814](https://github.com/jwilleke/yourphr/issues/814)). Sliding TTL with an absolute cap ([#445](https://github.com/jwilleke/yourphr/issues/445)). |
| `BaseAuthProvider`, `PasswordAuthProvider` | [src/framework/providers/](../../src/framework/providers/) | A provider returns a *result* (subject, provider, factors, issuedAt, token generation), never a boolean, and never mints a session. Unknown accounts still cost a real verification. Upgrade-on-login rehash. |
| `UsersManager` | [src/framework/managers/UsersManager.ts](../../src/framework/managers/UsersManager.ts) | Accounts, role, password policy ([#506](https://github.com/jwilleke/yourphr/issues/506)), bootstrap admin ([#504](https://github.com/jwilleke/yourphr/issues/504)), recovery ([#510](https://github.com/jwilleke/yourphr/issues/510)), admin reset ([#511](https://github.com/jwilleke/yourphr/issues/511)), account email ([#792](https://github.com/jwilleke/yourphr/issues/792)). The password hash is a column on `auth_users`. |
| `PolicyManager` | [src/framework/managers/PolicyManager.ts](../../src/framework/managers/PolicyManager.ts) | Roles and permissions as configuration (`yourphr.auth.roles.definitions`, `yourphr.auth.permissions.definitions`, [#623](https://github.com/jwilleke/yourphr/issues/623)). What a permission *means* is code; a role naming an unknown permission refuses the boot. One list serves both the admin screen and the check. |
| `ApiContext` | [src/framework/ApiContext.ts](../../src/framework/ApiContext.ts) | Request-scoped caller: `can(permission)`, `require(permission)` (401/403), `canRead(category)` for agent scopes, and `actor` naming who really asked. |
| Demo-admin guard | server | The `demo-admin` role holds `admin-read` only, and the server refuses every write for that role by default ([#644](https://github.com/jwilleke/yourphr/issues/644), [#514](https://github.com/jwilleke/yourphr/issues/514)). |
| `AgentTokensManager` | [src/framework/managers/AgentTokensManager.ts](../../src/framework/managers/AgentTokensManager.ts) | Patient-minted credentials for AI clients and scripts ([#695](https://github.com/jwilleke/yourphr/issues/695)), ported from ngdpbase after its #1108 review. Scopes are *access categories*, so a surface that cannot be logged cannot be scoped. Read-only by construction. Minting, renewing and revoking need the owner's session. Renewal re-mints. |
| `AuditManager` | [src/framework/managers/AuditManager.ts](../../src/framework/managers/AuditManager.ts) | The patient-visible access log ([#614](https://github.com/jwilleke/yourphr/issues/614)). Required capability: a read that cannot be logged fails. It records *reads of records*, not sign-ins. |
| Mail and notices | `EmailManager`, `NotificationManager` | Outbound mail is live ([#536](https://github.com/jwilleke/yourphr/issues/536)), so email-delivered factors are no longer blocked on infrastructure. |

__Not built:__ any second factor; step-up re-authentication; a sign-in record; credentials other than one password per account; the RFC 8628 device flow; write scopes for delegated credentials; the client-side permission projection.

## ngdpbase today

Read 2026-09-30 from [ngdpbase `src/managers/AuthManager.ts`](https://github.com/jwilleke/ngdpbase/blob/master/src/managers/AuthManager.ts) and [`src/providers/BaseAuthProvider.ts`](https://github.com/jwilleke/ngdpbase/blob/master/src/providers/BaseAuthProvider.ts):

- __AuthManager is a provider chain.__ `registerProvider()` is the one path for built-ins and addons ([ngdpbase#1050](https://github.com/jwilleke/ngdpbase/issues/1050)). First registration wins, so an addon cannot replace `password` with its own `verify()`. There is deliberately no `unregisterProvider()`, because withdrawing a provider does not revoke the sessions it established.
- __Providers shipped:__ password, magic link, Google OIDC, Cloudflare Access, Authentik bearer, agent token. Each is gated on its own `ngdpbase.auth.<id>.enabled` key and refuses to register when its required config is missing.
- __Flow plumbing YourPHR lacks:__ `initiate()`, `startFlow()` for redirects, `getFlowRedirect()`, `consumeToken()` as the single-use gate ([ngdpbase#1021](https://github.com/jwilleke/ngdpbase/issues/1021)), `getDeviceState()` binding a link to the browser that asked for it ([ngdpbase#1022](https://github.com/jwilleke/ngdpbase/issues/1022)), `provisionIfNew()` ([ngdpbase#1026](https://github.com/jwilleke/ngdpbase/issues/1026)), and per-user `allowedAuthMethods`.
- __Magic link__ refuses to register unless `base-url` is set explicitly ([ngdpbase#642](https://github.com/jwilleke/ngdpbase/issues/642)), because a link to localhost leaks the credential.
- __Factors:__ `ngdpbase.auth.required-factors` is declared, but only one factor is used. The replacement is decided, not built: see [Factors](#factors).
- __Planned, not built:__ passkeys ([ngdpbase#448](https://github.com/jwilleke/ngdpbase/issues/448), P1) and TOTP ([ngdpbase#421](https://github.com/jwilleke/ngdpbase/issues/421), P2), no longer `deferred` (2026-10-01). RFC 8628 ([ngdpbase#1526](https://github.com/jwilleke/ngdpbase/issues/1526)) and UserInfo ([ngdpbase#1529](https://github.com/jwilleke/ngdpbase/issues/1529)) come from the [oidc-auth-server](https://github.com/jwilleke/oidc-auth-server) package (see [RFC 8628 device authorization](#rfc-8628-device-authorization)).
- __Authorization:__ `UserManager.hasPermission()` → `PolicyEvaluator`, `ACLManager` for per-page ACLs, and the agent-token scope ceiling applied at a second enforcement point (`UserManager.ts:678`).

## Coordination with ngdpbase

The rule is __ngdpbase first__: a new auth capability is designed and built in ngdpbase, then ported. It is built in YourPHR first only when YourPHR has the concrete need and ngdpbase does not. Even then it is written to ngdpbase's contract and offered back (the "what flows the other way" list in [`ngdp-move.md`](ngdp-move.md)). No new Manager or provider is created in either repository without asking first.

| Capability | ngdpbase | YourPHR | Builds first | Flows back |
|---|---|---|---|---|
| Provider registry (`registerProvider`, first-wins) | built | own `BaseAuthProvider` + `yourphr.auth.providers` | ngdpbase (done) | — YourPHR converges on it |
| Provider result contract (subject, factors, issuedAt, token generation) | `AuthResult {username, viaToken}` | richer result | YourPHR (done) | yes: `factors` and `issuedAt` are what step-up and "how was this session established" need |
| Factor configuration: `amr` / `aal` / `acr` per provider, `required-aal` per role ([ngdpbase#1523](https://github.com/jwilleke/ngdpbase/issues/1523)) | single factor | ALL-OF list | __ngdpbase__ | — |
| Credentials store ([ngdpbase#1524](https://github.com/jwilleke/ngdpbase/issues/1524)) | `allowedAuthMethods` on user | password column | __ngdpbase__ (passkeys need it) | — |
| Passkeys / WebAuthn | [ngdpbase#448](https://github.com/jwilleke/ngdpbase/issues/448) P1 | none | __ngdpbase__ | — |
| TOTP | [ngdpbase#421](https://github.com/jwilleke/ngdpbase/issues/421) P2 | none | __ngdpbase__ | — |
| Email link (`email-link`: the magic link, as sign-in or second factor) | built as sign-in, with device binding and single-use gate | none | ngdpbase (done) | port |
| Email link as a second factor, into the approval page ([ngdpbase#1527](https://github.com/jwilleke/ngdpbase/issues/1527), [ngdpbase#1532](https://github.com/jwilleke/ngdpbase/issues/1532)) | magic link only | none | __ngdpbase__ | — |
| Twilio Verify auth provider ([ngdpbase#1528](https://github.com/jwilleke/ngdpbase/issues/1528)) | none | none | __ngdpbase__, off by default | — |
| Web Push auth provider ([ngdpbase#1550](https://github.com/jwilleke/ngdpbase/issues/1550)) | none | none | __ngdpbase__ | — |
| Sign-in channels as a person's preference ([ngdpbase#1533](https://github.com/jwilleke/ngdpbase/issues/1533)); SMS/RCS transports ([ngdpbase#1549](https://github.com/jwilleke/ngdpbase/issues/1549)) | none | none | __ngdpbase__ | — |
| Step-up re-authentication ([ngdpbase#1525](https://github.com/jwilleke/ngdpbase/issues/1525)) | none | none | __ngdpbase__ | — |
| Sign-in record | logger lines | none | either; YourPHR's needs patient visibility | the patient-visible shape |
| RFC 8628 device authorization ([ngdpbase#1526](https://github.com/jwilleke/ngdpbase/issues/1526)) | none | device grants without RFC 8628 ([#808](https://github.com/jwilleke/yourphr/issues/808)); required by [#314](https://github.com/jwilleke/yourphr/issues/314) | __[oidc-auth-server](https://github.com/jwilleke/oidc-auth-server)__ package | — |
| Agent tokens | built ([ngdpbase#946](https://github.com/jwilleke/ngdpbase/issues/946), #1108) | ported | ngdpbase (done) | category-scopes idea |
| Roles and permissions as config | two lists kept in sync by a comment ([ngdpbase#713](https://github.com/jwilleke/ngdpbase/issues/713)) | one list, boot refuses unknown names | YourPHR (done) | yes: the one-list fix |
| Current-user endpoint: OIDC UserInfo ([ngdpbase#1529](https://github.com/jwilleke/ngdpbase/issues/1529)) | none (server-rendered) | `/api/secure/account/me`, home-grown | __[oidc-auth-server](https://github.com/jwilleke/oidc-auth-server)__ package | — |
| Step-up as a list of permissions, session idle timeout ([ngdpbase#1525](https://github.com/jwilleke/ngdpbase/issues/1525), [ngdpbase#1546](https://github.com/jwilleke/ngdpbase/issues/1546)) | none | sliding TTL ([#445](https://github.com/jwilleke/yourphr/issues/445)) | __ngdpbase__ | — |

## Authentication plan

### Invariants (carried forward, still true)

- __A provider proves identity and never mints a session.__ Only `SessionsManager` issues session tokens. That is where the throttle, the audit line and `last_login` live.
- __A failed factor is a failed sign-in.__ A provider never falls through to another. "Any one of" is a policy the manager evaluates over *enrolled* factors, not a loop that tries providers until one says yes.
- __Delegated credentials carry scopes, never roles.__ Authority is resolved live from the account, so no credential holds a snapshot of it (ngdpbase's `ViaToken`).
- __Links never grant anything on their own.__ A link opens a page; the grant needs the signed-in patient to act on that page (the [#314](https://github.com/jwilleke/yourphr/issues/314) rule).

### Factors

Decided in ngdpbase: [the configuration shape](https://github.com/jwilleke/ngdpbase/blob/master/docs/planning/authentication.md#the-configuration-shape-decided) and [build order](https://github.com/jwilleke/ngdpbase/blob/master/docs/planning/authentication.md#build-order). YourPHR ports them as they are, under `yourphr.auth.factors` and per-role `required-aal`. In short, pointing there for the detail:

- Every factor is a registered `AuthProvider` with `amr`, `aal` and, where phishing-resistant, `acr` (`phr`, `phrh`), declared in code; config may lower them, never raise them. There is __no factor count and no priority__; this replaces both YourPHR's ALL-OF `yourphr.auth.factors` and the per-provider `auth-factors` count proposed on 2026-09-30.
- What a sign-in must reach is set __per role__ as `required-aal` (admin AAL2; patient roles AAL1). MFA means two or more distinct factor types (know / have / are).
- A passkey alone signs a person in. Its RP ID is the host of `yourphr.application.base-url`, and passkeys stay off until that is set.
- Email never lifts a sign-in above AAL1. A message second factor carries __one link, no code__, opening the approval page with Approve and Deny buttons ([ngdpbase#1532](https://github.com/jwilleke/ngdpbase/issues/1532)).
- SMS codes are Twilio Verify, an auth provider ([ngdpbase#1528](https://github.com/jwilleke/ngdpbase/issues/1528)); which channel carries a link or notice is the __patient's preference__ ([ngdpbase#1533](https://github.com/jwilleke/ngdpbase/issues/1533)), replacing the [#314](https://github.com/jwilleke/yourphr/issues/314) rule that SMS never carries notices.
- A known device skips the prompt for a while; it is a policy, not a factor. Recovery words are for account recovery only, never a factor.
- A factor is off until it is truly available; the server refuses to boot only when a role's `required-aal` cannot be reached by any available factor.

### Credentials table

Passkeys need more than one credential per account (a phone and a laptop), and so does "password plus TOTP". The password column on `auth_users` cannot hold that. The shape carried from the earlier authentication doc, which activescott/auth's `IdentityStore` validates:

```text
credentials
  id            text      -- uuid
  username      text      -> auth_users.username
  kind          text      -- password | passkey | totp | email | sms
  subject       text      -- credential id, phone number, address
  secret        text      -- hash, public key, TOTP seed (encrypted), or empty
  label         text      -- "Jim's iPhone"
  created_at    text      -- RFC 3339 with offset
  last_used_at  text
  UNIQUE (kind, subject)
```

Migration: one `password` row per account from `auth_users.password_hash`. The column is dropped a release later. Built in ngdpbase first, where `allowedAuthMethods` is its present equivalent.

### Step-up re-authentication

Decided in ngdpbase ([ngdpbase#1525](https://github.com/jwilleke/ngdpbase/issues/1525)): step-up is __one gate inside the permission check__, configured as a list of permissions (`yourphr.auth.step-up`: `max-age-minutes`, default 5, and `permissions`). A permission on the list needs a factor satisfied within that window, at least the role's `required-aal`, never a known device or delegated credential. YourPHR lists its equivalents of ngdpbase's `profile-manage` (password, email, credentials, approving a device, downloading the database), `config-manage`, `secret-reveal` and `token-mint`. Agent-token secrets are stored as one-way hashes and are shown once, never revealed. The provider result already reports which factors were satisfied and when, and they go into the session claims.

### Sign-in record

Part of [#507](https://github.com/jwilleke/yourphr/issues/507). Every sign-in, failed sign-in, credential change and device approval is recorded and __visible to the patient__, beside the access log. It is not a new manager: `AuditManager` gains an account-event kind. There is an optional "new sign-in" email through `NotificationManager`. Retention is decided before it ships (ngdpbase keeps audit by `ngdpbase.audit.retentiondays`; YourPHR still decides its own) (IPs were kept out of [#512](https://github.com/jwilleke/yourphr/issues/512) for the same reason).

### RFC 8628 device authorization

Required by [#314](https://github.com/jwilleke/yourphr/issues/314) (Jim, 2026-09-30): scales and devices with a screen but no keyboard. Build it once, as a shared capability serving three callers:

1. __Connected devices__ ([#314](https://github.com/jwilleke/yourphr/issues/314)): the device shows a short user code and a URL/QR. The patient signs in on their phone, sees what the device is asking for, and approves.
2. __AI and MCP clients__ ([#657](https://github.com/jwilleke/yourphr/issues/657)): obtain an agent token without the patient copying a secret between windows.
3. __Command-line tools.__

Rules (decided in ngdpbase, 2026-10-02; [ngdpbase#1526](https://github.com/jwilleke/ngdpbase/issues/1526)):

- The authorization server is the [oidc-auth-server](https://github.com/jwilleke/oidc-auth-server) package, a thin wrapper around node-oidc-provider. `SessionsManager` keeps sign-in; the package issues and checks tokens. It also serves OIDC UserInfo for [#804](https://github.com/jwilleke/yourphr/issues/804).
- The approval page runs step-up; a passkey prompt makes the approval phishing-resistant.
- The grant's scopes are a ceiling, never roles. __Scope names come from the host__: YourPHR uses SMART on FHIR v2 scopes as they are, so a wearable bridge gets `patient/Observation.c` (create only: it cannot read, change or delete).
- User codes are short-lived and single-use, and polling is rate-limited per RFC 8628 §3.5 (`slow_down`).
- The client is the phone's health app or a home bridge, not the sensor. A device grant __lasts until revoked__, not for a 30-day term: data from scales and watches flows for years. Refresh tokens rotate where the client supports them; a long-lived token is accepted where it cannot.
- Scope is add-only, the grant pauses after 90 days without an upload, and it is revocable from the profile and audited.

Built in the package first, used by ngdpbase, then by YourPHR. [#314](https://github.com/jwilleke/yourphr/issues/314)'s PR 4 is blocked by it. The device grant already built ([#808](https://github.com/jwilleke/yourphr/issues/808), [#809](https://github.com/jwilleke/yourphr/issues/809)) still has the 30-day term and the 14-day suspension; changing those is [#860](https://github.com/jwilleke/yourphr/issues/860) (until revoked), [#861](https://github.com/jwilleke/yourphr/issues/861) (90 days) and [#862](https://github.com/jwilleke/yourphr/issues/862) (SMART v2 scope names).

### activescott/auth

[activescott/auth](https://github.com/activescott/auth) (MIT, v5.7.0) is passwordless-only and in production at fernfiles.com. It has passkeys, email and SMS codes, magic links, identity linking, and separate identity, user and challenge stores.

__Recommendation:__ take ideas and at most its passkey provider. Do not take its JWT session layer. `SessionsManager` already owns sessions with revocation that works, and two session systems is the bug the managers exist to prevent. For WebAuthn itself, the choice is between `@activescott/auth-provider-passkey` and `@simplewebauthn/server`. That choice is made in [ngdpbase#448](https://github.com/jwilleke/ngdpbase/issues/448), not here.

## Authorization plan

### Settled

- Permissions are actions, named `resource-action` (ngdpbase's convention; `admin-read`, `user-edit`). What a permission means is code; which role holds it is configuration. An unknown name refuses the boot.
- The server context (`ApiContext`) is request-scoped and authoritative. Any client copy is session-scoped and advisory: it decides what to draw and nothing else.
- Default deny: a route with no declared permission is refused ([#514](https://github.com/jwilleke/yourphr/issues/514)).
- Delegated scopes are a __ceiling__ on the owner, never a grant. Agent-token scopes are access categories.
- Per-user isolation stays in the repository layer.
- No permissions in session tokens; they are resolved live per request, and the token generation forces a refresh when authority changes.
- No wildcards. A role that needs everything lists everything, so a diff shows what changed.

### Open

- ~~__Client projection.__~~ Decided (Jim, 2026-09-30): use the OpenID Connect UserInfo endpoint (OIDC Core 1.0 §5.3), not a home-grown `/account/me`. The caller's permissions go in as a private claim; the list is advisory. Built in [ngdpbase#1529](https://github.com/jwilleke/ngdpbase/issues/1529), adopted in [#804](https://github.com/jwilleke/yourphr/issues/804).
- __Route coverage test.__ A test that walks the registered routes and asserts each one declares a permission or is explicitly public. This makes an unmapped route a build failure rather than a runtime refusal. It is the highest-value single test in the design.
- __Denials audited?__ Same retention question as the sign-in record. Decide both together.
- __Subjects other than the caller__ (caregiver or parent acting on another person's records). This changes `can(p)` to `can(p, subject)` and is a redesign, not an addition. Not needed now.
- ~~__Write scopes__ for delegated credentials.~~ Decided (2026-10-02): device grants use SMART on FHIR v2 scope names (see RFC 8628 above).
- __CLI.__ `reset-password` and friends bypass HTTP ([#510](https://github.com/jwilleke/yourphr/issues/510)). Shell access is already total authority. Record that as the stated position.

## Decisions log

- 2026-08-12: "webconnect" meant WebAuthn / passkeys. Password policy is configuration, enforced server-side, never at sign-in.
- 2026-09-30 (Jim): this document is the single source of truth for the auth plan, and the work is coordinated with ngdpbase.
- 2026-09-30 (Jim): email magic links and codes, and SMS codes, are viable additional sign-in factors.
- 2026-09-30 (Jim): YourPHR needs RFC 8628 device authorization, from [#314](https://github.com/jwilleke/yourphr/issues/314).
- 2026-09-30 (Jim): the ngdpbase phases are filed there, under the epic [ngdpbase#1522](https://github.com/jwilleke/ngdpbase/issues/1522). Factor counts are per-provider configuration, and every factor is an `AuthProvider` ([ngdpbase#1523](https://github.com/jwilleke/ngdpbase/issues/1523)).
- 2026-09-30 (Jim): "who is this caller" uses the OIDC UserInfo standard ([ngdpbase#1529](https://github.com/jwilleke/ngdpbase/issues/1529), [#804](https://github.com/jwilleke/yourphr/issues/804)).
- 2026-10-02 (Jim): the authentication design is decided in ngdpbase's [authentication plan](https://github.com/jwilleke/ngdpbase/blob/master/docs/planning/authentication.md), and YourPHR follows it. That replaces the per-provider `auth-factors` count, email and SMS codes, the 30-day device term and the 14-day suspension recorded above. The authorization server is the [oidc-auth-server](https://github.com/jwilleke/oidc-auth-server) package; device scopes are SMART on FHIR v2.

## Awaiting decision

Asked one at a time, in this order:

- ~~Where RFC 8628 is built first.~~ ngdpbase: [ngdpbase#1526](https://github.com/jwilleke/ngdpbase/issues/1526) (Jim, 2026-09-30), now through the oidc-auth-server package.
- ~~Second-factor order.~~ ngdpbase's [build order](https://github.com/jwilleke/ngdpbase/blob/master/docs/planning/authentication.md#build-order) (2026-10-02).
- ~~Passkey-alone sign-in.~~ Yes, from day one, as NIST specifies (2026-10-02).
- __Sign-in record retention__ and whether denials are recorded with it.
- ~~Un-defer ngdpbase#448 and #421.~~ Done (2026-10-01).

## Sequencing

Each phase is its own issue, linked by blocked-by and never a checklist inside one issue. The ngdpbase issues sit under the epic [ngdpbase#1522](https://github.com/jwilleke/ngdpbase/issues/1522) with real sub-issue and blocked-by relations. The ngdpbase phases come first, and each YourPHR phase is blocked by its ngdpbase counterpart.

| Phase | Repository | Work | Blocked by |
|---|---|---|---|
| A1 | ngdpbase | [ngdpbase#1523](https://github.com/jwilleke/ngdpbase/issues/1523) factor configuration and per-role `required-aal`; [ngdpbase#1524](https://github.com/jwilleke/ngdpbase/issues/1524) credentials store | — |
| A2 | ngdpbase | Passkey provider ([ngdpbase#448](https://github.com/jwilleke/ngdpbase/issues/448)) | A1 |
| A3 | ngdpbase | [ngdpbase#1525](https://github.com/jwilleke/ngdpbase/issues/1525) step-up re-authentication; factors and issuedAt in the provider result | A1 |
| A4 | ngdpbase | [ngdpbase#1526](https://github.com/jwilleke/ngdpbase/issues/1526) RFC 8628 device authorization, through the oidc-auth-server package | A3 |
| A5 | ngdpbase | TOTP ([ngdpbase#421](https://github.com/jwilleke/ngdpbase/issues/421)); [ngdpbase#1527](https://github.com/jwilleke/ngdpbase/issues/1527) email link; [ngdpbase#1528](https://github.com/jwilleke/ngdpbase/issues/1528) Twilio Verify, off by default; [ngdpbase#1550](https://github.com/jwilleke/ngdpbase/issues/1550) Web Push | A1 |
| Y1 | YourPHR | Port A1: credentials table and migration; `yourphr.auth.factors` becomes the policy | A1 |
| Y2 | YourPHR | Sign-in record in the access log, with optional new-sign-in email ([#507](https://github.com/jwilleke/yourphr/issues/507)) | — |
| Y3 | YourPHR | Port passkeys and step-up; re-auth on DB download and secret reveal | Y1, A2, A3 |
| Y4 | YourPHR | Port RFC 8628; [#314](https://github.com/jwilleke/yourphr/issues/314) PR 4 and agent-token onboarding use it | Y3, A4 |
| Y5 | YourPHR | Port email link, TOTP, Twilio Verify, Web Push | Y1, A5 |
| Z1 | YourPHR | [#804](https://github.com/jwilleke/yourphr/issues/804) OIDC UserInfo in place of `/api/secure/account/me`, with the permission claim; `IsAdmin()` deleted | [ngdpbase#1529](https://github.com/jwilleke/ngdpbase/issues/1529) |
| Z2 | YourPHR | Route coverage test: every route declares a permission or is explicitly public | — |

Y2 and Z2 depend on nothing in ngdpbase and can start at once.

## Related

- [#507](https://github.com/jwilleke/yourphr/issues/507) — authentication policy survey (MFA, re-auth, sign-in audit)
- [#314](https://github.com/jwilleke/yourphr/issues/314) — connected devices; needs RFC 8628 and write scopes. [Review](2026-09-30-yourphr-314-device-review.md)
- [Design note: device write scope and consent grant](2026-09-30-device-write-scope-and-consent-grant.md) — [#807](https://github.com/jwilleke/yourphr/issues/807)
- [#657](https://github.com/jwilleke/yourphr/issues/657) — MCP server; agent-token onboarding
- [#695](https://github.com/jwilleke/yourphr/issues/695) — agent tokens
- [#508](https://github.com/jwilleke/yourphr/issues/508), [#528](https://github.com/jwilleke/yourphr/issues/528) — token generation and revocation
- [#514](https://github.com/jwilleke/yourphr/issues/514), [#644](https://github.com/jwilleke/yourphr/issues/644) — default deny; the read-only demo admin
- [#623](https://github.com/jwilleke/yourphr/issues/623) — roles and permissions as configuration
- ngdpbase: [authentication plan](https://github.com/jwilleke/ngdpbase/blob/master/docs/planning/authentication.md), [AuthManager](https://github.com/jwilleke/ngdpbase/blob/master/src/managers/AuthManager.ts), [#448 passkeys](https://github.com/jwilleke/ngdpbase/issues/448), [#421 TOTP](https://github.com/jwilleke/ngdpbase/issues/421), [#946 agent tokens](https://github.com/jwilleke/ngdpbase/issues/946)
- [activescott/auth](https://github.com/activescott/auth)
- NIST SP 800-63B; RFC 8628; WebAuthn Level 3
