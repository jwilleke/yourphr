# Auth framework — plan and source of truth

> __Status: the source of truth for YourPHR's auth plan__ (Jim, 2026-09-30). It covers both halves: __authentication__ (proving who someone is: sign-in, second factors, device and agent credentials) and __authorization__ (what an identified caller may do). The separate `authentication-framework.md` was folded in here and deleted (2026-09-30). Started 2026-08-13; rewritten 2026-09-30 for the TypeScript stack. The Go-era text is in git history.
>
> __Coordinated with ngdpbase.__ ngdpbase is the framework, and YourPHR runs on its model: managers are the only door, providers are bound by configuration, and ported pieces keep ngdpbase's names and config meanings under the `yourphr.` prefix. Every capability below says where it lives today, which repository builds it first, and what flows back. See [Coordination with ngdpbase](#coordination-with-ngdpbase).

## Scope

- __In scope:__ sign-in, sessions and revocation, factors (password, passkey, TOTP, email code/link, SMS code), step-up re-authentication, sign-in audit, delegated credentials (agent tokens, connected devices), the RFC 8628 device flow, roles and permissions, and the UI projection of permissions.
- __Kept apart, deliberately:__ the two halves stay in separate managers. Authentication *reports* who the caller is; authorization *decides*. One "auth manager" that does both decides everything and explains nothing.
- __Out of scope: per-user data isolation.__ Records are scoped to their owner by the repository (`user_id`), not by a permission. Modelling row ownership as permissions is how RBAC systems turn into query planners.
- __Out of scope: SMART on FHIR source-connect.__ There YourPHR is an OAuth *client* fetching from Epic or Cerner. Sign-in identity (OIDC) and device authorization (RFC 8628) are the opposite direction. They are named apart from the first commit so nobody wires one into the other.

## Where we are today (TypeScript stack, v3.12.0)

| Piece | Where | What it does |
|---|---|---|
| `SessionsManager` | [src/framework/managers/SessionsManager.ts](../../src/framework/managers/SessionsManager.ts) | The one door to sessions. Throttles per account and per IP before verifying ([#509](https://github.com/jwilleke/yourphr/issues/509), [#529](https://github.com/jwilleke/yourphr/issues/529)). Runs every factor in `yourphr.auth.factors` (ALL-OF). One generic refusal ([#104](https://github.com/jwilleke/yourphr/issues/104)). HMAC-signed claims carrying the token generation, so a password change or sign-out-everywhere ends live sessions ([#528](https://github.com/jwilleke/yourphr/issues/528)). Sliding TTL with an absolute cap ([#445](https://github.com/jwilleke/yourphr/issues/445)). |
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
- __Factors:__ `ngdpbase.auth.required-factors` is declared, but only one factor is used. MFA state is "deferred to a future issue".
- __Planned, not built:__ TOTP ([ngdpbase#421](https://github.com/jwilleke/ngdpbase/issues/421)) and passkeys ([ngdpbase#448](https://github.com/jwilleke/ngdpbase/issues/448)), both open and labelled `deferred`. No RFC 8628 device flow; [ngdpbase `docs/fernfiles.md`](https://github.com/jwilleke/ngdpbase/blob/master/docs/fernfiles.md) notes that fernfiles plans one for agents.
- __Authorization:__ `UserManager.hasPermission()` → `PolicyEvaluator`, `ACLManager` for per-page ACLs, and the agent-token scope ceiling applied at a second enforcement point (`UserManager.ts:678`).

## Coordination with ngdpbase

The rule is __ngdpbase first__: a new auth capability is designed and built in ngdpbase, then ported. It is built in YourPHR first only when YourPHR has the concrete need and ngdpbase does not. Even then it is written to ngdpbase's contract and offered back (the "what flows the other way" list in [`ngdp-move.md`](ngdp-move.md)). No new Manager or provider is created in either repository without asking first.

| Capability | ngdpbase | YourPHR | Builds first | Flows back |
|---|---|---|---|---|
| Provider registry (`registerProvider`, first-wins) | built | own `BaseAuthProvider` + `yourphr.auth.providers` | ngdpbase (done) | — YourPHR converges on it |
| Provider result contract (subject, factors, issuedAt, token generation) | `AuthResult {username, viaToken}` | richer result | YourPHR (done) | yes: `factors` and `issuedAt` are what step-up and "how was this session established" need |
| Factor policy: per-provider `auth-factors` ([ngdpbase#1523](https://github.com/jwilleke/ngdpbase/issues/1523)) | single factor | ALL-OF list | __ngdpbase__ | — |
| Credentials store ([ngdpbase#1524](https://github.com/jwilleke/ngdpbase/issues/1524)) | `allowedAuthMethods` on user | password column | __ngdpbase__ (passkeys need it) | — |
| Passkeys / WebAuthn | [ngdpbase#448](https://github.com/jwilleke/ngdpbase/issues/448) deferred | none | __ngdpbase__ | — |
| TOTP | [ngdpbase#421](https://github.com/jwilleke/ngdpbase/issues/421) deferred | none | __ngdpbase__ | — |
| Email magic link | built, with device binding and single-use gate | none | ngdpbase (done) | port, as sign-in and as a second-factor code |
| Email code as a second factor ([ngdpbase#1527](https://github.com/jwilleke/ngdpbase/issues/1527)) | magic link only | none | __ngdpbase__ | — |
| SMS code ([ngdpbase#1528](https://github.com/jwilleke/ngdpbase/issues/1528)) | none | none | __ngdpbase__, transport off by default | — |
| Step-up re-authentication ([ngdpbase#1525](https://github.com/jwilleke/ngdpbase/issues/1525)) | none | none | __ngdpbase__ | — |
| Sign-in record | logger lines | none | either; YourPHR's needs patient visibility | the patient-visible shape |
| RFC 8628 device authorization ([ngdpbase#1526](https://github.com/jwilleke/ngdpbase/issues/1526)) | none (fernfiles plans one) | none; required by [#314](https://github.com/jwilleke/yourphr/issues/314) | __ngdpbase__ | — |
| Agent tokens | built ([ngdpbase#946](https://github.com/jwilleke/ngdpbase/issues/946), #1108) | ported | ngdpbase (done) | category-scopes idea; write scopes inside a consent grant |
| Roles and permissions as config | two lists kept in sync by a comment ([ngdpbase#713](https://github.com/jwilleke/ngdpbase/issues/713)) | one list, boot refuses unknown names | YourPHR (done) | yes: the one-list fix |
| Current-user endpoint: OIDC UserInfo ([ngdpbase#1529](https://github.com/jwilleke/ngdpbase/issues/1529)) | none (server-rendered) | `/api/secure/account/me`, home-grown | __ngdpbase__ | — |

__Consequence for sequencing:__ ngdpbase#448 and #421 stop being `deferred` once YourPHR commits to second factors. Filing the matching YourPHR issues without moving those two would create work with no place to happen.

## Authentication plan

### Invariants (carried forward, still true)

- __A provider proves identity and never mints a session.__ Only `SessionsManager` issues session tokens. That is where the throttle, the audit line and `last_login` live.
- __A failed factor is a failed sign-in.__ A provider never falls through to another. "Any one of" is a policy the manager evaluates over *enrolled* factors, not a loop that tries providers until one says yes.
- __Delegated credentials carry scopes, never roles.__ Authority is resolved live from the account, so no credential holds a snapshot of it (ngdpbase's `ViaToken`).
- __Links never grant anything on their own.__ A link opens a page; the grant needs the signed-in patient to act on that page (the [#314](https://github.com/jwilleke/yourphr/issues/314) rule).

### Factors

| Factor | Assurance | Position | Notes |
|---|---|---|---|
| Password | memorised secret | exists | Policy is [#506](https://github.com/jwilleke/yourphr/issues/506). Never validated at sign-in. |
| __Passkey (WebAuthn)__ | phishing-resistant; with `userVerification: required` it is multi-factor by itself (device + PIN/biometric) | __viable alone__, or as the strongest second factor | Needs HTTPS and a stable RP ID (the instance's `base-url` host). Changing the host orphans every passkey, so the RP ID is set once and shown to the operator. Always keep a recovery path (a second passkey, or password + another factor). |
| TOTP | possession | second factor | Offline, no transport, no cost to a self-hoster. |
| Email code or magic link | weak possession (NIST SP 800-63B does not accept email for out-of-band) | second factor, or sign-in on instances that choose it | Viable (Jim, 2026-09-30). Mail is live. Needs ngdpbase's device binding and single-use gate, plus activescott/auth's POST confirm step so mail scanners that prefetch links cannot burn them. |
| SMS code | restricted (NIST SP 800-63B: SIM swap, interception) | second factor only, off by default | Viable (Jim, 2026-09-30). Operator-configured transport; never the only factor for an admin; excluded from the demo. SMS is __not__ used for notices ([#314](https://github.com/jwilleke/yourphr/issues/314) decision). |
| OIDC identity (Google etc.) | depends on the IdP | later | ngdpbase has it. Named `oidc-*`, never confused with SMART source-connect. |

__The policy shape this needs.__ Today's `yourphr.auth.factors` is ALL-OF (`password AND totp`). The target is:

- `password` + __any one__ enrolled second factor, from an instance-allowed list; or
- `passkey` alone.

An admin account requires a second factor once any are enabled. An account with no second factor enrolled signs in with a password alone until the instance requires enrolment.

__How configuration expresses it__ (Jim, 2026-09-30; [ngdpbase#1523](https://github.com/jwilleke/ngdpbase/issues/1523)): every factor is a registered `AuthProvider`, and each provider carries an `auth-factors` count. `0` means signing in through that provider needs no further factor (passkey, agent token, an IdP that already did MFA). `2` means the provider is one factor and the sign-in needs a second, different one (password). Unknown or unsatisfiable settings refuse the boot. Roles can raise the count, never lower it. This replaces ngdpbase's `required-factors` and YourPHR's ALL-OF `yourphr.auth.factors`, which ports it as `yourphr.auth.<provider>.auth-factors`.

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

Downloading the database, revealing a secret, changing the password or email, adding or removing a credential, and approving a device all require a __fresh__ factor: one satisfied within `yourphr.auth.reauth.max-age-seconds`. That needs the session to carry which factors were satisfied and when. The provider result already reports both, and they go into the session claims. A passkey prompt is the natural step-up.

### Sign-in record

Part of [#507](https://github.com/jwilleke/yourphr/issues/507). Every sign-in, failed sign-in, credential change and device approval is recorded and __visible to the patient__, beside the access log. It is not a new manager: `AuditManager` gains an account-event kind. There is an optional "new sign-in" email through `NotificationManager`. Retention is decided before it ships (IPs were kept out of [#512](https://github.com/jwilleke/yourphr/issues/512) for the same reason).

### RFC 8628 device authorization

Required by [#314](https://github.com/jwilleke/yourphr/issues/314) (Jim, 2026-09-30): scales and devices with a screen but no keyboard. Build it once, as a shared capability serving three callers:

1. __Connected devices__ ([#314](https://github.com/jwilleke/yourphr/issues/314)): the device shows a short user code and a URL/QR. The patient signs in on their phone, sees what the device is asking for, and approves.
2. __AI and MCP clients__ ([#657](https://github.com/jwilleke/yourphr/issues/657)): obtain an agent token without the patient copying a secret between windows.
3. __Command-line tools.__

Rules:

- The approval page runs step-up; a passkey prompt makes the approval phishing-resistant.
- The grant is an agent-token-style credential with scopes that are a ceiling, never roles.
- User codes are short-lived and single-use, and polling is rate-limited per RFC 8628 §3.5 (`slow_down`).
- A write scope, needed only for [#314](https://github.com/jwilleke/yourphr/issues/314), sits inside a patient consent grant: term of 30 days or less, short-lived keys, and only the patient extends it.
- A device with no upload for `yourphr.devices.inactive-after-days` (default 14) is suspended.

Built in ngdpbase first, beside `AgentTokenManager`, then ported. [#314](https://github.com/jwilleke/yourphr/issues/314)'s PR 4 is blocked by it.

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
- __Write scopes__ for delegated credentials: [#314](https://github.com/jwilleke/yourphr/issues/314) only, inside a consent grant (see RFC 8628 above). The rule "only listed GETs have a category" needs a matching write vocabulary.
- __CLI.__ `reset-password` and friends bypass HTTP ([#510](https://github.com/jwilleke/yourphr/issues/510)). Shell access is already total authority. Record that as the stated position.

## Decisions log

- 2026-08-12: "webconnect" meant WebAuthn / passkeys. Password policy is configuration, enforced server-side, never at sign-in.
- 2026-09-30 (Jim): this document is the single source of truth for the auth plan, and the work is coordinated with ngdpbase.
- 2026-09-30 (Jim): email magic links and codes, and SMS codes, are viable additional sign-in factors.
- 2026-09-30 (Jim): YourPHR needs RFC 8628 device authorization, from [#314](https://github.com/jwilleke/yourphr/issues/314).
- 2026-09-30 (Jim): the ngdpbase phases are filed there, under the epic [ngdpbase#1522](https://github.com/jwilleke/ngdpbase/issues/1522). Factor counts are per-provider configuration, and every factor is an `AuthProvider` ([ngdpbase#1523](https://github.com/jwilleke/ngdpbase/issues/1523)).
- 2026-09-30 (Jim): "who is this caller" uses the OIDC UserInfo standard ([ngdpbase#1529](https://github.com/jwilleke/ngdpbase/issues/1529), [#804](https://github.com/jwilleke/yourphr/issues/804)).

## Awaiting decision

Asked one at a time, in this order:

1. ~~Where RFC 8628 is built first.~~ ngdpbase: [ngdpbase#1526](https://github.com/jwilleke/ngdpbase/issues/1526) was filed there (Jim, 2026-09-30).
2. __Second-factor order.__ Recommend passkey first ([ngdpbase#448](https://github.com/jwilleke/ngdpbase/issues/448)), then email code (ngdpbase's magic link, ported), then TOTP ([ngdpbase#421](https://github.com/jwilleke/ngdpbase/issues/421)), then SMS.
3. __Passkey-alone sign-in__ allowed at launch of passkeys, or second-factor only at first.
4. __Sign-in record retention__ and whether denials are recorded with it.
5. __Un-defer ngdpbase#448 and #421__ once 2 is decided.

## Sequencing

Each phase is its own issue, linked by blocked-by and never a checklist inside one issue. The ngdpbase issues sit under the epic [ngdpbase#1522](https://github.com/jwilleke/ngdpbase/issues/1522) with real sub-issue and blocked-by relations. The ngdpbase phases come first, and each YourPHR phase is blocked by its ngdpbase counterpart.

| Phase | Repository | Work | Blocked by |
|---|---|---|---|
| A1 | ngdpbase | [ngdpbase#1523](https://github.com/jwilleke/ngdpbase/issues/1523) per-provider `auth-factors`; [ngdpbase#1524](https://github.com/jwilleke/ngdpbase/issues/1524) credentials store | — |
| A2 | ngdpbase | Passkey provider ([ngdpbase#448](https://github.com/jwilleke/ngdpbase/issues/448)) | A1 |
| A3 | ngdpbase | [ngdpbase#1525](https://github.com/jwilleke/ngdpbase/issues/1525) step-up re-authentication; factors and issuedAt in the provider result | A1 |
| A4 | ngdpbase | [ngdpbase#1526](https://github.com/jwilleke/ngdpbase/issues/1526) RFC 8628 device authorization | A3 |
| A5 | ngdpbase | TOTP ([ngdpbase#421](https://github.com/jwilleke/ngdpbase/issues/421)); [ngdpbase#1527](https://github.com/jwilleke/ngdpbase/issues/1527) email code; [ngdpbase#1528](https://github.com/jwilleke/ngdpbase/issues/1528) SMS, off by default | A1 |
| Y1 | YourPHR | Port A1: credentials table and migration; `yourphr.auth.factors` becomes the policy | A1 |
| Y2 | YourPHR | Sign-in record in the access log, with optional new-sign-in email ([#507](https://github.com/jwilleke/yourphr/issues/507)) | — |
| Y3 | YourPHR | Port passkeys and step-up; re-auth on DB download and secret reveal | Y1, A2, A3 |
| Y4 | YourPHR | Port RFC 8628; [#314](https://github.com/jwilleke/yourphr/issues/314) PR 4 and agent-token onboarding use it | Y3, A4 |
| Y5 | YourPHR | Port email code, TOTP, SMS | Y1, A5 |
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
- ngdpbase: [AuthManager](https://github.com/jwilleke/ngdpbase/blob/master/src/managers/AuthManager.ts), [#448 passkeys](https://github.com/jwilleke/ngdpbase/issues/448), [#421 TOTP](https://github.com/jwilleke/ngdpbase/issues/421), [#946 agent tokens](https://github.com/jwilleke/ngdpbase/issues/946)
- [activescott/auth](https://github.com/activescott/auth)
- NIST SP 800-63B; RFC 8628; WebAuthn Level 3
