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

⛔ **Blocked on a SMART v1/v2 mismatch** ([#338](https://github.com/jwilleke/yourphr/issues/338); proven 2026-06-19). The app is a correctly-registered **Patient / Public / R4-subscribed** app — the only problem is the SMART protocol version.

Proven by probing tenant `ec2458f2-1e24-41c8-b71b-0e701af7583d` with our app `c330e3c6` (read-only, no relay):

| Authorize endpoint | Result |
|---|---|
| `…/profiles/**smart-v2**/personas/patient/authorize` | ✅ reaches login — no error (with and without `offline_access`) |
| `…/profiles/**smart-v1**/personas/patient/authorize` | ❌ 303 → `…:grant:**unknown-tenant**` |

- The code Console app summary shows **SMART Version = SMART v2** and **Products = "Oracle Health FHIR APIs for Millennium: FHIR R4, All"** (so the *Trap 2* subscription **is** done — that earlier theory was wrong).
- A **v2-registered app on the v1 endpoint** is rejected as `unknown-tenant`, and YourPHR's SMART client lands on the v1 endpoint because that is the one discovery names (see below).
- The live failure additionally showed `authorization.cerner.com / personas/**provider**/authorize` (`client-persona-mismatch`) — that means the **deployed catalog entry's base URL was admin-edited to the provider host** (`fhir-ehr-code.cerner.com`). The committed seed is the correct patient host (`fhir-myrecord`), but the startup upsert is provision-only and never clobbers an admin-edited row (see `UpsertProviderCatalogEntryByDisplay`), so that stale base URL persists on that instance.

### How Cerner versions its endpoints (the actual mechanism)

Cerner serves **separate authorize endpoints per SMART version** under the same FHIR base, and the **SMART version is a property of the registered app** — each app must use the `…/profiles/smart-v{1,2}/…` endpoint matching its registration. Both endpoints exist for our tenant (probing reached login on v2, `unknown-tenant` on v1).

**Beware two different "v2" axes that share a label** — conflating them sends you down the wrong path:

| Axis | Where it appears | Meaning | Our case |
|---|---|---|---|
| **Scope grammar** | `permission-v1` / `permission-v2` capability | which scope *syntax* the server accepts (`patient/Observation.read` vs granular `patient/Observation.rs` / `.cruds`) | both supported — **not** our problem |
| **Endpoint profile** | `/profiles/smart-v1/` vs `/profiles/smart-v2/` in the endpoint URL path, bound to the app's registered SMART Version | which physical authorize/token endpoint the app must use | our app is **v2-registered**; only **v1** URLs are published → blocked |

So `permission-v2` only means "this server accepts v2-style scopes" — it is **not** a pointer to a v2 endpoint. Its `.well-known/smart-configuration` for `fhir-myrecord` publishes **only `smart-v1` URLs for every endpoint** (verified — `authorization_endpoint`, `token_endpoint`, and `revocation_endpoint` are all `…/profiles/smart-v1/…`); there is **no `smart-v2` URL anywhere in the document**. The v2 endpoints exist but are undiscoverable.

This is where Cerner departs from the usual model: standard SMART expects a **single** `authorization_endpoint` with the version negotiated via scopes + capabilities (exactly what `permission-v2` is for). Cerner instead **physically splits the endpoints per app-version** and publishes only the v1 set — so a spec-correct, discovery-following client (like YourPHR) is steered to v1, which then rejects the v2-registered app with `unknown-tenant`. The discovery doc isn't malformed; it just can't express "use the endpoint matching your app's version," and a v2 app must learn its endpoint out-of-band.

**Fix — two independent things:**

1. **Resolve the v1/v2 mismatch (root cause).** Either:
   - **(a)** Re-register / change the code Console app to **SMART v1** to match the endpoint discovery names — zero YourPHR change, but a **deliberate downgrade** off the modern profile (and `permission-v2` shows the server supports v2), so this is only worth it as a throwaway sandbox validation; **or**
   - **(b, preferred)** Keep the v2 app and add an optional per-entry **`authorize_url` override** to the provider catalog: when set, YourPHR uses it instead of the discovered `authorization_endpoint`. For Cerner, point it at the `…/profiles/smart-v2/…` URL. This is a general escape hatch for any server whose discovery under-describes its endpoints — not Cerner-specific. (Production Oracle/Cerner may advertise v2 directly, in which case no override is needed there — this is partly sandbox scaffolding.)
2. **Correct the deployed Oracle entry's base URL** back to `https://fhir-myrecord.sandboxcerner.com/r4/ec2458f2-1e24-41c8-b71b-0e701af7583d` — edit it in the admin catalog UI, or delete the row so startup re-seeds it from the (correct) seed.

Also minor: code Console **Type of Access = Online**, but our scope set requests `offline_access` (refresh token). Set it to **Offline** if you want refresh, or drop `offline_access` from the seed scopes. (Not the blocker — the v2 endpoint accepted both.)

Re-test success = the patient login (`nancysmart` / `Cerner01`) instead of `unknown-tenant` / `client-persona-mismatch`.

## See also

- Index: [`../test-sandboxes.md`](../test-sandboxes.md)
- Oracle docs: [Build & Test SMART on FHIR Apps](https://docs.oracle.com/en/industries/health/millennium-platform-apis/build-smart-on-fhir-apps/) · [SMART App Provisioning](https://docs.oracle.com/en/industries/health/millennium-platform-apis/smart-app-provisioning/)
