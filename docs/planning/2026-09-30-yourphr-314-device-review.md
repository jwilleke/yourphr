# Review: yourphr#314 wearable / device samples, fork `ep-ipc/yourphr` branch `sat-apple-health-ts`

Reviewed for Jim Willeke on 2026-09-30. The review itself was read-only. __Updated the same day with Jim's decisions__ ([below](#decisions-jim-2026-09-30); the storage-model part is also recorded on [#314](https://github.com/jwilleke/yourphr/issues/314)). The reply to Scott is posted on the issue, not kept here.

- Branch head: `4bc619949` ("docs: add proposal for implementing 314"), 14 commits. Authors are Scott Teglasi / steglasaurous, plus one commit by Parth Kheni (`4ca9c2b91`, the MCP bridge).
- Merge-base with upstream: `de8f0a92c` (2026-09-14). Upstream `main` is now `20a068eb0` (2026-09-29). __The branch is 145 commits behind__ (13 of those landed after `baf0121`).
- Diff against the merge-base: 61 files, +8,973 / −66. By area: server src +2,684, server tests +1,066, frontend Health page +4,198, other frontend +324, MCP bridge +210, docs +420, Docker +56.
- __It does not merge cleanly into main.__ A trial merge has 8 conflicted files: `src/server.ts`, `src/app.ts`, `src/account/index.ts`, `scripts/check-routes.ts`, `scripts/mcp-server.ts`, `scripts/mcp-tests.ts`, `frontend/src/app/app.module.ts`, and `frontend/src/app/pages/settings/settings.component.ts`.

## Decisions (Jim, 2026-09-30)

__Storage model — decided, recorded on [#314](https://github.com/jwilleke/yourphr/issues/314).__

- __Raw device values__ go in a dedicated value store, __`phd-samples.db`__ (PHD = Personal Health Device, HL7's term), its own encrypted file, included in backups: every sample as it arrived, with source, device and timezone offset. This replaces the branch's tables in the app database (M10).
- __Daily aggregates__ are written into __`records.db`__ as FHIR R4 Observations marked patient-generated (PGHD): `performer` → Patient, `device` → Device, Provenance for the sending app. They go through `RecordsManager`, the one door for records, so charts, search, provenance, the summary, IPS and full export work unchanged.
- __Spot readings__ (blood pressure, weight, temperature) go straight in as Observations, as home vitals do today. Only high-frequency data (heart rate, steps, watch SpO₂) is rolled up.
- __Timestamps__ are RFC 3339 with an explicit offset, or refused (Jim, 2026-09-30). Each sample keeps its original offset alongside its UTC instant.
- __Weekly and monthly__ views are summed from daily on read, not stored.
- __Detail on request:__ an aggregate covers a window; drilling in reads that window from `phd-samples.db` (as points, or as an Observation with `valueSampledData`), with its own access-log line. What the Health page reads at each range is in [connected-devices.md § Charts](../devices/connected-devices.md#charts).
- __Late, edited or deleted samples__ re-roll their day and __update__ that day's Observation, so its history shows the change. The rollup is where cross-source de-duplication (M4), local-time day bucketing (M3) and blood-pressure pairing (M1) are solved once.
- __Retention__ of raw samples can later be an operator setting; daily Observations are kept.
- __The FHIR claim, stated precisely:__ R4 fully supports this representation — Observation with `performer`/`device`/Provenance, `SampledData`; HL7's Physical Activity IG models daily summary Observations — but it prescribes no storage. The side store plus rollup is our design. R4 has no standard PGHD tag code; a `meta.tag` for it would be a YourPHR code.

__Also decided:__

- __Mobile device apps__ live in separate repositories under a permissive licence (MIT or Apache-2.0), not in yourPHR, which avoids the GPL / App Store conflict. yourPHR links to them once reviewed; it does not own or maintain them.
- __The phone's credential__ is an agent token with a single __write__ scope ("add health samples"), reaching only `POST /api/secure/health/samples` and `GET /api/secure/health/sync-state` at the existing default-deny edge gate. This consciously revisits #695's "read-only first cut" for that one route.
- __Contribution provenance:__ ask for a light confirmation that the work is contributed under GPLv3 with the employer's agreement (most commits use an `@experiencepoint.com` address; one commit has another author).

__Decided (Jim, 2026-09-30) — the phone's consent and lifetime.__ Jim: "I think we need the patient's consent." Today's rule already enforces it: minting, renewing and revoking an agent token all need the owner's own session (`requireHuman`, `AgentTokensManager`), so a token never extends itself. "Renew on each successful sync" would break that, and is dropped. Instead the __consent__ carries the term, not the token:

1. __The patient grants__ in Settings: what the phone may do (only "add health samples") and for how long, up to an operator maximum (30 days by default). The screen says plainly what is allowed; the grant — who, what, until when — is written to the patient's access log.
2. __Short keys inside the grant:__ the phone holds a short-lived key (24 h, like agent tokens today) and exchanges it for a fresh one as needed — the OAuth refresh pattern. An exchange __never__ moves the grant's end date.
3. __Only the patient extends:__ before the grant ends the patient is told (the notification banner, and email when escalation is on). Extending needs their signed-in session — a fresh consent. With no action, syncing stops and the phone says why.
4. __It ends early__ on revoke, password change, or "sign out everywhere".

A FHIR `Consent` resource could record the grant formally; start with the access-log record and add `Consent` if it should be exportable.

### Terms used in this document

- __Mobile device app__ — an app on the patient's phone (iOS HealthKit, Android Health Connect) that relays readings to yourPHR. Not part of yourPHR.
- __Personal health device (PHD)__ — the thing that takes the reading: watch, scale, blood-pressure cuff, glucose meter. HL7's term.
- __Connected device__ — anything holding an upload grant from the patient: a mobile device app, or a scale's own gateway. One grant per connected device; the patient sees and manages the list in Settings.

### Device upload is an HTTP API, not MCP (decided, Jim 2026-09-30)

- __MCP is for AI clients reading__ the record — the patient's own AI assistant. yourPHR's MCP bridge is read-only and stays that way; Scott's `read_health_metric` tool belongs there (PR 3).
- __A connected device uploading readings is data ingest__, so it is an ordinary HTTP API: `POST /api/secure/health/samples`, callable by any mobile device app, scale gateway or script, with no AI in the path.
- __Generic, not vendor-specific__ — more device kinds will come (scales, cuffs, glucose meters):
  - the __canonical input is FHIR__: a Bundle of Observations, as HL7's Personal Health Device IG and device gateways already produce, so a new device kind needs no new server code when it sends codes the catalog knows;
  - __vendor formats are adapters__ in front of it: HealthKit and Health Connect JSON map to the same Observations through Scott's catalog; a scale's own format gets its own adapter;
  - storage (`phd-samples.db`), the daily rollup, consent and audit are shared by every connected device.

### Inactive connected devices are suspended (decided, Jim 2026-09-30)

Jim's experience: phones and scales get replaced and sold, and the old one keeps its access.

- A connected device with __no successful upload for 14 days__ has its grant __suspended__. The 14 days is a __configuration value read through `ConfigurationManager`__ — `yourphr.devices.inactive-after-days`, default `14`, changed on Admin → Configuration, never set in the environment or deployment yaml (Jim, 2026-09-30) — not deleted; the readings it sent stay.
- The patient is told, in plain words: *"'Jim's iPhone' hasn't sent anything since 12 Sept, so its access is off. Turn it back on in Settings if that's a mistake."* Turning it back on needs the patient's own session — a fresh consent.
- __What inactivity cannot catch: a sold device that keeps syncing__, which would put the new owner's readings into the old owner's record. Defences: per-device grants shown with "last data received" so an unexpected source stands out; one-tap revoke per device; the consent term bounding how long a forgotten device runs; and "revoke yourPHR access before selling or resetting" in each mobile device app's own help.

### Setting up and renewing a connected device (decided, Jim 2026-09-30)

Every path ends in the same thing: a __grant__ — an agent-token write scope ("add health samples") inside a patient consent term (operator maximum 30 days), recorded in the patient's access log, suspended after 14 days without an upload. What differs is how a device reaches it, and that depends on the device.

#### Rules for every path

- __A link never grants anything.__ Email links, QR codes and app links only lead to the consent page; the patient signs in there and approves. A link that approved in one click would make the mailbox the key (and #507 already rejected "email me a link" for sign-in).
- __Emails carry no health data and no token__ — only "a device is asking to add health samples to your record; review it", with a link that expires.
- __Pairing codes are one-time and short-lived__ (about 10 minutes, single use), exchanged through the API for the grant. The long-lived credential is never shown, printed or put in a QR code (the branch's QR carried the token itself — H1).
- __The consent page confirms the connection__ ("'Jim's iPhone' connected just now", with Revoke), so an unexpected device shows at once.
- __Notices go by email and the in-app banner.__ No SMS for now: yourPHR stores no phone numbers and has no SMS transport; SMS could later be another way of sending the same notice.

#### Three kinds of device, three paths

| Device | Examples | Path |
|---|---|---|
| __Mobile device app__ (phone, has a camera) | iOS HealthKit / Android Health Connect relays | __Patient-started:__ Settings or an emailed link → sign in → consent (what, how long) → a one-time pairing code shown as a __QR__ on a computer, or an __"Open in app"__ button (app link) when the page is viewed on the phone itself, which cannot scan its own screen → the app exchanges the code for its grant. |
| __Has its own screen and internet connection__ | Wi-Fi scale with a display, networked cuff | __Device-started — OAuth 2.0 Device Authorization Grant (RFC 8628)__, the "TV sign-in" flow: the device calls `POST /api/device/authorize`, gets a secret device code and a short user code (for example `WDJB-MJHT`) plus a verification address, and displays the code (optionally as a QR of `verification_uri_complete`). yourPHR emails the patient a link; the patient signs in, sees the request with the same code, checks it matches the device, and approves. The device polls (`authorization_pending` / `slow_down` / `expired_token`) and receives its grant. |
| __No screen, Bluetooth only__ | most inexpensive scales and cuffs | Pairs with the phone; the __mobile device app__ uploads its readings (row 1). The phone is the connected device. |
| __Talks only to the maker's cloud__ | Withings, Omron, Fitbit accounts | Not the upload API at all: yourPHR __pulls__ from the maker's cloud as a __source__ in the provider catalog, with the ordinary OAuth sign-in used for Epic — the existing Sources model. |

__Renewal__ reuses the patient-started path without pairing: before the term ends yourPHR sends "extend 'Jim's iPhone' for another 30 days?" (email and banner) → sign in → Extend. The device keeps working until the old term ends, so extending early costs nothing; with no action, uploads stop at the end of the term and the device says why.

The QR here is not the screen #719 removed. That one paired an app that did not exist with a never-expiring, full-account token and no consent; this is a one-time pairing code shown after explicit consent.

## Recommendation

__Go ahead with changes, and split it.__ The sample store, catalog and ingest/read API fit yourPHR's manager/provider pattern well and are worth taking, with the storage reshaped per the decisions above (`phd-samples.db` plus daily PGHD Observations in `records.db`). The pairing credential needs a redesign before any of it merges. Today it is a never-expiring, full-account token (admin rights included) that can be traded for a normal browser session. That contradicts #695/#719, and main has already deleted the screen it depends on. The sleep terminology also needs fixing before the first merge, because the wrong codes are persisted.

## Summary

Scott's design choice is sound and well argued. Wearable samples do not go through the FHIRPath-indexed `SqliteFhirRepository`. They live in dedicated `health_samples` / `health_sync_states` tables behind `HealthManager` → `SqliteHealthProvider`, keyed by `user_id = ctx.username`, idempotent on `(user_id, external_uuid)`, and rebuilt as FHIR R4 Observations/Bundles on read. The catalog (`src/app/health/catalog.ts`) maps HealthKit and Health Connect keys onto LOINC + UCUM. Eight of the nine LOINC codes are correct (verified against tx.fhir.org). The ninth, sleep, is not. Account deletion, the access log ("Health" category), the demo write-refusal, the agent-token default-deny gate and store/HTTP boundaries are all respected. The server tests are real and pass.

The problems cluster in four places:

1. __Credential model.__ The device token is a full user credential (`ApiContext.device(owner, ownerRole…)`), including admin. `/api/auth/companion-session` turns it into a human session. It defaults to "No Expiration" (year 2099), has no per-user cap, no lifecycle audit, and no feature flag. It survives a password change and "sign out everywhere". I verified all of this against a running server (below).
2. __Terminology.__ Four of the six stored SNOMED sleep codes do not exist, and the other two mean "Facial profile convex" and "Therapeutic regimen". `89129007` (REM sleep) is accepted as an alias for *Awake*. LOINC `93832-4` is "Sleep duration", not a stage, and `sleep` is not an HL7 observation-category code.
3. __Sync semantics.__ Blood-pressure halves that arrive in different batches lose the diastolic. Updates and deletes never propagate. Days are bucketed in UTC and the source offset is thrown away, so a Pacific-time night is split in two. Overlapping sources (iPhone + Watch steps) are summed with no de-duplication.
4. __Mergeability and scope.__ The branch is 145 commits behind with 8 conflicts. It revives the pairing screen and the two Go-era routes that main deliberately deleted in #719 (`25504a4c4`). CI is red: `check:routes` fails, and a host-dependent discovery unit test fails. It also bundles unrelated work (a distroless Dockerfile, `angular.json` asset/sourcemap changes, header CSS).

__I could not find the iOS or Android apps.__ They are not in this branch, in the fork's other branches (`main`, `sat-apple-health`, `archive/chat`), or in any public repo under `ep-ipc` or `steglasaurous` (checked 2026-09-30). The apps could not be reviewed at all. Every mobile-side statement below is a question, not a finding.

## Test, typecheck and lint results

I ran everything on Node 24.21.0 on the box, on the branch and on the merge-base `de8f0a92c` for comparison. `npm ci --ignore-scripts` was used because the box has no `make`; the SQLCipher prebuilds load fine, which is also how the Dockerfile installs.

| Check | Merge-base | Branch |
|---|---|---|
| `typecheck`, `build`, `check:boundary`, `check:store` | pass | pass |
| `check:routes` | pass | __FAIL__: "KNOWN_MISSING entries the server now routes": `/api/secure/access/token`, `/api/secure/sync/discovery` (yourphr#719) |
| `test:coverage` (vitest) | 372/372 pass | __1 fail__ / 423 pass. `src/app/__tests__/discovery.test.ts:54` expects `['http://172.17.0.2:8080']` but got the box hostname. `serverBaseUrls` calls `os.hostname()` un-injected (`src/app/discovery.ts:161`), so the result depends on the host. It will very likely fail on GitHub runners too. |
| `framework, ssrf, smart, sync, auth, agent-tokens, mcp-tests (28/28), config, env, backup, worker, migrations, ips, provenance, medication, records, dcr, app, migrate, web, migrate:tool, process, demo-reset, lint:md, check:phi` | pass | pass |
| `device-tokens` (new) | n/a | pass (20/20) |
| Frontend Karma, `src/app/pages/health/**` specs only (ChromeHeadless) | n/a | __1 fail__ / 48 pass. `health-visit-summary.spec.ts:147` expects `page-break-inside: avoid`, but the CSS is minified (`page-break-inside:avoid`, `health-visit-summary.ts:466`). |
| ESLint on the changed frontend files | n/a | __1 error__: `health.component.ts:414` `@typescript-eslint/array-type`. There are also 32 warnings, mostly pre-existing lines in `fasten-api.service.ts` / `settings.component.ts`. |

__Fork CI:__ GitHub Actions "Server CI (TypeScript)" fails on the branch head `4bc619949` (and on the four prior pushes) at the __Route contract__ step. Every later step was skipped, so the discovery-test failure never surfaced there. The E2E job passed. I did not run the full Angular test suite, full `ng lint`, the Storybook build, or a Docker build.

## Findings

File:line references are on the branch head `4bc619949` unless noted. Findings marked __(verified)__ were reproduced against a live server started from the branch with a scratch script. The scripts are saved in `/workspace/reports/yourphr-314-probes/`.

### HIGH

__H1. The device token is a full-account credential, admin included (verified).__
`src/server.ts:559-567` builds `ApiContext.device(owner, roleOf(owner), …)`, and `ApiContext.canRead()` / `can()` place no restriction on `viaDevice` (`src/framework/ApiContext.ts:169-182`).

With a token minted by an admin account, the probe got:

- `200` on `GET /api/secure/admin/config`
- `200` on `PUT /api/secure/admin/instance`
- `200` on `POST /api/secure/admin/users` creating a new __admin__ user
- `200` on `DELETE /api/secure/account/me`, which deleted the whole account

A lost phone, or a screenshot of the QR code, is therefore full account takeover until someone notices and revokes it. The comment at `src/app.ts:418` says "a full user credential, not a scoped agent", so this is intentional. It is still the opposite of #695's decisions: scopes only narrow, unscoped is refused, `admin-*` is refused outright, and roles are never inherited silently.

__H2. `POST /api/auth/companion-session` turns the device token into a human session (verified).__
The route is at `src/server.ts:514-539` and calls `sessions.issueFor(device.owner)` at `:531`. The resulting cookie is an ordinary human session, so it passes `requireHuman` (`src/app/managers/DeviceTokensManager.ts:74-79`). From it, the probe minted __another__ device token (`200`) and an agent token with the `Full export` scope (`200`).

The proposal's statement "A device token cannot mint another device token" is therefore false end-to-end. The branch's own harness even asserts the escalation as a feature: `scripts/device-token-tests.ts:163` "the exchanged cookie is a human session and can list device tokens".

__H3. The token lifecycle is weaker than the agent tokens already on main (verified).__

- The default is "No Expiration" (`frontend/.../settings.component.ts:26-33`, `newDeviceExpiration = 0`), which resolves to `2099-12-31` (`DeviceTokensManager.ts:32,106`).
- There is no max-per-user, no mint/revoke audit event (AgentTokensManager records these), and no feature flag: the manager is always registered (`src/app.ts:419`).
- After a password change __and__ "sign out everywhere", both the original device token and the one minted from the phone-derived session still answered `200`.

Main's #719 work (`25504a4c4`) removed exactly this "No Expiration" option, and per your comment on #719 a test now fails if a never-expiring option reappears.

__H4. The sleep terminology is wrong and gets persisted (verified against tx.fhir.org, SNOMED International 2025-02-01).__
In `src/app/health/catalog.ts:174-263`:

| Stored code | Used for | What it actually is |
|---|---|---|
| `248218006` | Awake | not found |
| `248219008` | Light sleep | not found |
| `248218000` | REM sleep | not found |
| `248220008` | Deep sleep | "Asleep" |
| `248171000` | Asleep | "Facial profile convex" |
| `133877004` | In bed | "Therapeutic regimen" |

The alias `89129007` in the *Awake* list (`catalog.ts:191`) is "Rapid eye movement sleep". For comparison, "Awake" is `248218005`.

Other problems in the same area:

- The metric is coded LOINC `93832-4`, which is "Sleep duration", a quantity, not a stage.
- `category: 'sleep'` is not in `http://terminology.hl7.org/CodeSystem/observation-category` (tx.fhir.org: "Unable to find code 'sleep'").
- `2708-6` is "Oxygen saturation in Arterial blood". The pulse-oximetry code is `59408-5` (US Core Pulse Oximetry uses both).

These codes are written into `value_text` on every sleep row and exported in Observations and the MCP bridge. Fixing them after users have data needs a data migration, so fix them before the first merge.

__H5. The branch conflicts with decisions on main, and CI is red.__

- 145 commits behind, 8 conflicted files.
- The branch re-routes `/api/secure/access/token` and `/api/secure/sync/discovery` and re-uses the QR pairing screen. #719 (closed 2026-09-25) replaced that screen with the agent-key screen and planned to __delete__ those routes, because "the companion mobile app does not exist".
- `check:routes` fails for exactly that reason, and the discovery test is host-dependent (see the table above).

### MED

__M1. Blood pressure loses data (verified).__
`mergeBloodPressure` (`src/app/managers/HealthManager.ts:389-411`) only merges within one request. The first half creates a panel row whose `external_uuid` is the correlation id. The second half, arriving in a later batch, hits `ON CONFLICT(user_id, external_uuid) DO NOTHING` (`SqliteHealthProvider.ts:173`) and is reported as a "duplicate". The probe confirmed that only the systolic value was stored.

Separately, a standalone systolic (`8480-6`) or diastolic Observation is rejected ("blood_pressure requires component values"). That happens because `BY_CODE` maps component codes onto the panel (`catalog.ts:274-277`). Home cuffs and FHIR exports do produce standalone systolic/diastolic Observations.

__M2. Updates and deletes never propagate.__
Ingest is insert-or-ignore only (`SqliteHealthProvider.ts:167-189`), and there is no delete or tombstone path. HealthKit anchored queries report deletions, and Health Connect records can be updated in place under the same id. A sample the user deletes or edits on the phone stays unchanged in yourPHR forever.

__M3. Timezones (verified for sleep).__

- All day buckets use SQLite `date(start_time)` in UTC (`SqliteHealthProvider.ts:364-366, 424-426`). For you in ET, steps after 8 pm EDT count toward the next day.
- The sleep "night" is `date(start_time, '-12 hours')` (`:435-438`), so the cutover is 12:00 UTC, which is 05:00 PDT. In the probe, one 22:00–07:00 PDT night came back as two nights: `2026-09-09` Light 6 h and `2026-09-10` REM 1.5 h.
- `parseTime` (`HealthManager.ts:130-135`) converts to UTC and throws away the source offset, so local days cannot be rebuilt later.
- A timestamp without an offset is accepted and parsed in the __server's__ local timezone.

__M4. Overlapping sources are double-counted.__
`mode=day` is `SUM(value_num)` over every row (`SqliteHealthProvider.ts:363-367`), with no source priority or overlap handling. When iPhone and Apple Watch both record steps, which is the normal case, daily totals roughly double if the mobile device app sends raw samples. Apple's own Health totals de-duplicate by source priority. This comes from reading the code; I did not test it with real HealthKit output.

__M5. Health Connect integer sleep stages are mis-mapped (verified).__
The numeric aliases `'0'`–`'5'` (`catalog.ts:189-255`) are HealthKit raw values. Health Connect uses different constants (verified from the Android docs): UNKNOWN=0, AWAKE=1, SLEEPING=2, OUT_OF_BED=3, LIGHT=4, DEEP=5, REM=6, AWAKE_IN_BED=7. In the probe, `SleepSessionRecord` with `value_text: "4"` (Health Connect LIGHT) was stored as "Deep sleep". Whether the Android app actually sends integers is unknown, because its source isn't available. In the exported Observation, the Health Connect key is also coded under the Apple HealthKit system URL (`observation.ts:122-127`, `catalog.ts:15`).

__M6. Scale (measured, with extrapolation clearly marked).__
I inserted 1,000,000 heart-rate rows at a 5-second cadence (about 58 days) directly through the provider:

| Measurement | Result |
|---|---|
| Insert time | 10.3 s |
| Database size | 448 MB (~448 bytes/row) |
| `points` over the whole history (no window) | 1.95 s, +93 MB RSS |
| `points` over the last 7 days | 0.18 s |
| `daily-stats` over the whole history | 1.7 s |
| `metrics` summary | 0.7 s |

Extrapolated, not measured: one year at 5 s ≈ 6.3 M rows ≈ 2.8 GB per person. That volume would land in the shared app database next to accounts, sessions and the audit log, and in every backup of it.

`seriesPoints` and `seriesDailyStats` load every row in the window into JavaScript before downsampling (`SqliteHealthProvider.ts:277-279, 372-374`). better-sqlite3 is synchronous, so the event loop is blocked for that whole time. There is no rollup table and no retention policy. Real Apple Watch heart-rate cadence is usually much lower at rest, so this is a worst case.

__M7. Transport and discovery.__
The QR's base URLs use `https` only when `yourphr.web.secure-cookies` is true (`src/server.ts:836`). That ties TLS to a cookie flag, and the default is `false`, so the QR steers phones to plain-`http://` LAN addresses. Given H1/H3, that means a never-expiring full-account Bearer token crosses Wi-Fi in cleartext.

Also:

- The new unprefixed `HOST_IP` / `HOST_PORT` env aliases (`src/config/index.ts` `unprefixedEnvNameFor`) collide with a common Kubernetes downward-API convention (`HOST_IP` = node IP).
- `sync_endpoint` still advertises `api/secure/resource/fhir` (`src/app/discovery.ts:172`), not the ingest route.

__M8. FHIR output validity and PGHD provenance.__

- `meta.source` is set to a display string like "Apple Watch" (`observation.ts:119-121`). In R4 `meta.source` is a `uri`.
- `Bundle.total` is set on a `collection` Bundle (`observation.ts:148-153`), which violates `bdl-1`.
- An unknown metric's `valueCodeableConcept` keeps only the code (`HealthManager.ts:305-306`) and is later re-labelled SNOMED (`observation.ts:104-111`).
- There is no patient-generated marker (`performer` → Patient, or a `meta.tag`) and no Device resource, although #314 asks for "patient-generated provenance" and Device/DeviceMetric.
- `src/provenance/index.ts` (the `From <source> · first received…` surface) is not used for samples.

__M9. Subject binding.__
`subjectFor` takes "the first Patient" from `records.list(ctx, 'Patient', {limit: 1})` (`HealthManager.ts:448-458`). The proposal names this as an open question. Two consequences:

- An account with several connected sources has several Patient resources, each with a source-scoped id, so "first" is arbitrary.
- The reference dangles if that source is removed.

With yourPHR's one-account-per-member household model this is tolerable for a first cut, but it should be explicit.

__M10. PHI moves into the app database.__
Until now the clinical record lived in the records database behind `RecordsManager` (the backup "exporter"), while the app DB held accounts, sources, catalog and audit. Samples now live in the app DB. Encryption at rest follows the same opt-in key, so this is __no worse__ than today, but the volume of PHI under that opt-in model grows a lot. "Full export" does not include samples (the proposal lists this as an open follow-up).

### LOW

- __L1. Input limits.__ There are no per-metric value ranges (negative heart rate is accepted), no length caps on `source_name`, `device_name`, `external_uuid` or `metadata` (anything up to the 8 MiB body), and far-future timestamps are accepted. `anchors` has no cap, and each anchor is a separate, un-transactioned upsert (`HealthManager.ts:516-528`).
- __L2. Token exposure in the UI.__ `settings.component.ts:76` has `console.log('Generate token response:', response)`, which prints the cleartext token to the browser console. The line is pre-existing but is now live. The raw QR JSON is also shown in a textarea with a copy button.
- __L3. Schema management.__ There are three migrations for a schema that was never released (including an `hk_type` → `vendor_type` rename), plus provider-side `ALTER TABLE` / `RENAME COLUMN` at construction (`SqliteHealthProvider.ts:145-163`, duplicating `src/app.ts:228-256`). Upstream should get one migration with the final schema.
- __L4. Units.__ Only `kg` and `Cel` are accepted; `lb` and `degF` are rejected (verified). Rejecting is safer than silently storing wrong units, but should be documented, or converted server-side. `C` is accepted as Celsius, though in UCUM `C` means coulomb.
- __L5. Scope creep.__ The branch also contains:
  - a distroless runtime image (no shell, new `ENTRYPOINT`)
  - `angular.json` changes that narrow the lforms asset globs and turn off sourcemaps (a risk to questionnaire rendering; not verified)
  - mobile header CSS and a dashboard tile
  - account deletion now also removing agent tokens (`server.ts:759-761`). This is a genuine fix worth taking on its own.
- __L6.__ `Math.min(...allValues)` / `Math.max(...)` spread over panel series (`SqliteHealthProvider.ts:301-302, 386-387`) would throw `RangeError` on very large blood-pressure series. This is latent.
- __L7.__ `verify()` writes `last_used_at` on every request (`DeviceTokensManager.ts:122`), which is an extra app-DB commit per call.
- __L8.__ The clinician visit summary asserts device facts regardless of the actual source ("Measured overnight by the watch", "Continuous optical sensor": `health-visit-summary.ts` `qualityNote`, around lines 1105-1115). HTML escaping in the generated summary looked correct (`escapeHtml` on every interpolated field I checked).

### Relation to the 2026-09-29 security review

- Missing security headers: this branch adds none, and adds a cookie-issuing route (`companion-session`). The visit summary is a downloaded file, not a served page.
- Guarded-fetch Bearer-over-redirect: not touched. No new outbound fetch under `src/`, and `check:boundary` passes.
- Opt-in encryption with the key beside the data: samples inherit it. That is no worse in kind, but it means much more PHI.
- The branch does make the transport situation worse in practice (M7), because it encourages plain-HTTP LAN use with a long-lived full-account Bearer token.

## Test coverage and gaps

What is covered well:

- manager/provider ingest, idempotency, rejects, anchors, per-account isolation, and the blood-pressure merge within one batch
- series modes and account deletion
- token mint/verify/revoke, including cross-account and "a device cannot manage tokens"
- the HTTP edge: an agent cannot POST ingest, and a device token presented as a cookie is refused
- discovery ordering

What is not covered:

- device tokens against admin routes, account deletion, full export, or source writes (H1)
- the session-exchange escalation (H2), which is asserted as desired behaviour
- revocation on password change or sign-out-everywhere
- blood pressure split across batches, and standalone systolic/diastolic
- update/delete semantics
- timezone-offset inputs and non-UTC day/night bucketing
- Health Connect numeric stages
- volume/performance
- validating emitted Observations and Bundles against R4 / US Core
- a terminology snapshot test (it would have caught H4)
- the pairing Settings UI has no spec (main's replacement has one)
- nothing at all for the mobile apps, which are not available

## Maintainability, licensing, distribution, and the ngdpbase move

- __Size.__ About 9 k lines in one branch, 4.2 k of them in the Health page and visit summary. It needs splitting to be reviewable (see Phasing).
- __Dependencies.__ None added: `package.json` changes only a script, and the frontend `package.json` is unchanged. It reuses chart.js/ng2-charts and `@medplum/fhirtypes`. No licensing issue from the diff itself.
- __Native apps.__ No source is available. If they come to yourPHR, someone has to own two native codebases (Swift/HealthKit, Kotlin/Health Connect) and the recurring costs: an Apple Developer account ($99/yr), a Play developer account, and store review. HealthKit apps need a privacy policy. Google Play requires a Health Connect permissions declaration and review. Self-hosted apps that ask for a server URL have to get through review, often with a demo server.
  - Licensing: yourPHR is GPLv3. The FSF has long argued App Store terms conflict with GPL distribution (the 2011 VLC removal). If the apps are GPLv3 and include yourPHR/fasten-derived code (the WebView idea), App Store distribution may need an additional-permission exception from all copyright holders. A thin native client under a permissive license, in a separate repo, avoids most of that.
  - TestFlight, sideloading and F-Droid are the realistic early channels.
- __Contributor provenance.__ Most commits use a corporate address (`@experiencepoint.com`) from the `ep-ipc` fork org, and one commit is by a different author. It may be worth a light confirmation that the contribution is intended under GPLv3.
- __ngdpbase move__ (`docs/planning/ngdp-move.md` on main):
  - `HealthManager` and `SqliteHealthProvider` follow the "managers move unchanged, `ctx` passed in" rule, so the storage half survives the migration well. It also uses `better-sqlite3-multiple-ciphers`, which the doc says PHI stores still need.
  - The credential half complicates it. The doc calls the `server.ts` gate layer (session + Bearer, agent-token gate, demo gate, access-log gate) "the bulk of the work", and this branch adds a third bearer type plus a token-to-session exchange that would all have to be re-expressed.
  - An ingest credential built as a __scoped extension of the agent-token model__ (one write scope, one route) maps directly onto ngdpbase's `AgentTokenManager` + `tokenRouteMap` default-deny, and would carry over almost for free.

## Requested changes (for "go ahead with changes")

1. __Rebase on current main.__ Drop the revived QR pairing screen and the Go-era `/api/secure/access/token` + `/api/secure/sync/discovery` routes (removed on purpose in #719). Get CI green, including a hermetic discovery test (inject `hostname`) or dropping discovery for now.
2. __Replace the full-account device token with a narrowly scoped ingest credential__ — decided: an agent token with one write scope ("add health samples"), allowed only on `POST /api/secure/health/samples` (and `GET /api/secure/health/sync-state`), enforced at the existing default-deny edge gate. It should:
   - never carry admin rights
   - be capped per user
   - have mint/revoke audited
   - live inside a __patient consent grant__ with a patient-chosen term (operator maximum 30 days), short-lived keys exchanged within it, and only the patient able to extend it (see Decisions)
   - end on revoke, password change or sign-out-everywhere
   - be __off by default__ behind a config flag
3. __Remove `/api/auth/companion-session` from this work.__ A mobile device app that wraps the web UI should get its own issue, as Scott already suggested.
4. __Fix the terminology__ and add a snapshot test that checks every catalog code against a terminology source:
   - correct SNOMED sleep-stage codes, and remove `89129007` from the Awake aliases
   - don't code stages under `93832-4` "Sleep duration"
   - don't use `sleep` as an HL7 observation-category
   - use `59408-5` (with `2708-6`) for pulse oximetry
5. __Separate vendor systems and aliases.__ HealthKit vs Health Connect coding systems, and numeric stage aliases per vendor.
6. __Blood pressure.__ Merge components across batches by correlation id (update the existing row), and accept standalone systolic/diastolic Observations.
7. __Updates and deletes.__ Upsert on `(user_id, identifier_system, external_uuid)` with a version/modified marker, and add a tombstone/delete path for HealthKit deletions and Health Connect changes.
8. __Timestamps and timezones.__ Every date-time must be __RFC 3339 with an explicit offset__ (`2026-09-30T07:15:00-04:00` or `…Z`) — what FHIR itself requires of `instant` and of a `dateTime` that carries a time. Anything else is refused with a message, never guessed in the server's timezone (M3). Keep each sample's original offset as well as its UTC instant, and bucket days and nights in the sample's local time.
9. __De-duplicate cumulative metrics.__ Either apply source priority / overlap handling server-side, or have mobile device apps send vendor-computed aggregates for steps.
10. __Scale — superseded by the storage decision.__ Raw samples move to `phd-samples.db` and the record gets daily Observations, so the record store stays at thousands of entries a year. Within the value store: downsample in SQL for every mode and default or require a window; the daily rollup into `records.db` replaces the rollup table this item used to suggest.
11. __FHIR output.__
    - `meta.source` must be a URI, or drop it
    - no `Bundle.total` on `collection`
    - add a PGHD marker (performer → Patient and/or `meta.tag`)
    - keep the caller's `valueCodeableConcept` system
    - treat Device/DeviceMetric as a follow-up
12. __Input limits.__ Per-metric value ranges, string length caps, a cap on `anchors`, and one transaction for the anchor upserts.
13. __Clean up.__ Collapse to one migration with the final schema, remove the provider-side `ALTER`s, fix the failing spec and the ESLint error, and remove the `console.log` of the token.
14. __Split out unrelated changes:__ Dockerfile/distroless, `angular.json`, header CSS, and the agent-token cleanup on account deletion (the last is a good fix on its own).
15. __Transport.__ Don't derive `https` from `secure-cookies`, and document or require TLS for anything beyond explicit LAN opt-in.

## Suggested phasing (mergeable pieces)

1. __PR 1: value store, rollup and API, session-authenticated only.__
   - Contents: `phd-samples.db` (one migration, final schema) behind `SqliteHealthProvider`/`HealthManager`, the catalog, the __daily rollup into `records.db` as PGHD Observations through `RecordsManager`__ (spot readings direct), detail-on-request reads, and the `/api/secure/health/*` routes, with requested changes 4–13 applied.
   - Behind `yourphr.health.enabled` (default off).
   - Ingest works from the web session, which also covers #314's "Manual / CSV / JSON fallback" (upload an Apple Health / Health Connect export or a FHIR Bundle) without any new credential.
2. __PR 2: read UI.__ The Health page, charts, dashboard tile, and visit summary (reviewed on its own; it's 4 k lines).
3. __PR 3: MCP bridge.__ The `read_health_metric` tool and the `yourphr://health` resource, plus the `Health` access category. This already rides on agent tokens.
4. __PR 4: scoped ingest credential.__ An agent-token write scope inside a patient consent grant (see Decisions). A short design note first, aligned with #695 and ngdpbase's agent-token/route-map model, then the implementation and the grant UI inside main's Settings key screen.
5. __Separately:__ mobile device apps in their own repositories under a permissive licence (decided), with a distribution plan. A mobile device app wrapping the web UI goes in its own issue.
6. __Separate small PRs:__ Docker image slimming, and agent-token cleanup on account deletion.

## Open questions for Jim — all answered 2026-09-30

1. Mobile device apps associated with yourPHR? __Answered:__ separate repositories, permissive licence, not owned or maintained by yourPHR; linked once reviewed. Distribution costs and store review sit with the apps' maintainer.
2. Ingest credential: agent tokens with a write scope, or a separate type? __Answered:__ an agent-token write scope, revisiting #695's read-only first cut for that one route.
3. A long-lived credential for background sync? __Answered:__ a patient consent grant (operator maximum 30 days) with short keys exchanged inside it; only the patient extends. See Decisions.
4. Samples in the app database or a separate file? __Answered:__ `phd-samples.db`, included in backups; daily aggregates in `records.db`.
5. Timezone policy? __Answered__ (by the RFC 3339 decision): keep each sample's own offset and bucket by it (no per-user settings store exists yet, #709).
6. "First Patient" acceptable? __Answered:__ yes for the first cut, stated as a known limit.
7. Full export? __Answered:__ daily Observations always (they are records); raw detail as an option.
8. Sleep model? __Answered:__ store stage intervals with correct codes in `phd-samples.db`; the rollup writes per-night stage totals (LOINC `93829-0` REM, `93830-8` light, `93831-6` deep, `93828-2` awakening).
9. Contribution provenance? __Answered:__ yes, a light confirmation of GPLv3 and the employer's agreement.

## What I could not check

- The iOS and Android app source: not found in any public location I could see, so permissions, token storage, ATS/cleartext settings and SDKs/telemetry are all unreviewed.
- The full Angular test suite, full `ng lint` (including the Makefile badge check), the Storybook build, and a Docker image build and run.
- Real HealthKit / Health Connect payloads. The double-counting (M4) and update/delete behaviour (M2) come from reading the code, not from device data.
- Year-scale performance: measured at 1 M rows, extrapolated beyond that.
- Whether the lforms asset-glob change in `angular.json` breaks questionnaire rendering.
