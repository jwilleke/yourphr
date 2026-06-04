# OAuth callback gateway — plan

Plan for adding live provider sync to the self-hosted Fasten instance without relying on the commercial Fasten Lighthouse service.

## Background

The upstream `fasten-sources` library used Fasten Lighthouse — a hosted cloud OAuth relay — as the callback endpoint for SMART on FHIR provider authentication. Lighthouse was moved to the commercial Fasten Connect product (issue #629). Without it, provider sync is broken in the open-source build.

The underlying problem: `fasten.nerdsbythehour.com` is LAN-only and unreachable from the internet. Hospital portals need a publicly accessible `redirect_uri` to complete OAuth. Lighthouse was that public endpoint. We need our own equivalent.

## Chosen approach: Cloudflare Worker relay

A minimal stateless Cloudflare Worker sits at a public URL (e.g. `https://auth.nerdsbythehour.com/callback`) and acts as the OAuth relay. It stores the short-lived authorization code in Cloudflare KV, where the local Fasten instance polls for it and completes the token exchange directly with the provider.

### Why this approach

- **No server to maintain** — Cloudflare Workers free tier is sufficient
- **Codes never leave the relay** — the Worker stores the code for ≤60 seconds then deletes it; it never sees tokens
- **Token exchange is local** — Fasten exchanges the code with the provider directly from the LAN; the Worker never touches access/refresh tokens
- **LAN-only Fasten stays LAN-only** — only the `/callback` Worker endpoint is public

### Flow

```
1. User clicks "Connect provider" in Fasten UI
2. Fasten generates a state token + PKCE challenge; stores locally
3. Fasten redirects browser to provider's SMART authorization endpoint
   (e.g. https://fhir.veradigm.com/authorize?...&redirect_uri=https://auth.nerdsbythehour.com/callback&state=<token>)
4. User logs into provider portal and authorizes
5. Provider redirects to: https://auth.nerdsbythehour.com/callback?code=<code>&state=<token>
6. Worker stores {state → code} in KV with 60-second TTL
7. Fasten polls its own /api/oauth/poll?state=<token> endpoint
8. Fasten's backend polls Worker's GET /pending?state=<token>; Worker returns code
9. Fasten exchanges code for access + refresh tokens directly with the provider's token endpoint
10. Fasten stores tokens in SQLite; background worker uses refresh token for ongoing sync
```

### Worker API (two endpoints)

| Endpoint | Method | Description |
|---|---|---|
| `/callback?code=X&state=Y` | GET | Receives redirect from provider; stores `{state: code}` in KV (60s TTL); returns 200 HTML "you may close this window" |
| `/pending?state=Y` | GET | Called by local Fasten; returns `{code}` and deletes KV entry, or 404 if not yet arrived |

The `/pending` endpoint should require a shared secret header (`X-Fasten-Token`) to prevent anyone from polling for codes by guessing state values.

## Work required

### Phase 1 — Cloudflare Worker (standalone, ~1 day)

1. Create `workers/oauth-relay/` in the fork (or a separate repo)
2. Implement the two-endpoint Worker in TypeScript
3. Configure KV namespace `OAUTH_CODES`
4. Deploy to `auth.nerdsbythehour.com` via Cloudflare Pages/Workers
5. Add `FASTEN_RELAY_SECRET` as a Worker secret

### Phase 2 — SMART on FHIR client in Fasten (~1–2 weeks)

Replace the stubbed `fasten-sources` functionality with a real implementation:

1. **Provider registration:** store per-provider SMART app credentials (client_id, client_secret or PKCE-only) in a config file or encrypted in the DB
2. **Authorization flow:** generate PKCE challenge, build authorize URL, open browser
3. **Token exchange:** poll the Worker for the code, exchange with provider's token endpoint, store access + refresh tokens in `SourceCredential`
4. **Background refresh:** scheduled worker that checks token expiry, refreshes via provider's token endpoint
5. **Resource sync:** `GET /Patient/$everything` → parse Bundle → call `UpsertRawResource` for each entry

### Phase 3 — Per-provider registrations (~ongoing)

Each provider requires a separate SMART app registration:

| Provider | Developer portal | Notes |
|---|---|---|
| Veradigm / FollowMyHealth | developer.veradigm.com | FHIR R4, non-US-Core; `$everything` supported |
| Epic MyChart | fhir.epic.com | US Core R4; needs Epic app registration |
| CommonWell / Carequality | varies | Network-level, more complex |

### Phase 4 — Wire into Fasten UI (~1 week)

- Re-enable the "Add Source" → provider search flow in the frontend
- Connect to the new backend OAuth endpoints instead of the old `fasten-sources` factory
- Handle the "connect provider" success/error states

## Security considerations

- The Worker never sees access or refresh tokens — only the short-lived authorization code (60s TTL)
- PKCE is required for all flows (prevents code interception)
- The `/pending` endpoint is gated by `X-Fasten-Token` (shared secret, set in Worker env)
- State parameter ties the code to the originating session (prevents CSRF)
- Cloudflare KV entries auto-expire; no manual cleanup needed

## Relationship to current state

The `fasten-sources` stub in the fork (`./fasten-sources-stub`) satisfies all compile-time imports with stub implementations that return clear errors. The stub is the bridge until Phase 2 is complete. Phases can be implemented incrementally — Phase 1 (the Worker) can be deployed and tested with a standalone script before any Fasten backend work begins.

## Files that will change (in jwilleke/yourphr)

| File | Change |
|---|---|
| `fasten-sources-stub/clients/factory/factory.go` | Replace stub `GetSourceClient` with real implementation |
| `fasten-sources-stub/clients/models/models.go` | Implement `SourceClient` interface methods |
| `backend/pkg/web/handler/source.go` | OAuth initiation + code polling endpoints |
| `backend/pkg/web/server.go` | Register new OAuth routes |
| `workers/oauth-relay/` | New: Cloudflare Worker source |
| `frontend/src/app/components/...` | Re-enable provider connect UI |
