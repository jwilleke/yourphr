# Privacy Policy — YourPHR

__Public URL:__ [https://yourphr.org/privacy.html](https://yourphr.org/privacy.html)

__Related:__ [Terms of Service](terms) (rules of use, warranty, license — not repeated here).

Last updated: 31 July 2026

---

## Who this covers

YourPHR is __self-hosted__ personal health record software.

| Role | Role for privacy |
|---|---|
| __User__ | Your records on the instance you use |
| __Instance operator__ | Runs the server; responsible for that deployment’s security, access, backups, and any legal duties |
| __YourPHR project / yourphr.org__ | Publishes software and this site; does __not__ hold your health or Medicare data |

If someone else hosts your instance, ask __them__ how they protect your data.

---

## What data is involved

__On an instance:__ health records you import (including Medicare claims-related data such as Coverage and ExplanationOfBenefit when you connect Medicare); documents you upload; account login data for the instance; provider/OAuth tokens used to fetch data you authorized.

__Not by the project:__ maintainers and yourphr.org do not receive your health records, Medicare claims, or tokens.

__This website:__ static pages only; no health data; no first-party analytics cookies. The host may log standard request metadata (e.g. IP).

---

## How data is collected (including Medicare)

You may import files yourself or connect a patient-access API (SMART on FHIR), including __Medicare via CMS Blue Button__.

When you connect Medicare (or another provider):

1. You sign in with __that provider / CMS__ — not with a YourPHR project account. We never ask for your Medicare.gov password.
2. You authorize __read__ access to the scopes requested.
3. A short-lived OAuth __code__ may pass through a public __sign-in relay__ (~60 seconds in memory). The relay does __not__ get tokens or health data. Your instance exchanges the code for tokens __directly with the provider/CMS__.
4. Tokens stay __encrypted on the instance__. Imported data is stored and shown only there (and on operator backups).

__Shared with CMS:__ only what OAuth/API requires. __Shared with the YourPHR project:__ nothing about your Medicare or clinical data.

__How long:__ the instance may re-sync while the connection is authorized. On __Sources__, you can __Disconnect__ (clear stored OAuth tokens; imported records stay), __Remove data__ (delete records imported from that source on this instance), or __Disconnect & remove data__ (both, and remove the source card). __Delete account__ removes your whole account and all of your data on this instance. Operator backups may still hold copies until the operator prunes them.

---

## How data is used

Only to display and organize health information for users of that instance.

The stock software is __not__ designed to sell data, use it for advertising/marketing, or train commercial AI on your records. Default product does not send Medicare data to third parties for their own use. If an operator adds export/share features, they must disclose that.

__De-identified data:__ stock software does not package your data for sale/research as de-identified datasets. Even “anonymized” health data can sometimes re-identify people.

---

## Third parties

| Who | Role |
|---|---|
| CMS / your providers | You authorize; they supply data under their rules |
| Sign-in relay | OAuth code only (~60s); no health data, no tokens |
| Operator’s host / reverse proxy / SSO | Access control and hosting — operator must secure them |
| GitHub Pages | Serves yourphr.org only |

---

## Your control

- Do not connect Medicare (or any source) if you do not want that import
- __Disconnect__ (Sources → Actions): clears OAuth tokens so the instance stops syncing; imported records stay until you remove them
- __Remove data__ (Sources → Actions): deletes records imported from that source on this instance
- __Disconnect & remove data__ (Sources → Actions): both, and removes the source card
- __Revoke Privacy & Terms__ (Account Profile): blocks new Medicare connects and __disconnects__ Medicare-class sources (tokens only; records stay until you remove them)
- __Delete account__ (Account Profile): permanently deletes your account and all of your data on this instance
- Ask the operator about backups or a full deployment wipe if needed

__Dormant/closed accounts:__ data remains on the operator’s storage until removed (including any backups). The project holds no enrollee databases.

---

## Security

Local storage, encryption at rest when enabled, no project copy of records, short-lived relay codes. Operators must also use HTTPS, access control, secure backups, and current software.

---

## Breach notification

The __instance operator__ handles breaches of data on their deployment and notifies people as required by law (including, where applicable, the FTC Health Breach Notification Rule for personal health records).

The project does not hold your instance data. If project-run infrastructure (e.g. the public relay or this site) is involved in an incident, we will communicate through appropriate public channels.

---

## Sale or change of control

Open-source maintainer changes do __not__ move your database. If a __hosted operator__ is sold or changes data use, they must notify you when required; you should be able to disconnect sources and delete data.

---

## Changes to this policy

We may update this policy; the date above will change. For a CMS-approved Blue Button production app, policy/notice changes may need CMS review before rollout.

---

## Contact

__Your instance first.__ Your records are held by whoever operates the instance you use — they are the people to ask about your data, to correct it, or to have it removed. Their contact details are on the __Contact__ page of that instance, filled in by the operator; if they have published none, the software cannot supply one on their behalf.

- Your instance: its [__Contact__ page](contact) — filled in by whoever operates it
- Project (bugs, features — no access to anyone's records): [GitHub issues](https://github.com/jwilleke/yourphr/issues)
- CMS Blue Button: [BlueButtonAPI@cms.hhs.gov](mailto:BlueButtonAPI@cms.hhs.gov)

This document deliberately names no operator. It is the same policy on every instance, and each is run by a different party — so the operator's identity comes from the instance itself, not from here.
