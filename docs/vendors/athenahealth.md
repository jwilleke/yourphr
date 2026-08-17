# athenahealth — Developer Portal registration

athenahealth's FHIR R4 (athenaPractice / athenaFlow). __More involved than the other sandboxes__ — registration is gated behind portal __approval__, and base URLs are __site / practice-specific__. Treat this as a later target.

__Register at:__ <https://mydata.athenahealth.com/access-the-apis> — athenahealth Developer Portal (docs: <https://docs.athenahealth.com/api/guides/overview>). Approval required.

## What you need

| Item | How |
|---|---|
| __Developer Portal account__ | register at the athenahealth Developer Portal |
| __App + approval__ | submit an app and request the FHIR R4 APIs; access is __approval-gated__ (not instant) |
| __`client_id` + `client_secret`__ | issued after approval — __confidential__ (Web app / Secret auth); store the secret in `private/secrets.md` |
| __FHIR base URL__ | __site-specific__ — obtain the exact base from the portal |

Record credentials in `private/secrets.md` (gitignored).

## "Create New Application" form choices

| Field | Choose | Why |
|---|---|---|
| __API Access__ | __My app will use Certified APIs ONLY__ | YourPHR reads only the standard FHIR R4 patient-access API (ONC-certified §170.315(g)(10), "standardized API for patient and population services"); no proprietary athenaOne APIs. This Certified path = __US-Core R4 / USCDI__ (see [`../FHIR/uscdi-vs-us-core.md`](../FHIR/uscdi-vs-us-core.md)); also the 21st Century Cures Act patient-access path. |
| __App Category__ | __3-Legged OAuth for Patients__ | Patient-facing — the patient logs in via athenahealth's widget to authorize access to their own records (SMART patient-standalone). Not 2-Legged (service-to-service) or 3-Legged for Providers (clinician login). |
| __Application Type__ | __Web__ | YourPHR handles auth + tokens __server-side__ — the relay catches the code, the backend exchanges it; the browser never sees tokens. That's athenahealth's "Web" type. Not "Browser" (SPA where the browser receives tokens → public/PKCE) or "Native". |
| __Authentication Method__ | __Secret__ | "Web" apps are __confidential__ and authenticate with a client secret — athenahealth disallows PKCE for Web. YourPHR stores the secret server-side, DB-encrypted — the same confidential-client path as Blue Button ([#286](https://github.com/jwilleke/yourphr/issues/286)). ("JWK" = asymmetric `private_key_jwt`, for backend/system apps.) |
| __Post-Login Redirect URL__ (redirect URI) | `https://relay.nerdsbythehour.com/callback` | The YourPHR OAuth relay catches the auth code here — same for every sandbox; must match exactly. |
| __Post-Logout Redirect URL__ | *blank* (or `https://yourphr.org` if required) | YourPHR doesn't do OIDC RP-initiated logout (the patient disconnects the source in-app), so this isn't exercised — just needs a valid whitelisted URL if the field is mandatory. |
| __API framework (Scopes product)__ | __FHIR R4 SMART V1__ | YourPHR uses standard R4 FHIR with __v1__ scopes (`patient/*.read`). Not athenaOne (proprietary / non-certified), Event Notifications, __FHIR DSTU2__ (old FHIR version — wrong schema; see [`../FHIR/dstu2-vs-r4.md`](../FHIR/dstu2-vs-r4.md)), or SMART V2 (granular `.rs` scopes we don't use). |
| __Scopes__ (within FHIR R4 SMART V1) | `launch/patient openid fhirUser offline_access patient/*.read` | patient standalone + offline (refresh) + read. If no wildcard, tick the individual `patient/<Resource>.read` scopes. |

## Steps

1. Register at the __athenahealth Developer Portal__: <https://docs.athenahealth.com/api/guides/overview> (patient-data / mydata APIs: <https://mydata.athenahealth.com>).
2. Create an app — __API Access: Certified APIs ONLY__, __App Category: 3-Legged OAuth for Patients__ (see table above) — and request the __FHIR R4__ product. Wait for __approval__.
3. Get the __base FHIR URL__ — it is site-specific; see the [base-FHIR-URLs guide](https://docs.athenahealth.com/api/guides/base-fhir-urls).
4. Sandbox sample patient login: `athenainterop@aol.com`.

## Status

🟡 __Auth works; record access gated (live test 2026-06-18).__ Wired into `/sandbox` with base `https://api.preview.platform.athenahealth.com/fhir/r4` and the confidential `client_id`/`client_secret`. The SMART flow + PKCE + the __patient login succeed__ — the patient (e.g. *Jake Medlock, DOB Jan 28 1952*) authenticates and the popup reaches athenahealth's consent screen. It then stops at:

> "Could not confirm access to additional health records. Please check again later."

That is athenahealth's __patient record-sharing / app-onboarding gate__, not a YourPHR bug (the OAuth flow, creds, scopes, and `aud` are all correct). To clear it: finish app onboarding/approval in the Developer Portal so the app may pull patient records in preview, and/or use a test patient that has linked records (the docs also cite `athenainterop@aol.com`). "Please check again later" can also be literal provisioning lag.

Confirmed working values: base `https://api.preview.platform.athenahealth.com/fhir/r4`; test patient `phrtest_preview@mailinator.com` / `Password1`. It's a __confidential__ client (id + secret, both server-side).

## See also

- Index: [`../testing-sandboxes/test-sandboxes.md`](../testing-sandboxes/test-sandboxes.md)
- [athenahealth FHIR API docs](https://docs.athenahealth.com/api/docs/fhir-apis)
