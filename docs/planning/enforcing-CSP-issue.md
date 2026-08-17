# Enforcing Content-Security-Policy — issue & working plan

> __Status:__ ✅ __done (in-scope)__ — staged enforcing CSP is __live in prod__ and verified (2026-06-07): enforcing safe directives + report-only strict `script-src`. The only remaining item is the explicitly-deferred fully-strict `script-src`, tracked to #114.
> __Tracking issue:__ [#124](https://github.com/jwilleke/yourphr/issues/124) · Related: #105 (H4), #113, #120, #103 (H2), #114.
> __Owner:__ living doc — updated with findings as we work through it.
> Companion to [architecture-security-review.md](./architecture-security-review.md) and [Standards-Conformance.md](./Standards-Conformance.md).

## Goal

Ship an __enforcing__ `Content-Security-Policy` for the YourPHR SPA (served by the Go backend under `/web/`) that blocks injected/XSS scripts and other classic web attacks, __without breaking the app__. The security headers themselves (H4, #105) already ship; this is about flipping the CSP from report-only to enforcing — and doing it for *real* incremental value, not ceremony.

## The core problem (clearly stated)

Two things make a *fully strict* `script-src` hard for this app:

1. __The base-href bootstrap must stay inline.__ `index.html` has two inline `<script>` blocks that run at parse time — the one that `document.write`s `<base href="/web/">`, and the lforms web-components guard. They __cannot be externalized__: a relative `<script src>` resolves against the page URL *before* `<base href>` exists, 404s, and is served as `text/html` → "Refused to execute script". That was the #113 outage. ✅ __Solved__ by allowlisting the two inline scripts in `script-src` by their __sha256 hash__ (deterministic — the browser computes the same hash and runs them).
2. __Inline event handlers are incompatible with hash/nonce `script-src`.__ CSP hashes and nonces __only cover `<script>` blocks__ — they do __not__ cover inline event-handler attributes (`onclick=`, `onload=`, …). Allowing those requires `'unsafe-hashes'` __plus a hash of every handler__. This app's runtime DOM contains inline handlers that are __not in our templates__ (`grep src/app/**.html` finds none) → they're injected by a third-party widget (lforms / dwv) or via `innerHTML`. So enforcing a strict `script-src` blocks them and breaks the page. ❌ __Unsolved__ — this is the real blocker, and it may involve code we don't own.

__Key reframe — and the reason this is lower-stakes than it looks:__ the #1 XSS payoff, __session-token theft, is already closed by #103__ (HttpOnly cookie, no token in JS). Clickjacking is already closed by the enforced __`X-Frame-Options: DENY`__ header. So a fully-strict `script-src` is *incremental* hardening on top of vectors that are already mitigated — it must not block the safe, high-value parts of the CSP, and it is __not__ worth a third outage to chase.

## What we've tried

### Attempt 1 — externalize the inline bootstrap scripts (#113)

Moved the base-href + lforms-guard scripts to `assets/js/*.js` to satisfy `script-src 'self'`. __Broke prod__ (the relative-load bootstrap paradox above). Reverted in __#120__.

### Attempt 2 — sha256-hash the inline scripts, flip to enforcing (#124, commit `936a8dfd`)

Kept the scripts inline, allowlisted by __hardcoded__ hash. __The hashes worked__ (app loaded, no MIME breakage — #113 fully fixed). But enforcing `script-src` then __blocked inline event handlers__, breaking interactivity/render. Reverted (`4f3d5440`). Also exposed hash fragility: an unrelated `index.html` comment changed the prod-minified bytes and shifted a hash → motivates runtime hash computation (below).

## Findings (live console, Attempt 2)

| Symptom | Cause | Action |
|---|---|---|
| App loaded, assets OK | inline-script __hashes accepted__ ✅ | keep the hash approach |
| `Executing inline event handler violates script-src` (dashboard:18/45) | inline `onX=` handlers (3rd-party/runtime, __not our templates__) | the real blocker → keep `script-src` permissive on inline for now |
| `oauth4webapi … Unexpected token 'export'` | ESM loaded as classic script — __bundling bug, not CSP__ | investigate separately (IdpConnect path) |
| `site.webmanifest` blocked (default-src) | manifest 302'd to Authentik; no `manifest-src` | add `manifest-src 'self'` (non-breaking) |
| Perplexity-CDN font blocked | browser __extension__, not the app | ignore (test in incognito) |

## Decision: minimal staged enforcement (the lean plan)

CSP supports a `Content-Security-Policy` (enforce) __and__ a `Content-Security-Policy-Report-Only` (observe) header simultaneously. We use both, but deliberately keep the machinery small.

__Enforce now__ — safe, high-value, unaffected by inline handlers:
`default-src 'self'`, `frame-ancestors 'none'`, `base-uri 'self'` (base-tag injection), `form-action 'self'` (form hijack), `object-src 'none'` (plugins), `connect-src 'self' https://wallet.hello.coop https://issuer.hello.coop`, `img-src 'self' data: https:`, `font-src 'self' data:`, `style-src 'self' 'unsafe-inline'`, `manifest-src 'self'`, and __`script-src 'self' 'unsafe-inline'`__ (still blocks *cross-origin* script injection; permissive on inline so the app + its third-party handlers work).

__Observe__ (report-only) the strict target, for visibility only:
`script-src 'self' '<base-href hash>' '<lforms-guard hash>'` — the gap between this and the enforced policy is exactly "the inline-handler problem". No `report-uri` (see below). We read these in the browser console during local validation; we do not collect them server-side.

__Rationale:__ this delivers the real incremental hardening (`base-uri`, `form-action`, `object-src`, cross-origin `script-src`, resource-origin allowlists) __enforced and safe__, with roughly one-fifth the moving parts of a full rollout — appropriate for a single self-hosted family instance, and far less likely to cause a third outage.

### Planned Go shape (both headers)

The middleware sets both headers; the report-only hashes are computed at startup (next section), not hardcoded:

```text
Content-Security-Policy:             <enforcing policy above>
Content-Security-Policy-Report-Only: script-src 'self' 'sha256-…' 'sha256-…'
```

## Decision: compute the inline-script hashes at runtime (no hardcoding)

Attempt 2 hardcoded the hashes and they immediately drifted. Instead, the backend computes them __at startup from the `index.html` it actually serves__ (disk via `web.src.frontend.path`, or `embed.FS` for the embedded build): read the file, extract the two inline `<script>` bodies, sha256 each, build the report-only `script-src`. The hashes are by construction equal to the served bytes, so they cannot drift.

__Honest caveat:__ this only moves the fragility — the Go extractor must produce *exactly* the bytes the browser hashes (the script text node, verbatim). For the __report-only__ policy that is harmless: a wrong hash just produces a spurious console report, never a block. It would only become load-bearing if/when we promote strict `script-src` to enforcing (deferred — see below). If `index.html` is absent (some dev setups), fall back to `script-src 'self'` (no hashes) for the report-only policy.

## Considered and rejected: a server-side `/api/csp-violation` reporting endpoint

A `report-uri` + collector endpoint was proposed and __deliberately dropped__ for this deployment:

- __PHI risk.__ CSP violation reports include `document-uri`, `referrer`, `source-file`, and `script-sample`. On a PHR, `document-uri` is routes like `/web/resource/fhir/<sourceId>/<resourceId>` — collecting them writes __patient-resource identifiers into application logs__, which are typically less protected than the encrypted DB. Not worth the exposure for a hardening nicety.
- __Low ROI at this scale.__ The endpoint's value is "see violations you can't see in a console". On a single self-hosted instance the operator *is* the person with the console — DevTools (incognito) already provides the data during local validation. The endpoint would mostly add a public, spammable surface and log noise.

If YourPHR ever runs as a shared/multi-tenant service, revisit this — and if so, sanitize `document-uri`/`script-sample` before logging.

## Success criteria ("done")

1. The enforcing policy is live in prod with __zero app-breaking violations__ across the major flows (validated locally first — see below).
2. `connect-src` / `img-src` / `font-src` / `manifest-src` allowlists are confirmed against a clean local console walk (no legitimate resource blocked).
3. The report-only strict `script-src` is present for visibility; tightening it to enforcing is explicitly __out of scope__ here and tracked against the Angular upgrade (#114).

## Validation discipline (the lesson)

We caused two outages by __deploying to validate__. Going forward, __validate the production-served path *locally* first__:

- `make build-frontend`, point the Go backend's `web.src.frontend.path` at the built `dist/`, open `http://localhost:9090/web` with the console open. `ng serve` does NOT apply the backend CSP and serves at `/`, so it cannot validate this.
- Walk every major page with the console open: dashboard, sources, __add-source / SMART relay popup + token exchange__, records, __lforms questionnaire__, __print / PDF / report views__, settings.
- Test in __incognito (no extensions__ — removes the Perplexity-font noise) and in at least __two browsers__ (Chrome + Firefox).
- Deploy only when the local console is clean. (Aspirational: an automated E2E pass with the CSP applied.)

## Path to fully-strict `script-src` (deferred, lower priority)

This is intentionally *not* part of the current work; it is the eventual path if/when we decide the extra hardening is worth it:

1. __Enumerate__ every inline event handler (local walk) and pin the __exact widget + version__ injecting them (lforms? dwv?).
2. __Eliminate / contain:__ ours → refactor `onX=` to Angular `(event)` bindings; third-party → upgrade the widget if a fixed version exists, else replace/fork. Iframe-sandboxing the widget (its own relaxed CSP + a `postMessage` bridge) and `'unsafe-hashes'` + enumerated handler hashes are __last-resort, over-engineered options__ for a single-instance app — note them, don't reach for them.
3. __Nonce + `'strict-dynamic'`__ for script loading would require the Go backend to template `index.html` per-request (inject a nonce into the inline scripts + the CSP), replacing the static `StaticFS`/`c.File` serving of `index.html`. The app is already on __Angular 20__, which __supports__ CSP nonces (`ngCspNonce`, Angular 16+) — so this is unblocked at the framework level; the remaining work is the Go-backend per-request templating plus solving the inline-handler problem in steps 1–2. (Originally this was deferred to the Angular upgrade #114, but that upgrade is already done.)

## Worklog

- __2026-06-07__ — Attempt 2 (hardcoded hashes) reverted (`4f3d5440`); root cause = inline event handlers vs strict `script-src`. Initial plan drafted with a reporting endpoint + soak window.
- __2026-06-07 (rev.)__ — Trimmed to the __lean plan__ after a critical cost/benefit pass: enforcing CSP is *incremental* (token theft already closed by #103, clickjacking by `X-Frame-Options: DENY`), so dropped the `/api/csp-violation` endpoint (PHI-in-reports risk + low ROI for a single instance), dropped the multi-week prod soak (meaningless at one-family scale; a thorough local walk is the real signal), and demoted iframe-sandboxing to a last-resort note. Kept: minimal staged enforcement, __runtime-computed__ report-only hashes, and local-first validation.
- __2026-06-07 (implemented + validated)__ — Shipped the staged CSP (`security_headers.go`: enforce the safe directives with `script-src 'self' 'unsafe-inline'`; report-only strict `script-src` with hashes from `ComputeReportOnlyScriptSrc`); wired `readFrontendIndexHTML` into `Setup()`. Validated locally against a prod-built `dist/` served by the Go backend, then deployed. Details:
  - The runtime extractor produced exactly the two known-good hashes (`66XQ…` base-href, `EnWZB…` lforms-guard) from the real minified `index.html` — the Attempt-2 hash drift is gone.
  - Both headers emit correctly end-to-end; browser walk (login + dashboard) was clean — __no app resource blocked__; the only CSP block was a *browser-extension* font (Perplexity), which incognito removes.
  - Confirmed the enforcing policy is a permissive __superset__ of the report-only policy prod has run since #105 (loosened `script-src`/`img-src`, added `manifest-src`, tightened nothing), so the catastrophic strict-`script-src` outage mode is off the table.
  - Two __pre-existing, non-CSP__ bugs surfaced during the walk and were filed separately: the `oauth4webapi` ESM-as-classic parse error, and the manifest icons 404'ing under `/web/`.
- __2026-06-07 (verified live + manifest follow-up)__ — Confirmed the deployed prod headers (`main-117`) from the browser console: enforcing + report-only headers exact, app fully functional, __no enforcing block on any app resource__; the report-only strict `script-src` correctly logs the inline-handler violations (as designed). Prod surfaced one Authentik-specific interaction not visible locally, now resolved deployment-agnostically:
  - the uncredentialed manifest fetch 302's to Authentik and `manifest-src 'self'` blocks the result;
  - app-side fix: manifest icon paths made base-href-relative (yourphr `1621a0d7`, __closes #126__);
  - infra-side fix: a narrow public favicon/manifest ingress, kept entirely in infra (mj-infra-flux#111, __merged__) — YourPHR stays agnostic to Authentik/Traefik/Flux.
  - Still open: __#125__ (`oauth4webapi` ESM parse bug — not CSP).

## Related issues

- __#124__ — this work (re-enable enforcing CSP). · __#105__ — H4 security headers (shipped).
- __#113 / #120__ — the externalize-scripts outage + revert. · __#103__ — HttpOnly cookie (closes the primary XSS vector). · __#114__ — Angular upgrade (enables the strict path).
