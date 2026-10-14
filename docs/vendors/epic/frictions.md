# Epic frictions — what it costs a free patient app to reach Epic patients

A running record of every place Epic's process slowed yourPHR down, cost work, or failed silently. Each entry says what happened, when, what it cost, and what we did. It's written from our own experience, with dates and evidence, so the next decision rests on what happened rather than on what Epic's documents promise.

Why keep it: yourPHR's mission is "Your medical records, immediately and in your hands — for free." Epic runs the record systems for most US hospitals, so its process is the gate between a patient and their own records. The 21st Century Cures Act and its information-blocking rules exist for exactly this. If friction ever needs to be raised with Epic, ONC, or anyone else, this is the evidence.

Related: [`epic.md`](./epic.md) (how to connect), [`../production-onboarding.md`](../production-onboarding.md) (the dated production log), [`../clientid-friction.md`](../clientid-friction.md) (client-ID friction across vendors), [#863](https://github.com/jwilleke/yourphr/issues/863), [#924](https://github.com/jwilleke/yourphr/issues/924).

## Summary

| # | Friction | First hit | Cost | Status |
|---|---|---|---|---|
| 1 | One out-of-scope API silently paused the app at every organization | 2026-09-27 | 2+ weeks, a replacement app | Worked around (new app 62263) |
| 2 | A released app's API list is locked for good | 2026-10-07 | Forced the replacement app | Permanent |
| 3 | Support answers slowly, partly, or not at all | 2026-09-27 | Weeks of waiting | Ongoing |
| 4 | "Automatic" distribution still needs per-organization activation for refresh-token apps | 2026-10-14 | 522 organizations × 2 activations, each with a credential | Open ([#924](https://github.com/jwilleke/yourphr/issues/924)) |
| 5 | Refresh tokens only for confidential clients, which is what triggers #4 | 2026-07-31 | Confidential client, then per-organization credentials | Open |
| 6 | Deactivate does nothing on a production-ready app | 2026-10-14 | The old app can't be retired by us | Asked Epic |
| 7 | Silent form failures on the developer site | 2026-10-14 | Guesswork, lost answers | Worked around |
| 8 | A replacement app can't copy the original | 2026-10-14 | 2 APIs dropped | Accepted |
| 9 | Distribution status is opaque, and errors don't say why | 2026-10-14 | Can't tell "not yet synced" from "unknown app" | Ongoing |
| 10 | Every step is a manual click in the portal; no API | ongoing | Hours per change | Ongoing |

## 1. One API outside the list silently paused the app everywhere

- __What:__ app 56252 was marked Ready for Production with USCDI v3 automatic distribution on 2026-08-19. By 2026-09-27, 519 organizations had requested it, and every one showed *"Syncing to Production has been temporarily disabled for this customer by Epic while your app is modified."* Nothing said what modification, or that anything was wrong.
- __Why:__ the app had 12 APIs (six Read/Search pairs) outside the USCDI v3 appendix. None of them was used by yourPHR, and none was flagged when the app was marked ready.
- __Cost:__ zero patients could connect at any Epic organization for weeks. Finding the cause took an email and five days of waiting.
- __What we did:__ compared all 247 selected APIs by hand against the appendix of *Patient-Facing Apps Using FHIR*. The app page and the appendix name some APIs differently (Generated CDAs vs Generated CCDA, Vital Signs vs Vitals), so it had to be compared on resource, operation, version, and variant.
- __What would have prevented it:__ the developer site checking the API list against the appendix when "USCDI v3" is selected, and refusing to mark the app ready until it passes.

## 2. A released app's API list is locked for good

- __What:__ once an app is Ready for Production, *Edit* opens a notice: *"You can only edit the Non-Production JWK Set URL and Production JWK Set URL fields and add new Endpoint URIs."* APIs can't be removed. Epic's own advice is to create a new client ID.
- __Cost:__ fixing #1 needed a whole new app (62263): new client IDs and secrets, the questionnaire answered again, new catalog configuration, and the 519 requests on the old app thrown away.
- __What we did:__ built app 62263 with 233 APIs on 2026-10-14. It was Ready for Production the same day, and 522 organizations requested it within hours.

## 3. Support is slow, partial, or silent

- 2026-09-27: asked <open@epic.com> what modification Epic was waiting on, and whether per-organization activation with a client secret was the next step.
- 2026-10-02 (five days later): answered the first question in one sentence. The second question went unanswered.
- 2026-10-07: sent the list of out-of-scope APIs and asked Epic to remove them or unlock the list, repeating the per-organization question. __No reply.__ Seven days later we stopped waiting and replaced the app.
- 2026-10-14: asked Epic to retire 56252, and asked three questions about activating at scale.
- __Cost:__ every Epic-dependent step waits on a channel that may never answer. __Working rule from 2026-10-14: don't plan around an Epic reply.__ Act on the documentation, on evidence we gather ourselves, and on what other developers report.

## 4. "Automatic" distribution still needs per-organization activation

- __What:__ 62263's 522 requests arrived automatically, but each sits at "Not responded", and *Client ID Downloads* reads 0. Each organization needs *Activate for Non-Production*, then *Activate for Production*. Each activation asks how the app authenticates (JWK Set URL, or client secret / JWKS), and Epic recommends a separate secret for every organization and environment.
- __Epic's own wording:__ auto-sync apps *"sync automatically once a client secret or public key is provisioned for that organization"* ([community member enabled apps](https://fhir.epic.com/Documentation?docId=epiccommunitymemberenabledapps)). The condition in *Patient-Facing Apps Using FHIR* reads: *"Does not use refresh tokens OR uses refresh tokens and has a client credential uploaded by the vendor for that community member."*
- __Why it can't work for us:__ yourPHR is for any patient anywhere, so we can't know which of the 522 organizations will be used. Activating every one twice by hand, and storing 1,044 secrets, is not a process; it's a wall.
- __What others did:__ Josh Mandel hit the same ~500 organizations in 2026-02. He scripted the portal's internal approve call (496 of 500 in about 10 minutes), used a JWK Set URL, and found some organizations' networks blocked the key fetch ([activation journal](https://github.com/jmandel/health-skillz/blob/main/blog/epic/2026-02-11-epic-activation-journal.md)). There is no supported bulk action.
- __Status:__ open in [#924](https://github.com/jwilleke/yourphr/issues/924). Nothing gets activated until the intended method is confirmed.

## 5. Refresh tokens only for confidential clients

- __What:__ Epic issues no refresh tokens to a public standalone patient app. Without them, a patient has to sign in again about every hour. Epic's alternative for public apps is dynamic client registration.
- __Chain:__ to keep patients signed in, we became a confidential client (2026-08-19). A confidential client needs a credential per organization (#4). Dynamic client registration is a box that has to be ticked when the app is created, and it's locked after release (#2).
- __Cost:__ every route to "connect once and stay connected" goes through either per-organization activation or a new app plus a dynamic-client-registration implementation.

## 6. Deactivate does nothing on a production-ready app

- __What:__ on 56252 (0 downloads, paused), *Deactivate This App* gives no error, no confirmation, and no change. The app stays "Production Ready".
- __Cost:__ two apps named YourPHR are offered to organizations, and only Epic can retire the old one.
- __What we did:__ asked Epic to retire it (2026-10-14). It's harmless while paused.

## 7. Silent form failures on the developer site

- __Create an App:__ *Save* does nothing until an Endpoint URI is entered, and that field only appears after the *Patients* audience option is clicked. No message is shown; the check (`IsCreateInvalid`) runs and quietly stops the submit.
- __Data use questionnaire:__ every question has its own *Save Changes*, and an unsaved answer is lost on navigation without warning. The *"I understand customers will have access to my responses"* acknowledgment re-appears on every reload and hides the questions until clicked again. Clicks in the 2018 tab do nothing while the 2021 tab is active. Two answers were lost this way on the first filing.
- __Long sessions:__ the portal signs out during long work, and a half-filled form is lost.
- __Cost:__ every form needs a second check after saving.

## 8. A replacement app can't copy the original

- __What:__ `Observation.Read (Flowsheets) (R4)` and `Observation.Search (Flowsheets) (R4)` were selected on 56252 but are no longer offered to new apps.
- __Cost:__ small for us (yourPHR's sync doesn't request them), but it means a replacement app is never guaranteed to match.

## 9. Distribution status is opaque, and errors don't say why

- __What:__ changes can take up to 12 hours to reach customer sites. Meanwhile, an organization's authorize page answers our real client ID exactly as it answers a made-up one: *"OAuth2 Error. Something went wrong trying to authorize the client."*
- __Cost:__ we can't tell "not synced yet", "not activated", and "wrong ID" apart without waiting a day and trying again.

## 10. Every step is a manual click in the portal

- __What:__ app creation, the 247-API picker (search, click, `>>`, one at a time), questionnaires, activation, and secrets are all done by hand in fhir.epic.com. There's no public API, and no way to export or import an app's configuration.
- __Cost:__ rebuilding one app took hours of careful clicking. Activating 522 organizations would take days.

## Reporting this to the US government

The 21st Century Cures Act (2016) forbids *information blocking*, and Epic, as a developer of certified health IT, is covered. ASTP/ONC's API Conditions of Certification (45 CFR 170.404) set the rules for patient-access APIs. The one most relevant here: once a developer has verified an app developer's authenticity, it must __register and enable the app for production use within five business days__ (§ 170.404(b)(1)(ii)). ASTP/ONC's guidance treats refusing or delaying app registration as both an API problem and an information-blocking problem. Check the current eCFR text before citing a paragraph number, because a December 2025 proposal would renumber parts of § 170.404.

__Where to file:__

- __ASTP/ONC Health IT Feedback and Inquiry Portal__, which has a dedicated section for API complaints: <https://inquiry.healthit.gov/>
- __ASTP/ONC Information Blocking Portal__, reached from <https://www.healthit.gov/topic/information-blocking>
- __HHS-OIG Hotline__, the enforcement side for developers (civil money penalties): <https://oig.hhs.gov/fraud/report-fraud/>

ASTP/ONC recommends raising the problem with the developer first. That's done and documented in #3 (2026-09-27, 10-02, 10-07, 10-14).

__What this record supports, stated factually:__

- __Delay:__ the app was Ready for Production on 2026-08-19 and was usable at zero organizations as of 2026-10-14. Client ID Downloads was 0 on both apps.
- __A silent pause__ at all 519 organizations, with no notice of the cause; the cause was only given on request, five days later (#1).
- __Non-response__ to direct questions about how to get enabled (#3).
- __A per-organization activation burden__ (522 organizations × 2, each with a credential) for an app that qualifies for "automatic" distribution (#4).
- __No way to retire or correct a released app__ without Epic (#2, #6).

This record is evidence, not a legal conclusion. Whether any of it meets the legal definition of information blocking is for ASTP/ONC and HHS-OIG to decide. Before filing, copy the evidence into the complaint: dates, Epic's quoted wording, screenshots of the Manage Downloads page and the app page, and the email thread.

## What would remove most of this

For the record, this is what would let a free patient app work at every Epic organization:

1. Check the API list against the chosen distribution type before an app can be marked ready (#1).
2. Let a production app drop APIs, since removing access can only reduce risk (#2).
3. Let one app-level JWK Set URL count as the credential for every organization (#4, #5).
4. A supported bulk action for download requests (#4, #10).
5. Distinct errors for "unknown client" and "client not yet synced or activated" (#9).
6. A working Deactivate, or an answer when asked (#3, #6).

## Log

| Date | Entry |
|---|---|
| 2026-07-31 | Public client gets no refresh token; patients would have to reconnect hourly (#5). |
| 2026-08-19 | Became a confidential client with persistent access. 56252 Ready for Production. |
| 2026-09-27 | 519 organizations requested 56252; all paused. Asked Epic (#1, #3). |
| 2026-10-02 | Epic's partial answer: APIs outside USCDI v3 (#1, #3). |
| 2026-10-07 | API list locked on the released app; asked Epic to edit or unlock. No reply (#2, #3). |
| 2026-10-14 | Built 62263; silent Create failure (#7); Flowsheets not offered (#8); Deactivate dead (#6); 522 requests at 0 downloads, needing per-organization activation (#4); generic OAuth error (#9). Filed [#924](https://github.com/jwilleke/yourphr/issues/924). |
