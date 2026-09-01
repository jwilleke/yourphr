# Proposal: store and serve consumer health device samples

Draft for review before it is proposed against
[#314](https://github.com/jwilleke/yourphr/issues/314)
([FEATURE] Wearable Device Integration for Vitals, Activity & PGHD).

The reference implementation is branch `sat-apple-health-ts`. This document covers the
storage model and the HTTP API that write and read consumer-device samples. Charts,
companion apps, and vendor bridges stay outside it.

## What [#314](https://github.com/jwilleke/yourphr/issues/314) asks for, and what this slice delivers

[#314](https://github.com/jwilleke/yourphr/issues/314) asks YourPHR to keep wearable vitals,
activity, and sleep as patient-generated health data: FHIR Observations with standard codes,
provenance, time-series reads, and a bulk import path, all inside the self-hosted instance.

This proposal delivers that as an Observation-shaped projection in the app database, plus
authenticated routes that ingest samples and serve them back as rows, a reconstructed
Observation, a Bundle, a per-metric catalog, and a chart series.

A year of five-minute heart rate cannot go through the FHIR write path.
`SqliteFhirRepository` indexes every resource with FHIRPath, and that cost does not finish
for a wearable stream. Samples therefore live in their own tables. `toObservation()` rebuilds
FHIR R4 JSON when a caller asks for one Observation or a Bundle. The clinical record store is
unchanged.

## Identity

A sample has three names, used for different jobs:

| Name | Role |
| --- | --- |
| LOINC `code` + UCUM unit + Observation category | Canonical identity. Queries and exports use this. |
| `metric_type` | Stable snake_case name (`heart_rate`, `step_count`). Sync anchors use it. |
| `vendor_type` | Vendor key that arrived with the sample (`HKQuantityTypeIdentifierHeartRate`, `HeartRateRecord`). |

Ownership is the authenticated account (`user_id` = `ctx.username`). The request body cannot
name an account. On ingest, `subject` is set to `Patient/{id}` from the account's first Patient
when one exists. A later read uses the stored subject.

Idempotency is `(user_id, external_uuid)`. A retry of the same external identifier is counted
as a duplicate and does not insert a second row. The external identifier is the HealthKit
`uuid`, or `Observation.identifier[0].value`.

## Tables

Both tables are in the app database (`spike.db`), created by migrations
`20260901150000` and `20260909120000`. Migration `20260929160000` renames the
vendor-key column to `vendor_type`. They are removed with the account.

### `health_samples`

| Column | Meaning |
| --- | --- |
| `id` | Server id. Primary key. Becomes `Observation.id` on read. |
| `user_id` | Owning account. |
| `external_uuid` | Caller identifier. Unique with `user_id`. |
| `identifier_system` | Identifier system. `urn:uuid` when the caller omits one. |
| `vendor_type` | Vendor type key. Empty when the sample arrived as LOINC only. |
| `metric_type` | Catalog name. Empty when the vendor key is unknown. |
| `code_system` | `http://loinc.org` for a catalog match. The caller's system otherwise. |
| `code` | LOINC code for a catalog match. The caller's code otherwise. Empty for an unknown vendor key. |
| `category` | `vital-signs`, `activity`, or `sleep`. |
| `subject` | `Patient/{id}` captured at ingest. |
| `start_time`, `end_time` | Interval, stored as UTC RFC3339. Equal when the source had a single instant. |
| `value_num`, `unit` | Quantity. `value_num` is null for codeable and panel rows. `unit` is the catalog's UCUM code. |
| `value_text` | Canonical codeable value (a SNOMED code for sleep stage). |
| `components` | JSON array of `{code, display, value, unit}` for panel observations. Empty otherwise. |
| `correlation_uuid` | Caller correlation. Blood-pressure components that share one are merged into a single panel row. |
| `source_name` | Provenance label (`Apple Watch`, or `Observation.meta.source`). |
| `source_bundle_id` | Vendor app id. Stored. Omitted from list and Observation responses. |
| `device_name` | Device display name, or `Observation.device.display`. |
| `metadata` | JSON object from the caller. Stored. Omitted from list and Observation responses. |

Indexes:

- `(user_id, metric_type, start_time)` for series reads
- `(user_id, code, start_time)` for LOINC reads
- `(correlation_uuid)` for panel merge lookups

### `health_sync_states`

One row per account, companion device, and metric. The companion sends an opaque anchor after
the samples that anchor describes. The server stores the anchor and does not interpret it.

| Column | Meaning |
| --- | --- |
| `user_id`, `device_id`, `metric_type` | Primary key. |
| `anchor` | Opaque string from the companion. |
| `last_sample_end_time` | Latest `end_time` accepted for that metric in the same request. |
| `last_synced_at` | Server time of the upsert. |
| `device_name` | `device.name` from the ingest body. |

## Catalog

`src/app/health/catalog.ts` is the only map from a vendor key or `metric_type` onto LOINC, UCUM,
category, and allowed values. A key missing from the catalog is stored with an empty `code`
and empty `metric_type`, so a companion that ships a new metric before the server knows about
it does not drop the sample. A known metric whose unit is outside `acceptedUnits` is rejected.
A known codeable value outside the alias list is rejected.

HealthKit oxygen saturation often arrives as a fraction in `[0, 1]`. That input is scaled to
the FHIR percent range `0–100`. The same LOINC code sent as an Observation is left as sent.

| LOINC | `metric_type` | Kind | UCUM | Category | Vendor keys |
| --- | --- | --- | --- | --- | --- |
| `8867-4` | `heart_rate` | quantity | `/min` | vital-signs | `HKQuantityTypeIdentifierHeartRate`, `HeartRateRecord` |
| `40443-4` | `resting_heart_rate` | quantity | `/min` | vital-signs | `HKQuantityTypeIdentifierRestingHeartRate`, `RestingHeartRateRecord` |
| `80404-7` | `heart_rate_variability_sdnn` | quantity | `ms` | vital-signs | `HKQuantityTypeIdentifierHeartRateVariabilitySDNN` |
| `85354-9` | `blood_pressure` | panel | `mm[Hg]` | vital-signs | correlation plus systolic `8480-6` and diastolic `8462-4` |
| `55423-8` | `step_count` | quantity | `{steps}` | activity | `HKQuantityTypeIdentifierStepCount`, `StepsRecord` |
| `29463-7` | `body_mass` | quantity | `kg` | vital-signs | `HKQuantityTypeIdentifierBodyMass`, `WeightRecord` |
| `2708-6` | `oxygen_saturation` | quantity | `%` | vital-signs | `HKQuantityTypeIdentifierOxygenSaturation`, `OxygenSaturationRecord` |
| `8310-5` | `body_temperature` | quantity | `Cel` | vital-signs | `HKQuantityTypeIdentifierBodyTemperature`, `BodyTemperatureRecord` |
| `93832-4` | `sleep_stage` | codeable | | sleep | `HKCategoryTypeIdentifierSleepAnalysis`, `SleepSessionRecord` |

Sleep stages are stored as SNOMED codes. Accepted aliases include HealthKit category values
(`asleepDeep`, `HKCategoryValueSleepAnalysisAsleepDeep`) and Health Connect stage names
(`STAGE_TYPE_SLEEPING_DEEP`, `DEEP`):

| Stored code | Display |
| --- | --- |
| `248218006` | Awake |
| `248219008` | Light sleep |
| `248220008` | Deep sleep |
| `248218000` | REM sleep |
| `248171000` | Asleep |
| `133877004` | In bed |

Blood pressure from HealthKit arrives as two quantity samples that share `correlation_uuid`.
Ingest merges them into one row whose `code` is `85354-9`, whose `external_uuid` is the
correlation id, and whose `components` hold systolic `8480-6` and diastolic `8462-4`. A FHIR
panel Observation that already carries both components is stored as one row.

## HTTP API

Every route is under `/api/secure/health/` and requires a session or a companion device token.
Responses use the existing envelope, `{ "success": true, "data": ... }`.

Reads are in the `Health` access category, so an agent token scoped to Health can call the
GETs, and the access log records them. Agent tokens are refused on every POST, including
ingest, by the existing agent gate in
[#695](https://github.com/jwilleke/yourphr/issues/695). The demo instance refuses ingest.

### `POST /api/secure/health/samples`

Ingest. Body limit 8 MiB. At most 5,000 samples. Rate limit 60 requests per minute per account.
A sample that fails validation is counted in `rejected` and does not abort the rest of the
batch. At most 50 rejection reasons are returned.

`device.device_id` is required on every ingest, including a Bundle. It keys sync state. It is
a companion-chosen string, and it is not a FHIR `Device` id.

Two sample shapes are accepted in `samples`, and a FHIR Bundle may be the body itself.

Vendor sample:

```json
{
  "device": { "device_id": "iphone-1", "name": "Jim's iPhone" },
  "samples": [
    {
      "uuid": "hr-1",
      "type": "HKQuantityTypeIdentifierHeartRate",
      "start": "2026-08-24T12:00:00Z",
      "end": "2026-08-24T12:00:00Z",
      "value": 72,
      "unit": "count/min",
      "source_name": "Apple Watch",
      "source_bundle_id": "com.apple.health",
      "device_name": "Apple Watch"
    }
  ],
  "anchors": { "heart_rate": "opaque-anchor" }
}
```

`unit` must be one of the catalog's accepted units (`/min`, `count/min`, `count/minute`,
`bpm` for heart rate). It is stored as the canonical UCUM code.

FHIR Observation, either inside `samples` or as `Bundle.entry[].resource`:

```json
{
  "device": { "device_id": "bridge-1", "name": "Health Connect bridge" },
  "samples": [
    {
      "resourceType": "Observation",
      "identifier": [{ "system": "urn:uuid", "value": "obs-hr" }],
      "status": "final",
      "code": { "coding": [{ "system": "http://loinc.org", "code": "8867-4" }] },
      "effectiveDateTime": "2026-08-24T15:00:00Z",
      "valueQuantity": {
        "value": 64,
        "system": "http://unitsofmeasure.org",
        "code": "/min"
      },
      "device": { "display": "Pixel Watch" },
      "meta": { "source": "Health Connect" }
    }
  ]
}
```

An Observation is recognized when `resourceType` is `Observation`, or when `code` is present
and `type` is absent. `effectivePeriod` supplies the interval. `effectiveDateTime` supplies an
instant. `valueCodeableConcept` supplies a codeable value. `component[]` supplies a panel.

Result:

```json
{
  "received": 1,
  "accepted": 1,
  "stored": 1,
  "duplicates": 0,
  "rejected": 0
}
```

`received` counts raw samples before the blood-pressure merge. `accepted` counts rows after
that merge. `stored` counts rows actually inserted. `duplicates` is `accepted - stored`.
`errors`, when present, is `{ "uuid", "type", "reason" }[]`.

`anchors` is an object of `metric_type` to opaque string. Each entry upserts
`health_sync_states` for `device.device_id` after the samples are written.

### `GET /api/secure/health/samples`

Page of stored rows. Optional filters:

| Query | Meaning |
| --- | --- |
| `code` | Comma-separated LOINC codes. A `system\|code` value uses the code after the last `\|`. |
| `metric_type` | Comma-separated catalog names. A known name is resolved to its LOINC code before the query. |
| `vendor_type` | One vendor key. Applied when no `code` resolved. |
| `start_after`, `start_before` | RFC3339 bounds on `start_time`. `start_before` is exclusive. |
| `limit` | Default 500, maximum 5,000. |
| `offset` | Default 0. |
| `sort` | `asc` or `desc` (default) on `start_time`. |

When any requested code resolves, the query runs on `code` and ignores `metric_type` and
`vendor_type`. An unknown `metric_type` is matched against the `metric_type` column.

```json
{
  "total": 1,
  "count": 1,
  "offset": 0,
  "samples": [
    {
      "id": "…",
      "external_uuid": "hr-1",
      "identifier_system": "urn:uuid",
      "vendor_type": "HKQuantityTypeIdentifierHeartRate",
      "metric_type": "heart_rate",
      "code": "8867-4",
      "code_system": "http://loinc.org",
      "category": "vital-signs",
      "start_time": "2026-08-24T12:00:00.000Z",
      "end_time": "2026-08-24T12:00:00.000Z",
      "value_num": 72,
      "unit": "/min",
      "source_name": "Apple Watch"
    }
  ]
}
```

Panel rows include `components` instead of `value_num`. Codeable rows include `value_text`.
Empty strings are omitted.

### `GET /api/secure/health/observation/{id}`

One reconstructed FHIR R4 Observation. `404` when the id is missing or belongs to another
account.

The reconstruction sets `status` to `final`, copies the external identifier, sets `code` from
LOINC (and adds the vendor key as a second coding when `vendor_type` is set), sets `category`
from the observation-category code system, sets `subject` from the stored Patient reference,
uses `effectiveDateTime` when start and end match and `effectivePeriod` otherwise, and writes
`valueQuantity`, `valueCodeableConcept`, or `component` from the stored value. `device.display`
and `meta.source` carry provenance. UCUM stays in `valueQuantity.code`. `valueQuantity.unit`
uses a short display (`beats/minute`, `mmHg`, `C`, `steps`) for the four units that have one.

### `GET /api/secure/health/bundle`

A FHIR `collection` Bundle of Observations for the same filters as the sample list (`code`,
`metric_type`, `vendor_type`, `start_after`, `start_before`). The page size is the list maximum,
5,000, in ascending `start_time`. `Bundle.total` is the number of entries returned.

### `GET /api/secure/health/metrics`

One summary per metric the account actually holds, newest first. Grouping prefers `code`,
then `metric_type`, then `vendor_type`, so an unknown vendor key still appears.

```json
{
  "last_synced_at": "2026-08-24T12:00:05.000Z",
  "metrics": [
    {
      "code": "8867-4",
      "code_system": "http://loinc.org",
      "category": "vital-signs",
      "metric_type": "heart_rate",
      "vendor_type": "HKQuantityTypeIdentifierHeartRate",
      "unit": "/min",
      "value_num": 72,
      "latest_at": "2026-08-24T12:00:00.000Z",
      "earliest_at": "2026-08-01T08:00:00.000Z",
      "sample_count": 1200,
      "source_name": "Apple Watch",
      "device_name": "Apple Watch"
    }
  ]
}
```

`last_synced_at` is the newest sync-state timestamp, and it is omitted when the account has
never sent an anchor. `value_num` / `value_text` / `components` describe the latest sample.

### `GET /api/secure/health/series`

One metric over a window. `code`, `metric_type`, or `vendor_type` is required. Filters match the
sample list, plus:

| Query | Meaning |
| --- | --- |
| `mode` | `points` (default), `day`, `daily-stats`, or `stages`. |
| `max_points` | Cap for `points`. Default 400, maximum 2,000. |

`points` returns `{ "t", "v" }[]` in time order, plus `stats` (`min`, `max`, `avg`) over the
unsampled rows and `unit`. When the row count exceeds `max_points`, the response averages into
time buckets and sets `downsampled` to true. A panel returns `components`, a map of component
LOINC code to its own point list, instead of `points`.

`day` sums `value_num` by UTC calendar date. This is the step total. Days with no samples are
absent.

`daily-stats` returns one bucket per UTC day that has samples: `value` is the average, with
`min`, `max`, and `n`. For a blood-pressure panel the systolic component (`8480-6`, or the
first component) supplies the numbers. Window-wide `stats` cover every sample in the filter.

`stages` sums sleep hours by stage. The night date is `start_time` shifted back 12 hours, so
a stage that starts at 04:00 UTC is attributed to the previous calendar date. `nights[].stages`
maps the stored SNOMED code to hours.

```json
{
  "code": "8867-4",
  "metric_type": "heart_rate",
  "unit": "/min",
  "total": 2,
  "downsampled": false,
  "points": [
    { "t": "2026-08-24T10:00:00.000Z", "v": 70 },
    { "t": "2026-08-24T11:00:00.000Z", "v": 80 }
  ],
  "stats": { "min": 70, "max": 80, "avg": 75 }
}
```

### `GET /api/secure/health/sync-state`

Returns the anchor rows for the account. Optional `device_id` limits the list to one companion.

```json
[
  {
    "device_id": "iphone-1",
    "metric_type": "heart_rate",
    "anchor": "opaque-anchor",
    "last_sample_end_time": "2026-08-24T12:00:00.000Z",
    "last_synced_at": "2026-08-24T12:00:05.000Z",
    "device_name": "Jim's iPhone"
  }
]
```

## Who may write

Ingest is a write, so the read-only agent token cannot call it. A companion authenticates with
a device token (`yphr_dt_…`), minted by a human session at `POST /api/secure/access/token` and
presented as `Authorization: Bearer`. The token is stored hashed. Verification builds a full
user context for the owner, which is what makes `POST /api/secure/health/samples` succeed.

`device_tokens` holds `id`, `owner`, `name`, `hash`, `prefix`, `created_at`, `expires_at`,
`last_used_at`, `revoked_at`, and `revoked_by`. Minting and revoking require a human session.
A device token cannot mint another device token. Account deletion removes the tokens with the
samples.

`POST /api/auth/companion-session` trades a device-token Bearer header for the ordinary
session cookie. That route exists so a companion can open the same web UI. It is not required
to ingest samples.

## Account and backup

`DELETE /api/secure/account/me` calls `HealthManager.removeForUser`, which deletes that
account's rows from both health tables. Another account's samples stay.

Samples are restored with the app database. `HealthManager.backup()` records that the manager
participates. It does not emit a second copy of the rows.

## Follow-ups still open on [#314](https://github.com/jwilleke/yourphr/issues/314)

- Choosing which Patient in a family account owns a sample. Ingest currently binds `subject` to the first Patient.
- FHIR `Device` and `DeviceMetric` resources. Provenance today is `source_name`, `device_name`, and `source_bundle_id` on the row, surfaced as `Observation.device.display` and `Observation.meta.source`.
- A growing catalog. The nine metrics above are the ones companions send today. An unknown vendor key is kept, and a later catalog row can start recognizing it.
- Whether a full-record export should include the reconstructed Bundle beside the clinical FHIR export.

## Questions for review

1. Is binding every sample to the account, with Patient subject filled from the first Patient, enough for the first cut of family use?
2. Should `metadata` and `source_bundle_id` stay server-side only, as they do here, or appear on the sample list?
