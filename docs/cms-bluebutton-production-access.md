# CMS Blue Button — production access runbook

Operator checklist to apply for __production__ Blue Button API credentials, run the CMS Zoom demo, and enable __Medicare__ on a YourPHR instance.

__CMS process (source of truth):__ [Production Access](https://bluebutton.cms.gov/production-access/)  
__CMS Terms:__ [Blue Button API Terms of Service](https://bluebutton.cms.gov/terms/)  
__Contact:__ [BlueButtonAPI@cms.hhs.gov](mailto:BlueButtonAPI@cms.hhs.gov)

| Related | Doc / issue |
|---|---|
| Sandbox credentials + live login status | [`vendors/medicare.md`](vendors/medicare.md) |
| Connect walkthrough (scopes, catalog, env) | [`medicare-bluebutton.md`](medicare-bluebutton.md) |
| Connection policy (PP/ToS, pre-connect) | [`connection-policy.md`](connection-policy.md) |
| Privacy Policy (source) | [`backend/pkg/legal/privacy-policy.md`](../backend/pkg/legal/privacy-policy.md) → public [yourphr.org/privacy.html](https://yourphr.org/privacy.html) |
| Terms of Service (source) | [`backend/pkg/legal/terms-of-service.md`](../backend/pkg/legal/terms-of-service.md) → public [yourphr.org/terms.html](https://yourphr.org/terms.html) |
| CMS attribution | [`Attributions.md`](Attributions.md) |
| Production E2E proof after credentials | [#408](https://github.com/jwilleke/yourphr/issues/408) |
| This runbook | [#433](https://github.com/jwilleke/yourphr/issues/433) |
| Demo host epic | [#438](https://github.com/jwilleke/yourphr/issues/438) |

---

## What “production access” means

| | Sandbox | Production |
|---|---|---|
| API base | `https://sandbox.bluebutton.cms.gov/v2/fhir` | `https://api.bluebutton.cms.gov/v2/fhir` |
| Data | Synthetic beneficiaries | Real enrollee claims (with consent) |
| Credentials | Self-serve developer portal | Issued only after CMS form + Zoom demo + post-approval form |
| YourPHR UI | Admin __`/sandbox`__ | Patient __`/sources`__ → __Medicare__ |

YourPHR already has a production catalog template and operator wiring; you do __not__ need a code change after CMS issues credentials — see [`medicare-bluebutton.md`](medicare-bluebutton.md) § Production.

---

## Process overview (CMS)

1. Read __[Blue Button API Terms of Service](https://bluebutton.cms.gov/terms/)__ end-to-end.
2. Develop and exercise the app against the __sandbox__ (as far as CMS sandbox health allows).
3. Publish __Privacy Policy__ and __Terms of Service__ (public URLs + PDF copies for the form).
4. Email [BlueButtonAPI@cms.hhs.gov](mailto:BlueButtonAPI@cms.hhs.gov) to request the production access form.
5. Submit the form (org/app info + PDF PP/ToS).
6. Schedule and deliver a __~1 hour Zoom demo__.
7. Address any CMS follow-ups.
8. Complete the __post-approval form__ (directory listing preferences).
9. Receive __production__ `client_id` / `client_secret` → enable YourPHR production Medicare entry (env or Admin catalog).

CMS typically acknowledges the initial email within ~24 business hours. PP/ToS change reviews after approval: ~5 business days (do __not__ ship PP/ToS changes until CMS approves).

---

## Gate: product readiness (YourPHR)

These ship targets map to closed CMS prep issues. Re-check on the __demo host__ you will show CMS (prefer <https://demo.yourphr.org>).

| CMS expectation | YourPHR capability | Verify |
|---|---|---|
| Public Privacy Policy | [yourphr.org/privacy.html](https://yourphr.org/privacy.html) | Opens, dated, Medicare / disconnect language current |
| Public Terms of Service | [yourphr.org/terms.html](https://yourphr.org/terms.html) | Opens; does not contradict PP |
| Active opt-in (not default-agree) | Account Profile → Privacy & Terms (#427) | Unchecked checkbox + Grant consent |
| In-app PP/ToS links | Account Profile + consent URLs | Same public URLs as above |
| Pre-connect informed messaging | Sources / Medicare modal (#430) | Cancel / Continue; claims-oriented copy |
| Label source __Medicare__ | Production picker (#429) | List shows __Medicare__, not “Blue Button” |
| CMS non-endorsement | `/attributions` + Medicare connect (#428) | Required sentence visible |
| Enrollee controls | Sources Actions (#431 / #437) | Disconnect; Remove data; combined teardown |
| Revoke product consent | Account Profile revoke | Blocks new Medicare connects; disconnects Medicare-class tokens (records stay until Remove data) |
| Secure tokens / no project PHI | Architecture | Tokens on instance; relay never sees tokens ([SMART-flow-map.md](SMART-flow-map.md)) |

__Demo host checklist (day-of):__

- [ ] App version known (footer / release tag); prefer latest released image with #437 controls if possible  
- [ ] Relay healthy: Admin → SMART OAuth Relay shows `callback_url` (e.g. `https://demo-relay.yourphr.org/callback`)  
- [ ] Sandbox Blue Button entry enabled __or__ SMART Health IT enabled for OAuth smoke  
- [ ] Production Medicare entry remains __disabled__ until production secrets exist (do not show live real Medicare until approved)  
- [ ] Operator contact on Admin Instance card filled if you want CMS to see a support path  

---

## Gate: Privacy Policy & Terms (form attachments)

### Public URLs (submit these on the form)

| Document | URL |
|---|---|
| Privacy Policy | `https://yourphr.org/privacy.html` |
| Terms of Service | `https://yourphr.org/terms.html` |

Source of truth in-repo: `backend/pkg/legal/privacy-policy.md`, `backend/pkg/legal/terms-of-service.md` (moved there in [#463](https://github.com/jwilleke/yourphr/issues/463) so they can be embedded and served by the instance at `/privacy` and `/terms`). After editing source, republish `gh-pages` (`privacy.html` / `terms.html`) before attaching PDFs.

__Which URL to submit.__ CMS asks for a public URL, so submit the `yourphr.org` pages — an instance URL may sit behind auth or be unreachable from outside. The instance serves the same text unless its operator has published their own; see the operator override in [`deployment/README.md`](deployment/README.md).

### PDF for CMS form

CMS asks for __PDF__ attachments. Generate from the __published__ HTML (so pagination matches what enrollees see):

```bash
# Example — print to PDF from a browser, or:
# open https://yourphr.org/privacy.html → Print → Save as PDF
# open https://yourphr.org/terms.html → Print → Save as PDF
```

Store PDFs __outside git__ (e.g. `private/cms-application/`) with a date stamp:

```text
private/cms-application/YourPHR-Privacy-Policy-YYYY-MM-DD.pdf
private/cms-application/YourPHR-Terms-of-Service-YYYY-MM-DD.pdf
```

### PP checklist vs CMS production-access page

Confirm the published PP still covers (CMS wording summarized):

- How data is collected / used / shared (including Medicare path)  
- Third parties (providers, sign-in relay, operator host)  
- De-identified / anonymized data (stock product: not sold)  
- What happens on revoke / disconnect / remove data / delete account  
- Dormant / closed accounts  
- How users are notified of policy updates  
- Breach notification intent  
- Sale of company / change of control if applicable  

YourPHR PP is written for __self-hosted__ software: the __instance operator__ holds data; the open-source project does not. Be ready to explain that on Zoom.

### PP/ToS __changes after__ CMS approval

1. Draft new PP/ToS in `backend/pkg/legal/`.  
2. Draft enrollee notification text (what changed + how to opt out / delete).  
3. Email both to [BlueButtonAPI@cms.hhs.gov](mailto:BlueButtonAPI@cms.hhs.gov) __before__ shipping.  
4. Wait for CMS approval (they target five business days).  
5. Then publish `gh-pages` and in-app links.

---

## Application email (operator)

Send when gates above are green enough for a Zoom (product controls + public PP/ToS; live Medicare sandbox optional — see Demo script).

__To:__ [BlueButtonAPI@cms.hhs.gov](mailto:BlueButtonAPI@cms.hhs.gov)  
__Subject:__ Production access request — YourPHR (self-hosted personal health record)

```text
Hello Blue Button API team,

We request production access for the YourPHR application (open-source,
self-hosted personal health record viewer).

Organization: [legal entity / operator name]
Application name: YourPHR
Primary contact: [name, email, phone]
Website: https://yourphr.org
Demo host (if ready): https://demo.yourphr.org
Repository: https://github.com/jwilleke/yourphr
Privacy Policy: https://yourphr.org/privacy.html
Terms of Service: https://yourphr.org/terms.html

We have developed against the Blue Button sandbox as a confidential client
(authorization-code + PKCE) and are prepared to complete the production
access form and a Zoom demo of the enrollee journey.

Thank you,
[Name]
```

CMS replies with the __production access form__ link. Fill it and attach the dated PP/ToS PDFs.

### Form field prep (fill offline first)

Keep answers in `private/cms-application/form-answers.md` (gitignored) so they are consistent across form and Zoom.

| Topic | Suggested direction for YourPHR |
|---|---|
| What the app does | Self-hosted PHR: import FHIR / connect patient-access APIs; display records for the account holder |
| Who uses it | Individuals / families on instances they or a trusted operator run; free open-source software |
| Data types from Blue Button | Patient, Coverage, ExplanationOfBenefit (claims-oriented) |
| How data is used | Display and organize for that user on that instance only; not advertising; not sold |
| Sharing with third parties | Not by the stock product; operator may add features — must disclose |
| Storage | Encrypted SQLite (or operator config) on the instance; operator backups |
| Security | Instance-local tokens; HTTPS; HttpOnly session cookie; no project-side PHI store |
| Redirect / callback | Instance OAuth relay callback (e.g. `https://demo-relay.yourphr.org/callback`) — exact match |
| Client type | Confidential |
| Grant | Authorization code |
| Scopes | See [`medicare-bluebutton.md`](medicare-bluebutton.md) (exact list; no wildcards / no offline_access in sandbox) |

---

## Demo script (Zoom, ~1 hour)

CMS asks for a __substantially complete__ enrollee journey. Script for <https://demo.yourphr.org> (adjust host if needed).

### A. Pre-flight (15 min before call)

1. Fresh browser profile or private window.  
2. Confirm relay callback URL from Admin (if admin account available).  
3. Confirm PP/ToS pages load.  
4. Decide __data path for “show Medicare-shaped data”__ (pick one):

| Path | When to use | Notes |
|---|---|---|
| __A1 — Blue Button sandbox__ | CMS synthetic login works | Preferred for “authorize Medicare” authenticity. __As of 2026-07-31 / 2026-08-01, CMS sandbox login is failing__ for `BBUser…` ([`vendors/medicare.md`](vendors/medicare.md)). |
| __A2 — SMART Health IT__ | Sandbox BB broken | Proves YourPHR OAuth + import + Explore end-to-end; tell CMS BB sandbox is currently unavailable vendor-side. |
| __A3 — Manual FHIR / prior import__ | Last resort | Show Explore + controls only; be explicit that live CMS authorize will be shown when sandbox or prod credentials allow. |

### B. Spoken arc (map to CMS bullets)

| CMS wants | Demo step | Route / action |
|---|---|---|
| Account creation | Sign up / sign in on demo | `/auth/signup` or sign-in |
| Active PP/ToS opt-in | Account Profile → check box → Grant consent | `/account-profile` |
| Informed connect | Sources → Medicare (or sandbox Medicare entry) → pre-connect modal | `/sources` or Admin `/sandbox` |
| CMS attribution | Point at notice near connect + full `/attributions` | |
| User authorization | CMS login popup → authorize (or SMART Health IT) | Relay callback must match registration |
| How data is displayed | Connected Sources → Explore claims/coverage/patient | `/explore/...` |
| How data is used | State: “stored only on this instance for this user; project does not receive it” | |
| Enrollee controls | Actions → __Disconnect__ (tokens only); __Remove data__; optional combined teardown | #437 |
| Revoke product consent | Account Profile → Revoke (if time) | Tokens cleared for Medicare-class sources |
| Sharing with others | Stock product: __no__ multi-user share of Medicare data — say so if asked (#256 is future) | |

### C. Timed outline (~50 min + Q&A)

1. __0–5 min__ — Intro: YourPHR mission, self-hosted vs project, GPL, no project PHI.  
2. __5–12 min__ — Create account; show PP/ToS links; grant consent (active opt-in).  
3. __12–20 min__ — Sources list: __Medicare__ label; pre-connect modal (collect / store / disconnect / not medical advice); CMS attribution.  
4. __20–35 min__ — Connect path (A1/A2/A3); wait for import; open Explore; show EOB/Coverage/Patient if present.  
5. __35–45 min__ — Controls: Disconnect vs Remove data; Attributions page; optional revoke.  
6. __45–55 min__ — Security model: confidential client, PKCE, relay (code only), tokens on instance.  
7. __55–60 min__ — PP/ToS Q&A; next steps (post-approval form, directory listing).

### D. Honest talk tracks

__If CMS sandbox login is still broken:__

> “Our OAuth client and relay reach CMS authorize successfully. As of [date], CMS synthetic beneficiary login returns *can't process your request* for published `BBUser` credentials, so we cannot complete live Blue Button sandbox authorize today. We can demonstrate the full YourPHR journey with SMART Health IT and show Medicare UI, policy, and controls. We previously completed Blue Button sandbox E2E on 2026-06-14.”

__Self-hosted privacy model:__

> “Enrollees’ data stays on the instance they use. The open-source project and yourphr.org do not receive claims or tokens. Operators who host for others must secure that deployment under their own obligations.”

__Labeling:__

> “In multi-source pickers the source is labeled __Medicare__, per CMS UI guidance. Attributions correctly name the Blue Button APIs.”

### E. After the demo

- Note any CMS concerns in `private/cms-application/demo-notes-YYYY-MM-DD.md`.  
- Fix product gaps if any; re-demo only if CMS requests.  
- Do __not__ enable production credentials until post-approval form and CMS handoff.

---

## Post-approval

1. Complete CMS __post-approval form__ (Medicare connected apps directory preferences).  
2. Receive production `client_id` / `client_secret`.  
3. Store __only__ in operator secret store / k8s Secret — never git.  
4. Enable YourPHR production Medicare:

```bash
YOURPHR_PROD_BLUEBUTTON_CLIENT_ID=…
YOURPHR_PROD_BLUEBUTTON_CLIENT_SECRET=…
```

   Or Admin → Provider Catalog → __Medicare__ → set secrets → Enabled.  
5. Register production callback URI __exactly__ as Admin reports `callback_url`.  
6. Smoke-test with a real enrollee identity only if you are authorized (operator’s own Medicare, etc.).  
7. Track remaining proof work on [#408](https://github.com/jwilleke/yourphr/issues/408).

---

## Operator status log (fill as you go)

| Step | Date | Notes |
|---|---|---|
| Sandbox app registered | | callback URI: |
| Sandbox E2E last green | 2026-06-14 | regressed 2026-07-31+ |
| PP/ToS published | | URLs above |
| PP/ToS PDFs generated | | path in private/ |
| Application email sent | | |
| Form submitted | | |
| Zoom demo | | |
| CMS follow-ups closed | | |
| Post-approval form | | |
| Production credentials received | | |
| Production Medicare enabled | | host: |

---

## Related links

- CMS production access: <https://bluebutton.cms.gov/production-access/>  
- CMS developer sandbox: <https://sandbox.bluebutton.cms.gov/>  
- Developer docs: <https://bluebutton.cms.gov/api-documentation/>  
- Google Group: [Developer-group-for-cms-blue-button-api](https://groups.google.com/g/Developer-group-for-cms-blue-button-api)  
- YourPHR deployment: [`deployment/README.md`](deployment/README.md)  
- Releasing (demo image is release-gated): [`releasing.md`](releasing.md)  
