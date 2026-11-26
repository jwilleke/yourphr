---
name: Connected devices developer guide
description: The code behind connected devices and health samples — the two switches, device grants and their keys, sample intake, raw storage and the daily Observations
dateModified: 2026-11-23
category: guides
relatedModules: [AgentTokensManager, HealthManager, SqlitePhdSamplesProvider, app/health, RecordsManager.saveDeviceRecord]
---

# Connected devices developer guide

The server side of connected devices: a phone app reading Apple Health or Health Connect, or a scale, cuff or meter, that adds health samples to a patient's record. What a device app may rely on (setup codes, keys, refresh rotation, the upload body and its answers) is the contract in [devices/connected-devices.md](../devices/connected-devices.md); this page is how the code keeps it. No companion app lives in this repository.

## Standing rules

- Off by default, behind three switches. `yourphr.devices.enabled` turns on device grants (setup, keys, refresh). `yourphr.health.enabled` turns on the health routes and opens `phd-samples.db`; off, those routes do not exist. It turns on only while `yourphr.database.encryption.key` is set: with the key empty it is refused at start and logged, so readings are never stored unlocked ([#991](https://github.com/jwilleke/yourphr/issues/991)). `yourphr.health.device-intake.enabled` lets a device key upload; off, only a signed-in session can, and a device's upload answers 403 before it is logged as an upload.
- A device key is an agent token tied to a device grant (`grantId` on `ApiContext.viaToken`). Its scopes are `DEVICE_SCOPES` (`Health samples (add)`, `Health samples (sync state)` in `src/account/index.ts`), which are not access categories, so an ordinary agent token can never be given them and a device can never read the record.
- A device's only write is `POST /api/secure/health/samples` (`writeCategoryFor`); its only read is `GET /api/secure/health/sync-state`. Each is logged under the device's own name before it is served, and each upload is stamped on the grant (`AgentTokensManager.recordDeviceUpload`) for inactivity.
- `HealthManager` acts for `ctx.username` only; nothing in the body names the account. It refuses a device key on every chart read itself, as well as the agent gate refusing it first ([#1020](https://github.com/jwilleke/yourphr/issues/1020)).
- Every time is RFC 3339 with an explicit offset; anything else is refused, never read in the server's time zone (`src/app/health/time.ts`).
- Raw readings and the daily Observations are locked with the server's database key, the same as every record, so a device can upload while the patient is signed out. The device key only authorizes; it is never an encryption key. The threat model and its decision are in [security-developer-guide.md](security-developer-guide.md#health-data-at-rest-and-uploads-while-the-patient-is-signed-out) ([#991](https://github.com/jwilleke/yourphr/issues/991)).
- Device data is PGHD: tagged with `PGHD_TAG`, credited to the device, filed under the device's own source, never mixed with clinician records.

## The code

| Concern | Where |
| --- | --- |
| Grants: create, claim, refresh with rotation and reuse detection, extend, revoke, pause and resume, reminders | `AgentTokensManager` (`createDeviceGrant`, `claimDeviceGrant`, `refreshDeviceGrant`, `extendDeviceGrant`, `revokeDeviceGrant`, `suspendInactiveDevices`, `resumeDeviceGrant`, `remindEndingDevices`), stored by `SqliteAgentTokensProvider` (`device_grants`, `device_refresh_spent`) |
| Token prefixes | `yphr_setup_` (setup code), `yphr_at_` (access), `yphr_rt_` (refresh), constants in `AgentTokensManager.ts` |
| Public routes | `POST /api/device/claim`, `POST /api/device/token` (rate-limited per IP) |
| The patient's screens | `GET`/`POST /api/secure/account/devices`, `POST /api/secure/account/devices/:id/extend`, `…/resume`, `…/revoke` |
| Intake | `HealthManager.ingest` (at most `HEALTH_SAMPLE_MAX_BATCH`, 5,000 samples; body up to 8 MiB); a vendor batch or a FHIR Bundle of Observations |
| Vendor types to FHIR | `src/app/health/catalog.ts`: HealthKit and Health Connect keys resolve to one row of LOINC code, UCUM unit and `Observation.category`. An unknown type is stored with an empty code; a known type in a unit the row does not accept is rejected |
| Raw samples | `SqlitePhdSamplesProvider` over `phd-samples.db`, its own migrations (`PHD_MIGRATIONS`) |
| Daily and spot Observations | `src/app/health/rollup.ts` builds them; `RecordsManager.saveDeviceRecord` writes them to `records.db` |
| Reading back | `HealthManager.list`, `series`, `metrics`, `bundle`, `observation`, `syncState`; Observations rebuilt from raw rows by `src/app/health/observation.ts` |
| Scheduled work | `assembleApp` (`src/app.ts`) runs the end-of-term reminders and the inactivity pause hourly |

Device limits: `yourphr.devices.grant-max-days`, `key-ttl-hours`, `setup-code-minutes`, `max-per-user`, `notice-days`, `inactive-after-days`.

## How to add a metric

1. Add its row to `src/app/health/catalog.ts`: the LOINC code, the UCUM unit(s) it accepts, its category, and the HealthKit and Health Connect keys that map to it. Use the codes' canonical systems (`LOINC`, `SNOMED` and UCUM constants in that file).
2. Decide whether it is a high-frequency series (kept raw, rolled up per local day) or a spot reading (its own Observation), and follow the existing rows of that kind in `rollup.ts`.
3. Add a sample to the intake tests and update the public contract in [devices/connected-devices.md](../devices/connected-devices.md) if a device app sees the change.

## How you know you are done

- `npm run health-intake` and `npm run agent-tokens` pass, and the unit tests under `src/app/managers/__tests__/` (`HealthSamples`, `HealthIntakeGuards`, `HealthReadAccess`, `HealthRollup`, `DeviceRecords`) and `src/framework/managers/__tests__/DeviceGrants.test.ts`.
- The E2E journey `e2e/21-connected-devices.spec.ts` still passes when the UI changed.

## See also

- [devices/README.md](../devices/README.md): devices, and patient-entered implants
- [planning/2026-09-30-device-write-scope-and-consent-grant.md](../planning/2026-09-30-device-write-scope-and-consent-grant.md): the design and its decisions
- [security-developer-guide.md](security-developer-guide.md#the-access-log-and-agent-scopes): scopes and the agent gate

## Known gaps

- Devices with their own screen (the RFC 8628 device flow) are a later path ([ngdpbase#1526](https://github.com/jwilleke/ngdpbase/issues/1526)); today a device is set up only by a setup code the patient shows.
- The health routes and `phd-samples.db` exist only while `yourphr.health.enabled` is on; on a fresh instance every `/api/secure/health/*` path answers 404 until an operator turns it on.
