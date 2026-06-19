# Connect Medicare — CMS Blue Button 2.0

How to connect **CMS Blue Button 2.0** (Medicare claims data) to YourPHR as a SMART-on-FHIR source. This page exists so you don't have to reverse-engineer the settings the way we did — it lists the **exact** values that work, plus the errors you'll hit if a value is wrong.

> **✅ Verified working** against the Blue Button **sandbox** on 2026-06-14 — a real end-to-end connect (login → token exchange → sync) succeeded with exactly the settings below.
>
> **Heads-up — this is the manual / admin path.** Today you enter the OAuth settings by hand in the "Connect a SMART source" form. The patient-friendly "pick Medicare from a list, log in, never see a client id/secret" experience is the **Source Catalog** ([#291](https://github.com/jwilleke/yourphr/issues/291)) — until that lands, use the values below.

## What Blue Button 2.0 gives you

A national, standardized **FHIR R4** API for Medicare beneficiaries. It returns **claims/insurance** data — **`ExplanationOfBenefit`** (the main one), **`Coverage`**, and **`Patient`**. It is *complementary* to clinical records (labs, notes, meds), **not** a replacement. The **sandbox** is self-serve, instant, and serves **synthetic** beneficiary data (no real PHI); **production** is a documented CMS review (no cost).

## Step 1 — Register a sandbox app

1. Go to the CMS Blue Button developer portal: `https://bluebutton.cms.gov/developers/` → **Sandbox**.
2. Create a developer account and **register an application** with these settings:

   | App setting | Value |
   |---|---|
   | **OAuth Client Type** | **`confidential`** (you get a `client_id` **and** a `client_secret`) |
   | **OAuth Grant Type** | **`authorization-code`** |
   | **Callback URL / Redirect URI** | your instance's relay callback — **`https://relay.nerdsbythehour.com/callback`** (default), or `${YOURPHR_RELAY_URL}/callback` if you run your own relay. **Must match exactly.** |
   | **Collect beneficiary demographic data** | **Yes** (needed to read Patient demographics) |

3. CMS gives you a **Sandbox `client_id`** and **Sandbox `client_secret`**. Use the **Sandbox** pair (not Production).

## Step 2 — The exact connect settings

In YourPHR: **Sources → Connect a SMART source**, fill in **exactly**:

| Field | Value |
|---|---|
| **FHIR base URL** | `https://sandbox.bluebutton.cms.gov/v2/fhir` |
| **Client ID** | your sandbox `client_id` — **just the id** (see the `/` gotcha below) |
| **Client Secret** | your sandbox `client_secret` — Blue Button is a **confidential** client, so this is **required** |
| **Scopes** | `openid profile launch/patient patient/Patient.read patient/Coverage.read patient/ExplanationOfBenefit.read` |
| **Display name** | e.g. `Medicare (Blue Button)` |

Then **Connect** → a popup opens to the CMS login → log in as a **synthetic sandbox beneficiary** → **Authorize** → the popup redirects to the relay, YourPHR completes the token exchange and syncs.

## Scopes — use these, not the form default

The form's default scopes are Epic-shaped and **Blue Button rejects them** (`invalid_scope`). Blue Button supports a **specific** set — use exactly:

```
openid profile launch/patient patient/Patient.read patient/Coverage.read patient/ExplanationOfBenefit.read
```

Blue Button does **NOT** support these (they cause `invalid_scope`) — leave them out:

- `patient/*.read` — **no wildcard**; only the three specific resources above
- `fhirUser`
- `offline_access` — **confirmed rejected** by the sandbox authorize endpoint (it's not in Blue Button's published `scopes_supported`), even though Blue Button advertises an offline *capability*. Including it gives `invalid_scope`. **Omit it.** The trade-off: no refresh token, so the access token lasts only ~1h and a later re-sync needs a fresh login. (True offline/refresh on Blue Button may require a registration setting or production access — out of scope here.)

## Troubleshooting — the exact errors and their fixes

| Error you see | Cause | Fix |
|---|---|---|
| `invalid api_endpoint_base_url: URL must use https (got "")` | **FHIR base URL is empty** (the field shows the grey `https://fhir.example.com/r4` *placeholder*, which counts as blank). | Type `https://sandbox.bluebutton.cms.gov/v2/fhir` into the field. |
| `invalid_client : Application does not exist (client_id)` | The `client_id` CMS received isn't a registered sandbox app — usually **id+secret jammed into the Client ID field** (separated by `/`), a **wrong/Production** id, or a typo/space. | Put **only** the `client_id` in Client ID (the part **before** any `/`), and the secret in the **Client Secret** field. Use the **Sandbox** id. |
| `invalid_scope` | Requested scopes Blue Button doesn't support — the wildcard `patient/*.read`, `fhirUser`, **or `offline_access`** (the sandbox rejects all three). | Replace Scopes with the exact list above — none of those three. |
| `could not retrieve authorization code from relay: timed out` **and the popup said "Connected"** | The login took **longer than YourPHR's connect-wait window**. The popup "Connected" means the relay *did* get the code — but the backend had already stopped polling. Not a config error. | The window now defaults to **4 minutes** and is **operator-tunable** via `web.smart_connect.login_wait_seconds` (env `YOURPHR_WEB_SMART_CONNECT_LOGIN_WAIT_SECONDS`) — no frontend rebuild. If your login is even slower, raise it and restart. Quick workaround: pre-log-in at `bluebutton.cms.gov` in another tab first, then Connect so the popup skips straight to Authorize. |
| `could not retrieve authorization code from relay: timed out` **and no "Connected" popup** | The auth code never reached the relay — usually a **redirect-URI mismatch** (the app's registered Callback URL ≠ the relay callback) or the **login wasn't completed**. | Make the app's redirect URI **exactly** `https://relay.nerdsbythehour.com/callback`; complete the CMS login + Authorize with a **synthetic** beneficiary. |

**The `client_id` / `client_secret` "`/`" gotcha:** the connect form has **separate** Client ID and Client Secret fields. Do **not** paste `client_id/client_secret` into Client ID — CMS reads the whole blob as one id and returns `Application does not exist`. Split them.

## Production access

Sandbox is enough to build and prove the connection. For **real** Medicare data, request **production** credentials via CMS's documented app-review process (no cost); the base URL becomes `https://api.bluebutton.cms.gov/v2/fhir` and you use the **Production** `client_id`/`client_secret`.

## How this maps to YourPHR internals

- **Discovery + PKCE** work out of the box — Blue Button serves `/.well-known/smart-configuration`, so the generic SMART client handles the auth flow.
- **Confidential client** (the `client_secret`) — [#286](https://github.com/jwilleke/yourphr/issues/286).
- **No `$everything`** — Blue Button exposes only Patient/Coverage/ExplanationOfBenefit and no operations, so YourPHR fetches per-resource via the CapabilityStatement-driven path — [#250](https://github.com/jwilleke/yourphr/issues/250).
- **Connect-form Client Secret field** — [#279](https://github.com/jwilleke/yourphr/issues/279).
- **OAuth relay** — the redirect callback; default `relay.nerdsbythehour.com`, overridable via `YOURPHR_RELAY_URL` (see [`deployment/README.md`](deployment/README.md)).

## Future — no more of this (the Source Catalog)

Everything above is the manual path. The **Source Catalog** ([#291](https://github.com/jwilleke/yourphr/issues/291)) will hold these per-provider settings (base URL, scopes, the admin's credentials) so a patient just clicks **"Connect Medicare"** and logs in — never seeing a base URL, scope list, client id, or secret. This doc is the interim reference and the source of truth for the Blue Button catalog entry.
