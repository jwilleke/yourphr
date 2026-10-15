# Production onboarding log

What it took, vendor by vendor, to get yourPHR from a working sandbox to __real patients at real organizations__. The sandbox guides (`epic/epic.md`, `oracle/oracle-cerner.md` and the rest) explain how to connect; this file records the production process itself: each step, when it happened, what blocked it, and what we would do differently. Add to it as things happen, newest last within each vendor, with the date and the issue.

Why it matters: getting a production client ID is the project's biggest blocker ([`clientid-friction.md`](./clientid-friction.md)), and each vendor's process is learned the hard way once. Writing it down is how the second time is quick.

## Status

| Vendor | Production state | Blocked on | Tracking |
|---|---|---|---|
| __Epic__ | Replacement app __62263__ built with only qualifying APIs (Test stage); 56252 paused at 521 organizations | Sandbox test of 62263, then Ready for Production; deactivate 56252 | [#863](https://github.com/jwilleke/yourphr/issues/863), [#408](https://github.com/jwilleke/yourphr/issues/408) |
| __CMS Blue Button__ | Runbook written; see it for the current step | CMS production access process | [`../cms-bluebutton-production-access.md`](./cms-medicare/cms-bluebutton-production-access.md), [#433](https://github.com/jwilleke/yourphr/issues/433) |
| __athenahealth__ | Sandbox only; record sharing gated on portal onboarding | Developer Portal approval | [#339](https://github.com/jwilleke/yourphr/issues/339) |
| __Oracle Health (Cerner)__ | __Recognised at real hospitals with no activation__ (2026-10-14): the self-service Patient app reaches the patient login at real Oracle hospitals | A real patient connect, and loading Oracle's 1,319-endpoint list into the catalog ([#925](https://github.com/jwilleke/yourphr/issues/925)) | [`oracle/oracle-cerner.md`](./oracle/oracle-cerner.md) |
| __Veradigm / FollowMyHealth__ | Sandbox `unauthorized_client` until Veradigm provisions the app | Veradigm | [#53](https://github.com/jwilleke/yourphr/issues/53) |

## Epic — app 56252, replaced by app 62263 (YourPHR)

### Lessons

- __Select only APIs from the USCDI v3 appendix before marking Ready for Production.__ Automatic client distribution, the only realistic path to "a patient connects her own MyChart", requires every selected API to be on that list (*Patient-Facing Apps Using FHIR* → Appendix). One stray API pauses every organization.
- __Once released, the Incoming APIs list is locked.__ The Build Apps page's Edit button then unlocks only redirect URIs, JWK Set URLs and descriptive text. Removing an API needs Epic, or a new app. Epic's own guidance: "you can always create a new client ID to enable additional APIs", so start narrow.
- __A refresh-token (confidential, persistent access) app needs a client credential uploaded per organization__ before it auto-distributes there.
- __The app page and the appendix name some APIs differently__ (Generated CDAs vs Generated CCDA, Vital Signs vs Vitals, Encounter vs Encounter-Level). Compare on resource, operation, version and variant, not on exact text.
- __The out-of-scope count was 12, not 10__: six Read/Search pairs. Count Read and Search separately.
- __Two of 56252's APIs are no longer offered to new apps__: `Observation.Read/Search (Flowsheets) (R4)`. A replacement app cannot be an exact copy.
- __Save on the Create page does nothing until an Endpoint URI is entered__, and that field appears only after the Patients audience is clicked. No error is shown.
- An app with __0 production downloads can still be deactivated__ by the developer, so a replacement app is possible if Epic will not edit the old one.

### Log

| Date | What happened |
|---|---|
| 2026-06-15 → 2026-08-01 | Sandbox: discovery, then end-to-end connect and import verified on production hosts ([`epic/epic.md`](./epic/epic.md#live-connect-log-dated)). |
| 2026-08-19 | App made a __confidential client with persistent access__ (Epic issues no refresh tokens to public standalone clients); refresh tokens proven in sandbox. Marked __Ready for Production__ with Automatic Client Distribution = USCDI v3. |
| by 2026-09-27 | __519 organizations__ requested the app through automatic distribution; every one shows "Syncing to Production has been temporarily disabled for this customer by Epic while your app is modified". Client ID downloads: 0. |
| 2026-09-27 | Asked <open@epic.com> what modification Epic is waiting on, and whether per-organization activation with a client secret is the next step. |
| 2026-10-02 | Epic (Hunter): the app "has many APIs outside the scope of USCDI v3 automatic client distribution"; it may use only the appendix APIs. Filed [#863](https://github.com/jwilleke/yourphr/issues/863) (P0). |
| 2026-10-07 | Compared the app's 245 selected APIs with the appendix: __10 do not qualify__, none of which yourPHR uses — ExplanationOfBenefit (Claim), and the Outside Record variants of QuestionnaireResponse, Organization, Practitioner, RelatedPerson and ServiceRequest (Read and Search each, R4). The list is locked on a released app, so asked Epic to remove them or unlock it, and repeated the per-organization credential question. |
| 2026-10-08 | Epic Vendor Services: since 10/1/26 __Activate makes an app available instantly__, with no review wait. |
| 2026-10-13 | Code trace ([#863](https://github.com/jwilleke/yourphr/issues/863), phobrla): yourPHR's Epic sync derives types from `patient/*.read` and requests none of the out-of-scope APIs. |
| 2026-10-14 | Prod backup (2026-10-13 02:00Z) checked read-only: __no production Epic catalog entry exists__; the sandbox entry is wildcard-only (`launch/patient patient/*.read openid fhirUser offline_access`). Removing the APIs costs Epic sync nothing. |
| 2026-10-14 | No reply from Epic since 10-07. On 56252, Edit confirmed: "You can only edit the Non-Production JWK Set URL and Production JWK Set URL fields and add new Endpoint URIs." Built replacement __app 62263__: the same settings and text as 56252, __233 APIs__ (56252's 247 minus the 12 out-of-scope and the 2 Flowsheets APIs no longer offered), new thumbnail, both data use questionnaires answered as on record ([`epic/data-use-questionnaire.md`](./epic/data-use-questionnaire.md)), sandbox client secret generated and held privately. Licking Memorial (9332) on 56252 showed the per-organization path: *Activate for Non-Production* first, then Production. |
| 2026-10-07 | Sandbox re-verified end to end on v3 (prod host, test account): 310 records imported. Found and fixed on the way: no relay configured on v3 ([#870](https://github.com/jwilleke/yourphr/issues/870)), and no client secret in the Epic catalog entry ([#871](https://github.com/jwilleke/yourphr/issues/871)). __Both would also have blocked production__, even after Epic lifts the hold. |

### Next

1. Sandbox test of app 62263: put its non-production client ID and new secret in the Epic (Sandbox) catalog entry, connect `epictest`, import.
2. Operator accepts the open.epic terms and marks 62263 __Save & Ready for Production__ (permanent: locks APIs and questionnaire answers).
3. Add a production Epic catalog entry (`patient/*.read`, 62263's production client ID, secret through the environment, [#871](https://github.com/jwilleke/yourphr/issues/871)).
4. Deactivate 56252 (0 downloads) once 62263 is live; tell Epic (<open@epic.com>) the replacement exists.
5. Per-organization credential for Licking Memorial Health Systems (9332), then a real patient connects her own MyChart end to end ([#408](https://github.com/jwilleke/yourphr/issues/408)).
