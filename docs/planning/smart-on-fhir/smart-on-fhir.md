# SMART on FHIR — master plan

Living research-and-decision doc for the [EPIC #20](https://github.com/jwilleke/yourphr/issues/20) (SMART on FHIR live provider sync). Directly serves the mission in [issue #15](https://github.com/jwilleke/yourphr/issues/15) — immediate, complete patient access to records.

Tracked work: EPIC #20 → spike #48, generic client #49, relay #50, backend endpoints #51, frontend connect UI #52, Veradigm #53. Non-US-Core display polish is __deferred__ (volunteer-driven) in #54.

This is the __master__ doc; it will be upgraded as decisions are made. The relay-specific deep dive lives in [`oauth-gateway.md`](./oauth-gateway.md). Related ingestion options and ecosystem notes are in [`../personal-health/health-record-aggregation.md`](../personal-health/health-record-aggregation.md) and [`../personal-health/fastenhealth-ecosystem.md`](../personal-health/fastenhealth-ecosystem.md).

## Status

- __Phase:__ research / design. No implementation started.
- __Last updated:__ 2026-06-04.
- __Decisions made (all):__ __all Go__ (client *and* relay); store-and-poll relay, self-hosted; __per-user / BYO `client_id`__ distribution with a configurable dumb relay; __one generic SMART-R4 client__; __first provider Veradigm__ (sandbox first); __SMART-now__ (non-US-Core display deferred, #54); no Fasten Lighthouse server; rename "Lighthouse" identifiers (see [Decision log](#decision-log)). No open decisions remain — execution is tracked in EPIC #20.

## TL;DR

- "SMART on FHIR" is OAuth2 authorization-code + PKCE layered on a FHIR API. The protocol is standard; the hard parts are (1) a __public `redirect_uri`__ for an instance that may not be internet-reachable, and (2) __per-provider app registration/approval__, which is external and is the real calendar risk.
- The frontend __already implements__ the relay protocol and a desktop poll flow, and the repo already depends on a top-tier OAuth library. We should __reuse__, not rebuild.
- `yourphr.nerdsbythehour.com` is a __dev/demo platform__, so the first target should be a __SMART sandbox__ (test patients, no PHI, flexible registration), not a real provider.

## What SMART on FHIR requires

The OAuth callback gateway is only __one__ required piece (the public redirect target), not the whole flow. For a patient standalone launch there are three categories.

### Prerequisites (per provider, one-time, external — the long pole)

- A registered SMART app at the provider developer portal yields a `client_id` (and sometimes a `client_secret`).
- Pre-registered `redirect_uri` values that exactly match the public callback URL. This is *why* a gateway/relay must exist.
- Declared scopes, e.g. `launch/patient`, `patient/*.read`, `openid fhirUser`, `offline_access`.
- The provider FHIR base URL and SMART endpoints, discoverable at `GET {fhirBase}/.well-known/smart-configuration`.

### Runtime flow (every connection)

| Step | What happens | Who needs it |
|---|---|---|
| 1. Discover | `GET .well-known/smart-configuration` returns auth/token endpoints | our backend |
| 2. Build authorize URL | `response_type=code`, `client_id`, `redirect_uri`, `scope`, `state`, `aud`, `code_challenge` (PKCE S256) | our backend |
| 3. Redirect browser | user logs into the portal and consents | provider |
| 4. Provider redirects back | callback URL receives `code` and `state` | __the gateway__ |
| 5. Token exchange | `POST token_endpoint` with `code` + `code_verifier`, returns `access_token`, `refresh_token`, `patient`, `expires_in` | our backend |
| 6. Fetch data | `GET {fhirBase}/Patient/{id}/$everything` with a bearer token | our backend |
| 7. Refresh | on expiry, `POST token_endpoint` with `grant_type=refresh_token` (needs `offline_access`) | our backend (scheduled) |

### Components we must build

| ID | Component | Is it "the gateway"? |
|---|---|---|
| A | Per-provider config/credential store (`client_id`, scopes, FHIR base) | no |
| B | Public, stable HTTPS `redirect_uri` reachable by the provider | __yes__ |
| C | PKCE + `state` generation, stored locally to tie callback to session | no |
| D | Token-exchange logic (code to tokens) + encrypted token storage | no |
| E | Refresh-token lifecycle (scheduled refresh) | no |
| F | FHIR fetch + ingest (Bundle to `UpsertRawResource`) | no |
| G | UI to initiate connect and handle success/error | no |

__Gateway__ answers "where does the provider redirect to?" (component B only). __SMART on FHIR__ answers "how do we get authorized and pull the records?" — the gateway is just step 4.

## The core problem

SMART requires a publicly reachable `redirect_uri`, but a self-hosted instance often is not publicly reachable. Upstream solved this with Fasten Lighthouse — a hosted relay moved into the commercial Fasten Connect product (upstream issue #629) — which is why the fork's `fasten-sources` is a stub today and live sync is non-functional.

Two framings matter:

- __The demo platform.__ `yourphr.nerdsbythehour.com` is a development/demo, not a locked-down LAN production box, so the "maximal LAN isolation" rationale is weak for it. For the demo we can make a callback public (or just use a sandbox) with little concern.
- __The distributed product.__ End users each run their own instance at different, often non-public, URLs. "One app needs thousands of redirect URIs" is the classic self-hosted-OAuth problem. A shared *registered-app* relay (one provider registration for everyone) is what Lighthouse was, but we reject that model — see the distribution-model decision below.

## What the repo already implements (reuse, do not rebuild)

- `frontend/src/app/services/lighthouse.service.ts` implements the __Lighthouse relay protocol__: `generateSourceAuthorizeUrl()`, then `redirectWithOriginAndDestination()` which registers an `origin_url` + `dest_url` with a relay and forwards through a `redirect/{state}` URL.
- __Desktop poll mode__ is already coded: it routes to a `desktop/callback/{state}` path and __polls__ with `waitForDesktopCodeOrTimeout(state)` then `redirectWithDesktopCode()`. This is the same "store the code, client polls for it" design as the gateway plan — already implemented on the client.
- Build configs exist for `desktop_sandbox`, `desktop_prod`, `offline_sandbox`, plus a `desktop-callback` page wired into routing.
- `@panva/oauth4webapi` is already a dependency (`frontend/package.json`).
- Backend scaffolding exists: `SourceCredential` carries OAuth token fields and a `RefreshDynamicClientAccessToken()` method (called in `backend/pkg/web/handler/source.go`), and the Bundle-to-ingest path (component F) already exists via `CreateManualSource`.

__Implication:__ the relay/poll design is largely existing frontend work. The main new task is a relay backend that speaks the protocol the frontend already expects, plus backend components C, D, E.

## Method options (be open)

| Method | Public endpoint needed | Notes | Status in repo |
|---|---|---|---|
| Desktop / poll (loopback-style: client polls relay for code) | relay only; nothing inbound to the instance | strongest isolation | frontend already implemented |
| Shared relay (Lighthouse model: one registration per provider, fan-out by `state`) | the relay | lowest user friction; reuses most code | frontend protocol already implemented; needs a relay backend |
| Per-user public deploy (Cloudflare Tunnel / own domain, register own URL) | the instance itself | trivial for the demo | not built |
| BYO-registration (each user registers their own SMART app) | their instance URL | most decentralized; high user friction | not built |
| Non-OAuth ingestion (manual export, Apple Health intermediary) | none | works today; sidesteps SMART | manual import works |

__Distribution model — DECIDED (2026-06-04): per-user / BYO `client_id` + a configurable dumb relay.__ Each user registers their own SMART app (their own `client_id`) — they are the patient exercising their own access right, which keeps ToS clean, avoids a shared credential, removes central project liability, and isolates blast radius. The public `redirect_uri` problem is solved separately by a __provider-agnostic, client-agnostic relay__ that only bounces a short-TTL `code` by `state` (never a registered app, never sees tokens); its endpoint is configurable — a project-hosted convenience relay or a self-hosted one.

__Rejected: Option A__ — a shared *registered-app* relay (one project-owned `client_id` for everyone). That is the Fasten Lighthouse model Fasten commercialized, with central liability, ongoing cost, ToS exposure (operating apps on behalf of strangers), and a single point of failure.

## Relay architecture

Deep dive in [`oauth-gateway.md`](./oauth-gateway.md).

### The problem it solves

SMART requires the provider to redirect the browser to a __pre-registered, publicly reachable HTTPS `redirect_uri`__ carrying the authorization `code`. A self-hosted instance often cannot be that URL (LAN-only, behind NAT, dynamic address, or simply not registered). A __relay__ is a small public service that *is* the registered URL and gets the `code` back to the instance. The instance then exchanges the code for tokens __directly with the provider__ — the relay never sees tokens.

### Three patterns

1. __Web relay (browser-redirect bounce)__ — the model the frontend already implements. One public relay URL is registered as the `redirect_uri` (one registration per provider, shared by all instances). Before redirecting, the instance registers `state -> origin_url` with the relay. The provider redirects to `relay/callback?code&state`; the relay looks up `state` and 302-redirects the browser to the instance's own callback, which exchanges the code locally. Requires the user's browser to be able to reach the instance (a LAN browser reaches a LAN instance fine).
2. __Store-and-poll relay__ — the model the frontend already implements for desktop mode, and the design in `oauth-gateway.md`. The relay __stores__ `{state -> code}` with a short TTL; the instance __polls__ the relay for the code, then exchanges it locally. Nothing is inbound to the instance — it only makes outbound calls. Maximal isolation.
3. __No relay (inline public callback)__ — if the instance itself is publicly reachable at a stable HTTPS URL (e.g. the demo via Cloudflare Tunnel or a public deploy), register *that* as the `redirect_uri`. The provider redirects straight to the instance, which exchanges inline. Simplest; requires the instance to be public.

### Flow (store-and-poll variant)

```text
1.  User clicks "Connect provider"
2.  Instance: generate state + PKCE verifier/challenge; store locally
3.  Instance: redirect browser to provider authorize endpoint
    (redirect_uri = https://relay.example/callback, state=S, code_challenge=...)
4.  User logs in at provider, consents
5.  Provider: redirect browser to https://relay.example/callback?code=C&state=S
6.  Relay: store {S -> C} with ~60s TTL; show "you may close this window"
7.  Instance: poll relay GET /pending?state=S   (gated by shared secret)
8.  Relay: return C, delete the entry
9.  Instance: POST provider token endpoint with C + code_verifier -> tokens
10. Instance: store tokens (encrypted SQLite); scheduled refresh thereafter
```

### Decision and remaining options

__Decided:__ we will __not__ use Fasten's hosted Lighthouse relay (commercial; see IP section), and per the __all-Go__ decision the relay is a __self-hosted Go store-and-poll service__ (not a Cloudflare Worker, which would be JS/TS). It is a small public Go HTTP service that stores `{state -> code}` with a short TTL and serves a shared-secret-gated poll endpoint; tokens never pass through it.

Hosting — *DECIDED for dev/demo: the existing k8s cluster via [`mj-infra-flux`](https://github.com/jwilleke/mj-infra-flux)* behind the current Cloudflare ingress at __`relay.nerdsbythehour.com`__ (the dev infra domain — `yourphr.org` is the static GitHub Pages site and cannot host a service): a Deployment + Service + Ingress + Secret under `apps/.../yourphr-relay/`, reconciled by Flux like the `fasten` app. Lowest friction, GitOps-consistent, no new vendor.

The relay must be __publicly reachable__ even though the app (`yourphr.nerdsbythehour.com`) is internal/LAN — it is the one public piece, served by its own ingress, and it must __not__ be behind Authentik (`/callback` is unauthenticated; `/pending` is gated by the shared secret).

*Revisit a managed runtime (Fly.io / Cloud Run) at `relay.yourphr.org` for the distributed product*, so the shared, brand-consistent relay isn't bound to homelab uptime — trivial to move since the relay is stateless (short-TTL codes only, never tokens). Rejected alternatives: Cloudflare Worker + KV (JS/TS), and a per-user Cloudflare Tunnel exposing the instance's own callback (viable for the public demo only, not for non-public user instances).

### Security properties

- The relay only ever sees the short-lived `code` (~60s TTL), never `access`/`refresh` tokens.
- __PKCE__ binds the code to the instance: a stolen code is useless without the `code_verifier`, which never leaves the instance.
- __`state`__ ties the callback to the originating session (CSRF) and routes to the right instance.
- The poll endpoint is gated by a shared secret (store-and-poll variant).

### Naming (trademark hygiene)

Audit result: "Lighthouse" appears __only in internal code identifiers__ (e.g. `LighthouseService`, `lighthouse_api_endpoint_base`) across 21 `.ts` files, __never in user-facing UI strings__ — so trademark exposure is low (trademark targets user-facing use in commerce, not internal symbols). Still, because we build our __own__ relay (not Fasten's), relay-specific identifiers should be renamed to neutral terms (a "connect gateway" / "OAuth relay") during the relay refactor, so we are not naming our component after Fasten's product. Deep upstream-interface identifiers we still interoperate with (`fasten-sources`, `FastenDisplayModel`) can stay per `AGENTS.md`.

## Well-tested implementations to use

Do not hand-roll OAuth.

Decided: __all Go__ (see open decision 2). No JS in the product path.

| Layer | Use | Why |
|---|---|---|
| SMART client — discovery, PKCE, token exchange, refresh (spike + production) | `golang.org/x/oauth2` (PKCE via `GenerateVerifier` / `S256ChallengeOption`) + `net/http` | all-Go, canonical, battle-tested; the Go spike exercises the same libraries the product uses |
| FHIR parsing | existing `fastenhealth/gofhir-models` | already used; ingest path exists |
| Frontend (optional) | existing `@panva/oauth4webapi` only if the frontend builds authorize URLs | not needed if the Go backend builds the authorize URL and handles the callback |
| Dev/demo target | SMART sandboxes: SMART Health IT (`launch.smarthealthit.org`), Epic (`fhir.epic.com`), Cerner/Oracle, Logica | test patients, flexible registration, zero PHI |

SMART on FHIR is roughly `.well-known` discovery (a plain GET) + OAuth2 auth-code-with-PKCE (`x/oauth2`) + FHIR fetch (existing models) — __all Go__. No bespoke SMART library is needed, and the relay is a small self-hosted __Go__ store-and-poll service too (see [Relay architecture](#relay-architecture)).

## Recommended sequencing (de-risk first)

Mapped to EPIC #20 child issues:

1. __Spike against a SMART sandbox__ (#48, throwaway Go): prove the full PKCE flow end-to-end (authorize, callback, token exchange, `GET /Patient/$everything`, save bundle) with test patients and no PHI, using the production libraries (`golang.org/x/oauth2`).
2. __Generic Go SMART-R4 client__ (#49): discovery + PKCE + token exchange + refresh in the `fasten-sources` stub (components A, C, D, E).
3. __Self-hosted Go store-and-poll relay__ (#50): component B, deployed via `mj-infra-flux` at `relay.nerdsbythehour.com`.
4. __Backend OAuth endpoints + token storage + scheduled refresh__ (#51): wire into `source.go` / `server.go` (components C, D, E, F).
5. __Frontend: rename `Lighthouse` identifiers + re-enable "Add Source" UI__ (#52, component G).
6. __Veradigm registration + end-to-end integration__ (#53), after the sandbox spike passes.

Deferred (not blocking): non-US-Core display polish (#54). Additional providers (Epic, etc.) come later.

## UDAP / Dynamic Client Registration (north star — deferred, #355)

Our per-provider __bring-your-own-`client_id`__ (manual app registration, the "long pole" prerequisite above) is the manual version of what __UDAP (Unified Data Access Profiles)__ automates. UDAP is a set of open standards on top of OAuth 2.0 / OIDC — __Dynamic Client Registration__ (register on-the-fly via a signed JWT + X.509 cert), JWT/cert-bound client auth, and trust frameworks — incorporated into the __HL7 FAST Security IG__ (FHIR at Scale Taskforce) and used by Carequality, CARIN Blue Button, and Da Vinci HRex. It layers on the SMART flow we already build, so it's complementary, not a replacement.

__Why it's deferred, not near-term:__ patient-facing EHR FHIR APIs (Epic, Cerner, athenahealth patient access) today overwhelmingly use __plain SMART-on-FHIR with manual app registration__ — they don't require or offer UDAP DCR for a patient pulling their own records. UDAP DCR adoption is real in __B2B / payer (CARIN)__ contexts, much less for consumer patient access. So UDAP doesn't unblock current patient-record access (the mission); it's the right framework for [#355](https://github.com/jwilleke/yourphr/issues/355) when we scale to many providers / B2B. Refs: <https://www.udap.org>, HL7 FAST Security IG.

## Intellectual property and licensing

Short version: __no copyright/IP-infringement risk__ in building our own SMART client and relay on open standards and permissive libraries. The real obligations are contractual (per-provider terms) and license hygiene (GPLv3 + no reuse of Fasten's private/commercial code or marks).

### Veradigm (and other providers)

- Access is via SMART on FHIR under __patient-access rights__ (21st Century Cures Act / ONC info-blocking rules). The data is the patient's own; FHIR R4 is an open HL7 standard, free to implement.
- The obligation is __contractual, not copyright__: each provider runs a developer program with Terms of Use / an API agreement (app registration, allowed use, rate limits, sometimes production approval). We must read and comply with the `developer.veradigm.com` terms (and `fhir.epic.com` for Epic).
- We copy nothing from Veradigm — we are a standards client to their public patient API. No IP concern there.
- Watch for terms that restrict commercial use or redistribution, or require attribution; these matter if YourPHR is distributed. Confirm per provider before production.

### Fasten Lighthouse

- Lighthouse is Fasten Health's __proprietary__ hosted relay, now part of the commercial Fasten Connect product. Its server source was never open-sourced.
- __Decided (2026-06-04): we will not use Fasten's hosted Lighthouse server__ under any circumstances. We do not have, use, or copy its server code, and we will not free-ride on the hosted service. We build our __own__ relay (or use the no-relay option).
- The relay __protocol__ (`origin_url` / `dest_url` / `redirect/{state}`) is an interface. Independently reimplementing an API/protocol is well-established as non-infringing (cf. *Google v. Oracle*). We write our own server against the protocol the GPL client already speaks.
- The __client__ that speaks it (`lighthouse.service.ts`) is part of `fasten-onprem`, GPLv3 — we inherited it legally under GPL.
- __Trademark:__ "Fasten" and "Lighthouse" are Fasten's marks. Per `AGENTS.md` we keep internal identifiers (e.g. `FastenLighthouseEnvSandbox`) but user-facing product strings are YourPHR. Do not brand the relay as "Lighthouse" or imply Fasten endorsement.

### fasten-sources and the provider catalog

- Upstream `fasten-sources` was made private; our `fasten-sources-stub` is our own clean-room reimplementation of the interface. Do __not__ reintroduce upstream's private code or its proprietary brand/endpoint catalog.
- If we need a provider catalog, build it from __open__ sources: each provider's `.well-known/smart-configuration`, and public endpoint directories (ONC/CMS, Epic's open endpoint list, CARIN / National Directory) — not a copied private catalog.

### Our code and dependency licenses

- The fork is __GPLv3__; new code (backend client, relay integration) inherits GPLv3 obligations (publish source). Keep our relay GPL-compatible and, ideally, open-source it for community trust.
- GPLv3 is not AGPLv3: running a network relay does not by itself force source disclosure, but we intend to open it anyway.
- Per the all-Go decision, planned dependencies are just `golang.org/x/oauth2` (BSD-3-Clause) and `fastenhealth/gofhir-models` (verify license at adoption) — both permissive and GPLv3-compatible. No new JS OAuth dependencies (`fhirclient` dropped; `@panva/oauth4webapi` is only relevant if the existing Angular frontend builds authorize URLs).

### Action items

- Read and record the Veradigm developer Terms of Use before registering the app.
- Confirm `fastenhealth/gofhir-models` exact license at adoption.
- Add the Go relay to `mj-infra-flux` (`apps/.../yourphr-relay/`: Deployment + Service + Ingress + Secret) with DNS `relay.nerdsbythehour.com` (dev); ensure it is publicly reachable and excluded from Authentik forward-auth. Reserve `relay.yourphr.org` for a future product relay.
- Open-source the Go relay (recommended) under GPLv3 to match the fork.

## Open decisions

1. __Relay architecture__ — *DECIDED: store-and-poll, self-hosted __Go__ relay, hosted on the existing k8s cluster via `mj-infra-flux` + Cloudflare ingress for dev/demo* (not Fasten Lighthouse, not a JS Cloudflare Worker). Revisit a managed runtime (Fly.io / Cloud Run) for the distributed product.
2. __Where the production SMART client runs__ — *DECIDED (2026-06-04): all Go.* The full SMART flow (discovery, PKCE, token exchange, refresh, FHIR fetch) is built in the __Go backend__ with `golang.org/x/oauth2` + `net/http` + `gofhir-models`. `fhirclient` is dropped; the de-risk spike is also written in Go so it exercises the production libraries. The relay is Go as well — a self-hosted store-and-poll service (decision 1).
3. __Generic vs per-vendor client__ — *DECIDED: one generic SMART-R4 client* driven by `.well-known` discovery + per-provider config. Vendor quirks (Veradigm non-US-Core) belong in the display/normalization layer (upstream #428 / #431 / #347), not the auth client.
4. __Distribution model__ — *DECIDED: per-user / BYO `client_id` + a configurable dumb relay* (not a shared registered-app relay). See [Method options](#method-options-be-open).
5. __First provider target__ — *DECIDED: Veradigm/FollowMyHealth* (the primary source; FHIR R4, non-US-Core, `$everything` supported). A SMART sandbox is the first integration target regardless, before real Veradigm.
6. __Sequencing vs display bugs__ — *DECIDED: SMART-now.* Build SMART sync now; __defer non-US-Core display polish__ (#54) as volunteer-driven. SMART stores the records regardless (the mission is access); rendering refinement for non-US-Core resources is separate and not on the near-term roadmap.

## Files likely to change (in `jwilleke/yourphr`)

| File / area | Change |
|---|---|
| `fasten-sources-stub/clients/factory/factory.go` | replace stub `GetSourceClient` with a real generic SMART client |
| `fasten-sources-stub/clients/models/models.go` | implement `SourceClient` interface methods |
| `backend/pkg/web/handler/source.go` | OAuth initiation + token-exchange (and/or code-poll) endpoints |
| `backend/pkg/web/server.go` | register new OAuth routes |
| relay (new) | self-hosted __Go__ store-and-poll service + its deploy manifest (e.g. in `mj-infra-flux` behind Cloudflare ingress) |
| `frontend/src/app/services/lighthouse.service.ts` + medical-sources components | rename to a neutral "connect gateway", point at the new relay, re-enable provider connect UI |

## References

- Issues: [#20](https://github.com/jwilleke/yourphr/issues/20) (this feature), [#15](https://github.com/jwilleke/yourphr/issues/15) (mission).
- Upstream: `fastenhealth/fasten-onprem` #629 (Lighthouse moved to commercial Fasten Connect).
- Specs: HL7 SMART App Launch; OAuth 2.0 for Native Apps (RFC 8252); PKCE (RFC 7636).
- Sibling docs: [`oauth-gateway.md`](./oauth-gateway.md), [`../personal-health/health-record-aggregation.md`](../personal-health/health-record-aggregation.md), [`../personal-health/fastenhealth-ecosystem.md`](../personal-health/fastenhealth-ecosystem.md).

## Decision log

Append dated entries as decisions are made.

- __2026-06-04 — No Fasten Lighthouse server.__ We will not use Fasten's hosted Lighthouse relay (commercial; not open). We run our own relay or use the no-relay (inline public callback) option. Resolves part of open decision 1.
- __2026-06-04 — DECIDED: all Go (client and relay).__ The full SMART flow is built in the Go backend with `golang.org/x/oauth2` + `net/http` + `gofhir-models`; the de-risk spike is written in Go too; `fhirclient` and other JS OAuth deps are dropped. Resolves open decision 2.
- __2026-06-04 — DECIDED: store-and-poll relay, self-hosted Go service, hosted via `mj-infra-flux`.__ Maximal isolation (only outbound polls from the instance), matches the desktop-poll flow the frontend already implements, consistent with "no Fasten Lighthouse" and "all Go." The relay is a small public Go HTTP service (not a JS Cloudflare Worker); tokens never pass through it. For dev/demo it deploys to the existing k8s cluster via `mj-infra-flux` behind Cloudflare ingress at `relay.nerdsbythehour.com` (the dev domain; `yourphr.org` is static GitHub Pages), excluded from Authentik. Revisit Fly.io / Cloud Run at `relay.yourphr.org` for the distributed product (stateless, so trivial to move). Resolves open decision 1.
- __2026-06-04 — DECIDED: distribution model = per-user / BYO `client_id` + configurable dumb relay.__ Each user registers their own SMART app (own `client_id`); the relay is a provider-agnostic, client-agnostic code-bouncer (project-hosted or self-hosted, configurable) that never holds a registered app or tokens. Rejected Option A (shared registered-app relay = the commercial Lighthouse model: central liability, cost, ToS exposure, single point of failure). Keeps ToS clean, decentralizes trust, isolates blast radius. Resolves open decision 4.
- __2026-06-04 — DECIDED: one generic SMART-R4 client.__ A single generic client driven by `.well-known/smart-configuration` discovery + per-provider config, not per-vendor auth code. Vendor data quirks (Veradigm non-US-Core) are handled in the display/normalization layer (#428 / #431 / #347). Resolves open decision 3.
- __2026-06-04 — DECIDED: first provider = Veradigm/FollowMyHealth.__ The primary source (FHIR R4, non-US-Core, `$everything`). A SMART sandbox (`launch.smarthealthit.org`, etc.) is the first integration target regardless, before real Veradigm. Resolves open decision 5.
- __2026-06-04 — Rename "Lighthouse" identifiers (trademark hygiene).__ Audit found "Lighthouse" only in internal `.ts` identifiers, never user-facing — so legal risk is low, but since we build our own relay we will rename relay-specific identifiers (e.g. `LighthouseService`, `lighthouse_api_endpoint_base`) to neutral terms during the relay refactor. Keep deep upstream-interface identifiers (`fasten-sources`, `FastenDisplayModel`) per `AGENTS.md`. This is a scoped exception to the "do not rename internal identifiers" guidance, justified because we are replacing the component they name.
- __2026-06-04 — DECIDED: SMART-now; defer non-US-Core display.__ Build SMART sync now; non-US-Core display polish is deferred and volunteer-driven (#54) — possibly never unless a contributor takes it. SMART stores the records regardless, so this does not block access. Resolves open decision 6. Execution tracked in EPIC #20 (children #48–#53).
