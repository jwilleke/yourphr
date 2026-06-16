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

🟡 Registered, `client_id` obtained, discovery verified — **ready to connect** once the relay is online and the R4 API product is subscribed.

## See also

- Index: [`../test-sandboxes.md`](../test-sandboxes.md)
- Oracle docs: [Build & Test SMART on FHIR Apps](https://docs.oracle.com/en/industries/health/millennium-platform-apis/build-smart-on-fhir-apps/) · [SMART App Provisioning](https://docs.oracle.com/en/industries/health/millennium-platform-apis/smart-app-provisioning/)
