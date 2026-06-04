# SMART on FHIR — master plan

Living research-and-decision doc for [issue #20](https://github.com/jwilleke/yourphr/issues/20)
(support SMART on FHIR live provider sync). Directly serves the mission in
[issue #15](https://github.com/jwilleke/yourphr/issues/15) — immediate, complete patient
access to records.

This is the **master** doc; it will be upgraded as decisions are made. The relay-specific
deep dive lives in [`oauth-gateway.md`](./oauth-gateway.md). Related ingestion options and
ecosystem notes are in
[`../personal-health/health-record-aggregation.md`](../personal-health/health-record-aggregation.md)
and [`../personal-health/fastenhealth-ecosystem.md`](../personal-health/fastenhealth-ecosystem.md).

## Status

- **Phase:** research / design. No implementation started.
- **Last updated:** 2026-06-04.
- **Decisions made:** none yet (see [Open decisions](#open-decisions) and [Decision log](#decision-log)).

## TL;DR

- "SMART on FHIR" is OAuth2 authorization-code + PKCE layered on a FHIR API. The protocol is
  standard; the hard parts are (1) a **public `redirect_uri`** for an instance that may not be
  internet-reachable, and (2) **per-provider app registration/approval**, which is external and
  is the real calendar risk.
- The frontend **already implements** the relay protocol and a desktop poll flow, and the repo
  already depends on a top-tier OAuth library. We should **reuse**, not rebuild.
- `yourphr.nerdsbythehour.com` is a **dev/demo platform**, so the first target should be a
  **SMART sandbox** (test patients, no PHI, flexible registration), not a real provider.

## What SMART on FHIR requires

The OAuth callback gateway is only **one** required piece (the public redirect target), not the
whole flow. For a patient standalone launch there are three categories.

### Prerequisites (per provider, one-time, external — the long pole)

- A registered SMART app at the provider developer portal yields a `client_id`
  (and sometimes a `client_secret`).
- Pre-registered `redirect_uri` values that exactly match the public callback URL. This is *why*
  a gateway/relay must exist.
- Declared scopes, e.g. `launch/patient`, `patient/*.read`, `openid fhirUser`, `offline_access`.
- The provider FHIR base URL and SMART endpoints, discoverable at
  `GET {fhirBase}/.well-known/smart-configuration`.

### Runtime flow (every connection)

| Step | What happens | Who needs it |
|---|---|---|
| 1. Discover | `GET .well-known/smart-configuration` returns auth/token endpoints | our backend |
| 2. Build authorize URL | `response_type=code`, `client_id`, `redirect_uri`, `scope`, `state`, `aud`, `code_challenge` (PKCE S256) | our backend |
| 3. Redirect browser | user logs into the portal and consents | provider |
| 4. Provider redirects back | callback URL receives `code` and `state` | **the gateway** |
| 5. Token exchange | `POST token_endpoint` with `code` + `code_verifier`, returns `access_token`, `refresh_token`, `patient`, `expires_in` | our backend |
| 6. Fetch data | `GET {fhirBase}/Patient/{id}/$everything` with a bearer token | our backend |
| 7. Refresh | on expiry, `POST token_endpoint` with `grant_type=refresh_token` (needs `offline_access`) | our backend (scheduled) |

### Components we must build

| ID | Component | Is it "the gateway"? |
|---|---|---|
| A | Per-provider config/credential store (`client_id`, scopes, FHIR base) | no |
| B | Public, stable HTTPS `redirect_uri` reachable by the provider | **yes** |
| C | PKCE + `state` generation, stored locally to tie callback to session | no |
| D | Token-exchange logic (code to tokens) + encrypted token storage | no |
| E | Refresh-token lifecycle (scheduled refresh) | no |
| F | FHIR fetch + ingest (Bundle to `UpsertRawResource`) | no |
| G | UI to initiate connect and handle success/error | no |

**Gateway** answers "where does the provider redirect to?" (component B only). **SMART on FHIR**
answers "how do we get authorized and pull the records?" — the gateway is just step 4.

## The core problem

SMART requires a publicly reachable `redirect_uri`, but a self-hosted instance often is not
publicly reachable. Upstream solved this with Fasten Lighthouse — a hosted relay moved into the
commercial Fasten Connect product (upstream issue #629) — which is why the fork's `fasten-sources`
is a stub today and live sync is non-functional.

Two framings matter:

- **The demo platform.** `yourphr.nerdsbythehour.com` is a development/demo, not a locked-down LAN
  production box, so the "maximal LAN isolation" rationale is weak for it. For the demo we can make
  a callback public (or just use a sandbox) with little concern.
- **The distributed product.** End users each run their own instance at different, often
  non-public, URLs. "One app needs thousands of redirect URIs" is the classic self-hosted-OAuth
  problem. A **shared relay** (one registration per provider, fan-out by `state`) is the
  low-friction answer and is exactly what Lighthouse was.

## What the repo already implements (reuse, do not rebuild)

- `frontend/src/app/services/lighthouse.service.ts` implements the **Lighthouse relay protocol**:
  `generateSourceAuthorizeUrl()`, then `redirectWithOriginAndDestination()` which registers an
  `origin_url` + `dest_url` with a relay and forwards through a `redirect/{state}` URL.
- **Desktop poll mode** is already coded: it routes to a `desktop/callback/{state}` path and
  **polls** with `waitForDesktopCodeOrTimeout(state)` then `redirectWithDesktopCode()`. This is the
  same "store the code, client polls for it" design as the gateway plan — already implemented on
  the client.
- Build configs exist for `desktop_sandbox`, `desktop_prod`, `offline_sandbox`, plus a
  `desktop-callback` page wired into routing.
- `@panva/oauth4webapi` is already a dependency (`frontend/package.json`).
- Backend scaffolding exists: `SourceCredential` carries OAuth token fields and a
  `RefreshDynamicClientAccessToken()` method (called in
  `backend/pkg/web/handler/source.go`), and the Bundle-to-ingest path (component F) already exists
  via `CreateManualSource`.

**Implication:** the relay/poll design is largely existing frontend work. The main new task is a
relay backend that speaks the protocol the frontend already expects, plus backend components
C, D, E.

## Method options (be open)

| Method | Public endpoint needed | Notes | Status in repo |
|---|---|---|---|
| Desktop / poll (loopback-style: client polls relay for code) | relay only; nothing inbound to the instance | strongest isolation | frontend already implemented |
| Shared relay (Lighthouse model: one registration per provider, fan-out by `state`) | the relay | lowest user friction; reuses most code | frontend protocol already implemented; needs a relay backend |
| Per-user public deploy (Cloudflare Tunnel / own domain, register own URL) | the instance itself | trivial for the demo | not built |
| BYO-registration (each user registers their own SMART app) | their instance URL | most decentralized; high user friction | not built |
| Non-OAuth ingestion (manual export, Apple Health intermediary) | none | works today; sidesteps SMART | manual import works |

For the distributed product, the central fork is **shared community relay** vs
**per-user public-deploy / BYO**.

## Relay architecture options (for component B)

Detailed in [`oauth-gateway.md`](./oauth-gateway.md). Summary:

| Option | LAN isolation | Moving parts | Token exposure |
|---|---|---|---|
| Cloudflare Worker + KV + poll | total (outbound only) | Worker + KV + poll + shared secret | never leaves the instance |
| Cloudflare Tunnel (scoped `/callback`) | one callback path is internet-reachable | tunnel config only | never leaves the instance |

Both keep tokens on the instance; the only real difference is whether one narrow,
state-validated callback endpoint is reachable from the internet.

## Well-tested implementations to use

Do not hand-roll OAuth.

| Layer | Use | Why |
|---|---|---|
| Backend token machinery (code exchange, PKCE, refresh) | `golang.org/x/oauth2` | canonical, battle-tested Go OAuth2 client; native PKCE and refresh. Covers components D and E |
| Frontend / spike OAuth + OIDC | `@panva/oauth4webapi` + `jose` (already deps) | spec-compliant gold standard for JS |
| Reference SMART client (spike / desktop) | `fhirclient` (SMART Health IT "client-js") | reference SMART-on-FHIR JS lib maintained by the SMART team |
| FHIR parsing | existing `fastenhealth/gofhir-models` | already used; ingest path exists |
| Dev/demo target | SMART sandboxes: SMART Health IT (`launch.smarthealthit.org`), Epic (`fhir.epic.com`), Cerner/Oracle, Logica | test patients, flexible registration, zero PHI |

SMART on FHIR is roughly `.well-known` discovery (a plain GET) + OAuth2 auth-code-with-PKCE
(`x/oauth2`) + FHIR fetch (existing models). No bespoke backend SMART library is needed; the only
genuinely custom piece is the relay (about 50 lines).

## Recommended sequencing (de-risk first)

1. **Spike against a SMART sandbox** (throwaway): prove the full PKCE flow end-to-end
   (authorize, callback, token exchange, `GET /Patient/$everything`, save bundle) with test
   patients and no PHI. Validates the protocol and the existing frontend relay/desktop code.
2. **Spike against real Veradigm**: register the app, repeat the flow. De-risks the external
   registration/approval long pole and surfaces real non-US-Core data.
3. **Relay** (Worker or Tunnel) implementing the protocol the frontend already expects.
4. **Backend SMART client**: generic SMART-R4 client in the `fasten-sources` stub + authorize /
   callback / scheduled-refresh wiring (components C, D, E).
5. **Re-enable the "Add Source" UI** against the new endpoints (component G).
6. **Add providers** (Epic, etc.) as separate registrations.

## Intellectual property and licensing

Short version: **no copyright/IP-infringement risk** in building our own SMART client and relay on
open standards and permissive libraries. The real obligations are contractual (per-provider terms)
and license hygiene (GPLv3 + no reuse of Fasten's private/commercial code or marks).

### Veradigm (and other providers)

- Access is via SMART on FHIR under **patient-access rights** (21st Century Cures Act / ONC
  info-blocking rules). The data is the patient's own; FHIR R4 is an open HL7 standard, free to
  implement.
- The obligation is **contractual, not copyright**: each provider runs a developer program with
  Terms of Use / an API agreement (app registration, allowed use, rate limits, sometimes production
  approval). We must read and comply with the `developer.veradigm.com` terms (and `fhir.epic.com`
  for Epic).
- We copy nothing from Veradigm — we are a standards client to their public patient API. No IP
  concern there.
- Watch for terms that restrict commercial use or redistribution, or require attribution; these
  matter if YourPHR is distributed. Confirm per provider before production.

### Fasten Lighthouse

- Lighthouse is Fasten Health's **proprietary** hosted relay, now part of the commercial Fasten
  Connect product. Its server source was never open-sourced.
- We do **not** have, use, or copy Fasten's Lighthouse server code, and we will **not** free-ride on
  their hosted service. We build our **own** relay.
- The relay **protocol** (`origin_url` / `dest_url` / `redirect/{state}`) is an interface.
  Independently reimplementing an API/protocol is well-established as non-infringing
  (cf. *Google v. Oracle*). We write our own server against the protocol the GPL client already
  speaks.
- The **client** that speaks it (`lighthouse.service.ts`) is part of `fasten-onprem`, GPLv3 — we
  inherited it legally under GPL.
- **Trademark:** "Fasten" and "Lighthouse" are Fasten's marks. Per `CLAUDE.md` we keep internal
  identifiers (e.g. `FastenLighthouseEnvSandbox`) but user-facing product strings are YourPHR. Do
  not brand the relay as "Lighthouse" or imply Fasten endorsement.

### fasten-sources and the provider catalog

- Upstream `fasten-sources` was made private; our `fasten-sources-stub` is our own clean-room
  reimplementation of the interface. Do **not** reintroduce upstream's private code or its
  proprietary brand/endpoint catalog.
- If we need a provider catalog, build it from **open** sources: each provider's
  `.well-known/smart-configuration`, and public endpoint directories (ONC/CMS, Epic's open endpoint
  list, CARIN / National Directory) — not a copied private catalog.

### Our code and dependency licenses

- The fork is **GPLv3**; new code (backend client, relay integration) inherits GPLv3 obligations
  (publish source). Keep our relay GPL-compatible and, ideally, open-source it for community trust.
- GPLv3 is not AGPLv3: running a network relay does not by itself force source disclosure, but we
  intend to open it anyway.
- Planned dependencies are permissive and GPLv3-compatible (verify exact license at adoption):
  `golang.org/x/oauth2` (BSD-3-Clause), `@panva/oauth4webapi` and `jose` (MIT), SMART `fhirclient` /
  client-js (permissive), `fastenhealth/gofhir-models` (verify). Apache-2.0 is GPLv3-compatible.

### Action items

- Read and record the Veradigm developer Terms of Use before registering the app.
- Confirm `gofhir-models` and `fhirclient` exact licenses at adoption.
- Decide whether our relay is open-sourced (recommended) and under which license (GPLv3 to match).

## Open decisions

1. **Relay architecture** — Cloudflare Worker + KV + poll vs Cloudflare Tunnel (scoped callback).
2. **Generic vs per-vendor client** — recommend one generic SMART-R4 client driven by `.well-known`
   discovery + per-provider config; vendor quirks (Veradigm non-US-Core) belong in the
   display/normalization layer (upstream #428 / #431 / #347), not the auth client.
3. **Distribution model** — shared community relay vs per-user public-deploy / BYO-registration.
4. **First provider target** — Veradigm/FollowMyHealth vs Epic vs catalog-driven. (Sandbox first
   regardless.)
5. **Sequencing vs display bugs** — the ecosystem doc prioritizes non-US-Core display fixes before
   sync; confirm SMART is the near-term priority.

## Files likely to change (in `jwilleke/yourphr`)

| File / area | Change |
|---|---|
| `fasten-sources-stub/clients/factory/factory.go` | replace stub `GetSourceClient` with a real generic SMART client |
| `fasten-sources-stub/clients/models/models.go` | implement `SourceClient` interface methods |
| `backend/pkg/web/handler/source.go` | OAuth initiation + token-exchange (and/or code-poll) endpoints |
| `backend/pkg/web/server.go` | register new OAuth routes |
| relay (new) | Cloudflare Worker source, or Cloudflare Tunnel config in `mj-infra-flux` |
| `frontend/src/app/services/lighthouse.service.ts` + medical-sources components | point at the new relay; re-enable provider connect UI |

## References

- Issues: [#20](https://github.com/jwilleke/yourphr/issues/20) (this feature),
  [#15](https://github.com/jwilleke/yourphr/issues/15) (mission).
- Upstream: `fastenhealth/fasten-onprem` #629 (Lighthouse moved to commercial Fasten Connect).
- Specs: HL7 SMART App Launch; OAuth 2.0 for Native Apps (RFC 8252); PKCE (RFC 7636).
- Sibling docs: [`oauth-gateway.md`](./oauth-gateway.md),
  [`../personal-health/health-record-aggregation.md`](../personal-health/health-record-aggregation.md),
  [`../personal-health/fastenhealth-ecosystem.md`](../personal-health/fastenhealth-ecosystem.md).

## Decision log

Append dated entries as decisions are made.

- *(none yet)*
