# Personal health record aggregation — options

Planning doc for getting health records from patient portals (primarily FollowMyHealth / Veradigm) into a self-hosted store in JSON or XML format.

## Background

- **Current store:** [Fasten onprem](https://fasten.nerdsbythehour.com) — deployed, healthy, Authentik-gated, hourly SQLite backup to NAS. See [`docs/apps/fasten.md`](../../apps/fasten.md).
- **Key limitation:** fasten-onprem [dropped all provider integrations](https://github.com/fastenhealth/fasten-onprem/issues/629). The live SMART on FHIR sync is a commercial Fasten Connect feature only. The self-hosted version is a manual-import-only FHIR viewer.
- **Primary source:** [FollowMyHealth](https://www.followmyhealth.com/patientaccess) — Veradigm patient portal. Supports FHIR R4 via SMART on FHIR. Does **not** use US Core profiles (native FHIR R4 with custom extensions).
- **Format requirement:** JSON or XML.

---

## Option A — Manual portal export → Fasten import (works today)

**How:** FollowMyHealth portal → Health Record → Download → C-CDA XML or FHIR Bundle JSON → Fasten Sources → Manual / File Upload.

**Pros:** no developer registration, no code, works immediately.
**Cons:** manual process, no automation, must repeat when records update.
**Format:** C-CDA XML (HL7 CDA R2) or FHIR R4 JSON depending on portal export option.
**Status:** viable now.

---

## Option B — Custom SMART on FHIR sync script (Veradigm API)

**How:** register a patient-facing SMART app at [developer.veradigm.com](https://developer.veradigm.com), implement the SMART on FHIR OAuth2 launch flow (browser redirect for initial auth, persist refresh token), then run a cronjob that calls `GET /Patient/$everything` and saves the FHIR Bundle JSON for import into Fasten.

**Pros:** automated sync after one-time OAuth setup; FHIR R4 JSON output; reuses the `setup-fasten.mjs` pattern already in the repo.
**Cons:** requires Veradigm developer app registration (approval process); OAuth redirect needs a reachable localhost or LAN endpoint for the initial flow; refresh token management; Veradigm FHIR R4 deviates from US Core so some resources will have custom extensions.
**Format:** FHIR R4 Bundle JSON.
**Effort:** medium — OAuth flow is the hard part; bundle fetch and file save is simple.
**Status:** not started. Would live at `apps/production/jimsmcp/sync-health-records.mjs` or similar.

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

**How:** connect FollowMyHealth to Apple Health (Health app → Health Records → Add Account → FollowMyHealth). Apple Health syncs FHIR records automatically. Export from iPhone: Health app → profile → Export All Health Data → `.zip` containing `export.xml` (Apple CDA variant) and FHIR JSON files.

**Pros:** no developer account, no code, Apple handles the SMART on FHIR auth.
**Cons:** requires iPhone; export is manual (no server-side automation); Apple's CDA export format is non-standard in places; sync depends on Apple Health's polling interval.
**Format:** Apple-flavored CDA XML + FHIR JSON bundle files inside the export zip.
**Status:** viable now if on iPhone. Least technical path.

---

## Option D — Medplum as FHIR server (replace or augment Fasten)

**What:** [Medplum](https://github.com/medplum/medplum) is a FHIR R4 server + developer toolkit. Self-hostable on Kubernetes via Helm.

**Does it solve provider sync?** No — Medplum is a FHIR *server*, not a SMART client. It has no built-in connectors to patient portals. Custom integration code would still be required (same as Option B), but targeting Medplum's storage API instead of Fasten.

**Pros:** modern FHIR R4 native, strong API, active development, proper multi-resource FHIR store.
**Cons:** significantly more complex to deploy and operate than Fasten (needs PostgreSQL, Redis, background workers); designed for healthcare app developers, not personal PHR; does not eliminate the sync problem.
**Status:** not recommended unless Fasten's viewer limitations become blocking. Overkill for current use case.

---

## Option E — OpenEMR

**What:** [OpenEMR](https://github.com/openemr/openemr) is a full open-source clinical EMR designed for medical practices.

**Does it solve provider sync?** No — OpenEMR exposes a SMART on FHIR *server* for third-party apps; it has no client for pulling from patient portals.

**Status:** not recommended. Designed for clinics, not personal PHR. High operational complexity for a single user.

---

## Recommendation

| Priority | Option | Why |
|---|---|---|
| Now | A (manual export) | Zero effort, works immediately |
| Next | B (SMART sync script) | Automates the only hard part; reuses existing tooling patterns |
| Fallback | C (Apple Health export) | No-code path if on iPhone |
| Defer | D / E | No provider sync benefit; significant added complexity |

Start with **A** to validate that FollowMyHealth's export is clean and Fasten can import it correctly. Build **B** once the format is confirmed.
