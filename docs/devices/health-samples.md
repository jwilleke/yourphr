# Health samples

Sample processing for wearable readings, behind [#314](https://github.com/jwilleke/yourphr/issues/314). It is off unless an operator sets `yourphr.health.enabled`.

The catalog, timestamp rules, unit conversion, blood-pressure pairing, and daily rollup are adapted from Scott Teglasi's work on `ep-ipc/yourphr` branch `sat-apple-health-ts` at `d73bd992331ec6fcfbd25d75112ef0008040c4f5` (commits `db707f24b4550d5c4eb7de8a523987ccd233e792` and `d73bd992331ec6fcfbd25d75112ef0008040c4f5`). That work is under the same GNU GPL version 3 as this repository (`LICENSE.md`). The modifications are in the file headers: Health Connect keys are not coded as HealthKit, a day uses one named source instead of blending every source, and a device credential cannot call ingest.

## What a signed-in session can do

`POST /api/secure/health/samples`, while the flag is on, accepts a batch from the signed-in person. Raw rows go in `phd-samples.db`, encrypted with the same key as `records.db`. A wrong key fails the open. The file is not created when the flag is off.

A timestamp must be RFC 3339 with `Z` or an explicit offset. The offset is stored, the instant is stored in UTC, and the local day is taken from the offset. Pounds become kilograms and Fahrenheit becomes Celsius; the original unit string is kept on the row. A HealthKit oxygen value from 0 to 1 becomes a percent.

Daily steps keep the larger named source and do not add the others. Heart rate, resting heart rate, heart-rate variability, oxygen, and sleep do the same kind of choice: one source for that local day, not a blend. Both raw rows stay. The Observation says which source was not added. This is not interval-level de-duplication, and two names for one device are not recognised as the same device.

Blood-pressure halves that share `correlation_uuid` are paired, including across requests. Sending the same external id again updates that row. `metadata.deleted: true` marks it deleted and the day's Observation becomes `entered-in-error` when nothing remains. Spot readings (weight, temperature, blood pressure) are Observations as sent. High-frequency readings are one Observation per local day.

The Observations are written through `RecordsManager.saveDeviceRecord` onto a device source named "Uploaded by you", tagged patient-generated.

## What this does not do

- A connected-device key cannot upload. With the flag off the route is `404`. With the flag on a device key gets `403`. There is no background sync.
- `GET /api/secure/health/sync-state` is not served to a device. Anchors are stored when a session sends them, for a later intake to read.
- This repository does not run ngdpbase ICE. File import of Apple Health or Health Connect exports is not registered here. The processing above is the piece a future addon receiver would call; that registration is not in this process.
- Companion iOS and Android apps are not in this repository. Their licenses were not available to review.
