# Decision memo: wearable uploads while the patient is signed out (#991)

Written 2026-11-25 for Jim Willeke. __Status: decided (Jim, 2026-11-25): Option 1.__ See [Decisions](#decisions-jim-2026-11-25).

- Issue: [#991](https://github.com/jwilleke/yourphr/issues/991), under epic [#314](https://github.com/jwilleke/yourphr/issues/314)
- Read against `main` at `b4576e3e5` (after #1016), the `yourphr-addon` branch, and ngdpbase `master`

## The question in one paragraph

A phone app (iPhone or Android) sends new health readings in the background, usually when nobody is signed in to yourPHR. The phone's device key proves it is __allowed__ to add readings. It is not the key that locks the data. So where does the lock key come from when the server stores those readings, and who can open them afterwards?

## What is already true today

- __On `main` (today's yourPHR):__ every database (accounts, `records.db`, `phd-samples.db`) is locked with one server key, `yourphr.database.encryption.key`, set in the server's environment. That key is optional: when it is empty, the server only logs a warning and stores everything unlocked (`src/cli/start.ts`). Backups are always locked, with their own key.
- Device uploads already work technically on `main` behind three switches, all off by default (`yourphr.devices.enabled`, `yourphr.health.enabled`, `yourphr.health.device-intake.enabled`). An upload writes raw readings to `phd-samples.db` and daily totals to `records.db`, both with the server key. It needs no patient key, so it works while the patient is signed out.
- __In the phr add-on (after the cutover, #958):__ Jim decided this on 2026-10-18 (D2 in [`phr-database-plan.md`](phr-database-plan.md), and in [`ngdp-move.md`](ngdp-move.md)). Health records live in `phr.db` under the site's one database key, and a missing key means phr won't start. Only __files__ (PDFs, scans, original uploads) are sealed in each person's own vault, and that vault opens only while the person is signed in with a password.
- The threat model in D2, stated plainly: the server key protects a stolen disk, or a backup taken without the `.env`. It does __not__ protect against the operator or anyone with shell access on the server.
- The "per-person lock" ideas are written up in ngdpbase and were __deferred__ by Jim on 2026-10-15: [ngdpbase#1811](https://github.com/jwilleke/ngdpbase/issues/1811) (sealed inbox) and [ngdpbase#1812](https://github.com/jwilleke/ngdpbase/issues/1812) (a per-person database).
- On the phone side (from the earlier research): an iPhone can't read Apple Health while the phone is locked, and background runs happen when iOS allows them. Android Health Connect needs an extra "read in the background" permission, and Android also decides when background work runs. Neither gives real-time delivery. Both phones can keep their own waiting queue locked with the phone's secure key store (Keychain or Keystore).

## The options

### Option 1: The server's own key (what records already use)

The phone uploads whenever it can. The server checks the device key, then stores the raw readings and the daily totals with the same server key as every other health record.

- __Who holds the key:__ the server (the site's `.env`), exactly as for all records today.
- __Signed-out uploads:__ work, because no patient key is needed.
- __Charts:__ up to date as soon as the upload lands.
- __What it protects:__ a stolen disk or backup. Not the operator.
- __New work:__ small. Most of it already exists on `main`. What's missing is guard rails (see the plan below).
- __Fits:__ D2 as decided, the device-grant model (#860, #862) and the cutover (#992), with no new ngdpbase feature.

### Option 2: A locked inbox that opens at the next sign-in (ngdpbase#1811)

The server locks each upload to the patient's __public__ key and puts it in an inbox it can't read. When the patient next signs in, their key opens the inbox and the readings are added.

- __Who holds the key:__ the patient (unlocked by their password). The server holds only the public half.
- __Signed-out uploads:__ accepted and kept, but nobody can see them until the patient signs in.
- __Charts:__ stale until the patient signs in. Someone who rarely signs in sees old charts.
- __What it protects:__ only readings waiting in the inbox. Once they're opened, they go into `phr.db` under the server key anyway (D2), unless Option 3's per-person database is built too. So most of the benefit is lost.
- __New work:__ large and mostly in ngdpbase core: the person key pair ([ngdpbase#1762](https://github.com/jwilleke/ngdpbase/issues/1762) slice 5), the inbox itself, and recovery when a patient loses their password. Jim deferred this work.

### Option 3: Everything locked per person, end to end (ngdpbase#1811 plus #1812)

The phone, or the server on arrival, locks readings to the patient. Records then live in a per-person database that opens only while that person is signed in.

- __Who holds the key:__ only the patient.
- __Signed-out uploads:__ queued only, as in Option 2.
- __What it protects:__ everything, including from the operator.
- __What it costs:__ it reverses D2. Nightly jobs, backups, totals, search and sharing all have to work around locked data. A forgotten password with lost recovery words means losing the records for good. It's months of platform work, and only worth it if yourPHR is hosted for people who shouldn't have to trust the operator.

## Recommendation: Option 1, with firm guard rails

It matches what Jim already decided for records (D2), it's the only option where charts stay current without signing in, and it needs nothing from ngdpbase. Options 2 and 3 only pay off if Jim reverses D2. If he ever does, they can be added later without changing what the phone sends: the upload format and device keys stay the same, and only the server's storage step changes.

The guard rails, answering #991's checklist:

1. __No unlocked fallback.__ Health intake (session or device) refuses to turn on unless the server key is set. Today `main` would store readings unlocked if the key were empty. phr already refuses to start without a key.
2. __The device key is never the lock key.__ The device key only authorizes. The lock key stays the server's database key.
3. __Each kind of data, handled separately:__
   - *Readings waiting on the phone:* in the phone's own locked queue (Keychain or Keystore), not yourPHR's job beyond the contract.
   - *Raw readings:* in `phd-samples.db` (later a phr table) under the server key.
   - *Daily totals and spot readings:* FHIR Observations in `records.db` (later `phr.db`) under the server key.
   - *"Originals":* for phone uploads, the raw reading row __is__ the original, so there's no separate file. For file imports through ICE (#994), the file is sealed in the person's vault during the signed-in upload. The parsed records are then written under the server key, which background jobs have, and that answers #994's "receiver key" question.
4. __Failure and retry without loss or duplicates:__ each reading carries the phone's own id (`uuid`), so sending it again updates instead of duplicating. If storage is unavailable, the server answers "try again later" (`503` with `Retry-After`) and writes nothing, and the phone keeps its queue. The daily totals are always rebuilt from the raw rows, so a retry heals a half-finished day.
5. __Boundaries stay as they are:__ a device can only add (`patient/Observation.c`, #862), never read, change or delete. Every upload is logged under the device's name. Revoke, pause, password change and "sign out everywhere" stop it at once. Backups already include `phd-samples.db`.
6. __Off until proven:__ device intake stays off by default. It's turned on in production only after the tests below pass and Jim says so.

## What it touches

- `main`: `src/cli/start.ts` and `src/app.ts` (refuse health when the key is empty), `src/app/managers/HealthManager.ts` and `src/server.ts` (the "try again later" answer), `src/app/providers/SqlitePhdSamplesProvider.ts`, and the tests under `src/app/managers/__tests__/`.
- Docs: `docs/devices/connected-devices.md` (add the `503` row and say how readings are locked), `docs/guides/devices-developer-guide.md`, `docs/guides/storage-developer-guide.md` and `docs/guides/security-developer-guide.md` (threat model).
- phr add-on (`yourphr-addon` branch), at cutover: raw-reading tables in `phr.db` behind `PhrManager`, and an intake call that background and device contexts may use. This is the shared step for #994 and #992.
- No change to the phone contract, apart from documenting `503`.

## Proposed plan: small PRs, in order

| # | PR | Where | Size |
|---|---|---|---|
| 1 | Record the decision: threat model and key handling for health data, in the four docs above. Mark this memo decided. | `main`, docs only | small |
| 2 | No unlocked fallback: health intake refuses to turn on, with a clear boot message, when `yourphr.database.encryption.key` is empty. Tests. | `main` | small |
| 3 | Retry contract: `503` plus `Retry-After` when the store can't be written, no partial writes, totals rebuilt from raw rows. Tests for replay, restart and a half-finished day. | `main` | small to medium |
| 4 | Proof tests for #991: signed-out upload, revoked or paused device, another patient's data, restore from backup, and no plaintext (a marker reading never appears unlocked in the database files or backup). | `main`, tests | medium |
| 5 | phr: raw-reading tables and the intake step behind `PhrManager`, under the site key. The ICE receiver (#994) uses the same step. | `yourphr-addon` | medium |
| 6 | Device keys in phr through core's delegated credential (#992, #860, #862). | `yourphr-addon`, at cutover | medium |

PRs 1–4 make #991's checklist true on `main`. Production device intake stays off until Jim approves. PR 5 and PR 6 follow #958's cutover and belong to #994 and #992.

## Decisions (Jim, 2026-11-25)

1. __Option 1:__ the server's database key, with the guard rails above. D2 stands ("the operator is trusted").
2. __Build it on today's `main`,__ behind the off-by-default switch (`yourphr.health.device-intake.enabled`). PRs 1–4 land on `main`. PRs 5 and 6 follow the cutover.
3. __The stored raw reading is the original__ for phone uploads. No per-batch file in the person's vault, so Option 2's inbox isn't needed.
4. __Is the key set where yourPHR runs?__ Checked 2026-11-25 without reading any value, by counting the two start-up warnings in each pod's log (`kubectl logs`, `grep -c` only):
   - `yourphr.org` itself is a static GitHub Pages site. No yourPHR server or database runs behind it.
   - `yourphr.nerdsbythehour.com` (the family instance, `yourphr-ts` on k3s, image `ghcr.io/jwilleke/yourphr:main`): __the key is set.__ The log has the "keys are on this volume only" warning, printed only when the key is present, and not the "is not set" warning.
   - `demo.yourphr.org` (`demo-yourphr-ts`): __no key, on purpose.__ The demo reset refuses an encrypted database (`demo-yourphr-ts/deployment.yaml`). After PR 2, health stays off on the demo unless that changes.

## Open questions

- Whether the demo should ever show wearable charts. If yes, the demo reset needs to accept an encrypted database first.
