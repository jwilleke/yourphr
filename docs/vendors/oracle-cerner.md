# Oracle Health (Cerner) — code Console registration

How to register a **patient-access SMART app** for the **Cerner Millennium** sandbox and get a `client_id`. Cerner is more gated than Epic, and the registration has two real traps (the org / Client-Number prompt, and the API-product subscription) — both documented below.

**Register at:** <https://code-console.cerner.com/> — the developer **code Console** (free CernerCare account; it issues the `client_id`).

## What you need

| Item | How |
|---|---|
| **CernerCare account** | free; created on first use of the code Console |
| **`client_id`** | **issued by the code Console** when you register an app — you do NOT supply one |
| **Client Secret** | none — register as a **Public (PKCE)** client |
| **FHIR R4 access** | subscribe the app to the **"Oracle Health FHIR APIs for Millennium: FHIR R4, All"** API product |

Credential values go in `private/secrets.md` (gitignored), never the committed docs.

## Trap 1 — the "Organization (Client Number)" prompt

CernerCare **account creation** asks for an **Organization (Client Number)** — a search that must match a real Cerner customer org. That ties the *account* to a Cerner client; it is **not** part of app registration. If you're asked for an "Oracle CID" just to register an app, you're on the **wrong portal** (Oracle's enterprise console). The developer **code Console** issues the `client_id` itself.

## Steps

1. Go to the **code Console**: <https://code-console.cerner.com/>
2. Sign in (create the free **CernerCare** account on first use).
3. **+ New App** → register with:

   | Setting | Value |
   |---|---|
   | **App Name** | YourPHR |
   | **App Type** | Patient |
   | **Client Type** | Public (PKCE — no secret) |
   | **FHIR Spec** | R4 |
   | **SMART Launch URI** | *(blank — standalone, not EHR launch)* |
   | **Redirect URI** | `https://relay.nerdsbythehour.com/callback` |
   | **Scopes** | `launch/patient openid fhirUser offline_access patient/*.read` |
   | **Terms of Use URL** | `https://yourphr.org/terms` |
   | **Privacy Policy URL** | `https://yourphr.org/privacy` |

4. **Register** → the console shows your **`client_id`** (and an Application ID). Save both to `private/secrets.md`.

## Trap 2 — subscribe to the FHIR R4 API product

After registering, the app's **FHIR Version may show `-`** and FHIR calls fail. Fix: **subscribe the app to "Oracle Health FHIR APIs for Millennium: FHIR R4, All"** — that grants R4 access.

## Connect values

| Field | Value |
|---|---|
| **FHIR base URL** | `https://fhir-myrecord.sandboxcerner.com/r4/ec2458f2-1e24-41c8-b71b-0e701af7583d` |
| **Client ID** | from registration (in `private/secrets.md`) |
| **Client Secret** | *(blank)* |
| **Scopes** | `launch/patient openid fhirUser offline_access patient/*.read` |

Use **`fhir-myrecord`** (patient persona). `fhir-ehr` is the *provider* (EHR-launch) persona — don't use it for YourPHR. `fhir-open` is the unauth endpoint (no SMART config).

## Discovery pre-flight (verified 2026-06-15, no relay needed)

```bash
curl -s "https://fhir-myrecord.sandboxcerner.com/r4/ec2458f2-1e24-41c8-b71b-0e701af7583d/.well-known/smart-configuration" | python3 -m json.tool
```

→ **200**, patient-persona authorize endpoint, PKCE `S256`, capabilities include `launch-standalone` + `client-public` + `context-standalone-patient` + `permission-offline`. YourPHR's standalone-patient / public-PKCE / offline flow is fully supported.

## Status

🟡 **Open — strong lead found; pending a real browser login to confirm end-to-end** ([#338](https://github.com/jwilleke/yourphr/issues/338); 2026-06-19). The working patient authorize endpoint exists but **is not advertised by any Cerner discovery document** — so YourPHR can't reach it via standard discovery.

> **Superseded diagnoses (all wrong — do not trust earlier notes):** (1) wrong persona registration; (2) unfinished R4 subscription (*Trap 2*) — it **is** subscribed; (3) "SMART v1/v2 mismatch + override to a smart-v2 endpoint" — **the smart-v2 endpoint returns 404, it does not exist**; (4) "wrong tenant, probably defer". Each was based on an incomplete probe. Keep only the verified matrix below.

### Verified by probing (read-only; a bare `200` is **not** proof of a completed login — confirm in a browser)

| Authorize combination (smart-v1) | Result |
|---|---|
| `authorization.cerner.com` + `personas/patient`, `aud=fhir-ehr.cerner.com/r4/{t}` | ✅ **200, Cerner auth SPA, no error redirect** — the lead |
| `authorization.cerner.com` + `personas/provider` | `client-persona-mismatch` (this is the live deployed failure) |
| `authorization.sandboxcerner.com` + `personas/patient` | `unknown-tenant` — **and a bogus client_id gets the identical error**, so this authz host just doesn't serve tenant `ec2458f2` |
| any `…/profiles/smart-v2/…` (any host/persona) | **404 — no smart-v2 endpoint exists anywhere** |

Discovery by FHIR base (what each host *advertises*):

- `fhir-ehr.cerner.com` / `fhir-ehr-code.cerner.com` → `authorization.cerner.com/…/personas/**provider**/authorize` (tenant-aware authz, **wrong persona**)
- `fhir-myrecord.sandboxcerner.com` → `authorization.sandboxcerner.com/…/personas/**patient**/authorize` (**right persona, but the authz that doesn't know the tenant**)

**The trap:** the tenant-aware authz (`authorization.cerner.com`) only advertises the *provider* persona; the host that advertises the *patient* persona points at an authz that doesn't have the tenant. The working URL only exists by hand-combining "tenant-aware authz + patient persona" — which no discovery document publishes.

### On the v2 registration

The code Console app is **SMART v2**, but Cerner exposes **only smart-v1** endpoints (v2 = 404 everywhere). The v1 patient endpoint on `authorization.cerner.com` did **not** reject our v2 app at the authorize step (200, no error) — but whether the *token exchange* completes for a v2-registered app on a v1 endpoint is **unconfirmed** without a real login.

### Implication for YourPHR

The working endpoint is **not discoverable**, so YourPHR's discovery-following flow will always land on the provider persona (mismatch). To use it, a per-entry **authorize-endpoint override** (persona, not version) would be needed: seed base/`aud` = `https://fhir-ehr.cerner.com/r4/{tenant}`, take discovery's provider authorize, then override the authorize endpoint to the `…/personas/patient/authorize` variant. (The token endpoint is host-based, not persona-split, so it likely needs no override.)

### Confirm before building anything (no code)

Open the lead URL in a browser, log in as `nancysmart` / `Cerner01`, and confirm it returns to `https://relay.nerdsbythehour.com/callback?code=…`:

```
https://authorization.cerner.com/tenants/ec2458f2-1e24-41c8-b71b-0e701af7583d/protocols/oauth2/profiles/smart-v1/personas/patient/authorize?response_type=code&client_id=c330e3c6-3ebe-49f3-a3a3-52dd7764d745&redirect_uri=https://relay.nerdsbythehour.com/callback&scope=launch/patient%20offline_access%20openid%20fhirUser%20patient/Patient.read&aud=https://fhir-ehr.cerner.com/r4/ec2458f2-1e24-41c8-b71b-0e701af7583d&state=manualtest&code_challenge=PLACEHOLDER&code_challenge_method=S256
```

If it issues a code, the persona-override path is worth building. If it 404s/errors after login, Cerner sandbox patient-standalone for this tenant is genuinely unsupported → defer (Blue Button + Epic already validate the pipeline).

### Also, regardless

Correct the deployed entry's base URL off `fhir-ehr-code.cerner.com` (admin UI edit, or delete the row to re-seed) — `UpsertProviderCatalogEntryByDisplay` is provision-only and won't overwrite an admin-edited row.

## See also

- Index: [`../test-sandboxes.md`](../test-sandboxes.md)
- Oracle docs: [Build & Test SMART on FHIR Apps](https://docs.oracle.com/en/industries/health/millennium-platform-apis/build-smart-on-fhir-apps/) · [SMART App Provisioning](https://docs.oracle.com/en/industries/health/millennium-platform-apis/smart-app-provisioning/)
