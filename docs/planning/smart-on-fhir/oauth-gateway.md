# OAuth callback relay — deep dive

Relay-specific deep dive for [EPIC #20](https://github.com/jwilleke/yourphr/issues/20). The overall plan and all decisions live in [`smart-on-fhir.md`](./smart-on-fhir.md); this file covers just the relay (component B — the public `redirect_uri`).

## Background

Upstream `fasten-sources` used Fasten Lighthouse — a hosted cloud OAuth relay — as the callback endpoint for SMART on FHIR. Lighthouse moved to the commercial Fasten Connect product (`fastenhealth/fasten-onprem#629`), so provider sync is broken in the open-source build, and we will **not** use Fasten's hosted relay.

The underlying problem: a self-hosted instance (e.g. `yourphr.nerdsbythehour.com`, internal/LAN behind Authentik) is unreachable from the internet, but provider portals need a publicly accessible `redirect_uri` to deliver the authorization `code`. We need our own public relay.

## Chosen approach: self-hosted Go store-and-poll relay

A small **Go** HTTP service at a public URL receives the provider's redirect, stores the short-lived authorization `code` keyed by `state`, and serves it to the local instance, which polls for it and completes the token exchange directly with the provider. The relay never sees tokens. This is the **store-and-poll** pattern; it matches the desktop-poll flow the frontend already implements.

This reflects the project decisions (see [`smart-on-fhir.md`](./smart-on-fhir.md)): **all Go**, **store-and-poll**, **self-hosted** (not a JS Cloudflare Worker, not Fasten Lighthouse), **per-user / BYO `client_id`**.

### Why this approach

- **All Go** — one language across client and relay; reuses the team's Go toolchain and `mj-infra-flux` GitOps.
- **Codes never leave the relay as tokens** — the relay stores the `code` for ~60 seconds then deletes it; it never sees access/refresh tokens.
- **Token exchange is local** — the instance exchanges the `code` with the provider directly; the relay never touches tokens.
- **Nothing inbound to the instance** — the instance only makes outbound calls (the redirect and the poll), so a LAN/NAT instance stays reachable-free; only the relay is public.
- **Provider-agnostic and client-agnostic** — the relay is a dumb bouncer keyed by `state`; it holds no provider app registration and no `client_id` (BYO model).

### Flow

```text
1.  User clicks "Connect provider" in the UI
2.  Instance: generate state + PKCE verifier/challenge; store locally
3.  Instance: redirect browser to the provider authorize endpoint
    (redirect_uri = https://relay.nerdsbythehour.com/callback, state=S, code_challenge=...)
4.  User logs into the provider portal and authorizes
5.  Provider: redirect browser to https://relay.nerdsbythehour.com/callback?code=C&state=S
6.  Relay: store {S -> C} in memory with ~60s TTL; return "you may close this window"
7.  Instance: poll its own backend, which polls the relay GET /pending?state=S (shared-secret gated)
8.  Relay: return C, delete the entry
9.  Instance: exchange C (+ PKCE verifier) for access + refresh tokens at the provider token endpoint
10. Instance: store tokens (encrypted SQLite); scheduled refresh drives ongoing sync
```

### Relay API (two endpoints)

| Endpoint | Method | Description |
|---|---|---|
| `/callback?code=C&state=S` | GET | Receives the provider redirect; stores `{state: code}` with ~60s TTL; returns 200 HTML "you may close this window" |
| `/pending?state=S` | GET | Called by the local instance; returns `{code}` and deletes the entry, or 404 if not yet arrived. Gated by a shared secret header (`X-Yourphr-Token`) so codes cannot be harvested by guessing `state` |

State is held in memory with a TTL (no external KV needed); a single small replica is sufficient and entries are ephemeral.

## Hosting

For dev/demo, deploy via [`mj-infra-flux`](https://github.com/jwilleke/mj-infra-flux) to the existing k8s cluster behind the current Cloudflare ingress at **`relay.nerdsbythehour.com`** (the dev infra domain; `yourphr.org` is the static GitHub Pages site and cannot host a service). It is a Deployment + Service + Ingress + Secret under `apps/.../yourphr-relay/`, reconciled by Flux like the `fasten` app.

The relay must be **publicly reachable and excluded from Authentik forward-auth** (`/callback` is unauthenticated; `/pending` is shared-secret gated). Even though the app is internal/LAN, the relay is the one public piece, served by its own ingress.

For the eventual distributed product, reserve **`relay.yourphr.org`** on a managed runtime (Fly.io / Cloud Run) so the shared relay is not bound to homelab uptime — trivial to move since the relay is stateless.

## Rejected alternative: Cloudflare Worker + KV

The original plan used a stateless Cloudflare Worker storing codes in Cloudflare KV. Rejected to satisfy the **all-Go** decision: a Worker is JS/TS, a second language and toolchain outside `mj-infra-flux`. A self-hosted Go service does the same job (store-and-poll, tokens never pass through) in one language on the existing infra. The Worker remains a viable option only if we later want zero-ops hosting for the product relay.

## Security considerations

- The relay only ever holds the short-lived `code` (~60s TTL), never access/refresh tokens.
- **PKCE** is required: a stolen `code` is useless without the `code_verifier`, which never leaves the instance.
- The `/pending` endpoint is gated by a shared secret.
- The `state` parameter ties the `code` to the originating session (CSRF) and routes it to the right instance.
- In-memory entries auto-expire; no manual cleanup and no durable store of codes.

## Work breakdown (EPIC #20)

- **#50 — relay**: the Go store-and-poll service + `mj-infra-flux` deploy at `relay.nerdsbythehour.com`.
- **#51 — backend**: authorize-initiation + callback/poll endpoints, token exchange, encrypted token storage, scheduled refresh.
- **#52 — frontend**: rename the `Lighthouse` identifiers to a neutral connect-gateway, point at the new relay, re-enable the "Add Source" connect UI.
- **#49 — client**: the generic Go SMART-R4 client the backend drives (core merged; see the master plan).

## Files that will change (in `jwilleke/yourphr`)

| File / area | Change |
|---|---|
| relay (new) | self-hosted Go store-and-poll service + deploy manifest in `mj-infra-flux` |
| `fasten-sources-stub/clients/...` | generic SMART-R4 client (core merged in `clients/smart`); factory wiring |
| `backend/pkg/web/handler/source.go` | OAuth initiation + callback/poll endpoints, token exchange + refresh |
| `backend/pkg/web/server.go` | register the new OAuth routes |
| `frontend/src/app/services/lighthouse.service.ts` + medical-sources components | rename to a neutral connect-gateway; point at the relay; re-enable connect UI |
