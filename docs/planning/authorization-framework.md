# Authorization framework — planning

> __Status: planning, not decided.__ Nothing here is built. This records the shape we are converging on, the prior art it draws from, and the questions still open. Started 2026-08-13.

## Scope

__Authorization only__ — what an already-identified caller is *allowed to do*. Proving *who* someone is belongs to [`authentication-framework.md`](authentication-framework.md), which explicitly deferred this half. This is that thread returning.

The trigger was concrete: on the public demo, every write button on the admin screens looks live, and the read-only demo admin learns they are refused by pressing them ([#527](https://github.com/jwilleke/yourphr/issues/527) reported two bugs found exactly that way). The button and the rule that governs it are decided in two different places, in two different languages, with no shared vocabulary between them. That is the problem worth solving; the demo is only where it first became visible.

__Explicitly out of scope: per-user data isolation.__ Repository queries scope records to their owner, and that is a different mechanism from a permission check — it is a `WHERE user_id = ?`, not a yes/no on an action. Modelling row ownership as permissions is how RBAC systems turn into query planners. It stays where it is.

## Where we are today

| Mechanism | Where | Covers |
|---|---|---|
| `RequireAuth` | `middleware/require_auth.go` | Is there a valid session at all; token generation check ([#508](https://github.com/jwilleke/yourphr/issues/508)) |
| `handler.IsAdmin(c)` | `handler/auth.go:29`, called from 6 handler files | Admin-only actions — config, database, users, instance, metrics |
| `requireAdmin(c)` | `handler/provider_catalog.go:55`, called 6 times | The same check, written twice |
| `RestrictDemoAdmin` | `middleware/demo_admin_guard.go` | Read-only demo admin, default-deny by HTTP method ([#516](https://github.com/jwilleke/yourphr/issues/516)) |
| `RestrictDemoAccount` | `middleware/demo_guard.go` | Shared demo user ([#496](https://github.com/jwilleke/yourphr/issues/496), [#514](https://github.com/jwilleke/yourphr/issues/514)) |
| `AuthService.IsAdmin()` | `frontend/src/app/services/auth.service.ts` | The browser's independent guess at what the backend will allow |
| Repository scoping | `database/gorm_common.go` | Per-user record isolation — out of scope here, listed for completeness |

__25 in-handler admin gate call sites across 7 files, reached through two duplicate helpers.__ Two roles exist: `user` and `admin` (`pkg/constants.go:82`).

### What today's shape costs

- __The rule is expressed as "is this person an admin", never as "is this action permitted".__ So there is no way to answer "may this session delete a provider?" without running the request. That is precisely the question the UI needs answered *before* drawing the button, which is why the frontend ended up guessing.
- __Two helpers already drifted into existence__ for one concept. A third role would need 25 sites revisited, each an independent chance to be wrong.
- __The demo rules are expressed in a different dimension entirely__ — HTTP method and path prefix, not action. That was the right call under the circumstances (see the [#514](https://github.com/jwilleke/yourphr/issues/514) note below) but it means two separate systems answer overlapping questions, and neither can see the other.
- __The frontend holds an independent copy of the policy.__ `IsAdmin()` is a guess. When it disagrees with the server, the user meets a refusal they were invited to trigger.
- __Access tokens carry no scopes at all.__ `models.AccessToken` is `UserID`, `TokenID`, `Name`, `IssuedAt`, `ExpiresAt` — nothing narrows what a token may do, so every token is exactly as powerful as the person who made it. (Not to be confused with the `Scopes` on `ProviderCatalogEntry`: those are SMART scopes we *request from* Epic and Cerner, outbound, and have nothing to do with authorizing callers of our own API.)

## Prior art

### `jwilleke/ngdpbase` — `src/context/WikiContext.ts`, `ACLManager`, `UserManager`, `PolicyEvaluator`

Ours, and the model this proposal is derived from. The relevant surface:

- `WikiContext` is __request-scoped__ and carries `userContext` (username, roles, authenticated).
- `hasRole(...names)` — a cheap roles-array check, no policy consulted.
- `hasPermission(action)` — the canonical path, delegating to `UserManager.hasPermission` and from there to `PolicyEvaluator`.
- `canAccess()` — per-page ACLs via `ACLManager`.
- `_permissionCache: Map<string, Promise<boolean>>` — the same question asked twice in one request is free.

Two details worth carrying over verbatim:

- __The agent-token scope ceiling__ (`UserManager.ts:678`). A token scoped `page-read` cannot create pages *even if its owner could*, and the comment there is explicit that this is a __second enforcement point, not a duplicate__ — capability checks reach `UserManager` without ever touching `ACLManager`, so a ceiling in one does not cover the other. Our access tokens need the same, and the lesson is that "where does this check actually run" has to be answered per path, not per intention.
- __`AuthenticateResult.viaToken` deliberately omits roles__ — authority is resolved live from the user record so no credential holds a snapshot of it. Already noted in the authentication doc; it matters more here.

__One thing not to inherit:__ the permission vocabulary there is inconsistent — `page-create` and `user-read` in some places, `page:read` and `admin:system` in others. Pick one convention and hold it.

### The structural difference that matters

__ngdpbase renders on the server.__ `WikiContext` is request-scoped, and the template asks `hasPermission('page:edit')` *while drawing the button*. Rendering and enforcement are the same process reading the same object, so they cannot disagree.

__YourPHR is an Angular SPA against a JSON API.__ The button is drawn in the browser; enforcement is in Go; a network sits between. The single context therefore splits into two:

| | Server | Client |
|---|---|---|
| Scope | Request | Session |
| Authority | __The decision__ | A projection of it |
| Governs | Whether the handler runs | What gets drawn |
| If they disagree | Server wins, always | User meets a refusal — a cosmetic bug |

They stay honest by speaking the __same permission strings__, named once in Go and shipped to the UI. That is the whole contract, and it is what today's `IsAdmin()` guess lacks.

## Proposed shape

```go
// Permission is an action, not a role. Named once, here.
type Permission string

const (
    PermissionConfigRead        Permission = "config:read"
    PermissionConfigWrite       Permission = "config:write"
    PermissionConfigRevealSecret Permission = "config:reveal-secret"
    PermissionUserList          Permission = "user:list"
    PermissionUserResetPassword Permission = "user:reset-password"
    PermissionProviderCatalogDelete Permission = "provider-catalog:delete"
    PermissionDatabaseBackup    Permission = "database:backup"
    PermissionDatabaseBrowse    Permission = "database:browse"
)

// AuthContext is request-scoped, computed once by middleware, and carried on the gin.Context —
// the WikiContext analogue. Never serialised into a token.
type AuthContext struct {
    Username    string
    Role        pkg.UserRole
    Permissions map[Permission]bool // resolved, not re-derived per question
    ViaToken    *TokenGrant         // when the caller is an access token; scopes CEIL the set above
}

func (a *AuthContext) Can(p Permission) bool
```

Routes declare what they require, rather than each handler asking:

```go
secure.DELETE("/admin/provider-catalog/:id", middleware.Require(PermissionProviderCatalogDelete), handler.DeleteProviderCatalogEntry)
```

### The invariant that matters

__The client's permission set is advisory. It decides what to draw and nothing else.__

Anyone can edit it from the browser console, so a UI that "checks permission before calling the API" has performed a suggestion, not a control. Every request is evaluated independently, server-side, from the user record — the same rule the demo guard follows today, where a disabled button is decoration and the middleware is the control. Getting this backwards converts a UI improvement into an authentication bypass on a product holding medical records.

### Default-deny survives the migration

[#514](https://github.com/jwilleke/yourphr/issues/514) is the reason this is non-negotiable. The demo guard was originally written by naming the dangerous routes; it missed two — change password and delete account — and any visitor could lock every user out of the public demo permanently. The replacement inverted the direction, and that inversion must survive: __a route with no declared permission is refused, not allowed.__ Not logged, not warned — refused. A framework that fails open is worse than the 25 scattered checks, because it looks organised while being wrong.

### Where the demo rules land

`RestrictDemoAdmin` becomes a permission set — the demo admin resolves to reads only — rather than a method-and-prefix filter. Two constraints on doing that:

- It does not move until parity is proven route by route, and the existing guard stays in place until then. The method filter is coarse but it is *currently correct*, which is worth more than elegance.
- Even afterwards, the group-level default-deny stays. Belt and braces is the appropriate posture for a public host running an admin API.

## Traps specific to this codebase

- __Do not put permissions in the JWT.__ They would go stale the moment a role changed, and a demoted admin would keep their buttons — and their access — until the token expired. Resolve live per request; `token_generation` ([#508](https://github.com/jwilleke/yourphr/issues/508)) already forces a client to re-fetch when authority changes.
- __The migration must not silently widen.__ Every mapping starts from what the route does *today*. A route that is admin-only now maps to an admin permission now, even where a narrower one looks obviously right — narrowing is a second, separate change with its own test.
- __Row-level isolation is not RBAC.__ `WHERE user_id = ?` stays in the repository. `user:read-records` as a permission would be a permission that is always true and explains nothing.
- __Two enforcement points already exist and will multiply.__ ngdpbase learned this the hard way (`UserManager.ts:678`): a ceiling applied on the resource path did not cover the capability path. Enumerate the paths a request can take to reach a handler *before* deciding where the check goes.
- __The frontend's `IsAdmin()` must be deleted, not left alongside.__ Two sources of truth for the same question is the bug we are fixing; leaving the old one in place ships the bug with extra steps.

## Settled so far

- Permissions are actions, named `resource:action`, one convention, defined once in Go.
- The server-side context is request-scoped and authoritative; the client's copy is session-scoped and advisory.
- Unmapped route means refused.
- __If__ access tokens gain scopes, those scopes are a __ceiling__ on the owner's permissions, never a grant. (They have none today — see the open question, since introducing them has a migration problem of its own.)
- Per-user data isolation stays in the repository layer and is not modelled as permissions.
- The existing demo guards stay until per-route parity is demonstrated.

## Open questions

- __Where does the client fetch its projection?__ Fold it into `GET /api/secure/account/me`, or a dedicated endpoint? `/me` means one fewer request and no chance of the two disagreeing; a dedicated endpoint is easier to cache and to reason about.
- __Do permissions attach to roles, or directly to users?__ Two roles today, and a family instance may eventually want "my daughter can see her own records but not manage sources". Role-only is simpler and probably right until a third role actually exists.
- __Does a permission carry a reason string for the UI?__ `provider-catalog:delete` denied → "disabled in the public demo" is much better copy than a generic refusal, but it puts presentation text in the policy layer.
- __How is this tested so the table cannot drift from the routes?__ A test that walks the registered routes and asserts each declares a permission would make an unmapped route a build failure rather than a runtime refusal. Probably the highest-value single test in the whole design.

- __Is the role-to-permission mapping configuration, or is it compiled in?__ This one collides with a standing rule of this project — variables belong in the configuration system, never hardcoded ([#472](https://github.com/jwilleke/yourphr/issues/472)) — and it is not obvious the rule should win here. Configurable means an operator can build a caregiver role without a release, which is genuinely valuable for a product meant to be self-hosted by families. It also means a typo in a config store silently widens access to medical records, that support questions become unanswerable without seeing the instance's own table, and that the mapping is no longer covered by our tests. A middle position exists: permissions and their meanings are compiled, while the *assignment* of permissions to roles is configuration with a shipped default and a startup validation pass that refuses to boot on an unknown permission name. Worth deciding explicitly rather than by habit.

- __What happens to an open browser session when its authority changes?__ The projection is fetched once. Demote an admin and their UI keeps the admin buttons until something refetches — every click then fails against a server that is correctly refusing. The server side is safe either way; the question is purely how bad the UI is allowed to look. Options: accept the staleness and let the refusals explain themselves, refetch on navigation, or reuse `token_generation` ([#508](https://github.com/jwilleke/yourphr/issues/508)) so an authority change invalidates the session outright and forces a clean re-entry.

- __Do access tokens get scopes, and what happens to the ones that already exist?__ The ceiling described above assumes a field that does not exist yet, so this is a feature, not an intersection. The migration has two options and both are bad in different directions: default existing tokens to *all* the owner's permissions, which is a silent grant that quietly matches today's behaviour, or default them to nothing, which is correct and breaks every token in the field with no warning. A third path — treat scope-less tokens as legacy, log every use, and refuse to mint new ones without scopes — costs more code and is probably the honest answer.

- __Are denials audited?__ On a product holding medical records, "someone tried to do something they were not allowed to do" is exactly the event worth keeping. Sign-in audit was already deferred once in [#507](https://github.com/jwilleke/yourphr/issues/507). But an audit log is itself PHI-adjacent and needs a retention decision, which is the same reasoning that kept IP addresses out of [#512](https://github.com/jwilleke/yourphr/issues/512). Do not add a log without deciding how long it lives and who can read it.

- __Does a refusal name the permission it wanted?__ `{"code":"forbidden","permission":"provider-catalog:delete"}` is enormously better for debugging and for writing precise UI copy. It also tells an attacker the shape of the permission model — mild disclosure, and arguably irrelevant given the vocabulary will be in a public repository. Leaning toward including it, but state the reasoning rather than defaulting.

- __Are wildcards allowed?__ `admin:*` is convenient and is how these systems usually acquire their first accidental over-grant, because the wildcard silently absorbs every permission added afterwards — which is precisely the failure mode of [#514](https://github.com/jwilleke/yourphr/issues/514) in a new costume. Recommend no wildcards, and if a role really does need everything, generate the full explicit list so a diff shows what changed.

- __Does `admin` survive as a role, or become a bundle of permissions?__ Keeping it means two concepts (roles and permissions) where one might do. Dropping it means touching `models.User.Role`, the bootstrap admin provisioning, the reserved-name rules, and the demo admin — a much larger blast radius than phases 1–3, and probably a later phase of its own if it happens at all.

- __Can a permission ever have a subject other than the caller?__ Today every question is "may *I* do X". A caregiver or parent acting on another person's records asks "may I do X *to Y's data*", which changes the signature from `Can(p)` to `Can(p, subject)` and pulls row ownership back into a design that deliberately excludes it. Not needed now. Worth knowing that answering "yes" later is a redesign, not an addition.

- __Does the CLI need any of this?__ `fasten reset-password` and friends bypass HTTP entirely, so no middleware sees them and no permission is consulted. That is arguably correct — shell access to the host is already total authority, and the command exists precisely for when nobody can sign in ([#510](https://github.com/jwilleke/yourphr/issues/510)). But it should be a stated position rather than an accident of where the code lives, because the next CLI command might not be so obviously fine.

## Sequencing

Each phase is its own issue, linked with blocked-by — not a checklist inside one issue.

1. __Permission vocabulary and table in Go.__ No behaviour change; nothing consumes it yet. Deliverable is the named set plus the role-to-permission mapping that reproduces today's rules exactly.
2. __Request-scoped `AuthContext` and `Require(...)` middleware__, with the route-coverage test from the open questions above. Still no behaviour change: mappings reproduce current gates.
3. __Retire the 25 call sites__ and both duplicate helpers, route by route, one PR per handler file so a regression is bisectable.
4. __Publish the projection__ to the client and consume it in the frontend; delete `AuthService.IsAdmin()`.
5. __Fold the demo rules into permissions__, keeping the group-level default-deny.
6. __Access-token scopes__ — introducing the field, deciding what existing tokens inherit, and applying the ceiling. Last because it is the only phase that is a new feature rather than a consolidation, and the only one that can break a credential someone is already using.

__Not blocked by any of this:__ disabling the demo's dead admin buttons using the `demo.admin.session` flag that already exists. It is about an hour of work, and phase 4 deletes it. Shipping the interim fix is not wasted effort — it is the thing that stops the demo teaching visitors that the app is broken while the framework gets built.

## Related

- [`authentication-framework.md`](authentication-framework.md) — the other half; explicitly deferred authorization to here
- [#527](https://github.com/jwilleke/yourphr/issues/527) — the reporting bugs that surfaced this
- [#516](https://github.com/jwilleke/yourphr/issues/516) — read-only demo admin, the current default-deny guard
- [#514](https://github.com/jwilleke/yourphr/issues/514) — why default-deny is not negotiable
- [#508](https://github.com/jwilleke/yourphr/issues/508) — `token_generation`, the mechanism for forcing a permission re-fetch
- `jwilleke/ngdpbase`: `src/context/WikiContext.ts`, `src/managers/UserManager.ts`, `src/managers/ACLManager.ts`
