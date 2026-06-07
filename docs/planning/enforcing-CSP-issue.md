# Enforcing Content-Security-Policy — issue & working plan

> **Status:** ✅ **done (in-scope)** — staged enforcing CSP is **live in prod** and verified (2026-06-07): enforcing safe directives + report-only strict `script-src`. The only remaining item is the explicitly-deferred fully-strict `script-src`, tracked to #114.
> **Tracking issue:** [#124](https://github.com/jwilleke/yourphr/issues/124) · Related: #105 (H4), #113, #120, #103 (H2), #114.
> **Owner:** living doc — updated with findings as we work through it.
> Companion to [architecture-security-review.md](./architecture-security-review.md) and [Standards-Conformance.md](./Standards-Conformance.md).

## Goal

Ship an **enforcing** `Content-Security-Policy` for the YourPHR SPA (served by the Go backend under `/web/`) that blocks injected/XSS scripts and other classic web attacks, **without breaking the app**. The security headers themselves (H4, #105) already ship; this is about flipping the CSP from report-only to enforcing — and doing it for *real* incremental value, not ceremony.

## The core problem (clearly stated)

Two things make a *fully strict* `script-src` hard for this app:

1. **The base-href bootstrap must stay inline.** `index.html` has two inline `<script>` blocks that run at parse time — the one that `document.write`s `<base href="/web/">`, and the lforms web-components guard. They **cannot be externalized**: a relative `<script src>` resolves against the page URL *before* `<base href>` exists, 404s, and is served as `text/html` → "Refused to execute script". That was the #113 outage. ✅ **Solved** by allowlisting the two inline scripts in `script-src` by their **sha256 hash** (deterministic — the browser computes the same hash and runs them).
2. **Inline event handlers are incompatible with hash/nonce `script-src`.** CSP hashes and nonces **only cover `<script>` blocks** — they do **not** cover inline event-handler attributes (`onclick=`, `onload=`, …). Allowing those requires `'unsafe-hashes'` **plus a hash of every handler**. This app's runtime DOM contains inline handlers that are **not in our templates** (`grep src/app/**.html` finds none) → they're injected by a third-party widget (lforms / dwv) or via `innerHTML`. So enforcing a strict `script-src` blocks them and breaks the page. ❌ **Unsolved** — this is the real blocker, and it may involve code we don't own.

**Key reframe — and the reason this is lower-stakes than it looks:** the #1 XSS payoff, **session-token theft, is already closed by #103** (HttpOnly cookie, no token in JS). Clickjacking is already closed by the enforced **`X-Frame-Options: DENY`** header. So a fully-strict `script-src` is *incremental* hardening on top of vectors that are already mitigated — it must not block the safe, high-value parts of the CSP, and it is **not** worth a third outage to chase.

## What we've tried

### Attempt 1 — externalize the inline bootstrap scripts (#113)

Moved the base-href + lforms-guard scripts to `assets/js/*.js` to satisfy `script-src 'self'`. **Broke prod** (the relative-load bootstrap paradox above). Reverted in **#120**.

### Attempt 2 — sha256-hash the inline scripts, flip to enforcing (#124, commit `936a8dfd`)

Kept the scripts inline, allowlisted by **hardcoded** hash. **The hashes worked** (app loaded, no MIME breakage — #113 fully fixed). But enforcing `script-src` then **blocked inline event handlers**, breaking interactivity/render. Reverted (`4f3d5440`). Also exposed hash fragility: an unrelated `index.html` comment changed the prod-minified bytes and shifted a hash → motivates runtime hash computation (below).

## Findings (live console, Attempt 2)

| Symptom | Cause | Action |
|---|---|---|
| App loaded, assets OK | inline-script **hashes accepted** ✅ | keep the hash approach |
| `Executing inline event handler violates script-src` (dashboard:18/45) | inline `onX=` handlers (3rd-party/runtime, **not our templates**) | the real blocker → keep `script-src` permissive on inline for now |
| `oauth4webapi … Unexpected token 'export'` | ESM loaded as classic script — **bundling bug, not CSP** | investigate separately (IdpConnect path) |
| `site.webmanifest` blocked (default-src) | manifest 302'd to Authentik; no `manifest-src` | add `manifest-src 'self'` (non-breaking) |
| Perplexity-CDN font blocked | browser **extension**, not the app | ignore (test in incognito) |

## Decision: minimal staged enforcement (the lean plan)

CSP supports a `Content-Security-Policy` (enforce) **and** a `Content-Security-Policy-Report-Only` (observe) header simultaneously. We use both, but deliberately keep the machinery small.

**Enforce now** — safe, high-value, unaffected by inline handlers:
`default-src 'self'`, `frame-ancestors 'none'`, `base-uri 'self'` (base-tag injection), `form-action 'self'` (form hijack), `object-src 'none'` (plugins), `connect-src 'self' https://wallet.hello.coop https://issuer.hello.coop`, `img-src 'self' data: https:`, `font-src 'self' data:`, `style-src 'self' 'unsafe-inline'`, `manifest-src 'self'`, and **`script-src 'self' 'unsafe-inline'`** (still blocks *cross-origin* script injection; permissive on inline so the app + its third-party handlers work).

**Observe** (report-only) the strict target, for visibility only:
`script-src 'self' '<base-href hash>' '<lforms-guard hash>'` — the gap between this and the enforced policy is exactly "the inline-handler problem". No `report-uri` (see below). We read these in the browser console during local validation; we do not collect them server-side.

**Rationale:** this delivers the real incremental hardening (`base-uri`, `form-action`, `object-src`, cross-origin `script-src`, resource-origin allowlists) **enforced and safe**, with roughly one-fifth the moving parts of a full rollout — appropriate for a single self-hosted family instance, and far less likely to cause a third outage.

### Planned Go shape (both headers)

The middleware sets both headers; the report-only hashes are computed at startup (next section), not hardcoded:

```text
Content-Security-Policy:             <enforcing policy above>
Content-Security-Policy-Report-Only: script-src 'self' 'sha256-…' 'sha256-…'
```

## Decision: compute the inline-script hashes at runtime (no hardcoding)

Attempt 2 hardcoded the hashes and they immediately drifted. Instead, the backend computes them **at startup from the `index.html` it actually serves** (disk via `web.src.frontend.path`, or `embed.FS` for the embedded build): read the file, extract the two inline `<script>` bodies, sha256 each, build the report-only `script-src`. The hashes are by construction equal to the served bytes, so they cannot drift.

**Honest caveat:** this only moves the fragility — the Go extractor must produce *exactly* the bytes the browser hashes (the script text node, verbatim). For the **report-only** policy that is harmless: a wrong hash just produces a spurious console report, never a block. It would only become load-bearing if/when we promote strict `script-src` to enforcing (deferred — see below). If `index.html` is absent (some dev setups), fall back to `script-src 'self'` (no hashes) for the report-only policy.

## Considered and rejected: a server-side `/api/csp-violation` reporting endpoint

A `report-uri` + collector endpoint was proposed and **deliberately dropped** for this deployment:

- **PHI risk.** CSP violation reports include `document-uri`, `referrer`, `source-file`, and `script-sample`. On a PHR, `document-uri` is routes like `/web/resource/fhir/<sourceId>/<resourceId>` — collecting them writes **patient-resource identifiers into application logs**, which are typically less protected than the encrypted DB. Not worth the exposure for a hardening nicety.
- **Low ROI at this scale.** The endpoint's value is "see violations you can't see in a console". On a single self-hosted instance the operator *is* the person with the console — DevTools (incognito) already provides the data during local validation. The endpoint would mostly add a public, spammable surface and log noise.

If YourPHR ever runs as a shared/multi-tenant service, revisit this — and if so, sanitize `document-uri`/`script-sample` before logging.

## Success criteria ("done")

1. The enforcing policy is live in prod with **zero app-breaking violations** across the major flows (validated locally first — see below).
2. `connect-src` / `img-src` / `font-src` / `manifest-src` allowlists are confirmed against a clean local console walk (no legitimate resource blocked).
3. The report-only strict `script-src` is present for visibility; tightening it to enforcing is explicitly **out of scope** here and tracked against the Angular upgrade (#114).

## Validation discipline (the lesson)

We caused two outages by **deploying to validate**. Going forward, **validate the production-served path *locally* first**:

- `make build-frontend`, point the Go backend's `web.src.frontend.path` at the built `dist/`, open `http://localhost:9090/web` with the console open. `ng serve` does NOT apply the backend CSP and serves at `/`, so it cannot validate this.
- Walk every major page with the console open: dashboard, sources, **add-source / SMART relay popup + token exchange**, records, **lforms questionnaire**, **print / PDF / report views**, settings.
- Test in **incognito (no extensions** — removes the Perplexity-font noise) and in at least **two browsers** (Chrome + Firefox).
- Deploy only when the local console is clean. (Aspirational: an automated E2E pass with the CSP applied.)

## Path to fully-strict `script-src` (deferred, lower priority — likely with #114)

This is intentionally *not* part of the current work; it is the eventual path if/when we decide the extra hardening is worth it:

1. **Enumerate** every inline event handler (local walk) and pin the **exact widget + version** injecting them (lforms? dwv?).
2. **Eliminate / contain:** ours → refactor `onX=` to Angular `(event)` bindings; third-party → upgrade the widget if a fixed version exists, else replace/fork. Iframe-sandboxing the widget (its own relaxed CSP + a `postMessage` bridge) and `'unsafe-hashes'` + enumerated handler hashes are **last-resort, over-engineered options** for a single-instance app — note them, don't reach for them.
3. **Nonce + `'strict-dynamic'`** for script loading would require the Go backend to template `index.html` per-request (inject a nonce into the inline scripts + the CSP), replacing the static `StaticFS`/`c.File` serving of `index.html`. Angular 14 has **no** built-in CSP-nonce support (that's Angular 16+ `ngCspNonce`), so this realistically pairs with the **Angular upgrade (#114)**, which may change the widget stack anyway.

## Worklog

- **2026-06-07** — Attempt 2 (hardcoded hashes) reverted (`4f3d5440`); root cause = inline event handlers vs strict `script-src`. Initial plan drafted with a reporting endpoint + soak window.
- **2026-06-07 (rev.)** — Trimmed to the **lean plan** after a critical cost/benefit pass: enforcing CSP is *incremental* (token theft already closed by #103, clickjacking by `X-Frame-Options: DENY`), so dropped the `/api/csp-violation` endpoint (PHI-in-reports risk + low ROI for a single instance), dropped the multi-week prod soak (meaningless at one-family scale; a thorough local walk is the real signal), and demoted iframe-sandboxing to a last-resort note. Kept: minimal staged enforcement, **runtime-computed** report-only hashes, and local-first validation.
- **2026-06-07 (implemented + validated)** — Shipped the staged CSP (`security_headers.go`: enforce the safe directives with `script-src 'self' 'unsafe-inline'`; report-only strict `script-src` with hashes from `ComputeReportOnlyScriptSrc`); wired `readFrontendIndexHTML` into `Setup()`. Validated locally against a prod-built `dist/` served by the Go backend, then deployed. Details:
  - The runtime extractor produced exactly the two known-good hashes (`66XQ…` base-href, `EnWZB…` lforms-guard) from the real minified `index.html` — the Attempt-2 hash drift is gone.
  - Both headers emit correctly end-to-end; browser walk (login + dashboard) was clean — **no app resource blocked**; the only CSP block was a *browser-extension* font (Perplexity), which incognito removes.
  - Confirmed the enforcing policy is a permissive **superset** of the report-only policy prod has run since #105 (loosened `script-src`/`img-src`, added `manifest-src`, tightened nothing), so the catastrophic strict-`script-src` outage mode is off the table.
  - Two **pre-existing, non-CSP** bugs surfaced during the walk and were filed separately: the `oauth4webapi` ESM-as-classic parse error, and the manifest icons 404'ing under `/web/`.
- **2026-06-07 (verified live + manifest follow-up)** — Confirmed the deployed prod headers (`main-117`) from the browser console: enforcing + report-only headers exact, app fully functional, **no enforcing block on any app resource**; the report-only strict `script-src` correctly logs the inline-handler violations (as designed). Prod surfaced one Authentik-specific interaction not visible locally, now resolved deployment-agnostically:
  - the uncredentialed manifest fetch 302's to Authentik and `manifest-src 'self'` blocks the result;
  - app-side fix: manifest icon paths made base-href-relative (yourphr `1621a0d7`, **closes #126**);
  - infra-side fix: a narrow public favicon/manifest ingress, kept entirely in infra (mj-infra-flux#111, **merged**) — YourPHR stays agnostic to Authentik/Traefik/Flux.
  - Still open: **#125** (`oauth4webapi` ESM parse bug — not CSP).

## Related issues

- **#124** — this work (re-enable enforcing CSP). · **#105** — H4 security headers (shipped).
- **#113 / #120** — the externalize-scripts outage + revert. · **#103** — HttpOnly cookie (closes the primary XSS vector). · **#114** — Angular upgrade (enables the strict path).
