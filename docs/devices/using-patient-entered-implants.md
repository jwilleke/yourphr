# Using patient-entered implants

> __Status.__ On `main` since PR [#882](https://github.com/jwilleke/yourphr/pull/882) (merged 2026-10-11, `bd985a976`), which added partial dates and the placement and removal rows under Procedures. It reaches the instances with the next release after v3.16.4.

Wearables and other external equipment are covered in [Connected devices](connected-devices.md). An implant is not a connected device.

## What it is for

An implant is something a clinician put inside your body: a stent, a pacemaker, an artificial joint, a breast implant, a cochlear implant. Recording it gives you one place that answers the questions people actually get asked: *what is it, when did it go in, is it still there, and what is its serial or UDI number?* Those are the questions an MRI technician, a surgeon, or a recall notice asks.

External equipment is not an implant. Hearing aids, Dexcom/Libre CGMs and CPAP machines go under __A measurement__, named in __Measured with__.

## Adding one

1. Open __Add record__. It's on Explore, Medical History, and the report header, or go to `/resource/add`.
2. Under __What are you adding?__, choose __An implant__.
3. Fill in what you know. Only the name is required.

| Field | What to put | Notes |
|---|---|---|
| Name | What it is, in your words: "Coronary stent", "Left knee replacement" | Required. |
| When was it put in? | `2024`, `2024-06` or `2024-06-10` | Optional. Use only the precision you actually know. |
| When was it removed? | Same formats | Optional. Leave it empty if the implant is still in. |
| Status | Active, Inactive, or Unknown / not stated | Defaults to Unknown. The app never guesses this. |
| UDI device identifier | The DI part of the barcode on the implant card | Optional. |
| Distinct identifier | The distinct identifier, if your implant card gives one | Optional. |
| Serial number | From the implant card | Optional. |
| Lot number | From the implant card | Optional. |
| Manufacture date | `YYYY`, `YYYY-MM` or `YYYY-MM-DD` | Optional. |
| Expiration date | Same formats | Optional. |

The implant card or the hospital's discharge papers usually carry the UDI, serial and lot numbers. Those numbers are what a recall notice matches on.

### Partial dates

If you only know the year, type `2019`. If you know the month, type `2019-03`. The app stores exactly what you typed and shows it the same way: `2019`, `Mar 2019`, `Mar 14, 2019`. It never fills in a month or day you didn't give.

The app rejects a date pair only when the dates *definitely* conflict:

- Removal `2023` with placement `2024` is refused, because 2023 ends before 2024 begins.
- Removal `2024-06-30` with placement `2024-06` is accepted, because the placement could have been any day in June.
- The same rule applies to expiration against manufacture.

Impossible dates such as `2024-13` or `2023-02-29` are refused.

## Where it shows up

- __Explore:__ a __Device__ card with the name, status, identifiers and dates. After saving, the __View in Explore__ button goes straight there.
- __Procedures__: one row for __Implant placement__ and one for __Implant removal__, each at the date you gave. Each row links back to its Device.
- __Dashboard search__: searching "implant removal" finds the removal row as well as the Device.
- __Measurements:__ an implant never appears in the __Measured with__ list. It isn't a measuring device.

Everything you enter is marked __patient-reported__, so it's clear the record came from you and not from a provider.

## Changing or removing it

- __Deleting__ the Device deletes its placement and removal rows with it. Those rows can't be deleted on their own. They are views of the Device, not separate records, so you can't end up with a removal row for an implant that no longer exists.
- __Editing__ an implant after saving isn't supported yet. To correct one, delete it and add it again.

## Behind the scenes (for the operator)

- Stored as a FHIR `Device` with the US Core Implantable Device profile (`US_CORE_IMPLANTABLE_DEVICE`) and the patient-generated-data tag (`PGHD_TAG`). The builder is `src/patient-entry/implant.ts`.
- Placement and removal are `Procedure` resources __contained__ in the Device (`id` `implant-placement` / `implant-removal`, `focalDevice.manipulated.reference = "#"`). Saving, exporting and deleting the Device therefore always carries them along.
- `src/app/managers/implant-procedures.ts` projects the contained Procedures as read-only records with id `<deviceId>#implant-placement`. They appear in lists, counts, search, detail and provenance, but they are never stored rows and never enter the review queue.
- Dates are validated on the server (`src/patient-entry/implant-dates.ts`) and again in the browser (`frontend/src/lib/utils/implant-date.ts`), and the two use the same rules.
- Search matches placement and removal rows with the same SQLite FTS5 `porter unicode61` tokenizer as the main index ([#891](https://github.com/jwilleke/yourphr/pull/891)), so "implant removing" finds "Implant removal". The match runs in a small in-memory database, never on the records connection. Parents are looked up as `Device`, so a Device that shares an id with another resource still resolves.

## Testing it

- E2E: `e2e/patient-implants.spec.ts`, which has four journeys and runs in the full `make test-e2e` suite.
- Unit: `src/patient-entry/__tests__/implant.test.ts`, `frontend/src/lib/utils/implant-date.spec.ts`.
- Use synthetic implants only. The demo instance or the dedicated test login is fine; real records are not.
