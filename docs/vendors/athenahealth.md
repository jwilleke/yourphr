# athenahealth — Developer Portal registration

athenahealth's FHIR R4 (athenaPractice / athenaFlow). **More involved than the other sandboxes** — registration is gated behind portal **approval**, and base URLs are **site / practice-specific**. Treat this as a later target.

**Register at:** <https://mydata.athenahealth.com/access-the-apis> — athenahealth Developer Portal (docs: <https://docs.athenahealth.com/api/guides/overview>). Approval required.

## What you need

| Item | How |
|---|---|
| **Developer Portal account** | register at the athenahealth Developer Portal |
| **App + approval** | submit an app and request the FHIR R4 APIs; access is **approval-gated** (not instant) |
| **`client_id` / `client_secret`** | issued after approval |
| **FHIR base URL** | **site-specific** — obtain the exact base from the portal |

Record credentials in `private/secrets.md` (gitignored).

## Steps

1. Register at the **athenahealth Developer Portal**: <https://docs.athenahealth.com/api/guides/overview> (patient-data / mydata APIs: <https://mydata.athenahealth.com>).
2. Create an app and request the **FHIR R4** product. Wait for **approval**.
3. Get the **base FHIR URL** — it is site-specific; see the [base-FHIR-URLs guide](https://docs.athenahealth.com/api/guides/base-fhir-urls).
4. Sandbox sample patient login: `athenainterop@aol.com`.

## Status

🔴 Not started — approval-gated and site-specific, so **lower priority**. SMART Health IT + Epic + Cerner already cover standard-SMART testing.

## See also

- Index: [`../test-sandboxes.md`](../test-sandboxes.md)
- [athenahealth FHIR API docs](https://docs.athenahealth.com/api/docs/fhir-apis)
