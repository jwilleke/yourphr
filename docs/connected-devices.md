# Connected devices: the contract for mobile device apps

For developers of a __mobile device app__ (a phone app that reads Apple Health or Google Health Connect) or a connected scale, cuff or meter that sends readings to a patient's yourPHR instance. This is what yourPHR guarantees today. The design and its decisions are in [2026-09-30-device-write-scope-and-consent-grant.md](planning/2026-09-30-device-write-scope-and-consent-grant.md) ([#807](https://github.com/jwilleke/yourphr/issues/807)). Built in [#808](https://github.com/jwilleke/yourphr/issues/808) and [#809](https://github.com/jwilleke/yourphr/issues/809) as part of [#810](https://github.com/jwilleke/yourphr/issues/810).

> __Status.__ Setup, keys, refresh, pausing and the write gate are live on `main`. The samples upload itself (`POST /api/secure/health/samples`, its body and the `sync-state` read) arrives with [#314](https://github.com/jwilleke/yourphr/issues/314) PR 1, and this page will describe it then. Until then those two routes answer `404` after the gate.

## What a device may do

- __One write:__ add health samples (`POST /api/secure/health/samples`). One read: its own sync state (`GET /api/secure/health/sync-state`).
- __Nothing else.__ A device key reads nothing of the patient's record, cannot manage devices or keys, and cannot reach any other route. Every request it makes is recorded in the patient's access log under the name the patient gave it.
- __For as long as the patient allows__, up to the instance's maximum (30 days by default). Only the patient, signed in, can extend it.
- __Off by default.__ An operator turns it on with `yourphr.devices.enabled` in Admin → Configuration.

## Setup: how a device gets its keys

1. The patient opens __Settings → Connected devices__, names the device, chooses how long to allow it, and confirms with their password.
2. yourPHR shows a __one-time setup code__, once. It is valid for `yourphr.devices.setup-code-minutes` (10 by default) and works a single time. It is shown three ways:
   - a __QR code__ whose text is JSON:

     ```json
     { "v": 1, "server": "https://phr.example.org/api", "code": "yphr_setup_…" }
     ```

   - an __Open in app__ link: `yourphr-device://claim?server=<url-encoded server>&code=<url-encoded code>`
   - the code itself, for typing in.

   `server` is the API base. Every path below is relative to it: `<server>/device/claim` is `https://phr.example.org/api/device/claim`.
3. The app __claims__ the code.

The code grants nothing until an app claims it, and it works once. Treat it as a secret: never log it, never send it anywhere but the patient's own server.

### `POST <server>/device/claim`

No authentication. Rate-limited per client IP, as sign-in is.

```http
POST /api/device/claim
Content-Type: application/json

{ "code": "yphr_setup_…" }
```

`200`:

```json
{
  "success": true,
  "data": {
    "access_token": "yphr_at_…",
    "token_type": "Bearer",
    "expires_in": 86400,
    "refresh_token": "yphr_rt_…",
    "grant_ends_at": "2026-10-30T14:02:11.000Z",
    "label": "Jim's iPhone — Apple Health"
  }
}
```

- `expires_in`: seconds the access token lives (`yourphr.devices.key-ttl-hours`, 24 by default). It is never later than `grant_ends_at`.
- `grant_ends_at`: when the patient's permission ends. No refresh can go past it.
- `label`: what the patient called the device. Show it, so the person knows which permission this is.

`401` `{ "success": false, "error": "that setup code is not valid — ask the patient to show a new one" }`: the code is wrong, used or expired, or the permission has ended. Ask the patient to add the device again.

## Using the access token

Send it on every call as `Authorization: Bearer yphr_at_…`. Never in a query string, and never as a cookie.

- `401` from an upload means the key is dead (expired, rotated, or the permission ended). Refresh. If the refresh is refused, stop and tell the person.
- `403` means this key may not do that. It is a bug in the app, not something to retry.

## Staying connected: `POST <server>/device/token`

The access token lasts a day; the __refresh token__ lasts until the permission ends. Trade the refresh token for a fresh pair before or after the access token expires. A phone that was off for a weekend resumes on its own, as long as the permission has not ended.

```http
POST /api/device/token
Content-Type: application/json

{ "refresh_token": "yphr_rt_…" }
```

`200` returns the same shape as the claim, with a __new__ access token and a __new__ refresh token. Every earlier access token of this device stops working at once.

__A refresh token works once.__ This is the rule an app must get right (OAuth 2.0 rotation with reuse detection, [RFC 9700 §4.14](https://www.rfc-editor.org/rfc/rfc9700#section-4.14)):

- Save the new refresh token __before__ using the new access token, and replace the old one atomically. A crash between the two must leave the app holding the new one.
- If yourPHR ever sees a refresh token that was already used, it assumes it was copied. It __revokes the whole permission__, and the patient sees "a copied key was used" in their access log. The real device is then locked out too, until the patient adds it again. That's deliberate.
- Never retry a refresh with the same token after a network error you can't classify. Keep the pair, and only discard the old refresh token once the response carrying the new one has been saved.

Refusals:

| Status | `error` | Meaning | What the app does |
|---|---|---|---|
| `401` | "this device is no longer allowed to add to the record — the patient can connect it again" | revoked, ended, a copied refresh token, or the patient's sign-out-everywhere or password change | stop; tell the person to add the device again in yourPHR |
| `403` | "paused: yourPHR received nothing from this device for N days — the patient can resume it" | paused for inactivity ([#809](https://github.com/jwilleke/yourphr/issues/809)) | stop; tell the person to resume it in Settings → Connected devices. The same refresh token works again once they do |
| `429` | "too many requests — try again shortly" | rate limit; `Retry-After` gives seconds | wait, then retry |

## What ends or pauses a permission

- __The patient removes it__, or it reaches `grant_ends_at` without being extended.
- __The patient changes their password or signs out everywhere.__ Every device permission ends with their sessions.
- __A used refresh token is presented again__ (see above).
- __Nothing is uploaded__ for `yourphr.devices.inactive-after-days` (14 by default). The permission is __paused__, not ended: keys stop, the patient is told, and they can resume it. Phones and scales get replaced and sold, and the old credential should not live on. Refreshing does not count as activity; uploading does.

The patient is reminded before the end (`yourphr.devices.notice-days`, 7 and 1 days by default) and can extend from Settings. Extending never needs anything from the app.

## Rules the data must follow

Decided on [#314](https://github.com/jwilleke/yourphr/issues/314). The upload body itself comes with its PR 1:

- __Every date-time is RFC 3339 with an explicit offset__ (`2026-09-30T07:15:00-04:00` or `…Z`). Anything else is refused with a message, never guessed in the server's timezone.
- What a device sends is recorded as __patient-generated health data (PGHD)__, credited to the device by the name the patient gave it, and never mixed with what a clinician recorded. See the published code system at <https://yourphr.org/fhir/CodeSystem/record-origin>.

## Storage in the app

- Keep the refresh token in the platform's secure store (iOS Keychain, Android Keystore-backed storage), never in plain preferences, logs or crash reports.
- Keep the access token in memory when you can. It is short-lived by design.
- Store `server` with the tokens. One app can hold permissions to more than one patient's server.

## Related

- [#314](https://github.com/jwilleke/yourphr/issues/314): wearables and connected devices, and the [review](planning/2026-09-30-yourphr-314-device-review.md)
- [authorization-framework.md](planning/authorization-framework.md): the auth plan. RFC 8628 for devices with their own screen is a later path ([ngdpbase#1526](https://github.com/jwilleke/ngdpbase/issues/1526))
- [agent-access-policy.md](agent-access-policy.md): the read-only agent tokens this builds on
