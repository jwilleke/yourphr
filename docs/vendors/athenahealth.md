# athenahealth — Developer Portal registration

athenahealth's FHIR R4 (athenaPractice / athenaFlow). **More involved than the other sandboxes** — registration is gated behind portal **approval**, and base URLs are **site / practice-specific**. Treat this as a later target.

**Register at:** <https://mydata.athenahealth.com/access-the-apis> — athenahealth Developer Portal (docs: <https://docs.athenahealth.com/api/guides/overview>). Approval required.

## What you need

| Item | How |
|---|---|
| **Developer Portal account** | register at the athenahealth Developer Portal |
| **App + approval** | submit an app and request the FHIR R4 APIs; access is **approval-gated** (not instant) |
| **`client_id`** | issued after approval — **public / PKCE, no secret** (choose PKCE auth) |
| **FHIR base URL** | **site-specific** — obtain the exact base from the portal |

Record credentials in `private/secrets.md` (gitignored).

## "Create New Application" form choices

| Field | Choose | Why |
|---|---|---|
| **API Access** | **My app will use Certified APIs ONLY** | YourPHR reads only the standard FHIR R4 patient-access API (ONC-certified §170.315(g)(10), "standardized API for patient and population services"); no proprietary athenaOne APIs. Also the 21st Century Cures Act patient-access path. |
| **App Category** | **3-Legged OAuth for Patients** | Patient-facing — the patient logs in via athenahealth's widget to authorize access to their own records (SMART patient-standalone). Not 2-Legged (service-to-service) or 3-Legged for Providers (clinician login). |
| **Authentication Method** | **Proof key for Code Exchange (PKCE)** | YourPHR is a public client — it secures the auth-code flow with PKCE (S256), no secret — same as Epic/Cerner/SMART Health IT. "Secret" = confidential (per-user secret to manage, like Blue Button); "JWK" = asymmetric `private_key_jwt` for backend/system apps. |
| **Post-Login Redirect URL** (redirect URI) | `https://relay.nerdsbythehour.com/callback` | The YourPHR OAuth relay catches the auth code here — same for every sandbox; must match exactly. |
| **Post-Logout Redirect URL** | _blank_ (or `https://yourphr.org` if required) | YourPHR doesn't do OIDC RP-initiated logout (the patient disconnects the source in-app), so this isn't exercised — just needs a valid whitelisted URL if the field is mandatory. |
| **Scopes** | `launch/patient openid fhirUser offline_access patient/*.read` | patient standalone + offline (refresh) + read access |

## Steps

1. Register at the **athenahealth Developer Portal**: <https://docs.athenahealth.com/api/guides/overview> (patient-data / mydata APIs: <https://mydata.athenahealth.com>).
2. Create an app — **API Access: Certified APIs ONLY**, **App Category: 3-Legged OAuth for Patients** (see table above) — and request the **FHIR R4** product. Wait for **approval**.
3. Get the **base FHIR URL** — it is site-specific; see the [base-FHIR-URLs guide](https://docs.athenahealth.com/api/guides/base-fhir-urls).
4. Sandbox sample patient login: `athenainterop@aol.com`.

## Status

🔴 Not started — approval-gated and site-specific, so **lower priority**. SMART Health IT + Epic + Cerner already cover standard-SMART testing.

## See also

- Index: [`../test-sandboxes.md`](../test-sandboxes.md)
- [athenahealth FHIR API docs](https://docs.athenahealth.com/api/docs/fhir-apis)
