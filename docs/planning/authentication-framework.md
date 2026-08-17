# Authentication framework — planning

> __Status: planning, not decided.__ Nothing here is built. This records the shape we are converging on, the prior art it draws from, and the questions still open. Started 2026-08-12.

## Scope

__Authentication only__ — proving *who* someone is. Everything below answers that one question.

__Authorization is explicitly out of scope__ — what an identity is *allowed to do*. That half is now drafted separately in [`authorization-framework.md`](authorization-framework.md). YourPHR already has authorization, in four scattered places: the `admin` role check inside each admin handler, `RequireAuth`, the demo guards ([#496](https://github.com/jwilleke/yourphr/issues/496), [#514](https://github.com/jwilleke/yourphr/issues/514), [#516](https://github.com/jwilleke/yourphr/issues/516)), and per-user isolation in the repository queries. Consolidating those is worth doing and is a __separate__ piece of work. Mixing the two into one "auth manager" produces something that decides everything and explains nothing, and the authorization half is where the PHI risk actually lives.

## Where we are today

| Credential | Implementation | Notes |
|---|---|---|
| Password | `handler.AuthSignin` | bcrypt via `models.User.CheckPassword`; username enumeration already handled ([#104](https://github.com/jwilleke/yourphr/issues/104)) |
| Session JWT | `pkg/auth/jwt_utils.go` | HS256, sliding renewal ([#445](https://github.com/jwilleke/yourphr/issues/445)), signing key auto-generated and persisted ([#102](https://github.com/jwilleke/yourphr/issues/102)) |
| Session transport | `setSessionCookie` + `RequireAuth` | HttpOnly cookie for browsers ([#103](https://github.com/jwilleke/yourphr/issues/103)); `Authorization: Bearer` for API/SMART |
| Access tokens | `handler/access_token.go` | create / list / delete — a second credential type entirely outside any abstraction |
| Demo sign-in | `handler.AuthDemoSignin`, `AuthDemoAdminSignin` | config-gated, verifies a generated password server-side ([#515](https://github.com/jwilleke/yourphr/issues/515), [#516](https://github.com/jwilleke/yourphr/issues/516)) |

__Three credential types already exist__, each hand-rolled in its own handler, each minting its own session token. This abstraction is not speculative — it is consolidating something that has already multiplied.

### What today's shape costs

- __Every new method means another handler that mints a JWT.__ Session creation has no single choke point, so rate limiting ([#509](https://github.com/jwilleke/yourphr/issues/509)), `last_login` tracking ([#512](https://github.com/jwilleke/yourphr/issues/512)), and sign-in audit ([#507](https://github.com/jwilleke/yourphr/issues/507)) each have to be implemented N times or forgotten N−1 times.
- __Credentials live on the user row.__ `users.password` is a column, so a second authentication method for the same person has nowhere to go.
- __Nothing records *how* a session was established__, so "this action requires a fresh password, not a magic link clicked six days ago" is not expressible.

## Prior art

### `jwilleke/ngdpbase` — `src/managers/AuthManager.ts`

Our own, and the closest fit. `AuthManager` registers providers, gates each on configuration, and dispatches `initiate`/`verify`. `BaseAuthProvider` defines `id`, `displayName`, optional `initiate()`, required `verify()`, optional `consumeToken()`. Providers already shipped there: password, magic link, Google OIDC, Cloudflare Access, Authentik bearer, agent token.

Two details worth carrying over:

- `AuthenticateResult.viaToken` carries the delegating token's id, name and scopes — and __deliberately omits roles__, which are resolved live from the user record so a token never holds a snapshot of authority. That is exactly right and we should copy it.
- `required-factors` is declared but single-factor only. A caution, not a model: do not half-build MFA.

### `activescott/auth`

TypeScript, passwordless-only, deliberately excludes OAuth/social. Architecture: an `Auth` core, a `SessionManager` owning JWT cookies, an `AuthProvider` interface, and __three separate stores__ — `IdentityStore`, `UserStore`, `ChallengeStore`. Providers never write state directly; they delegate to the stores. Supports email magic links, email and SMS one-time codes, passkeys/WebAuthn, and identity linking across methods.

What we take:

- __Identities separate from users.__ The single most important idea here — see the data model below.
- __Server-backed challenges.__ Single-use codes and links live in a `ChallengeStore` rather than as a secret inside a token, which prevents replay and gives expiry an obvious home.
- __The magic-link confirm step.__ Their links require a `POST` confirmation because corporate email security scanners *prefetch* URLs and silently consume the single-use credential. This is a real bug that is very hard to reproduce once shipped.

What we do not take: their exclusion of OAuth. We cannot — see the trap below.

## Proposed shape

```go
// Identity is what a provider proves. It is not a session.
type Identity struct {
    Username string
    Method   string   // "password", "access-token", "demo", "webauthn", "oidc-google", "magic-link"
    Scopes   []string // delegated authority; nil for interactive sign-ins
}

type Provider interface {
    ID() string
    DisplayName() string
    Enabled(cfg config.Interface) bool

    // Challenge-based flows only: send the email, start the redirect. No-op for password.
    Initiate(ctx context.Context, req InitiateRequest) (*Challenge, error)

    // Prove identity. Returns nil for "not this provider's problem" and an error for failure.
    Verify(ctx context.Context, creds Credentials) (*Identity, error)

    // Single-use credentials only: burn the challenge once a session exists.
    Consume(ctx context.Context, token string) error
}
```

### The invariant that matters

__A provider proves identity and never mints a session.__ Only the manager issues JWTs.

Every auth defect this repository has had recently traces to that boundary being fuzzy. Demo sign-in came close to becoming "flag flipped ⇒ token issued", and the whole [#515](https://github.com/jwilleke/yourphr/issues/515) design turns on provisioning being a *separate step* from the flag, so that a mis-set boolean cannot be enough on its own. One choke point for session creation is also the only sane home for the throttle, the audit line, and `last_login`.

### Data model — identities separate from users

Today: `users.password`. Proposed:

```text
identities
  id            uuid
  user_id       uuid      -> users.id
  provider      text      -- "password", "webauthn", "oidc-google", …
  subject       text      -- provider-scoped identifier (username, credential id, sub claim)
  secret        text      -- bcrypt hash, public key, or empty for external providers
  created_at    timestamp
  last_used_at  timestamp
  UNIQUE (provider, subject)
```

Migration: one row per existing user, `provider = "password"`, `subject = username`, `secret =` the current hash. `users.password` is then dropped in a later release once nothing reads it.

__Do this early.__ Adding a second authentication method with credentials still on the user row means either a second column or a rewrite under live data. It is much cheaper as phase one than as a prerequisite discovered during the passkey work.

It also makes __account linking__ expressible: the same human with a password today and a passkey next month is two `identities` rows pointing at one `users` row. Linking *policy* — who may link what, and what proves it is the same person — is an open question below, not something the schema decides.

### Session claims

Add `Method` to the session claims. That is what makes step-up re-auth possible later ("changing your password requires a fresh password"), what makes the sign-in audit trail meaningful, and what an admin screen needs to show how a session was established. Retrofitting a claim into live sessions is painful, so it should land with the manager rather than after it.

## Two traps specific to this codebase

__OAuth means two opposite things here.__ We are already an OAuth *client*: SMART on FHIR provider connect, where YourPHR fetches a patient's records from Epic or Blue Button. "Sign in with Google" is OAuth as *identity*, where YourPHR is a relying party. Same word, opposite direction, entirely different failure modes. If both end up as sibling "OAuth providers" in one registry, someone will eventually wire the wrong one into the wrong flow. Name them apart from the first commit: `oidc-google` for identity, and leave the existing source-connect path alone.

__Magic link over SMS/RCS on a health record.__ An SMS or email magic link makes the phone number or mailbox a complete account-takeover path, and SIM swap is not exotic. The asset here is a full medical history. If we ship it: opt-in per instance, never the only factor for an admin account, and excluded from the demo. It is also blocked on SMTP infrastructure that does not exist yet ([#507](https://github.com/jwilleke/yourphr/issues/507) deferred it).

## Methods under consideration

| Method | Status | Notes |
|---|---|---|
| Password | exists | Moves onto the interface unchanged. Policy work is [#506](https://github.com/jwilleke/yourphr/issues/506) |
| Access token | exists | Already a distinct credential; `Scopes` earns its place here. Feeds revocation ([#508](https://github.com/jwilleke/yourphr/issues/508)) |
| Demo | exists | Already effectively a provider: config-gated, verifies server-side, mints nothing itself |
| WebAuthn / passkeys | proposed | __This is what "webconnect" meant__ (confirmed 2026-08-12). Phishing-resistant, no shared secret. The one method that materially *improves* security rather than adding another door |
| OIDC identity | proposed | Must be named apart from SMART source-connect |
| Magic link / OTP | proposed | Needs `ChallengeStore`, SMTP, the confirm-page step, and the risk decision above |

## Settled so far

- __Scope is authentication only__ (2026-08-12). Authorization is separate work.
- __"webconnect" means WebAuthn / passkeys__ (2026-08-12).
- __Password policy is configuration, enforced server-side__ ([#506](https://github.com/jwilleke/yourphr/issues/506), 2026-08-12). `auth.PasswordPolicy` is deliberately a value read from config rather than logic inside a handler, so the future password provider owns it by moving one file. It is applied at sign-up, admin user-create and change-password, and __never at sign-in__ — validating a credential someone already holds locks them out over a rule they cannot act on until they are inside.

## Open questions

1. __Multi-factor.__ Does the manager track partial-authentication state, or do we stay single-factor and say so? ngdpbase declares `required-factors` and implements one factor; that half-state is worth avoiding.
2. __Account linking policy.__ Who may add an identity to an existing account, and what proves it is the same person? Email-match alone is an account-takeover path if any provider's email is unverified.
3. __Is demo a provider, or a configuration of the password provider?__ It is a password check against a generated credential, so it may not need its own provider at all.
4. __Self-hosted reality.__ Every external provider (OIDC, SMS) adds a dependency a self-hoster must run or trust. Which of these are we willing to make available but off by default, and which do we decline outright?

## Sequencing

One issue per phase, per repository convention. Nothing is filed yet.

| Phase | Work | Blocked by |
|---|---|---|
| EPIC | Pluggable authentication providers | — |
| 1 | `identities` table + migration of existing password hashes; `Identity` / `Provider` / `Manager`; all session minting moves to the manager | — |
| 2 | Password and demo moved onto the interface. Pure refactor; existing tests carry over | 1 |
| 3 | Access tokens as a provider; `Scopes` on `Identity` | 1 |
| 4 | `Method` in session claims; step-up re-auth for sensitive actions | 1 |
| 5 | WebAuthn / passkeys | 1, 2 |
| 6 | OIDC identity | 1, 2 |
| 7 | Magic link / OTP: `ChallengeStore`, confirm-page, SMTP | 1, 2, and the risk decision |

Phases 1–2 are a refactor with no user-visible change, which is deliberate: the abstraction should be proven against the methods we already have before it carries a new one.

## Related

- [#507](https://github.com/jwilleke/yourphr/issues/507) — authentication policy survey; where MFA, re-auth and sign-in audit were deferred
- [#508](https://github.com/jwilleke/yourphr/issues/508) — session revocation; a stolen session survives a password change
- [#509](https://github.com/jwilleke/yourphr/issues/509) — per-account sign-in throttle
- [#510](https://github.com/jwilleke/yourphr/issues/510) — `fasten reset-password` CLI
- [#511](https://github.com/jwilleke/yourphr/issues/511) — admin sets another user's password
- [#512](https://github.com/jwilleke/yourphr/issues/512) — `last_login` / `login_count`
- [#519](https://github.com/jwilleke/yourphr/issues/519) — reserved usernames guard signup, not provisioning
- `jwilleke/ngdpbase` — `src/managers/AuthManager.ts`, `src/providers/BaseAuthProvider.ts`
- <https://github.com/activescott/auth>
