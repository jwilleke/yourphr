# Design note: a connected device's write scope inside a patient consent grant

> __Status: decided__ (Jim, 2026-09-30). The six decisions are at the end and on the issue. Issue [#807](https://github.com/jwilleke/yourphr/issues/807), child of the #314 readiness epic [#810](https://github.com/jwilleke/yourphr/issues/810). It unblocks the implementation [#808](https://github.com/jwilleke/yourphr/issues/808) and, through it, [#809](https://github.com/jwilleke/yourphr/issues/809) and [#314](https://github.com/jwilleke/yourphr/issues/314) PR 4. Part of the auth plan in [authorization-framework.md](authorization-framework.md).

## What is already decided

From [#314](https://github.com/jwilleke/yourphr/issues/314) and its [review](2026-09-30-yourphr-314-device-review.md) (Jim, 2026-09-30):

- A connected device (a mobile device app, a scale) uploads over an HTTP API, not MCP.
- Its credential has __one write scope__, "add health samples". It reaches only `POST /api/secure/health/samples` and `GET /api/secure/health/sync-state`, at the existing default-deny edge gate.
- __The patient's consent carries the term, not the token.__ The patient chooses the term, up to an operator maximum (30 days by default). The device exchanges short-lived keys inside it, and an exchange never moves the end date. Only the patient's signed-in session extends it.
- It ends on revoke, password change or sign-out-everywhere. It is suspended after 14 days with no upload (`yourphr.devices.inactive-after-days`, [#809](https://github.com/jwilleke/yourphr/issues/809)).
- Setup is patient-started, with a one-time code shown as a QR code or an "Open in app" button. Links never grant anything. RFC 8628 ([ngdpbase#1526](https://github.com/jwilleke/ngdpbase/issues/1526)) is a later path for devices with their own screen.
- Off by default.

## Today's agent tokens, and the gap

`AgentTokensManager` ([#695](https://github.com/jwilleke/yourphr/issues/695)) already gives most of what is needed:

- Minting, renewing and revoking need the owner's own session.
- Renewal re-mints rather than moving a date.
- Scopes are __access categories__, the same words the access log uses. So "a surface that cannot be logged cannot be scoped".
- The edge gate ([src/server.ts](../../src/server.ts), the `agentRequest` block) lets an agent reach only a GET that has an access category its token names.

The gap: categories exist only for reads (`accessCategoryFor` in [src/account/index.ts](../../src/account/index.ts) maps GET paths), so no write can ever be granted. A token also has one fixed lifetime (24 h by default), which is too short for a phone that syncs in the background and too long to stand in for a 30-day consent.

## Proposed model

Two records. The __grant__ is the patient's consent. The __keys__ are what the device presents.

### The grant (the consent)

A new record beside agent tokens, in the app database:

| Field | Meaning |
|---|---|
| `id` | |
| `owner` | the patient |
| `label` | the patient's own words: "Jim's iPhone — Apple Health" |
| `scopes` | write categories (below), e.g. `["Health samples (add)"]` |
| `createdAt`, `endsAt` | RFC 3339 with offset; `endsAt` ≤ `createdAt` + `yourphr.devices.grant-max-days` |
| `ownerGeneration` | the owner's token generation at grant time; a mismatch ends the grant, which is how password change and sign-out-everywhere end it |
| `lastUploadAt` | for inactivity suspension (#809) |
| `status` | `active`, `suspended`, `revoked`, `ended` |
| `sourceId` | the device source its records are credited to ([#806](https://github.com/jwilleke/yourphr/issues/806)) |

### The keys (what the device holds)

The OAuth refresh pattern, with both halves bound to the grant:

- An __access key__: an agent token with `grantId` set, lifetime `yourphr.devices.key-ttl-hours` (24). It is what the device sends on every upload.
- A __refresh token__ (OAuth 2.0, rotating, per RFC 9700 §4.14): lives until the grant ends, and __rotates on every use__. The device exchanges it at `POST /api/device/token` for a new access key and a new refresh token. Presenting a refresh token that was already used means it was copied, so the whole grant is revoked, and the patient is told.

Why a refresh token rather than "exchange the current access key": a phone that is off for a weekend would otherwise come back with an expired key and need the patient to set it up again. With the refresh token it resumes on its own, still inside the patient's term.

An exchange __never__ moves `endsAt`. Every exchange checks that the grant is active and that the owner's generation still matches.

### The write vocabulary

A small table beside `accessCategoryFor`, keyed by method and path:

```text
POST /api/secure/health/samples     →  "Health samples (add)"      (write)
GET  /api/secure/health/sync-state  →  "Health samples (sync state)" (read)
```

The edge gate lets an agent request through only when:

- the path and method have a category, and
- the token's scopes name it, and
- for a write, the token belongs to an __active__ grant.

Every other write stays refused for every agent. The access log names each write batch by the grant's label ("Jim's iPhone added 1,204 samples"). The safety property extends to writes unchanged: a surface that cannot be logged cannot be scoped.

### Setup (patient-started)

1. Settings → Connected devices → "Add a device". The patient names it, picks the term (default and maximum from configuration), and confirms it is them __with any primary auth method their account holds__ (the password today; a passkey and others as they arrive). A delegated credential never satisfies it. [ngdpbase#1525](https://github.com/jwilleke/ngdpbase/issues/1525)'s step-up replaces this interim check when it lands.
2. The server creates the grant and a __setup code__: single use, `yourphr.devices.setup-code-minutes` (10), shown only in that signed-in page, as a QR code and an "Open in app" button.
3. The app sends the code to `POST /api/device/claim` and receives the first access key and refresh secret, the grant's `endsAt`, and the patient-visible label.

The code is shown only to the signed-in patient, lives minutes, and is spent on first use. The QR code and link carry that code and nothing else. Scanning it grants nothing until the app claims it, and it works once.

### Extending, and the end of the term

- Notices through `NotificationManager` at the days in `yourphr.devices.notice-days` (default 7 and 1 before `endsAt`), and once when it has ended. They go to __every channel the person has approved__, with the in-app banner always on ([#833](https://github.com/jwilleke/yourphr/issues/833), blocked by #709; until then, the banner plus email when the person has an address and escalation is on). No SMS notices.
- "Extend" needs the signed-in session and the same re-authentication. It sets a new `endsAt` of at most now + the maximum.
- With no action, the grant ends. The device's next exchange is refused with a message the app can show ("Your consent for this device ended on …; extend it in yourPHR").

### What is recorded

Access-log lines, in the patient's words, for: grant created, extended, revoked, suspended, resumed, ended, a reused refresh secret, and each write batch. Key exchanges are counted on the grant, not logged one by one.

A FHIR `Consent` resource is __not__ written at first. The grant list is exportable, and `Consent` can be added when the patient's export should carry it.

### Configuration

| Key | Default |
|---|---|
| `yourphr.devices.enabled` | `false` |
| `yourphr.devices.grant-max-days` | `30` |
| `yourphr.devices.key-ttl-hours` | `24` |
| `yourphr.devices.setup-code-minutes` | `10` |
| `yourphr.devices.inactive-after-days` | `14` (#809) |
| `yourphr.devices.max-per-user` | `5` (suspended grants count; revoked and ended do not) |
| `yourphr.devices.notice-days` | `[7, 1]` |

All read through ConfigurationManager.

## Where it lives

__In `AgentTokensManager`, not a new manager.__ A grant is a delegation with a term, and its keys are agent tokens. Keeping them in one manager keeps one door to "who may act for this patient", and it avoids the ask-before-a-new-manager rule. The grant/refresh pattern is what flows back to ngdpbase's `AgentTokenManager`, which has the same one-lifetime gap.

## Decisions (Jim, 2026-09-30, recorded on [#807](https://github.com/jwilleke/yourphr/issues/807))

1. __Grants live in `AgentTokensManager`__, not a new manager: one door for who may act for a patient.
2. __Rotating OAuth refresh tokens with reuse detection__, never moving the grant's end date.
3. __Re-authentication with any primary auth method the account holds__ on grant and extend (password today; passkeys and others as they arrive), replaced by ngdpbase#1525's step-up when it lands.
4. __No FHIR `Consent` at first:__ the grant record plus plain-words access-log lines; `Consent` later if the export should carry it.
5. __Reminders on configurable days__ (`yourphr.devices.notice-days`, default `[7, 1]`), to every channel the person approved ([#833](https://github.com/jwilleke/yourphr/issues/833)). No SMS notices: they look like phishing, and yourPHR does not pay for SMS.
6. __At most `yourphr.devices.max-per-user` (default 5)__ active grants per patient, suspended ones included.
