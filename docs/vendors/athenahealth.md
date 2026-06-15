# athenahealth — Developer Portal registration

athenahealth's FHIR R4 (athenaPractice / athenaFlow). **More involved than the other sandboxes** — registration is gated behind portal **approval**, and base URLs are **site / practice-specific**. Treat this as a later target.

**Register at:** <https://mydata.athenahealth.com/access-the-apis> — athenahealth Developer Portal (docs: <https://docs.athenahealth.com/api/guides/overview>). Approval required.

## What you need

| Item | How |
|---|---|
| **Developer Portal account** | register at the athenahealth Developer Portal |
| **App + approval** | submit an app and request the FHIR R4 APIs; access is **approval-gated** (not instant) |
| **`client_id` + `client_secret`** | issued after approval — **confidential** (Web app / Secret auth); store the secret in `private/secrets.md` |
| **FHIR base URL** | **site-specific** — obtain the exact base from the portal |

Record credentials in `private/secrets.md` (gitignored).

## "Create New Application" form choices

| Field | Choose | Why |
|---|---|---|
| **API Access** | **My app will use Certified APIs ONLY** | YourPHR reads only the standard FHIR R4 patient-access API (ONC-certified §170.315(g)(10), "standardized API for patient and population services"); no proprietary athenaOne APIs. This Certified path = **US-Core R4 / USCDI** (see [`../FHIR/uscdi-vs-us-core.md`](../FHIR/uscdi-vs-us-core.md)); also the 21st Century Cures Act patient-access path. |
| **App Category** | **3-Legged OAuth for Patients** | Patient-facing — the patient logs in via athenahealth's widget to authorize access to their own records (SMART patient-standalone). Not 2-Legged (service-to-service) or 3-Legged for Providers (clinician login). |
| **Application Type** | **Web** | YourPHR handles auth + tokens **server-side** — the relay catches the code, the backend exchanges it; the browser never sees tokens. That's athenahealth's "Web" type. Not "Browser" (SPA where the browser receives tokens → public/PKCE) or "Native". |
| **Authentication Method** | **Secret** | "Web" apps are **confidential** and authenticate with a client secret — athenahealth disallows PKCE for Web. YourPHR stores the secret server-side, DB-encrypted — the same confidential-client path as Blue Button ([#286](https://github.com/jwilleke/yourphr/issues/286)). ("JWK" = asymmetric `private_key_jwt`, for backend/system apps.) |
| **Post-Login Redirect URL** (redirect URI) | `https://relay.nerdsbythehour.com/callback` | The YourPHR OAuth relay catches the auth code here — same for every sandbox; must match exactly. |
| **Post-Logout Redirect URL** | _blank_ (or `https://yourphr.org` if required) | YourPHR doesn't do OIDC RP-initiated logout (the patient disconnects the source in-app), so this isn't exercised — just needs a valid whitelisted URL if the field is mandatory. |
| **API framework (Scopes product)** | **FHIR R4 SMART V1** | YourPHR uses standard R4 FHIR with **v1** scopes (`patient/*.read`). Not athenaOne (proprietary / non-certified), Event Notifications, **FHIR DSTU2** (old FHIR version — wrong schema; see [`../FHIR/dstu2-vs-r4.md`](../FHIR/dstu2-vs-r4.md)), or SMART V2 (granular `.rs` scopes we don't use). |
| **Scopes** (within FHIR R4 SMART V1) | `launch/patient openid fhirUser offline_access patient/*.read` | patient standalone + offline (refresh) + read. If no wildcard, tick the individual `patient/<Resource>.read` scopes. |

## Steps

1. Register at the **athenahealth Developer Portal**: <https://docs.athenahealth.com/api/guides/overview> (patient-data / mydata APIs: <https://mydata.athenahealth.com>).
2. Create an app — **API Access: Certified APIs ONLY**, **App Category: 3-Legged OAuth for Patients** (see table above) — and request the **FHIR R4** product. Wait for **approval**.
3. Get the **base FHIR URL** — it is site-specific; see the [base-FHIR-URLs guide](https://docs.athenahealth.com/api/guides/base-fhir-urls).
4. Sandbox sample patient login: `athenainterop@aol.com`.

## Status

🟡 Registered — `client_id` + `client_secret` obtained 2026-06-15 (in `private/secrets.md`). Remaining before a connect: confirm the **site-specific FHIR base URL** from the portal, clear any approval gate, and have the relay online. It's a **confidential** client, so the YourPHR connect form needs **both** the `client_id` and `client_secret` (same as Blue Button).

## See also

- Index: [`../test-sandboxes.md`](../test-sandboxes.md)
- [athenahealth FHIR API docs](https://docs.athenahealth.com/api/docs/fhir-apis)
