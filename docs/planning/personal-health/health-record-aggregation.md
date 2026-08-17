# Personal health record aggregation — options

Planning doc for getting health records from patient portals (primarily FollowMyHealth / Veradigm) into a self-hosted store in JSON or XML format.

## Background

- __Current store:__ [Fasten onprem](https://fasten.nerdsbythehour.com) — deployed, healthy, Authentik-gated, hourly SQLite backup to NAS.
- __Key limitation:__ fasten-onprem [dropped all provider integrations](https://github.com/fastenhealth/fasten-onprem/issues/629). The live SMART on FHIR sync is a commercial Fasten Connect feature only. The self-hosted version is a manual-import-only FHIR viewer.
- __Primary source:__ [FollowMyHealth](https://www.followmyhealth.com/patientaccess) — Veradigm patient portal. Supports FHIR R4 via SMART on FHIR. Does __not__ use US Core profiles (native FHIR R4 with custom extensions).
- __Format requirement:__ JSON or XML.

---

## Option A — Manual portal export → Fasten import (works today)

__How:__ FollowMyHealth portal → Health Record → Download → C-CDA XML or FHIR Bundle JSON → Fasten Sources → Manual / File Upload.

__Pros:__ no developer registration, no code, works immediately.
__Cons:__ manual process, no automation, must repeat when records update.
__Format:__ C-CDA XML (HL7 CDA R2) or FHIR R4 JSON depending on portal export option.
__Status:__ viable now.

---

## Option B — Custom SMART on FHIR sync script (Veradigm API)

__How:__ register a patient-facing SMART app at [developer.veradigm.com](https://developer.veradigm.com), implement the SMART on FHIR OAuth2 launch flow (browser redirect for initial auth, persist refresh token), then run a cronjob that calls `GET /Patient/$everything` and saves the FHIR Bundle JSON for import into Fasten.

__Pros:__ automated sync after one-time OAuth setup; FHIR R4 JSON output; reuses the `setup-fasten.mjs` pattern already in the repo.
__Cons:__ requires Veradigm developer app registration (approval process); OAuth redirect needs a reachable localhost or LAN endpoint for the initial flow; refresh token management; Veradigm FHIR R4 deviates from US Core so some resources will have custom extensions.
__Format:__ FHIR R4 Bundle JSON.
__Effort:__ medium — OAuth flow is the hard part; bundle fetch and file save is simple.
__Status:__ not started. Would live at `apps/production/jimsmcp/sync-health-records.mjs` or similar.

### Rough implementation sketch

```text
1. Register app at developer.veradigm.com → get client_id
2. One-time: launch SMART auth flow (redirect to FollowMyHealth login)
   → user authorizes → receive auth_code → exchange for access + refresh tokens
   → persist refresh token securely (SOPS-encrypted secret)
3. Cronjob (daily):
   → use refresh token to get new access token
   → GET /Patient/$everything → FHIR Bundle JSON
   → save to /mnt/tank/jims/data/health-records/YYYYMMDD.json
   → optional: POST bundle to Fasten API if it exposes an import endpoint
```

---

## Option C — Apple Health as intermediary (iPhone only)

__How:__ connect FollowMyHealth to Apple Health (Health app → Health Records → Add Account → FollowMyHealth). Apple Health syncs FHIR records automatically. Export from iPhone: Health app → profile → Export All Health Data → `.zip` containing `export.xml` (Apple CDA variant) and FHIR JSON files.

__Pros:__ no developer account, no code, Apple handles the SMART on FHIR auth.
__Cons:__ requires iPhone; export is manual (no server-side automation); Apple's CDA export format is non-standard in places; sync depends on Apple Health's polling interval.
__Format:__ Apple-flavored CDA XML + FHIR JSON bundle files inside the export zip.
__Status:__ viable now if on iPhone. Least technical path.

---

## Option D — Medplum as FHIR server (replace or augment Fasten)

__What:__ [Medplum](https://github.com/medplum/medplum) is a FHIR R4 server + developer toolkit. Self-hostable on Kubernetes via Helm.

__Does it solve provider sync?__ No — Medplum is a FHIR *server*, not a SMART client. It has no built-in connectors to patient portals. Custom integration code would still be required (same as Option B), but targeting Medplum's storage API instead of Fasten.

__Pros:__ modern FHIR R4 native, strong API, active development, proper multi-resource FHIR store.
__Cons:__ significantly more complex to deploy and operate than Fasten (needs PostgreSQL, Redis, background workers); designed for healthcare app developers, not personal PHR; does not eliminate the sync problem.
__Status:__ not recommended unless Fasten's viewer limitations become blocking. Overkill for current use case.

---

## Option E — OpenEMR

__What:__ [OpenEMR](https://github.com/openemr/openemr) is a full open-source clinical EMR designed for medical practices.

__Does it solve provider sync?__ No — OpenEMR exposes a SMART on FHIR *server* for third-party apps; it has no client for pulling from patient portals.

__Status:__ not recommended. Designed for clinics, not personal PHR. High operational complexity for a single user.

---

## Recommendation

| Priority | Option | Why |
|---|---|---|
| Now | A (manual export) | Zero effort, works immediately |
| Next | B (SMART sync script) | Automates the only hard part; reuses existing tooling patterns |
| Fallback | C (Apple Health export) | No-code path if on iPhone |
| Defer | D / E | No provider sync benefit; significant added complexity |

Start with __A__ to validate that FollowMyHealth's export is clean and Fasten can import it correctly. Build __B__ once the format is confirmed.
