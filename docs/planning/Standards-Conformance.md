# YourPHR — Standards Conformance

> How YourPHR's security design maps to the relevant standards, with verified-conformant
> items and tracked gaps. Companion to [Architecture & Security Review](./architecture-security-review.md)
> (which holds the findings C1–H4); this document is the standards-mapping view.
>
> Date: 2026-06-06 · Verified against `main`.

## The two security domains

A recurring source of confusion: only one of these is governed by SMART-on-FHIR.

1. **Provider sync (EPIC #20)** — YourPHR acting as a **SMART client** to authorize against and
   pull data from external FHIR R4 servers (Veradigm/FMH/etc.). **This is where SMART App Launch
   / OAuth 2.0 / PKCE apply.**
2. **YourPHR's own app session** (#102/#103/#104/#105) — how a user logs into YourPHR itself and
   how the browser SPA authenticates to YourPHR's own `/api/secure`. **SMART-on-FHIR does not
   govern this**; it's general web-app security (OWASP ASVS, OAuth 2.0 for Browser-Based Apps).

---

## Domain 1 — SMART-on-FHIR provider sync

Verified in `fasten-sources-stub/clients/smart/client.go` and `backend/pkg/web/handler/source.go`.

| Requirement | Standard | Status | Evidence |
|---|---|---|---|
| Authorization Code grant | RFC 6749 | ✅ | `AuthCodeURL` / `ExchangeCode` |
| **PKCE `S256`** | RFC 7636 | ✅ | `GenerateVerifier` (32 random bytes), `base64url(sha256(verifier))`, `code_challenge_method=S256` |
| Discovery via `.well-known/smart-configuration` | SMART App Launch | ✅ | `Config.Discover` |
| `aud` = FHIR base URL | SMART App Launch | ✅ | set in `AuthCodeURL` |
| `state` parameter | RFC 6749 §10.12 | ⚠️ present, see G1 | `state := uuid.New()` |
| Access token → FHIR API as `Authorization: Bearer` | RFC 6750 | ✅ | provider client |
| **Tokens held server-side, never in the browser** | SMART security guidance | ✅ | `source.go`: "the browser never handles tokens" (store-and-poll relay) |
| TLS-only endpoints; no SSRF to internal targets | RFC 9700 | ✅ | `ssrf.ValidatePublicHTTPSURL` (#75) |

The server-side token custody is the **Backend-For-Frontend (BFF)** shape — the IETF best practice
for browser-based OAuth apps.

### Gaps / hardening (tracked)

- **G1 — `state` + PKCE `code_verifier` round-trip through the browser.** `AuthorizeSource` returns
  both `state` and `code_verifier` to the SPA, and `ConnectSource` accepts them back from the SPA;
  the backend does not hold them server-side bound to the user/session. Per **RFC 9700** (OAuth 2.0
  Security BCP), `state` should be bound to the user-agent session to prevent CSRF / account-linking
  ("mix-up") attacks, and the PKCE verifier (a secret) ideally never leaves the backend. *Risk:* an
  attacker-influenced `state`/`verifier` could be submitted (account-linking CSRF); verifier exposure
  to JS (mitigated by the enforcing CSP, #113). *Remediation:* at `AuthorizeSource`, persist
  `{state → verifier}` server-side keyed to the current user; at `ConnectSource`, look the verifier up
  by `state` for the authenticated user instead of trusting client-supplied values.
- **G2 — no `id_token` validation.** The flow uses `access_token` + `patient` from the token response;
  if the `openid` scope is requested, the returned `id_token`'s `iss`/`aud`/signature should be
  validated. *Action:* confirm whether `openid` is required for the target providers; validate if so.

---

## Domain 2 — YourPHR app session (OWASP / Browser-Based Apps BCP)

| Concern | Standard | Status | Notes |
|---|---|---|---|
| No hardcoded signing secret | OWASP ASVS V6 | ✅ | JWT key auto-generated + persisted on first run (#102) |
| Auth error uniformity + throttling | OWASP ASVS V2.2 | ✅ | generic `401`, no username echo, per-IP rate limit (#104) |
| Security response headers + CSP | OWASP ASVS V14.4 | ✅ | nosniff / `X-Frame-Options: DENY` / Referrer-Policy / HSTS / enforcing CSP (#105/#113) |
| Session-token transport | RFC 6750 + Browser-Based Apps BCP | ◑ in progress | `Authorization: Bearer` primary; `HttpOnly`/`Secure`/`SameSite=Strict` cookie fallback (Phase 1, #112). **Phase 2** (drop `localStorage`, SPA relies on cookie + `/me`) = the BCP/BFF target — tracked in #103 |
| Session lifetime | — | ℹ️ note | HS256, 1h expiry, no refresh token. Acceptable for a single self-hosted service (same service signs+verifies); a refresh flow would be a UX improvement, not a security gap |

---

## Standards referenced

- **HL7 SMART App Launch** (FHIR R4) — provider authorization & launch.
- **RFC 6749** (OAuth 2.0), **RFC 6750** (Bearer Token Usage), **RFC 7636** (PKCE).
- **RFC 9700** — OAuth 2.0 Security Best Current Practice.
- **IETF "OAuth 2.0 for Browser-Based Apps"** — the BFF recommendation.
- **OWASP ASVS** — application security verification.

## Open conformance follow-ups

| ID | Item | Where |
|---|---|---|
| G1 | Bind `state`/`code_verifier` server-side to the user session | SMART connect flow (`source.go`) |
| G2 | Validate `id_token` if `openid` is used | SMART connect flow |
| H2 | Finish #103 Phase 2 (SPA → cookie, drop `localStorage`) | frontend `auth.service` |
| — | Angular framework upgrade (XSS advisories unpatched in v14) | #114 |
