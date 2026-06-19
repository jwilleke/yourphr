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

⛔ **Blocked on app provisioning, NOT persona routing** ([#338](https://github.com/jwilleke/yourphr/issues/338); re-diagnosed 2026-06-19). The base URL, persona, and YourPHR's SMART flow are all **correct** — the registered app simply isn't entitled to the sandbox tenant yet.

Verified by direct probing (read-only, no relay) of tenant `ec2458f2-1e24-41c8-b71b-0e701af7583d`:

- **The tenant is valid and active.** `fhir-open.sandboxcerner.com/r4/ec2458f2-…/metadata` → **200**, `CapabilityStatement`, `fhirVersion 4.0.1`, `status active`.
- **Discovery is correct and patient-appropriate.** `fhir-myrecord` (patient host) `.well-known/smart-configuration` advertises `authorization_endpoint = .../personas/**patient**/authorize` with `context-standalone-patient` + `client-public`. (`fhir-ehr-code` is the **provider** host — don't use it; its discovery returns `personas/provider/authorize`, which is the only reason an earlier test saw `client-persona-mismatch`.)
- **But our app gets `unknown-tenant` on BOTH personas.** A standalone authorize against the **patient** endpoint with our `client_id` + this tenant 303-redirects to `…/errors/…:grant:**unknown-tenant**…?persona=patient&client=c330e3c6-…&tenant=ec2458f2-…`. The same `unknown-tenant` on the patient persona (where there is no persona mismatch) proves this is **not** a persona problem — the **registered app is not provisioned/entitled to this tenant**.

**Root cause (high confidence):** the app's **FHIR R4 API-product subscription was never completed** — see *Trap 2* above; the code Console app summary showed **FHIR Version `-`**. Without the "Oracle Health FHIR APIs for Millennium: FHIR R4, All" subscription, the app is not associated with the sandbox tenant → `unknown-tenant`.

**Fix (human task in code Console — no YourPHR code change):**

1. Open app `c330e3c6-…` (Application ID `865ab3c7-…`) in <https://code-console.cerner.com/>.
2. **Subscribe it to "Oracle Health FHIR APIs for Millennium: FHIR R4, All"** (*Trap 2*). Confirm the app summary's **FHIR Version now shows `R4`** (not `-`).
3. Confirm the app's **persona/type is Patient** and its tenant/base URL matches `fhir-myrecord…/r4/ec2458f2-…` (code Console is authoritative — if it shows a different tenant for the app, update `YOURPHR_SANDBOX_ORACLE_CLIENT_ID`'s base URL in `SandboxProviderSeeds()` to match).
4. Re-run the patient authorize probe; success = it reaches the patient login (`nancysmart` / `Cerner01`) instead of `unknown-tenant`.

No authorize-endpoint override and no provider app are needed — those earlier "options" were based on testing the wrong (provider) host. YourPHR's seeded `fhir-myrecord` base + discovery already yield the correct patient flow.

## See also

- Index: [`../test-sandboxes.md`](../test-sandboxes.md)
- Oracle docs: [Build & Test SMART on FHIR Apps](https://docs.oracle.com/en/industries/health/millennium-platform-apis/build-smart-on-fhir-apps/) · [SMART App Provisioning](https://docs.oracle.com/en/industries/health/millennium-platform-apis/smart-app-provisioning/)
