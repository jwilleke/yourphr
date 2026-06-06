# YourPHR — Architecture & Security Review

> Independent evaluation of the `jwilleke/yourphr` codebase (community continuation of
> Fasten OnPrem). Reviewed: backend (Go/Gin/GORM), frontend (Angular 14), deployment,
> and the SMART-on-FHIR relay. **No code was changed** — this is an assessment plus a
> prioritized improvement backlog.
>
> Date: 2026-06-06 · Scope: `master`/`main` working tree.
>
> See also: [Standards Conformance](./Standards-Conformance.md) — how these findings map to
> SMART App Launch / OAuth 2.0 / PKCE / OWASP, with verified-conformant items and tracked gaps.

---

## 1. Executive summary

YourPHR is a self-hosted Personal Health Record viewer: a Go backend (Gin + GORM,
encrypted SQLite) serving a compiled Angular 14 SPA, importing FHIR R4 bundles. The
architecture is clean and conventional, and the fork shows **genuine, recent security
hardening** beyond upstream — a dedicated SSRF guard package, a store-and-poll OAuth
relay that keeps tokens out of the browser, per-user data scoping at the repository
layer, bcrypt (cost 14), JWT algorithm pinning, reserved-username blocking, and a
"standby mode" that refuses to open the DB without an encryption key.

The dominant residual risk is **a single shared HS256 JWT signing key that ships with a
known public default and is never force-rotated on first run**. Because all per-user data
isolation and the admin role gate ultimately trust that signature, a deployment left on
the default key is fully compromisable (forge a token for any user/role). Everything else
is secondary to closing that gap.

**Overall posture: solid foundation, one critical config-hardening gap, several
medium hardening opportunities.** Appropriate for a self-hosted/family threat model,
especially behind the documented forward-auth (Authentik) deployment; not yet ready to be
exposed directly to the public internet without the fixes below.

---

## 2. Architecture evaluation

### 2.1 Component map

| Layer | Tech | Notes |
|---|---|---|
| Frontend | Angular 14 SPA, served as static assets | JWT in `localStorage`; talks to `/api` |
| Web/API | Gin router (`backend/pkg/web/server.go`) | Route groups: `/api` (public), `/api/secure` (JWT), `/api/unsafe` (dev only) |
| Auth | HS256 JWT (`backend/pkg/auth/jwt_utils.go`) + bcrypt | Session token (1h) + long-lived "access" tokens (DB-backed) |
| Data | `DatabaseRepository` interface → GORM | SQLite (encrypted build) is the only working backend; Postgres is stubbed/broken |
| FHIR models | ~70 generated `fhir_*.go` structs | FHIRPath extraction via goja JS engine into indexed columns |
| Relay | Separate tiny Go service (`backend/cmd/relay`) | Store-and-poll OAuth `code` bouncer; never sees tokens |
| Sources | `fasten-sources` replaced by a local **stub** | Live provider sync is non-functional in this fork; manual upload is the supported path |

### 2.2 Strengths

- **Clean separation of concerns.** The `DatabaseRepository` interface
  (`backend/pkg/database/interface.go`) is a single, testable data-access contract;
  handlers stay thin and pull dependencies from Gin context via typed middleware
  (`RepositoryMiddleware`, `ConfigMiddleware`, `EventBusMiddleware`).
- **Per-user scoping is centralized.** Almost every repository method derives the owner
  from `GetCurrentUser(ctx)` (`gorm_common.go:94`) and filters by `UserID`, rather than
  trusting an ID from the request. This is the right place for the check and makes
  horizontal isolation the default.
- **Defense in depth on roles.** The admin gate (`IsAdmin`, `handler/auth.go:22`) re-reads
  the role from the DB rather than trusting the `role` claim baked into the JWT — so a
  tampered claim cannot escalate without a valid signature.
- **Code generation discipline.** FHIR model structs and the frontend TS types are
  generated and committed, with the regeneration path documented. This keeps ~70 resource
  types consistent and reduces hand-written surface area.
- **Reproducible builds.** Multi-stage Dockerfile, vendored deps, `distroless/static`
  runtime image, Nix flake for the dev toolchain.

### 2.3 Architectural risks / weaknesses

- **SQLite ceiling.** The roadmap already flags this: a lifetime, multi-family PHR on a
  single-writer SQLite file will eventually hit write-contention and size limits. PR #95
  ("isolate per-table query session") suggests concurrency friction is already showing.
  Postgres is the documented escape hatch but is currently broken.
- **Multi-user model is half-built.** The README describes admin/viewer roles and
  "grant access to another user's records," but the data layer currently scopes strictly
  to the current user (no implemented cross-user grant/ACL beyond
  `verifyAssociationPermission`). Shipping the *documented* sharing model will require a
  real authorization layer (see §3) — this is the highest-leverage architectural decision
  ahead, and it is much cheaper to design before the sharing feature than to retrofit.
- **`Reinitialize()` server lifecycle** (`server.go:40`) tears down and rebuilds the HTTP
  server on encryption-key setup. Functional, but the standby→active transition is a
  stateful dance worth integration-test coverage.
- **Generated-model coupling to upstream identifiers.** Intentional (documented in
  CLAUDE.md), but it means the fork carries upstream's `fasten-*` naming and the private
  `fasten-sources` stub indefinitely. Fine as a decision; just a long-term maintenance tax.

---

## 3. Security evaluation

Ordered by severity. Severity reflects impact on **PHI confidentiality**, which is the
asset that matters most here.

### 🔴 Critical

**C1 — Default JWT signing key + no forced rotation.** ([#102](https://github.com/jwilleke/yourphr/issues/102))
The committed `config.yaml:39` ships `jwt.issuer.key: "thisismysupersecure…"`, a known
public default. `JwtValidateFastenToken` (`auth/jwt_utils.go:42`) verifies tokens with
this key, and *all* per-user scoping and the admin gate ultimately trust it. Unlike the
**database** encryption key — whose absence forces "standby mode"
(`server.go:446`) — the JWT key has a working default, so the server starts silently
insecure. An operator who deploys without overriding it exposes every record: an attacker
can forge a valid token for any `username`/role.
*Recommendation:* generate a random key on first run and persist it as a system setting
(the in-code TODO already proposes this), or refuse to start if the key equals the known
default. At minimum, log a prominent startup error (not just a doc note).

### 🟠 High

**H2 — JWT stored in `localStorage`.** ([#103](https://github.com/jwilleke/yourphr/issues/103))
`auth.service.ts` keeps the session JWT in `localStorage` (`:187`, `:224`). Any XSS in the
Angular app yields full PHI exfiltration, and "access" tokens can be minted to persist
access. For a PHI app this is a meaningful amplifier of any frontend injection bug.
*Recommendation:* prefer an `HttpOnly`, `Secure`, `SameSite` cookie for the session token,
or at least add a strict Content-Security-Policy (see H4) to shrink the XSS surface.

**H3 — No rate limiting / lockout on auth, plus username enumeration.** ([#104](https://github.com/jwilleke/yourphr/issues/104))
`AuthSignin` (`handler/auth.go:78`) has no throttling or lockout — bcrypt cost 14 slows but
does not stop online guessing. It also returns **different responses** for unknown user
(`500`, "could not find user: X") vs. wrong password (`401`, "username or password does not
match: X"), which enumerates valid usernames. Signup is likewise unauthenticated and
unthrottled.
*Recommendation:* add per-IP/username rate limiting + temporary lockout; return a single
generic `401` ("invalid username or password") for both failure modes; avoid echoing the
attempted username.

**H4 — No security response headers.** ([#105](https://github.com/jwilleke/yourphr/issues/105))
No `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`/`frame-ancestors`,
`X-Content-Type-Options`, or `Referrer-Policy` are set anywhere in the backend. A PHR SPA
should ship a strict CSP (mitigates H2), HSTS (HTTPS is on by default), and clickjacking
protection.
*Recommendation:* add a security-headers middleware; start CSP in report-only and tighten.

### 🟡 Medium

**M5 — Open registration.**
`POST /api/auth/signup` is public; the first account silently becomes `admin`
(`handler/auth.go:51`), and anyone who can reach the instance can self-register a regular
account thereafter. Mitigated in the documented deployment by Authentik forward-auth, but
the app itself has no toggle to disable open signup or require admin approval.
*Recommendation:* add a `disable_open_registration` setting; consider admin-invite-only
after first-run.

**M6 — CORS proxy is unauthenticated and forwards all headers.**
`CORSProxy` (`handler/cors_proxy.go`) sits in the **public** `/api` group and copies the
inbound request headers verbatim to the upstream (`req.Header = c.Request.Header`,
`:64`). It is constrained to endpoints whose definition has `CORSRelayRequired` and whose
URL prefix-matches the known `TokenEndpoint` (good), and it forces `https://`. But the
in-code `TODO: throw an error if the remote.Host is not allowed` (`:74`) is unresolved, and
it then stamps `Access-Control-Allow-Origin: *` with `Allow-Credentials: true` on responses.
The prefix-match is the only real guard. With the `fasten-sources` stub the catalog is
small, limiting exposure today, but this is a latent SSRF/open-relay shape.
*Recommendation:* require auth (move to `/api/secure` or gate behind a token), strip hop-by-hop
and `Authorization` headers unless intended, and resolve the host-allowlist TODO.

**M7 — Access tokens default to effectively no expiry.**
`buildAccessTokenModel` (`handler/access_token.go:113`) maps "expiration = 0" to the year
**2099**. Long-lived bearer tokens for PHI are high-value; if one leaks it is valid for
~75 years until manually revoked.
*Recommendation:* cap maximum lifetime, default to a finite expiry, and surface
last-used/rotation in the UI.

**M8 — DB-write failure on access-token creation is swallowed.**
`CreateAccessToken` (`handler/access_token.go:52`) returns the freshly minted JWT to the
client even if persisting it fails ("Still return the token even if storage fails"). Since
`RequireAuth` validates access tokens against the DB (`require_auth.go:46`), the token is
issued but unusable — confusing, and it means a partial failure hands out a credential the
server won't honor.
*Recommendation:* fail closed — do not return a token that wasn't stored.

### 🔵 Low / informational

- **L9 — Verbose error passthrough.** Several handlers return `err.Error()` straight to the
  client (e.g. signup/signin `500`s). Low risk on a self-hosted box, but leaks internal
  detail; prefer generic messages + server-side logging.
- **L10 — `/api/unsafe` dev endpoints.** Guarded by `web.allow_unsafe_endpoints` (default
  off) with loud startup warnings (`server.go:227`). Correctly gated; just ensure it can
  never be enabled in the shipped image.
- **L11 — `web.listen.host: 0.0.0.0`.** Binds all interfaces by default. Expected for a
  containerized app, but worth a deployment note that the instance should sit behind the
  reverse proxy / forward-auth, not be exposed directly.
- **L12 — `GetUserByUsername` can return a non-nil zero user on error** (TODO noted at
  `gorm_common.go`), a potential nil/zero-value panic or logic hazard; tighten the error
  contract.
- **L13 — Relay shared-secret model.** The relay design is sound (never sees tokens; secret
  gates `/pending`). Ensure `YOURPHR_RELAY_SECRET` is high-entropy and the relay enforces
  the short TTL it documents; consider constant-time secret comparison.

### Things done well (credit where due)

- SSRF guard (`backend/pkg/ssrf/ssrf.go`) blocks loopback/RFC1918/link-local/metadata and
  is wired into the SMART discovery path (`handler/source.go:30`); it even documents its own
  DNS-rebinding limitation.
- Access-token operations verify ownership before delete (`gorm_repository_access_token.go:84`).
- JWT validation pins HS256 and rejects other algorithms (`auth/jwt_utils.go:47`),
  closing the `alg=none`/algorithm-confusion class.
- bcrypt cost 14 with empty-password rejection (`models/user.go`).
- Reserved-username blocking (`gorm_common.go`) and strong `.gitignore`/CLAUDE.md rules
  against committing PHI, DBs, keys, and certs.
- DB encryption on by default with a standby-mode guard when the key is absent.

---

## 4. Prioritized improvement backlog

| # | Improvement | Severity | Effort | Area |
|---|---|---|---|---|
| [C1](https://github.com/jwilleke/yourphr/issues/102) | Generate/persist a random JWT key on first run, or refuse to start on the default key | 🔴 Critical | S | Backend/config |
| [H2](https://github.com/jwilleke/yourphr/issues/103) | Move session JWT out of `localStorage` (HttpOnly cookie) | 🟠 High | M | Frontend/auth |
| [H3](https://github.com/jwilleke/yourphr/issues/104) | Auth rate limiting + lockout; generic `401`; stop username echo | 🟠 High | M | Backend |
| [H4](https://github.com/jwilleke/yourphr/issues/105) | Security-headers middleware (CSP, HSTS, X-Frame-Options, nosniff) | 🟠 High | S | Backend |
| M5 | `disable_open_registration` / invite-only mode | 🟡 Medium | S | Backend |
| M6 | Authenticate + host-allowlist the CORS proxy; drop forwarded auth headers | 🟡 Medium | M | Backend |
| M7 | Cap access-token lifetime; finite default | 🟡 Medium | S | Backend |
| M8 | Fail closed when access-token persistence fails | 🟡 Medium | S | Backend |
| — | Design the real authorization layer **before** building cross-user record sharing | Arch | L | Backend |
| — | Restore/finish Postgres backend for scale | Arch | L | Backend/DB |
| L9–L13 | Error hygiene, relay secret hardening, `GetUserByUsername` contract | 🔵 Low | S | Various |

**Suggested order:** C1 → H4 → H3 → H2 → M5/M7/M8 (quick wins) → M6 → multi-user authz
design → Postgres.

### Process / supply-chain suggestions (no app-code change)

- Add `gosec` and `govulncheck` to CI (`ci.yaml`) and `npm audit`/`yarn audit` for the
  frontend; the project already runs `go vet` + tests and Dependabot.
- Add `gitleaks` (or similar) as a pre-commit / CI gate to enforce the "never commit PHI or
  secrets" rule mechanically rather than by discipline alone.
- Document a key-rotation runbook (JWT key, DB encryption key, relay secret).

---

## 5. Caveats

This review is static (read-only) and time-boxed; it did not run the app, exercise the
endpoints, or audit every one of the ~70 generated FHIR handlers. Severity ratings assume
the self-hosted/family threat model the project targets, with the note that direct public
exposure raises H3/H4/M5/M6 in practice. Findings cite `file:line` at review time and may
drift as the code evolves — re-verify before acting.
