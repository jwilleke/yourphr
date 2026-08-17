# Connect Medicare — CMS Blue Button 2.0

How to connect __CMS Blue Button 2.0__ (Medicare claims data) to YourPHR as a SMART-on-FHIR source — __sandbox__ (verified) and __production__ (after CMS credentials).

__Related:__ [provider catalog](provider-catalog/README.md) · [connection policy](connection-policy.md) · [attributions](Attributions.md) · __[CMS production access runbook](cms-bluebutton-production-access.md)__ ([#433](https://github.com/jwilleke/yourphr/issues/433)) · [#432](https://github.com/jwilleke/yourphr/issues/432) · [#408](https://github.com/jwilleke/yourphr/issues/408)

## Patient-facing name: “Medicare” (#429)

Blue Button is the API / architecture (FHIR, OAuth, CARIN). For CMS production-access UI rules, when enrollees pick among several sources the __list label must be “Medicare”__ — not “Blue Button”, “CMS Blue Button”, or “Medicare.gov”.

YourPHR enforces that on the __production__ connectable list and when storing the connected source display. __Sandbox / admin__ may keep explicit names (e.g. `Medicare — Blue Button 2.0 (Sandbox)`). Attributions still say “Blue Button APIs” where required ([#428](https://github.com/jwilleke/yourphr/issues/428)).

## What Blue Button 2.0 gives you

A national __FHIR R4__ API for Medicare beneficiaries. Claims/insurance data: __`ExplanationOfBenefit`__, __`Coverage`__, __`Patient`__. Complementary to clinical EHR records, not a replacement.

| | Sandbox | Production |
|---|---|---|
| FHIR base | `https://sandbox.bluebutton.cms.gov/v2/fhir` | `https://api.bluebutton.cms.gov/v2/fhir` |
| Data | Synthetic beneficiaries | Real enrollee claims (with consent) |
| Credentials | Self-serve developer portal | CMS production-access review ([#433](https://github.com/jwilleke/yourphr/issues/433)) |
| YourPHR path | Admin `/sandbox` (env-seeded) | Patient `/sources` (catalog `environment=production`) |

> __Sandbox status:__ ✅ E2E verified __2026-06-14__ (login → token → sync). ⛔ __Regressed 2026-07-31__, __reconfirmed 2026-08-01__ on demo.yourphr.org v1.19.1 — CMS synthetic beneficiary login (`BBUser00000` / `PW00000!`) shows *"We can't process your request at this time"*; no auth code reaches the relay (not a YourPHR callback bug). Details: [`vendors/medicare.md`](vendors/medicare.md). Use SMART Health IT for smoke tests until CMS restores sandbox login.

---

## Scopes (sandbox and production)

Use __exactly__ (also `models.BlueButtonSMARTScopes`):

```
openid profile launch/patient patient/Patient.read patient/Coverage.read patient/ExplanationOfBenefit.read
```

__Do not__ request (Blue Button returns `invalid_scope`):

- `patient/*.read` (no wildcard)
- `fhirUser`
- `offline_access` (sandbox rejects it; no refresh token → re-login for later re-sync)

---

## Sandbox (operators / developers)

### 1. Register a sandbox app

1. [CMS Blue Button developers](https://bluebutton.cms.gov/developers/) → __Sandbox__.
2. Register an application:

   | App setting | Value |
   |---|---|
   | __OAuth Client Type__ | __`confidential`__ |
   | __OAuth Grant Type__ | __`authorization-code`__ |
   | __Callback URL / Redirect URI__ | __Exactly__ this instance’s relay callback (see [Relay callback](#b-relay-callback-uri) below) |
   | __Collect beneficiary demographic data__ | __Yes__ |

3. Use the __Sandbox__ `client_id` / `client_secret` (not Production).

### 2. Wire YourPHR (preferred: env seed)

Set on the app deployment (never commit secrets):

```bash
YOURPHR_SANDBOX_BLUEBUTTON_CLIENT_ID=…
YOURPHR_SANDBOX_BLUEBUTTON_CLIENT_SECRET=…
# Plus relay — see Relay callback
YOURPHR_RELAY_PUBLIC_URL=https://your-public-relay.example
YOURPHR_RELAY_SECRET=…   # same secret as the relay process
```

On startup, YourPHR upserts __Medicare — Blue Button 2.0 (Sandbox)__ as `environment=sandbox`, enabled. Test from Admin → __Sandbox__, not patient Sources.

### 3. Alternate: Admin catalog

Admin → Provider Catalog: create/edit the sandbox Blue Button row (or env-seeded row), confidential secret, enabled. Connect from `/sandbox`.

### 4. Client id `/` gotcha

CMS portal may show `client_id/client_secret` as one string. Put __only__ the id in Client ID and the secret in Client Secret — never paste both into Client ID.

### Sandbox troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `invalid_client` / Application does not exist | Wrong id, Production id on sandbox, or id+secret jammed into Client ID | Sandbox id only in Client ID; secret separate |
| `invalid_scope` | Wildcard / `fhirUser` / `offline_access` | Use exact scopes above |
| Relay timeout + popup “Connected” | Login longer than connect wait | Raise `YOURPHR_WEB_SMART_CONNECT_LOGIN_WAIT_SECONDS` (default 240); or pre-login at CMS |
| Relay timeout, no “Connected” | Redirect URI mismatch or incomplete login | Callback must match [Relay callback](#b-relay-callback-uri) exactly |
| CMS “We can't process your request at this time” on `BBUser…` login (__2026-07-31__, __2026-08-01__ demo) | CMS sandbox synthetic login broken/changed; authorize never yields a code | Vendor-side — not a YourPHR callback bug. See [`vendors/medicare.md`](vendors/medicare.md); use SMART Health IT for E2E; watch CMS sandbox docs / [BlueButtonAPI@cms.hhs.gov](mailto:BlueButtonAPI@cms.hhs.gov) |
| ID.me / medicare.gov “patient data not found” (sandbox) | Sandbox has no real Medicare identity | Expected for synthetic path; do not use ID.me for BB sandbox |

---

## Production (#432) — operator checklist

__Goal:__ After CMS issues production credentials, enable patient __Medicare__ on `/sources` with __no code change__ and __no secrets in git__.

### A. CMS production app

1. Complete the full operator runbook: __[cms-bluebutton-production-access.md](cms-bluebutton-production-access.md)__ (email, form, Zoom script, PP/ToS gates — [#433](https://github.com/jwilleke/yourphr/issues/433)). CMS process: [production access](https://bluebutton.cms.gov/production-access/).
2. Register __production__ app with:
   - Confidential client, authorization-code
   - __Callback URL__ = this instance’s relay callback ([below](#b-relay-callback-uri)) — __exact match__
   - Demographic collection as required by your CMS registration
3. Receive __Production__ `client_id` and `client_secret` only via CMS (not the sandbox pair).

### B. Relay callback URI

1. As admin, open __Admin Dashboard → SMART OAuth Relay__ (or `GET /api/secure/source/relay-config`).
2. Copy __`callback_url`__ (public origin + `/callback`).
3. Register that __exact__ string with CMS (sandbox app and/or production app).
4. Ensure `YOURPHR_RELAY_PUBLIC_URL` (and `YOURPHR_RELAY_URL` / `YOURPHR_RELAY_SECRET` as needed) match how you deploy the relay. See [`deployment/README.md`](deployment/README.md) and [`SMART-flow-map.md`](SMART-flow-map.md).

### C. Production catalog entry (no code change)

YourPHR ships a __credential-free production template__ (migration):

| Field | Value |
|---|---|
| Display (admin) | `Medicare` |
| Environment | `production` |
| FHIR base | `https://api.bluebutton.cms.gov/v2/fhir` |
| Scopes | Blue Button SMART scopes above |
| Enabled | `false` until you add creds |
| Patient button label | __Medicare__ (enforced) |

#### Option 1 — Admin UI (any host)

1. Admin → __Provider Catalog__
2. Open entry __Medicare__ (or create with the values above if missing)
3. Set __Client ID__ / __Client Secret__ (production pair)
4. Set __Enabled__ = true
5. Save

#### Option 2 — Env seed (GitOps / k8s Secret)

```bash
YOURPHR_PROD_BLUEBUTTON_CLIENT_ID=…
YOURPHR_PROD_BLUEBUTTON_CLIENT_SECRET=…
```

On startup, YourPHR upserts the production __Medicare__ entry with those credentials and __enables__ it. Restart the app after setting env.

Never commit these values. Prefer a sealed Secret / external secret store.

### D. Enrollee path (verify)

1. User grants PP/ToS on __Account Profile__
2. __Sources__ → __Medicare__ (not “Blue Button”)
3. Pre-connect informed modal → Continue
4. CMS login → Authorize → import on Connected Sources
5. Disconnect / Remove data / combined teardown work from Connected Sources (#437)

### E. Operator contact (optional but useful for demos)

Admin → __Instance__ card: operator name / contact email / help URL for this deployment (not the OSS project). Enrollee-facing display of that contact may still be expanded later.

---

## How this maps to YourPHR internals

- __Catalog path__ — patient and sandbox UIs use provider-catalog authorize/connect (not BYO form for normal use).
- __Discovery + PKCE__ — `/.well-known/smart-configuration`; generic SMART client.
- __Confidential client__ — [#286](https://github.com/jwilleke/yourphr/issues/286).
- __No `$everything`__ — per-resource fetch ([#250](https://github.com/jwilleke/yourphr/issues/250)).
- __Patient id__ — may come from Coverage/EOB when token omits `patient` ([#293](https://github.com/jwilleke/yourphr/issues/293)).
- __Connection policy__ — PP/ToS + pre-connect modal ([connection-policy.md](connection-policy.md)).

## Related code / constants

| Item | Location |
|---|---|
| Sandbox seeds | `models.SandboxProviderSeeds()` + `YOURPHR_SANDBOX_BLUEBUTTON_*` |
| Production template | `models.ProductionMedicareCatalogTemplate()` |
| Production env seed | `database.SeedProductionMedicareProvider` + `YOURPHR_PROD_BLUEBUTTON_*` |
| Scopes constant | `models.BlueButtonSMARTScopes` |
